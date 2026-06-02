import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { env, pipeline } from '@huggingface/transformers';

type StartMessage = {
  type: 'start';
  file: File;
  duration: number;
  modelId: string;
  language: string;
};

type CancelMessage = {
  type: 'cancel';
};

type MainMessage = StartMessage | CancelMessage;

type AutomaticSpeechRecognitionPipeline = (
  audio: Float32Array,
  options?: Record<string, unknown>
) => Promise<unknown>;

type CreatePipeline = (
  task: 'automatic-speech-recognition',
  model: string,
  options: {
    progress_callback: (progress: unknown) => void;
  }
) => Promise<AutomaticSpeechRecognitionPipeline>;

const CHUNK_SECONDS = 30;
const OVERLAP_SECONDS = 5;
const STEP_SECONDS = CHUNK_SECONDS - OVERLAP_SECONDS;
const INPUT_NAME = 'input.mp4';
const DEFAULT_MODEL_ID = 'Xenova/whisper-large-v3';
const ALLOWED_MODEL_IDS = new Set([
  'Xenova/whisper-tiny',
  'Xenova/whisper-base',
  'Xenova/whisper-small',
  'Xenova/whisper-large-v3',
  'Xenova/whisper-tiny.en',
  'Xenova/whisper-base.en',
  'Xenova/whisper-small.en'
]);
const ALLOWED_LANGUAGES = new Set([
  'auto',
  'english',
  'dutch',
  'french',
  'german',
  'spanish',
  'italian',
  'portuguese',
  'polish',
  'ukrainian'
]);

const ffmpeg = new FFmpeg();
let ffmpegLoaded = false;
const transcriberCache = new Map<string, AutomaticSpeechRecognitionPipeline>();
let canceled = false;
let busy = false;

env.allowLocalModels = false;
env.useBrowserCache = true;
(env.backends as { onnx?: { wasm?: { numThreads?: number; proxy?: boolean } } }).onnx ??= {};
(env.backends as { onnx: { wasm?: { numThreads?: number; proxy?: boolean } } }).onnx.wasm ??= {};
(env.backends as { onnx: { wasm: { numThreads?: number; proxy?: boolean } } }).onnx.wasm.numThreads = 1;
(env.backends as { onnx: { wasm: { numThreads?: number; proxy?: boolean } } }).onnx.wasm.proxy = false;

self.postMessage({ type: 'ready' });

self.addEventListener('message', async (event: MessageEvent<MainMessage>) => {
  const message = event.data;

  if (message.type === 'cancel') {
    canceled = true;
    return;
  }

  if (busy) {
    self.postMessage({ type: 'error', message: 'A transcription is already running.' });
    return;
  }

  busy = true;
  canceled = false;

  try {
    await transcribeFile(
      message.file,
      message.duration,
      safeModelId(message.modelId),
      safeLanguage(message.language)
    );
    self.postMessage({ type: canceled ? 'canceled' : 'done' });
  } catch (error) {
    if (canceled) {
      self.postMessage({ type: 'canceled' });
    } else {
      self.postMessage({ type: 'error', message: errorMessage(error) });
    }
  } finally {
    busy = false;
    await safeDelete(INPUT_NAME);
  }
});

const transcribeFile = async (file: File, duration: number, modelId: string, language: string) => {
  await ensureFFmpegLoaded();
  const transcriber = await getTranscriber(modelId);

  self.postMessage({ type: 'status', message: 'Writing MP4 into ffmpeg.wasm memory...' });
  await safeDelete(INPUT_NAME);
  await ffmpeg.writeFile(INPUT_NAME, await fetchFile(file));

  const chunkStarts = buildChunkStarts(duration);

  if (chunkStarts.length === 0) {
    throw new Error('Could not determine any audio chunks for this MP4.');
  }

  for (let chunkIndex = 0; chunkIndex < chunkStarts.length; chunkIndex += 1) {
    throwIfCanceled();

    const start = chunkStarts[chunkIndex];
    const chunkName = `chunk_${chunkIndex}.wav`;
    const end = Math.min(start + CHUNK_SECONDS, duration);

    self.postMessage({
      type: 'progress',
      progress: Math.round((chunkIndex / chunkStarts.length) * 100),
      chunkIndex,
      chunkCount: chunkStarts.length
    });

    self.postMessage({
      type: 'status',
      message: `Extracting ${formatSeconds(start)} to ${formatSeconds(end)}...`
    });

    await extractChunk(start, chunkName);

    try {
      throwIfCanceled();
      const wavBytes = await ffmpeg.readFile(chunkName);
      const audio = decodeWavToFloat32(wavBytes);

      self.postMessage({
        type: 'status',
        message: `Transcribing chunk ${chunkIndex + 1} of ${chunkStarts.length}...`
      });

      const result = await transcribeAudio(transcriber, audio, modelId, language);
      throwIfCanceled();

      self.postMessage({
        type: 'chunk',
        chunkIndex,
        start,
        end,
        text: result
      });
    } finally {
      await safeDelete(chunkName);
    }
  }
};

const ensureFFmpegLoaded = async () => {
  if (ffmpegLoaded) return;

  self.postMessage({ type: 'status', message: 'Loading ffmpeg.wasm...' });

  const baseURL = new URL('../ffmpeg-core/', self.location.href).href;
  const classWorkerURL = new URL('../ffmpeg-wrapper/worker.js', self.location.href).href;
  self.postMessage({ type: 'status', message: 'Preparing ffmpeg core script...' });
  const coreURL = await toBlobURL(`${baseURL}ffmpeg-core.js`, 'text/javascript');
  self.postMessage({ type: 'status', message: 'Preparing ffmpeg core wasm...' });
  const wasmURL = await toBlobURL(`${baseURL}ffmpeg-core.wasm`, 'application/wasm');
  self.postMessage({ type: 'status', message: 'Starting ffmpeg worker...' });
  await ffmpeg.load({
    classWorkerURL,
    coreURL,
    wasmURL
  });
  self.postMessage({ type: 'status', message: 'ffmpeg.wasm loaded.' });

  ffmpegLoaded = true;
};

const getTranscriber = async (modelId: string) => {
  const cachedTranscriber = transcriberCache.get(modelId);
  if (cachedTranscriber) {
    self.postMessage({
      type: 'status',
      message: `Using cached Whisper model ${modelId}.`
    });
    return cachedTranscriber;
  }

  self.postMessage({
    type: 'status',
    message: `Loading Whisper model ${modelId}...`
  });
  self.postMessage({
    type: 'status',
    message: browserCacheAvailable()
      ? 'Using browser storage for downloaded model files.'
      : 'Browser model-file cache is not available in this environment.'
  });

  const createPipeline = pipeline as unknown as CreatePipeline;
  const loadedTranscriber = await createPipeline('automatic-speech-recognition', modelId, {
    progress_callback: (progress: unknown) => {
      if (
        progress &&
        typeof progress === 'object' &&
        'file' in progress &&
        'progress' in progress &&
        typeof progress.progress === 'number'
      ) {
        self.postMessage({
          type: 'status',
          message: `Loading model file ${progress.file}: ${Math.round(progress.progress)}%`
        });
      }
    }
  });
  transcriberCache.set(modelId, loadedTranscriber);
  return loadedTranscriber;
};

const buildChunkStarts = (duration: number) => {
  const starts: number[] = [];
  for (let start = 0; start < duration; start += STEP_SECONDS) {
    starts.push(start);
    if (start + CHUNK_SECONDS >= duration) break;
  }
  return starts;
};

const extractChunk = async (start: number, outputName: string) => {
  await safeDelete(outputName);
  await ffmpeg.exec([
    '-ss',
    String(start),
    '-t',
    String(CHUNK_SECONDS),
    '-i',
    INPUT_NAME,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    outputName
  ]);
};

const transcribeAudio = async (
  transcriber: AutomaticSpeechRecognitionPipeline,
  audio: Float32Array,
  modelId: string,
  language: string
) => {
  const options = buildTranscriptionOptions(modelId, language);
  const output = await transcriber(audio, options);

  if (Array.isArray(output)) {
    return output.map((item) => ('text' in item ? String(item.text) : '')).join(' ').trim();
  }

  if (output && typeof output === 'object' && 'text' in output) {
    return String(output.text).trim();
  }

  return String(output).trim();
};

const decodeWavToFloat32 = (input: Uint8Array | string) => {
  if (typeof input === 'string') {
    throw new Error('Expected wav bytes but received a string from ffmpeg.');
  }

  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const riff = readAscii(view, 0, 4);
  const wave = readAscii(view, 8, 4);
  if (riff !== 'RIFF' || wave !== 'WAVE') {
    throw new Error('Extracted audio is not a WAV file.');
  }

  let offset = 12;
  let audioFormat = 1;
  let bitsPerSample = 16;
  let dataOffset = -1;
  let dataSize = 0;

  while (offset + 8 <= view.byteLength) {
    const id = readAscii(view, offset, 4);
    const size = view.getUint32(offset + 4, true);
    offset += 8;

    if (id === 'fmt ') {
      audioFormat = view.getUint16(offset, true);
      bitsPerSample = view.getUint16(offset + 14, true);
    } else if (id === 'data') {
      dataOffset = offset;
      dataSize = size;
      break;
    }

    offset += size + (size % 2);
  }

  if (dataOffset < 0) {
    throw new Error('Could not find WAV data chunk.');
  }

  if (audioFormat !== 1 || bitsPerSample !== 16) {
    throw new Error(`Expected 16-bit PCM WAV, got format ${audioFormat} with ${bitsPerSample} bits.`);
  }

  const sampleCount = Math.floor(dataSize / 2);
  const audio = new Float32Array(sampleCount);

  for (let i = 0; i < sampleCount; i += 1) {
    audio[i] = view.getInt16(dataOffset + i * 2, true) / 32768;
  }

  return audio;
};

const readAscii = (view: DataView, offset: number, length: number) => {
  let value = '';
  for (let i = 0; i < length; i += 1) {
    value += String.fromCharCode(view.getUint8(offset + i));
  }
  return value;
};

const safeDelete = async (name: string) => {
  try {
    await ffmpeg.deleteFile(name);
  } catch {
    // Missing files are fine; this keeps cleanup idempotent across cancel/error paths.
  }
};

const throwIfCanceled = () => {
  if (canceled) {
    throw new Error('Canceled');
  }
};

const formatSeconds = (seconds: number) => `${seconds.toFixed(0)}s`;

const safeModelId = (modelId: string) => (ALLOWED_MODEL_IDS.has(modelId) ? modelId : DEFAULT_MODEL_ID);

const safeLanguage = (language: string) => (ALLOWED_LANGUAGES.has(language) ? language : 'auto');

const browserCacheAvailable = () => typeof caches !== 'undefined';

const buildTranscriptionOptions = (modelId: string, language: string) => {
  if (modelId.endsWith('.en')) return undefined;

  const options: Record<string, unknown> = {
    task: 'transcribe'
  };

  if (language !== 'auto') {
    options.language = language;
  }

  return options;
};

const errorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  return String(error);
};

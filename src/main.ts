import './style.css';

type WorkerReadyMessage = {
  type: 'ready';
};

type WorkerStatusMessage = {
  type: 'status';
  message: string;
};

type WorkerProgressMessage = {
  type: 'progress';
  progress: number;
  chunkIndex?: number;
  chunkCount?: number;
};

type WorkerChunkMessage = {
  type: 'chunk';
  chunkIndex: number;
  start: number;
  end: number;
  text: string;
};

type WorkerDoneMessage = {
  type: 'done';
};

type WorkerErrorMessage = {
  type: 'error';
  message: string;
};

type WorkerCanceledMessage = {
  type: 'canceled';
};

type WorkerMessage =
  | WorkerReadyMessage
  | WorkerStatusMessage
  | WorkerProgressMessage
  | WorkerChunkMessage
  | WorkerDoneMessage
  | WorkerErrorMessage
  | WorkerCanceledMessage;

const videoInput = document.querySelector<HTMLInputElement>('#video-input');
const fileName = document.querySelector<HTMLParagraphElement>('#file-name');
const startButton = document.querySelector<HTMLButtonElement>('#start-button');
const cancelButton = document.querySelector<HTMLButtonElement>('#cancel-button');
const copyButton = document.querySelector<HTMLButtonElement>('#copy-button');
const downloadButton = document.querySelector<HTMLButtonElement>('#download-button');
const progressBar = document.querySelector<HTMLProgressElement>('#progress-bar');
const statusText = document.querySelector<HTMLParagraphElement>('#status');
const transcriptOutput = document.querySelector<HTMLPreElement>('#transcript');

if (
  !videoInput ||
  !fileName ||
  !startButton ||
  !cancelButton ||
  !copyButton ||
  !downloadButton ||
  !progressBar ||
  !statusText ||
  !transcriptOutput
) {
  throw new Error('Missing expected page elements.');
}

const worker = new Worker(new URL('./transcription.worker.ts', import.meta.url), {
  type: 'module'
});

let selectedFile: File | null = null;
let selectedDuration = 0;
let transcript = '';
let isRunning = false;

const setStatus = (message: string) => {
  statusText.textContent = message;
};

const setRunning = (running: boolean) => {
  isRunning = running;
  startButton.disabled = running || !selectedFile;
  cancelButton.disabled = !running;
  videoInput.disabled = running;
};

const setTranscriptActions = () => {
  const hasTranscript = transcript.trim().length > 0;
  copyButton.disabled = !hasTranscript;
  downloadButton.disabled = !hasTranscript;
};

videoInput.addEventListener('change', async () => {
  selectedFile = videoInput.files?.[0] ?? null;
  selectedDuration = 0;
  startButton.disabled = true;

  await prepareSelectedFile();
});

startButton.addEventListener('click', () => {
  if (!selectedFile) return;

  transcript = '';
  transcriptOutput.textContent = '';
  setTranscriptActions();
  progressBar.value = 0;
  setRunning(true);
  setStatus('Starting transcription...');

  worker.postMessage({
    type: 'start',
    file: selectedFile,
    duration: selectedDuration
  });
});

cancelButton.addEventListener('click', () => {
  if (!isRunning) return;
  setStatus('Canceling after the current operation...');
  cancelButton.disabled = true;
  worker.postMessage({ type: 'cancel' });
});

copyButton.addEventListener('click', async () => {
  await navigator.clipboard.writeText(transcript);
  setStatus('Transcript copied to clipboard.');
});

downloadButton.addEventListener('click', () => {
  const blob = new Blob([transcript], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = transcriptFileName(selectedFile);
  a.click();
  URL.revokeObjectURL(url);
});

worker.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;

  switch (message.type) {
    case 'ready':
      setStatus('Worker ready. Choose an MP4 file.');
      break;
    case 'status':
      setStatus(message.message);
      break;
    case 'progress':
      progressBar.value = message.progress;
      if (message.chunkIndex !== undefined && message.chunkCount !== undefined) {
        setStatus(`Processing chunk ${message.chunkIndex + 1} of ${message.chunkCount}...`);
      }
      break;
    case 'chunk':
      appendTranscript(message);
      setTranscriptActions();
      break;
    case 'done':
      progressBar.value = 100;
      setRunning(false);
      setStatus('Transcription complete.');
      break;
    case 'canceled':
      setRunning(false);
      setStatus('Transcription canceled.');
      break;
    case 'error':
      setRunning(false);
      setStatus(`Error: ${message.message}`);
      break;
  }
});

const appendTranscript = (message: WorkerChunkMessage) => {
  const timeRange = `[${formatTime(message.start)} - ${formatTime(message.end)}]`;
  const line = `${timeRange}\n${message.text.trim()}\n\n`;
  transcript += line;
  transcriptOutput.textContent = transcript;
};

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
};

const formatTime = (seconds: number) => {
  const rounded = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(rounded / 60);
  const secs = rounded % 60;
  return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

const transcriptFileName = (file: File | null) => {
  const baseName = file?.name.replace(/\.mp4$/i, '') || 'transcript';
  return `${baseName}.txt`;
};

const readVideoDuration = (file: File) =>
  new Promise<number>((resolve, reject) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);

    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      if (Number.isFinite(video.duration) && video.duration > 0) {
        resolve(video.duration);
      } else {
        reject(new Error('Could not read a valid MP4 duration.'));
      }
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not load MP4 metadata.'));
    };
    video.src = url;
  });

const prepareSelectedFile = async () => {
  if (!selectedFile) {
    fileName.textContent = 'No file selected';
    return;
  }

  fileName.textContent = `${selectedFile.name} (${formatBytes(selectedFile.size)})`;
  setStatus('Reading video duration...');

  try {
    selectedDuration = await readVideoDuration(selectedFile);
    startButton.disabled = isRunning;
    setStatus(`Ready. Duration: ${formatTime(selectedDuration)}.`);
  } catch (error) {
    selectedFile = null;
    videoInput.value = '';
    fileName.textContent = 'No file selected';
    setStatus(`Error: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const loadLocalTestFile = async () => {
  const params = new URLSearchParams(window.location.search);
  const testFile = params.get('testFile');
  const isLocalhost = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);

  if (!testFile || !isLocalhost) return;

  setStatus('Loading local test MP4...');
  const response = await fetch(testFile);
  if (!response.ok) {
    throw new Error(`Could not load local test file: ${response.status}`);
  }

  const blob = await response.blob();
  selectedFile = new File([blob], testFile.split('/').pop() || 'test.mp4', { type: 'video/mp4' });
  await prepareSelectedFile();

  if (params.get('autostart') === '1' && selectedFile) {
    startButton.click();
  }
};

void loadLocalTestFile().catch((error: unknown) => {
  setStatus(`Error: ${error instanceof Error ? error.message : String(error)}`);
});

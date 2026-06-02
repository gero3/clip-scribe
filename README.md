# Clip Scribe

Clip Scribe is a static web app for transcribing MP4 videos entirely in the browser.

It uses ffmpeg.wasm to extract small audio chunks from the uploaded video, then runs Whisper through Transformers.js to turn those chunks into text. The MP4 never needs to be uploaded to a backend.

Live site:

```text
https://gero3.github.io/clip-scribe/
```

## Features

- Upload an MP4 with a normal browser file input.
- Extract 30-second audio chunks with 5-second overlap.
- Choose between multilingual and English-only Whisper models.
- Use `Xenova/whisper-large-v3` by default, with smaller fallback options available.
- Auto-detect the language or pick a language such as English, Dutch, French, German, or Spanish.
- Append text as each chunk finishes.
- Copy the full transcript or download it as a `.txt` file.
- Cancel an in-progress transcription.
- Keep all processing client-side.

## How It Works

1. The user selects an MP4 file.
2. The app reads the video duration from browser metadata.
3. A Web Worker loads ffmpeg.wasm and the selected Whisper model.
4. ffmpeg.wasm extracts each chunk with:

   ```text
   ffmpeg -ss START -t 30 -i input.mp4 -vn -ac 1 -ar 16000 chunk_N.wav
   ```

5. Each WAV chunk is decoded and passed to Whisper.
6. The chunk transcript is sent back to the page.
7. The chunk file is deleted from ffmpeg's in-memory filesystem.

## Local Development

```powershell
npm install
npm run dev
```

Open the local Vite URL:

```text
http://localhost:5173
```

If npm fails with `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, run:

```powershell
$env:NODE_OPTIONS='--use-system-ca'
npm install
```

## Production Build

```powershell
npm run build
```

The static files are generated in `dist/`.

## GitHub Pages Deployment

This repository includes a GitHub Actions workflow at:

```text
.github/workflows/deploy.yml
```

To enable deployment:

1. Go to the repository on GitHub.
2. Open **Settings > Pages**.
3. Set **Source** to **GitHub Actions**.
4. Push to the `main` branch.
5. Wait for the deploy workflow to finish.

The site is published at:

```text
https://gero3.github.io/clip-scribe/
```

The Vite config uses `base: './'`, so built assets work correctly from the `/clip-scribe/` GitHub Pages path.

## Browser Notes

- The first run downloads ffmpeg.wasm and the selected Whisper model into the browser cache.
- `large-v3` is the default for accuracy, but it is much heavier than `tiny`, `base`, or `small`.
- Large videos can take time and use significant memory.
- Performance depends on the user's browser, CPU, and available memory.
- Everything runs locally in the browser; there is no server-side transcription.

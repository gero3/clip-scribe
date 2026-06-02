# Browser MP4 Transcriber

A plain Vite TypeScript static web app that transcribes MP4 files entirely in the browser.

The app uses ffmpeg.wasm to extract 30-second mono 16 kHz WAV chunks with 5-second overlap, then transcribes each chunk with `Xenova/whisper-tiny.en` through Transformers.js. No backend is required.

## Local Setup

```powershell
npm install
npm run dev
```

Open the local Vite URL, usually:

```text
http://localhost:5173
```

If npm fails with `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, run:

```powershell
$env:NODE_OPTIONS='--use-system-ca'
npm install
```

## Build

```powershell
npm run build
```

The static files are generated in `dist/`.

## Deploy To GitHub Pages

1. Create a GitHub repository and push this project.
2. In GitHub, go to **Settings > Pages**.
3. Under **Build and deployment**, set **Source** to **GitHub Actions**.
4. Push to the `main` branch.
5. The workflow in `.github/workflows/deploy.yml` builds the app and uploads `dist/` to GitHub Pages.

The Vite config uses `base: './'`, so the built app works from a repository Pages URL like:

```text
https://YOUR_USERNAME.github.io/YOUR_REPOSITORY/
```

## Notes

The first transcription downloads ffmpeg.wasm and the Whisper model into the browser cache. Large videos can take time and use significant memory because all processing happens client-side.

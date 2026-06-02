import { mkdir, copyFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const coreSourceDir = join(root, 'node_modules', '@ffmpeg', 'core', 'dist', 'esm');
const coreTargetDir = join(root, 'public', 'ffmpeg-core');
const wrapperSourceDir = join(root, 'node_modules', '@ffmpeg', 'ffmpeg', 'dist', 'esm');
const wrapperTargetDir = join(root, 'public', 'ffmpeg-wrapper');

await mkdir(coreTargetDir, { recursive: true });
await mkdir(wrapperTargetDir, { recursive: true });

for (const fileName of ['ffmpeg-core.js', 'ffmpeg-core.wasm']) {
  await copyFile(join(coreSourceDir, fileName), join(coreTargetDir, fileName));
}

for (const fileName of await readdir(wrapperSourceDir)) {
  if (fileName.endsWith('.js')) {
    await copyFile(join(wrapperSourceDir, fileName), join(wrapperTargetDir, fileName));
  }
}

console.log('Copied ffmpeg.wasm files to public/ffmpeg-core and public/ffmpeg-wrapper.');

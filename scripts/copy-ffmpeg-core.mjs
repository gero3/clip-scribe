import { mkdir, copyFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceDir = join(root, 'node_modules', '@ffmpeg', 'core', 'dist', 'umd');
const targetDir = join(root, 'public', 'ffmpeg-core');

await mkdir(targetDir, { recursive: true });

for (const fileName of ['ffmpeg-core.js', 'ffmpeg-core.wasm']) {
  await copyFile(join(sourceDir, fileName), join(targetDir, fileName));
}

console.log('Copied ffmpeg.wasm core files to public/ffmpeg-core.');

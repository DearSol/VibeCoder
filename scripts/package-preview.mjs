import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const root = fileURLToPath(new URL('../', import.meta.url));
const prefix = 'Expand-Studio-Preview/';
const files = {};
async function addDirectory(directory, archivePath) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    const name = archivePath + entry.name;
    if (entry.isDirectory()) await addDirectory(path, name + '/');
    else if (entry.isFile()) files[name] = await readFile(path);
  }
}
await addDirectory(resolve(root, 'dist'), prefix + 'web/');
files[prefix + 'server.mjs'] = await readFile(resolve(root, 'scripts/preview-server.mjs'));
files[prefix + 'README.txt'] = await readFile(resolve(root, 'scripts/preview-readme.txt'));
files[prefix + 'Start Expand Studio.bat'] = Buffer.from(
  (await readFile(resolve(root, 'scripts/start-preview.bat'), 'utf8')).replace(/\r?\n/g, '\r\n'),
);
await mkdir(resolve(root, 'release'), { recursive: true });
const destination = resolve(root, 'release/Expand-Studio-PC-Preview.zip');
await writeFile(destination, zipSync(files, { level: 6 }));
console.log(`Created ${destination}`);

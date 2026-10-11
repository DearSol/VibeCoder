import { isTauri } from '@tauri-apps/api/core';

export async function openNativeFile(): Promise<File | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const { readFile } = await import('@tauri-apps/plugin-fs');
  const path = await open({
    multiple: false,
    filters: [
      { name: 'Images and Expand projects', extensions: ['png', 'jpg', 'jpeg', 'webp', 'expand'] },
    ],
  });
  if (!path || Array.isArray(path)) return null;
  const bytes = await readFile(path);
  return new File([new Uint8Array(bytes)], path.split(/[\\/]/).at(-1) || 'Image.png');
}

export { isTauri };

export async function saveFile(
  blob: Blob,
  filename: string,
  extension: 'png' | 'expand',
): Promise<boolean> {
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    const path = await save({
      defaultPath: filename,
      filters: [
        { name: extension === 'png' ? 'PNG image' : 'Expand project', extensions: [extension] },
      ],
    });
    if (!path) return false;
    await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
    return true;
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return true;
}

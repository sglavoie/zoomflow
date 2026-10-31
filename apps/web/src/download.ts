import { safeFilename } from './text';
import { exportSourcesZip } from '@zoomflow/core';

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.addEventListener('click', (event) => event.stopPropagation());
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Download the source captured when Save was requested. */
export function downloadSource(source: string, name: string) {
  const filename = `${safeFilename(name.replace(/\.d2$/i, ''))}.d2`;
  download(new Blob([source], { type: 'text/plain;charset=utf-8' }), filename);
  return filename;
}

/** All project sources retain their relative paths, including files with source errors. */
export function downloadProjectSources(sources: Record<string, string>, name: string) {
  const filename = `${safeFilename(name)}.zip`;
  download(new Blob([exportSourcesZip(sources)], { type: 'application/zip' }), filename);
  return filename;
}

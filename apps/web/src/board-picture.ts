import { prepareExportSvg } from '@zoomflow/viewer';

/** Fit and sanitize a board in an isolated image, sharing the export theme rules. */
export async function boardPicture(svg: string, dark: boolean) {
  const prepared = await prepareExportSvg(svg, dark, { fit: true });
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(prepared.svg)}`;
}

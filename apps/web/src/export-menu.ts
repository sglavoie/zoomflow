import { exportBoardsHtml, exportBoardsZip, exportGlyphSource, exportSourcesZip, renderExportBoards, indexBoards } from '@zoomflow/core';
import { prepareExportSvg, rasterizeSvg, offlineViewerScript, offlineViewerStyle } from '@zoomflow/viewer';
import type { DocumentPane } from './document-pane';
import type { setupExamplePicker } from './example-picker';
import { describeError, plural, safeFilename } from './text';

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

/** The header Export menu: diagram exports and source downloads for the active pane. */
export function setupExportMenu(activePane: () => DocumentPane | undefined, picker: () => ReturnType<typeof setupExamplePicker>) {
  const moreToggle = document.querySelector<HTMLButtonElement>('#header-more-toggle')!;
  const moreContent = document.querySelector<HTMLElement>('#header-more-content')!;
  const more = document.querySelector<HTMLElement>('#header-more')!;
  function setMoreOpen(open: boolean) {
    moreContent.hidden = !open;
    moreToggle.setAttribute('aria-expanded', String(open));
  }
  moreToggle.addEventListener('click', () => setMoreOpen(Boolean(moreContent.hidden)));
  document.addEventListener('click', (event) => { if (event.target instanceof Node && !more.contains(event.target)) setMoreOpen(false); });
  more.addEventListener('focusout', (event) => { if (event.relatedTarget instanceof Node && !more.contains(event.relatedTarget)) setMoreOpen(false); });
  more.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !moreContent.hidden) {
      event.preventDefault(); event.stopPropagation(); setMoreOpen(false); moreToggle.focus();
    }
  });

  const exportStatus = document.querySelector<HTMLElement>('#export-status')!;
  const projectDownloadButton = document.querySelector<HTMLButtonElement>('#save-project')!;
  function setExportStatus(message: string, kind: 'info' | 'error' = 'info') {
    exportStatus.textContent = message;
    exportStatus.dataset.kind = kind;
    exportStatus.hidden = !message;
  }
  /** The export menu shows the result while open; the pane's live activity line announces it once. */
  function reportExport(message: string, kind: 'info' | 'error' = 'info', pane = activePane()!) {
    pane.setActivity(message, kind);
    setExportStatus(message, kind);
  }

  document.querySelector<HTMLButtonElement>('#save-source')!.addEventListener('click', () => {
    const pane = activePane()!;
    if (!pane.key) return;
    const name = safeFilename(pane.name.replace(/\.d2$/i, '')) + '.d2';
    download(new Blob([pane.source], { type: 'text/plain;charset=utf-8' }), name);
    picker().markDownloadRequested(pane.id);
    pane.setActivity(`Source download started: ${name}`);
  });
  projectDownloadButton.addEventListener('click', () => {
    const pane = activePane()!;
    const name = picker().projectName(pane.id);
    if (!name) return;
    try {
      const { fs, inputPath } = picker().compilation(pane.id);
      fs[inputPath] = pane.source;
      const filename = `${safeFilename(name)}.zip`;
      download(new Blob([exportSourcesZip(fs)], { type: 'application/zip' }), filename);
      reportExport(`Project source download started: ${filename}`);
    } catch (error) { reportExport(`Project source download failed: ${describeError(error)}`, 'error'); }
  });

  const exportButton = document.querySelector<HTMLButtonElement>('#export')!;
  const exportChoices = document.querySelector<HTMLFieldSetElement>('#export-format')!;
  const exportFormat = { get value() { return exportChoices.querySelector<HTMLInputElement>('input:checked')!.value; } };
  let explicitExportFormat = false;
  try {
    const saved = localStorage.getItem('zoomflow.export-format');
    const choice = [...exportChoices.querySelectorAll<HTMLInputElement>('input')].find(input => input.value === saved);
    if (choice) { choice.checked = true; explicitExportFormat = true; }
  } catch { /* Exporting works without stored preferences. */ }
  let exporting = false;
  const canExport = () => !exporting && Boolean(activePane()?.documentExport && activePane()!.current);
  function updateExportLabel() {
    const pane = activePane();
    const documentExport = pane?.documentExport;
    exportButton.disabled = !canExport();
    const count = documentExport ? indexBoards(documentExport.diagram).size : 0;
    if (documentExport && !explicitExportFormat) {
      exportChoices.querySelector<HTMLInputElement>(`input[value="${count > 1 ? 'html' : 'svg'}"]`)!.checked = true;
    }
    const allBoards = exportFormat.value === 'zip' || exportFormat.value === 'html';
    const formatName = ({ svg: 'SVG', png: 'PNG', zip: 'SVG ZIP', html: 'Interactive HTML' } as Record<string, string>)[exportFormat.value];
    document.querySelector('#export-scope')!.textContent = documentExport
      ? allBoards ? `Entire diagram · ${plural(count, 'board')} · ${formatName}`
        : `Current board: ${pane!.viewer.currentBoard?.name ?? 'Root'} · ${formatName}` : 'Compile the current source to export a diagram.';
    exportButton.textContent = ({ svg: 'Download SVG', png: 'Download PNG', zip: 'Download SVG ZIP',
      html: 'Download HTML' } as Record<string, string>)[exportFormat.value] ?? 'Download export';
  }
  function rememberExportFormat() {
    explicitExportFormat = true;
    try { localStorage.setItem('zoomflow.export-format', exportFormat.value); } catch { /* Optional preference. */ }
    updateExportLabel();
  }
  exportChoices.addEventListener('change', rememberExportFormat);
  exportChoices.addEventListener('click', (event) => {
    // Clicking the automatically selected format is still an explicit choice.
    if (event.target instanceof HTMLInputElement && event.target.checked) rememberExportFormat();
  });

  exportButton.addEventListener('click', async () => {
    const pane = activePane()!;
    const loaded = pane.documentExport;
    const board = pane.viewer.currentBoard;
    if (!loaded || !board || !canExport()) return;
    const exportRevision = pane.generation;
    exporting = true;
    exportButton.disabled = true;
    const format = exportFormat.value;
    reportExport(`Preparing ${format.toUpperCase()} download…`, 'info', pane);
    const dark = document.documentElement.dataset.theme === 'dark';
    const exportName = pane.name;
    const warnings: string[] = [];
    // Interactive HTML follows its reader's color scheme; images keep the theme shown here.
    const theme = format === 'html' ? undefined : dark;
    const prepare = async (target: string) => {
      const result = await prepareExportSvg(await loaded.render(target), theme);
      warnings.push(...result.warnings);
      return result.svg;
    };
    try {
      let blob: Blob;
      let name = safeFilename(exportName.replace(/\.d2$/i, ''));
      if (format === 'svg' || format === 'png') {
        const svg = await prepare(board.target);
        blob = format === 'png' ? await rasterizeSvg(svg) : new Blob([svg], { type: 'image/svg+xml' });
        name += `-${board.name === 'Root' ? 'root' : safeFilename(board.name)}.${format}`;
      } else {
        const boards = await renderExportBoards(loaded.diagram, prepare, loaded.diagnostics);
        // Shared font subsets are an optimization; each board keeps its own fonts without them.
        const glyphSource = format === 'html' ? exportGlyphSource(boards) : undefined;
        const glyphs = glyphSource ? await loaded.renderSource(glyphSource).catch(() => undefined) : undefined;
        blob = format === 'zip' ? new Blob([exportBoardsZip(boards)], { type: 'application/zip' })
          : new Blob([exportBoardsHtml(boards, { title: exportName, script: offlineViewerScript(),
            style: offlineViewerStyle, glyphs })], { type: 'text/html' });
        name += `.${format}`;
      }
      if (exportRevision !== pane.generation || pane.documentExport !== loaded) {
        reportExport('Export canceled because the source changed.', 'info', pane);
        return;
      }
      download(blob, name);
      const result = warnings.length ? `Download started: ${name}. ${[...new Set(warnings)].join(' ')}` : `Download started: ${name}`;
      reportExport(result, warnings.length > 0 ? 'error' : 'info', pane);
    } catch (error) {
      reportExport(`Export failed: ${describeError(error)}`, 'error', pane);
    }
    finally { exporting = false; updateExportLabel(); }
  });

  return {
    setExportStatus,
    updateExportLabel,
    /** Only project files offer the whole project as a download. */
    showProjectDownload(project: boolean) { projectDownloadButton.hidden = !project; },
  };
}

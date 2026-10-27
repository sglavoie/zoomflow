import { guardBuilderDialog } from './builder-dialog';
import { flowSource, flowTemplate, plainLook } from './flow-model';
import { mindMapSource } from './mind-map-model';
import { setText } from './text';

export type NewFileKind = 'flow' | 'mind map' | 'empty';
/** A board of a project file: its hash in the file's routes (`#/Sleep`), and its names from the root down. */
export type FileBoard = { hash: string; label: string };
type LinkRequest = {
  /** Project paths the shape can open. */
  files: string[];
  /** The link to start from, when changing one. */
  current?: { path: string; hash: string };
  boards: (path: string) => Promise<FileBoard[]>;
  shape: string;
};

const kinds: [NewFileKind, string][] = [['flow', 'Flow'], ['mind map', 'Mind map'], ['empty', 'Empty diagram']];
let shared: ReturnType<typeof create> | undefined;

/** One dialog, shared by both panes, that picks a project file for a shape to open, or names a new one. */
export function fileLinkDialog() {
  shared ??= create();
  return shared;
}

function create() {
  const dialog = document.createElement('dialog');
  dialog.id = 'file-link-dialog';
  dialog.setAttribute('aria-labelledby', 'file-link-title');
  dialog.setAttribute('aria-describedby', 'file-link-description');
  dialog.innerHTML = `
    <form>
      <div class="flow-heading"><h2 id="file-link-title"></h2><button type="button" data-close aria-label="Close">Close</button></div>
      <p id="file-link-description"></p>
      <div class="flow-settings" data-mode="link">
        <label><span>Diagram file</span><select id="file-link-file"></select></label>
        <label><span>Opens at</span><select id="file-link-board"></select></label>
      </div>
      <div data-mode="new">
        <label><span>File name</span><input id="file-link-name" required maxlength="100" /></label>
        <fieldset class="builder-look"><legend>Start with</legend>
          ${kinds.map(([kind, label], i) => `<label><input type="radio" name="file-link-kind" value="${kind}"${i ? '' : ' checked'} /> ${label}</label>`).join('\n          ')}
        </fieldset>
      </div>
      <p id="file-link-status" class="flow-help" role="status"></p>
      <div class="flow-footer"><button type="button" data-close>Cancel</button><button class="button-primary" type="submit"></button></div>
    </form>`;
  document.body.append(dialog);
  const form = dialog.querySelector('form')!;
  const title = dialog.querySelector('h2')!;
  const description = dialog.querySelector<HTMLElement>('#file-link-description')!;
  const [linkFields, newFields] = dialog.querySelectorAll<HTMLElement>('[data-mode]');
  const file = dialog.querySelector<HTMLSelectElement>('#file-link-file')!;
  const board = dialog.querySelector<HTMLSelectElement>('#file-link-board')!;
  const name = dialog.querySelector<HTMLInputElement>('#file-link-name')!;
  const status = dialog.querySelector<HTMLElement>('#file-link-status')!;
  const submit = dialog.querySelector<HTMLButtonElement>('[type="submit"]')!;
  // Nothing typed here is lost by closing: the shape is unchanged.
  guardBuilderDialog(dialog, () => true);
  let finish: ((submitted: boolean) => void) | undefined;
  dialog.addEventListener('close', () => { finish?.(false); finish = undefined; });
  form.addEventListener('submit', event => {
    event.preventDefault();
    const done = finish;
    finish = undefined;
    dialog.close();
    done?.(true);
  });

  function show(mode: 'link' | 'new', heading: string, text: string, action: string) {
    setText(title, heading);
    setText(description, text);
    submit.textContent = action;
    linkFields.hidden = mode !== 'link';
    newFields.hidden = mode !== 'new';
    name.required = mode === 'new';
    setText(status, '');
    dialog.showModal();
    return new Promise<boolean>(resolve => { finish = resolve; });
  }

  let loading = 0;
  async function loadBoards(request: LinkRequest, selected = '') {
    const attempt = ++loading;
    const path = file.value;
    board.replaceChildren(new Option('Its home board', ''));
    board.disabled = true;
    setText(status, 'Finding the boards in this file…');
    try {
      const boards = await request.boards(path);
      if (attempt !== loading) return;
      board.append(...boards.map(item => new Option(item.label, item.hash, false, item.hash === selected)));
      setText(status, '');
    } catch {
      if (attempt === loading) setText(status, 'This file’s boards could not be read. The link opens its home board.');
    } finally {
      if (attempt === loading) board.disabled = false;
    }
  }

  return {
    /** Resolves the file and board the shape opens, or undefined when canceled. */
    async link(request: LinkRequest): Promise<{ path: string; hash: string } | undefined> {
      file.replaceChildren(...request.files.map(path => new Option(path.replace(/\.d2$/i, ''), path, false, path === request.current?.path)));
      file.onchange = () => void loadBoards(request);
      void loadBoards(request, request.current?.path === file.value ? request.current.hash : '');
      const changing = Boolean(request.current);
      if (!await show('link', changing ? 'Change linked diagram' : 'Link to a diagram',
        `Choose the project file “${request.shape}” opens, and optionally one of its boards.`, changing ? 'Change link' : 'Link')) return;
      return { path: file.value, hash: board.value };
    },
    /** Resolves the name and kind of a new file for the shape to open, or undefined when canceled. */
    async create(label: string): Promise<{ name: string; kind: NewFileKind } | undefined> {
      name.value = label;
      if (!await show('new', 'New linked diagram',
        `Creates a project file next to this one that “${label}” opens. Choose how it starts.`, 'Create and open')) return;
      return { name: name.value, kind: dialog.querySelector<HTMLInputElement>('[name="file-link-kind"]:checked')!.value as NewFileKind };
    },
  };
}

/** The source of a new linked file: a flow or mind map its builder reopens, or an empty diagram named in a comment. */
export function newFileSource(kind: NewFileKind, name: string): string {
  const label = name.trim().replace(/\.d2$/i, '') || 'Diagram';
  if (kind === 'flow') return flowSource(flowTemplate('simple'));
  if (kind === 'mind map') {
    return mindMapSource({ direction: 'right', split: 0, look: plainLook(),
      root: { label, children: ['First idea', 'Second idea'].map(child => ({ label: child, children: [] })) } });
  }
  return `# ${label}\n`;
}

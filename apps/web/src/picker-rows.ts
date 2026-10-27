import type { Draft } from './draft-store';
import { exampleSource } from './draft-library';

export type ProjectGroup = { section: HTMLElement; files: HTMLElement; toggle: HTMLButtonElement };

/** A collapsible project heading with the project's unsaved count, its Atlas map and a Remove action. */
export function projectGroup(item: Draft, remove: () => void, atlas: () => void): ProjectGroup {
  const id = item.projectId!;
  const section = document.createElement('section');
  section.className = 'project-group';
  const name = item.title.split('/')[0];
  section.setAttribute('aria-label', `${name} project`);
  const heading = document.createElement('div');
  heading.className = 'project-heading';
  const title = document.createElement('button');
  title.type = 'button';
  title.className = 'project-toggle button-quiet';
  title.textContent = name;
  title.setAttribute('aria-label', name);
  title.setAttribute('aria-expanded', 'true');
  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'example-remove button-quiet';
  removeButton.textContent = 'Remove project';
  removeButton.setAttribute('aria-label', `Remove ${name} project drafts`);
  removeButton.addEventListener('click', remove);
  const unsaved = document.createElement('span');
  unsaved.className = 'project-unsaved';
  unsaved.setAttribute('role', 'status');
  heading.append(title, unsaved, removeButton);
  const files = document.createElement('div');
  files.id = `project-files-${id}`;
  // The map leads the project's files; file rows are appended after it.
  const atlasRow = document.createElement('div');
  atlasRow.className = 'example-row project-atlas';
  const atlasButton = document.createElement('button');
  atlasButton.type = 'button';
  atlasButton.className = 'example-option';
  atlasButton.innerHTML = '<span class="example-title">Atlas map</span><span class="example-description">Every file and the links between them · read-only</span>';
  atlasButton.setAttribute('aria-label', `Atlas map of the ${name} project`);
  atlasButton.addEventListener('click', atlas);
  atlasRow.append(atlasButton);
  files.append(atlasRow);
  title.setAttribute('aria-controls', files.id);
  title.addEventListener('click', () => {
    files.hidden = !files.hidden;
    title.setAttribute('aria-expanded', String(!files.hidden));
  });
  section.append(heading, files);
  return { section, files, toggle: title };
}

/** One menu row: the draft's button, plus Remove for files or Restore for edited examples.
 * `refresh` updates its labels after the draft changes. */
export function draftRow(item: Draft, actions: { choose: () => void; remove: () => void; restore: () => void }) {
  const row = document.createElement('div');
  row.className = 'example-row';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'example-option';
  const label = document.createElement('span');
  label.className = 'example-title';
  label.textContent = item.projectId ? `${item.path}${item.recoveredFrom ? ' (recovered)' : ''}` : item.title;
  if (item.projectId) button.title = item.title;
  const detail = document.createElement('span');
  detail.className = 'example-description';
  detail.textContent = item.description;
  button.append(label, detail);
  button.addEventListener('click', actions.choose);
  row.append(button);
  if (item.key.startsWith('file:')) {
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'example-remove button-quiet';
    remove.textContent = 'Remove';
    remove.setAttribute('aria-label', `Remove ${item.name} draft`);
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      actions.remove();
    });
    row.append(remove);
  } else if (!item.projectId) {
    const restore = document.createElement('button');
    restore.type = 'button';
    restore.className = 'example-restore';
    restore.textContent = 'Restore';
    restore.setAttribute('aria-label', `Restore original example: ${item.title}`);
    restore.addEventListener('click', actions.restore);
    row.append(restore);
  }
  const modified = document.createElement('span');
  modified.className = 'example-modified';
  modified.textContent = 'Modified';
  label.append(modified);
  const unsaved = document.createElement('span');
  unsaved.className = 'draft-unsaved';
  unsaved.textContent = '•';
  unsaved.setAttribute('role', 'img');
  unsaved.setAttribute('aria-label', 'Unsaved changes');
  unsaved.title = 'Changes since the last file save';
  label.append(unsaved);
  const timestamp = document.createElement('span');
  timestamp.className = 'example-description';
  const elsewhere = document.createElement('span');
  elsewhere.className = 'example-elsewhere';
  elsewhere.textContent = 'Open in the other pane';
  elsewhere.hidden = true;
  button.append(timestamp, elsewhere);
  function refresh() {
    label.firstChild!.textContent = item.projectId
      ? `${item.path}${item.name !== item.path!.split('/').at(-1) ? ` → ${item.name}` : ''}${item.recoveredFrom ? ' (recovered)' : ''}` : item.title;
    row.querySelector('.example-remove')?.setAttribute('aria-label', `Remove ${item.name} draft`);
    const original = exampleSource(item.key);
    const changed = original !== undefined && item.source !== original;
    modified.hidden = !changed;
    unsaved.hidden = original !== undefined || item.source === item.baseline;
    const restore = row.querySelector<HTMLButtonElement>('.example-restore');
    if (restore) restore.hidden = !changed;
    timestamp.hidden = !item.updatedAt || Boolean(item.projectId);
    timestamp.textContent = item.updatedAt ? `Edited ${new Date(item.updatedAt).toLocaleDateString()}` : '';
    button.title = item.projectId ? item.title : [item.title, item.updatedAt ? `Edited ${new Date(item.updatedAt).toLocaleString()}` : ''].filter(Boolean).join('\n');
    if (item.recoveredFrom) detail.textContent = 'Recovered copy · Edits from another tab';
    else if (item.key.startsWith('file:')) detail.textContent = item.template ? `Saved copy of ${item.template} · Draft ${item.number}` : `Your file · Draft ${item.number ?? item.key.slice(5)}`;
    else if (item.projectId) { detail.textContent = ''; detail.hidden = true; }
  }
  refresh();
  return { row, button, refresh };
}

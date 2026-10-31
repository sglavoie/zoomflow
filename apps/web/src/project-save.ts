import type { setupExamplePicker } from './example-picker';
import { queryWritePermission, writePermission, type DirectoryHandles, type FileHandles } from './file-handles';
import { saveFile, type SaveFileResult } from './save-file';

export type ProjectSaveSnapshot = {
  id: string;
  name: string;
  files: { key: string; path: string; name: string; source: string }[];
};
export type ProjectSaveState = {
  project: ProjectSaveSnapshot;
  running: boolean;
  cancelled: boolean;
  path?: string;
  results: (SaveFileResult & { path: string })[];
};
export type ProjectSaveHost = {
  picker: () => ReturnType<typeof setupExamplePicker>;
  fileHandles: FileHandles;
  directoryHandles: DirectoryHandles;
  adopt: (key: string, saved: { key: string; name: string }) => void;
};

/** One batch at a time, using the same write locks and safeguards as Save .d2.
 * Sources are captured once; edits made during a write stay dirty against that saved snapshot. */
export function createProjectSave(host: ProjectSaveHost, changed: (state: ProjectSaveState) => void) {
  let state: ProjectSaveState | undefined;
  function publish(next: ProjectSaveState) { state = next; changed(next); }
  return {
    async start(project: ProjectSaveSnapshot) {
      if (state?.running) return;
      publish({ project, running: true, cancelled: false, results: [] });
      await host.directoryHandles.restore(host.picker().hasProject);
      // Request the folder once, while the initiating click is still active. Child files can then
      // query the inherited grant without attempting permission prompts after each awaited write.
      const directory = host.directoryHandles.get(project.id);
      if (!state!.cancelled && directory && project.files.length && await queryWritePermission(directory) === 'prompt') await writePermission(directory);
      for (const file of project.files) {
        if (state!.cancelled) {
          publish({ ...state!, results: [...state!.results, { path: file.path, status: 'skipped', message: 'Project save cancelled before this file was saved.' }] });
          continue;
        }
        publish({ ...state!, path: file.path });
        let activity = '';
        const result = await saveFile({
          fileHandles: host.fileHandles, picker: host.picker,
          key: () => host.picker().hasDraft(file.key) ? file.key : undefined,
          name: () => file.name, source: () => file.source,
          downloaded: () => {}, adopt: host.adopt,
          setActivity: message => { activity = message; }, activity: () => activity,
        }, { existingOnly: true, requestPermission: !directory });
        publish({ ...state!, results: [...state!.results, { ...result, path: file.path }] });
      }
      publish({ ...state!, running: false, path: undefined });
    },
    cancel() { if (state?.running) publish({ ...state, cancelled: true }); },
  };
}

import type { D2 } from '@d2lang/d2';
import { diagramFonts } from './fonts';

export class CompilerStartupError extends Error {
  constructor(cause: unknown) { super('The diagram engine could not start.', { cause }); }
}

type Resources = { d2: D2; fonts: Awaited<ReturnType<typeof diagramFonts>> };

/** Cache successful startup, but allow a failed module, worker or font load to retry. */
export function createCompiler(load = async (): Promise<Resources> => {
  const { D2 } = await import('@d2lang/d2');
  // The pinned worker exposes ready, although its published types omit it.
  // Await initialization separately so startup errors cannot become source errors.
  const d2 = new D2() as D2 & { ready: Promise<void> };
  try {
    const [, fonts] = await Promise.all([d2.ready, diagramFonts()]);
    return { d2, fonts };
  } catch (error) {
    void d2.dispose();
    throw error;
  }
}) {
  let pending: Promise<Resources> | undefined;
  let resources: Resources | undefined;
  let disposed = false;
  let revision = 0;
  function reset() {
    ++revision;
    void resources?.d2.dispose();
    resources = undefined;
    pending = undefined;
  }
  return {
    get ready() { return Boolean(resources); },
    get() {
      if (disposed) return Promise.reject(new Error('Workspace closed'));
      const request = revision;
      return pending ??= load().then((result) => {
        if (disposed || request !== revision) { void result.d2.dispose(); throw new Error('Diagram engine restarted'); }
        resources = result;
        return result;
      }).catch((error) => { if (request === revision) pending = undefined; throw new CompilerStartupError(error); });
    },
    restart: reset,
    dispose() { disposed = true; reset(); },
  };
}

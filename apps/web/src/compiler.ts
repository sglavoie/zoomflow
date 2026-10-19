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
  return {
    get ready() { return Boolean(resources); },
    get() {
      return pending ??= load().then((result) => {
        if (disposed) { void result.d2.dispose(); throw new Error('Workspace closed'); }
        resources = result;
        return result;
      }).catch((error) => { pending = undefined; throw new CompilerStartupError(error); });
    },
    dispose() { disposed = true; void resources?.d2.dispose(); },
  };
}

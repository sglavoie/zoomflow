/** Finish the running preview, then run only the most recently requested one.
 * Invalidated callers still settle, so document switches never wait forever.
 */
export function createPreviewQueue() {
  type Job = { run: () => Promise<void>; resolve: () => void; reject: (error: unknown) => void };
  let running = false;
  let pending: Job | undefined;
  let active: Job | undefined;
  let revision = 0;
  async function drain() {
    if (running) return;
    running = true;
    const request = revision;
    try {
      while (pending && request === revision) {
        const job = active = pending;
        pending = undefined;
        try { await job.run(); job.resolve(); }
        catch (error) { job.reject(error); }
      }
    } finally { if (request === revision) { running = false; active = undefined; } }
  }
  return {
    // The caller must replace the compiler before abandoning its active work.
    restart() {
      ++revision;
      active?.resolve(); pending?.resolve();
      active = pending = undefined;
      running = false;
    },
    invalidate() { pending?.resolve(); pending = undefined; },
    run(run: () => Promise<void>): Promise<void> {
      return new Promise((resolve, reject) => {
        pending?.resolve();
        pending = { run, resolve, reject };
        void drain();
      });
    },
  };
}

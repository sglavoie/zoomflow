/** Finish the running preview, then run only the most recently requested one.
 * Invalidated callers still settle, so document switches never wait forever.
 */
export function createPreviewQueue() {
  type Job = { run: () => Promise<void>; resolve: () => void; reject: (error: unknown) => void };
  let running = false;
  let pending: Job | undefined;
  async function drain() {
    if (running) return;
    running = true;
    try {
      while (pending) {
        const job = pending;
        pending = undefined;
        try { await job.run(); job.resolve(); }
        catch (error) { job.reject(error); }
      }
    } finally { running = false; }
  }
  return {
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

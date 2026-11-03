/** Keep the disk version check and write in one cross-tab critical section.
 * File handles cannot be named consistently across tabs, so serialize all Zoomflow disk writes. */
export function withDiskWriteLock<T>(work: () => Promise<T>): Promise<T> {
  return navigator.locks?.request('zoomflow.disk-write', work) ?? work();
}

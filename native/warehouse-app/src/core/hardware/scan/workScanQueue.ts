/** Retains a failed head; later physical scans never overtake it. */
export function createWorkScanQueue<T>(consume: (event: T) => Promise<void>) {
  const items: T[] = [];
  const listeners = new Set<() => void>();
  let running: Promise<void> | null = null;
  let failure: unknown;
  const notify = () => listeners.forEach((fn) => fn());
  function pump(): Promise<void> {
    if (running) return running;
    if (failure) return Promise.reject(failure);
    running = (async () => {
      while (items.length) {
        try {
          await consume(items[0]);
        } catch (error) {
          failure = error;
          notify();
          throw error;
        }
        items.shift();
        notify();
      }
    })().finally(() => {
      running = null;
      notify();
    });
    return running;
  }
  return {
    enqueue(event: T) {
      items.push(event);
      notify();
      void pump().catch(() => {});
    },
    size: () => items.length,
    head: () => items[0],
    rejectHead(event: T) {
      if (!failure || items[0] !== event)
        throw new Error('Only the confirmed failed head can be rejected');
      items.shift();
      failure = undefined;
      notify();
      void pump().catch(() => {});
    },
    error: () => failure,
    drain: () => pump(),
    async retryHead() {
      failure = undefined;
      await pump();
    },
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

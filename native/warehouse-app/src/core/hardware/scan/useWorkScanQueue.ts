import { useEffect, useRef, useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import { createWorkScanQueue } from './workScanQueue';
import { useWorkRuntime } from '../../operations/OperationContext';
interface ScanRecord<T> {
  id: string;
  data: T;
}
/** Store every accepted physical input before consuming it; reuse its ID on restart. */
export function useWorkScanQueue<T>(
  consume: (event: T, eventId: string) => Promise<void>,
  storageKey?: string
) {
  const runtime = useWorkRuntime();
  const router = useRouter({ warn: false });
  const consumeRef = useRef(consume);
  consumeRef.current = consume;
  const storageId = useRef<Promise<string> | null>(null);
  const [queue] = useState(() =>
    createWorkScanQueue<ScanRecord<T>>(async (event) => {
      await consumeRef.current(event.data, event.id);
      if (runtime && storageId.current)
        await runtime.store.draft<ScanRecord<T>[]>(
          await storageId.current,
          (events) => (events ?? []).filter((e) => e.id !== event.id)
        );
    })
  );
  const [saving, setSaving] = useState(0);
  const [saveError, setSaveError] = useState<unknown>();
  const [, render] = useState(0);
  const serial = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => queue.subscribe(() => render((v) => v + 1)), [queue]);
  useEffect(() => {
    if (!runtime || !storageKey) return;
    let live = true;
    storageId.current = runtime
      .getScope()
      .then((scope) => `${scope}:scan:${storageKey}`);
    serial.current = storageId.current
      .then((id) => runtime.store.draft<ScanRecord<T>[]>(id))
      .then((events) => {
        if (live) events?.forEach((e) => queue.enqueue(e));
      })
      .catch(setSaveError);
    return () => {
      live = false;
    };
  }, [runtime, storageKey, queue]);
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (queue.size() || saving) e.preventDefault();
    };
    window.addEventListener('beforeunload', guard);
    const unblock = router?.history.block({
      blockerFn: () => queue.size() > 0 || saving > 0,
      enableBeforeUnload: () => queue.size() > 0 || saving > 0,
    });
    return () => {
      window.removeEventListener('beforeunload', guard);
      unblock?.();
    };
  }, [queue, router, saving]);
  return {
    ...queue,
    enqueue(data: T) {
      const event = { id: crypto.randomUUID(), data };
      if (!runtime || !storageKey) {
        queue.enqueue(event);
        return;
      }
      setSaving((n) => n + 1);
      serial.current = serial.current.then(async () => {
        try {
          const id = await (storageId.current ??
            runtime.getScope().then((scope) => `${scope}:scan:${storageKey}`));
          await runtime.store.draft<ScanRecord<T>[]>(id, (events) => [
            ...(events ?? []),
            event,
          ]);
          queue.enqueue(event);
        } catch (e) {
          setSaveError(e);
        } finally {
          setSaving((n) => n - 1);
        }
      });
    },
    async rejectHead() {
      const head = queue.head();
      if (!head || !queue.error()) return;
      if (runtime && storageId.current)
        await runtime.store.draft<ScanRecord<T>[]>(
          await storageId.current,
          (events) => (events ?? []).filter((e) => e.id !== head.id)
        );
      queue.rejectHead(head);
    },
    size: () => queue.size() + saving,
    error: () => saveError ?? queue.error(),
  };
}

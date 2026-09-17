import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import { createWorkScanQueue } from './workScanQueue';
import { useWorkRuntime } from '../../operations/OperationContext';
interface ScanRecord<T> {
  id: string;
  data: T;
}
export const SCAN_STORAGE_MESSAGE =
  '스캔을 저장하지 못했어요. 이 화면을 유지한 채 저장 공간을 확보하고 다시 확인해 주세요. 상품은 다시 찍지 마세요.';
/** Store every accepted physical input before consuming it; reuse its ID on restart. */
export function useWorkScanQueue<T>(
  consume: (event: T, eventId: string) => Promise<void>,
  storageKey?: string
) {
  const runtime = useWorkRuntime();
  const router = useRouter({ warn: false });
  const consumeRef = useRef(consume);
  consumeRef.current = consume;
  const restoredIds = useRef(new Set<string>());
  const storageId = useRef<Promise<string> | null>(null);
  const [queue] = useState(() =>
    createWorkScanQueue<ScanRecord<T>>(async (event) => {
      await consumeRef.current(event.data, event.id);
      if (runtime && storageId.current)
        await runtime.store.draft<ScanRecord<T>[]>(
          await storageId.current,
          (events) => (events ?? []).filter((e) => e.id !== event.id)
        );
      restoredIds.current.delete(event.id);
    })
  );
  const [saveError, setSaveError] = useState<unknown>();
  const [restored, setRestored] = useState(!runtime || !storageKey);
  const [, render] = useState(0);
  const serial = useRef<Promise<unknown>>(Promise.resolve());
  // A failed write still owns the physical input. Keep it (and following inputs)
  // in memory until it can be persisted; never report an empty queue on failure.
  const [savingQueue] = useState(() =>
    createWorkScanQueue<ScanRecord<T>>(async (event) => {
      await serial.current;
      const id = await storageId.current!;
      await runtime!.store.draft<ScanRecord<T>[]>(id, (events) => [
        ...(events ?? []),
        event,
      ]);
      queue.enqueue(event);
    })
  );
  useEffect(() => {
    const refresh = () => render((v) => v + 1);
    const stopWork = queue.subscribe(refresh);
    const stopSaving = savingQueue.subscribe(refresh);
    return () => {
      stopWork();
      stopSaving();
    };
  }, [queue, savingQueue]);
  const restore = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    if (!runtime || !storageKey) return;
    let live = true;
    restore.current = async () => {
      setRestored(false);
      storageId.current = runtime
        .getScope()
        .then((scope) => `${scope}:scan:${storageKey}`);
      try {
        const events = await runtime.store.draft<ScanRecord<T>[]>(
          await storageId.current
        );
        if (live) {
          restoredIds.current = new Set(events?.map((event) => event.id));
          events?.forEach((e) => queue.enqueue(e));
          setSaveError(undefined);
          setRestored(true);
        }
      } catch (error) {
        if (live) setSaveError(error);
        throw error;
      }
    };
    serial.current = restore.current();
    void serial.current.catch(() => {});
    return () => {
      live = false;
    };
  }, [runtime, storageKey, queue]);
  // An unread backlog has unknown size; it is not permission to submit a
  // partially restored draft or leave the screen.
  const blocked = useCallback(
    () => !restored || queue.size() > 0 || savingQueue.size() > 0,
    [restored, queue, savingQueue]
  );
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (blocked()) e.preventDefault();
    };
    window.addEventListener('beforeunload', guard);
    const unblock = router?.history.block({
      blockerFn: blocked,
      enableBeforeUnload: blocked,
    });
    return () => {
      window.removeEventListener('beforeunload', guard);
      unblock?.();
    };
  }, [router, blocked]);
  return {
    ...queue,
    enqueue(data: T) {
      const event = { id: crypto.randomUUID(), data };
      if (!runtime || !storageKey) {
        queue.enqueue(event);
        return;
      }
      savingQueue.enqueue(event);
    },
    async retryHead() {
      if (saveError) {
        serial.current = restore.current();
        await serial.current;
      }
      await savingQueue.retryHead();
      await queue.retryHead();
    },
    async rejectHead() {
      const head = queue.head();
      if (!head || !queue.error()) return;
      if (runtime && storageId.current)
        await runtime.store.draft<ScanRecord<T>[]>(
          await storageId.current,
          (events) => (events ?? []).filter((e) => e.id !== head.id)
        );
      restoredIds.current.delete(head.id);
      queue.rejectHead(head);
    },
    size: () => queue.size() + savingQueue.size(),
    blocked,
    ready: restored && restoredIds.current.size === 0,
    error: () => saveError ?? savingQueue.error() ?? queue.error(),
    storageError: () => saveError ?? savingQueue.error(),
  };
}

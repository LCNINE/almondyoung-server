import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import { createWorkScanQueue } from './workScanQueue';
import { useWorkRuntime } from '../../operations/OperationContext';
interface ScanRecord<T> {
  id: string;
  data: T;
}
class DetachedQueueError extends Error {}
export const SCAN_STORAGE_MESSAGE =
  '스캔을 저장하지 못했어요. 이 화면을 유지한 채 저장 공간을 확보하고 다시 확인해 주세요. 상품은 다시 찍지 마세요.';
/** Store every accepted physical input before consuming it; reuse its ID on restart. */
export function useWorkScanQueue<T>(
  consume: (event: T, eventId: string) => Promise<void>,
  storageKey?: string,
  /** 남은 입력이 있어도 화면을 떠나도 되는가 — 저장된 입력은 다시 열 때 같은 키로 재생된다 */
  canLeave?: () => boolean
) {
  const runtime = useWorkRuntime();
  const router = useRouter({ warn: false });
  const consumeRef = useRef(consume);
  consumeRef.current = consume;
  const restoredIds = useRef(new Set<string>());
  const storageId = useRef<Promise<string> | null>(null);
  // 결과 모름을 남기고 떠난 화면의 큐 — 뒤에 줄 선 입력은 보내지 않는다(저장돼 있어 다시 열 때 보낸다)
  const detached = useRef(false);
  const [queue] = useState(() =>
    createWorkScanQueue<ScanRecord<T>>(async (event) => {
      if (detached.current) throw new DetachedQueueError();
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
  const canLeaveRef = useRef(canLeave);
  canLeaveRef.current = canLeave;
  // 떠나도 되는 때: 받은 입력이 모두 저장됐고, 화면이 남은 것을 맡겨도 된다고 할 때(결과 모름)
  const leavable = useCallback(
    () =>
      savingQueue.size() === 0 &&
      !saveError &&
      (canLeaveRef.current?.() ?? false),
    [savingQueue, saveError]
  );
  const leavableRef = useRef(leavable);
  leavableRef.current = leavable;
  useEffect(() => {
    detached.current = false;
    return () => {
      detached.current = leavableRef.current();
    };
  }, []);
  useEffect(() => {
    const leaveBlocked = () => blocked() && !leavable();
    const guard = (e: BeforeUnloadEvent) => {
      if (leaveBlocked()) e.preventDefault();
    };
    window.addEventListener('beforeunload', guard);
    const unblock = router?.history.block({
      blockerFn: leaveBlocked,
      enableBeforeUnload: leaveBlocked,
    });
    return () => {
      window.removeEventListener('beforeunload', guard);
      unblock?.();
    };
  }, [router, blocked, leavable]);
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
    /**
     * 저장 중·처리 중인 입력이 다 끝날 때까지 기다린다. 머리가 실패했으면(결과를 모르는 입력) 그 오류로 거절한다 — 화면을 떠나기 전에.
     * 기다리는 사이 받은 입력도 기다린다 — 처리 큐가 비는 순간 저장 큐에 남은 입력이 있으면 한 번 더 돈다
     */
    async settle() {
      if (saveError) throw saveError;
      do {
        await savingQueue.drain();
        await queue.drain();
      } while (savingQueue.size() > 0 || queue.size() > 0);
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
    /** 받았지만 아직 저장하지 못한 입력이 있다 */
    unsaved: () => savingQueue.size() > 0,
    /** 결과 모름을 남기고 떠난 화면의 큐다 — 늦게 온 결과로 화면을 바꾸지 않는다 */
    detached: () => detached.current,
    blocked,
    ready: restored && restoredIds.current.size === 0,
    error: () => saveError ?? savingQueue.error() ?? queue.error(),
    storageError: () => saveError ?? savingQueue.error(),
  };
}

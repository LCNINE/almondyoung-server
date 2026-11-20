import 'fake-indexeddb/auto';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import { OperationContext } from '../../operations/OperationContext';
import { createOperationRunner } from '../../operations/operationRunner';
import { createOperationStore } from '../../operations/operationStore';
import { useWorkScanQueue } from './useWorkScanQueue';

it('retries unsaved inputs in order with their original IDs before consuming them', async () => {
  const store = createOperationStore(crypto.randomUUID());
  const getScope = async () => 'local-test-worker';
  const runtime = {
    store,
    getScope,
    runner: createOperationRunner({
      store,
      getScope,
      api: { request: vi.fn() },
    }),
  };
  const draft = store.draft;
  let diskFull = true;
  const attemptedIds: string[] = [];
  vi.spyOn(store, 'draft').mockImplementation(async (id, update) => {
    if (update && diskFull) {
      const events = update(undefined) as { id: string }[];
      attemptedIds.push(events[0].id);
      throw new DOMException('disk full', 'QuotaExceededError');
    }
    return draft(id, update);
  });
  const consumed: { code: string; id: string }[] = [];
  const { result } = renderHook(
    () =>
      useWorkScanQueue<string>(async (code, id) => {
        // Persisting the input must precede any business action.
        expect(
          await store.draft('local-test-worker:scan:count:s1')
        ).toContainEqual({ id, data: code });
        consumed.push({ code, id });
      }, 'count:s1'),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <OperationContext.Provider value={runtime}>
          {children}
        </OperationContext.Provider>
      ),
    }
  );
  act(() => {
    result.current.enqueue('A');
    result.current.enqueue('A');
    result.current.enqueue('B');
  });
  await waitFor(() => expect(result.current.error()).toBeTruthy());
  expect(consumed).toEqual([]);
  expect(result.current.size()).toBe(3);
  const leaveWithUnsavedInput = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(leaveWithUnsavedInput);
  expect(leaveWithUnsavedInput.defaultPrevented).toBe(true);
  const firstId = attemptedIds[0];
  diskFull = false;
  await act(async () => result.current.retryHead());
  await waitFor(() =>
    expect(consumed.map((e) => e.code)).toEqual(['A', 'A', 'B'])
  );
  expect(consumed[0].id).toBe(firstId);
  expect(new Set(consumed.map((e) => e.id)).size).toBe(3);
  await waitFor(() => expect(result.current.size()).toBe(0));
  expect(result.current.error()).toBeFalsy();
  expect(await store.draft('local-test-worker:scan:count:s1')).toEqual([]);
  const leaveAfterRecovery = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(leaveAfterRecovery);
  expect(leaveAfterRecovery.defaultPrevented).toBe(false);
});

it('loads older saved inputs before new inputs when the initial storage read is retried', async () => {
  const store = createOperationStore(crypto.randomUUID());
  const getScope = async () => 'local-test-worker';
  const runtime = {
    store,
    getScope,
    runner: createOperationRunner({
      store,
      getScope,
      api: { request: vi.fn() },
    }),
  };
  await store.draft('local-test-worker:scan:outbound:s1', () => [
    { id: 'previous-scan', data: 'A' },
  ]);
  const draft = store.draft;
  let unavailable = true;
  vi.spyOn(store, 'draft').mockImplementation(async (id, update) => {
    if (!update && unavailable)
      throw new DOMException('storage unavailable', 'UnknownError');
    return draft(id, update);
  });
  const consumed: { code: string; id: string }[] = [];
  const { result } = renderHook(
    () =>
      useWorkScanQueue<string>(async (code, id) => {
        consumed.push({ code, id });
      }, 'outbound:s1'),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <OperationContext.Provider value={runtime}>
          {children}
        </OperationContext.Provider>
      ),
    }
  );
  expect(result.current.blocked()).toBe(true);
  await waitFor(() => expect(result.current.error()).toBeTruthy());
  expect(result.current.size()).toBe(0);
  expect(result.current.blocked()).toBe(true);
  const leaveWithoutLoadingScans = new Event('beforeunload', {
    cancelable: true,
  });
  window.dispatchEvent(leaveWithoutLoadingScans);
  expect(leaveWithoutLoadingScans.defaultPrevented).toBe(true);
  act(() => result.current.enqueue('B'));
  await waitFor(() => expect(result.current.storageError()).toBeTruthy());
  expect(consumed).toEqual([]);
  unavailable = false;
  await act(async () => result.current.retryHead());
  await waitFor(() => expect(consumed.map((e) => e.code)).toEqual(['A', 'B']));
  expect(consumed[0].id).toBe('previous-scan');
  await waitFor(() => expect(result.current.size()).toBe(0));
  expect(result.current.error()).toBeFalsy();
  expect(result.current.blocked()).toBe(false);
  await act(async () => result.current.retryHead());
  expect(consumed).toHaveLength(2);
  expect(await store.draft('local-test-worker:scan:outbound:s1')).toEqual([]);
});

it('keeps restored inputs in recovery until replay and reconciliation finish', async () => {
  const store = createOperationStore(crypto.randomUUID());
  const getScope = async () => 'worker';
  const runtime = {
    store,
    getScope,
    runner: createOperationRunner({
      store,
      getScope,
      api: { request: vi.fn() },
    }),
  };
  await store.draft('worker:scan:outbound:s1', () => [
    { id: 'old', data: 'A' },
  ]);
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const consumed: string[] = [];
  const { result } = renderHook(
    () =>
      useWorkScanQueue<string>(async (code) => {
        consumed.push(code);
        await gate;
      }, 'outbound:s1'),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <OperationContext.Provider value={runtime}>
          {children}
        </OperationContext.Provider>
      ),
    }
  );
  await waitFor(() => expect(consumed).toEqual(['A']));
  expect(result.current.ready).toBe(false);
  release();
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(await store.draft('worker:scan:outbound:s1')).toEqual([]);
});

it('settle 은 저장·처리가 다 끝난 뒤 풀리고, 머리가 실패하면 그 오류로 거절한다', async () => {
  const store = createOperationStore(crypto.randomUUID());
  const getScope = async () => 'local-test-worker';
  const runtime = {
    store,
    getScope,
    runner: createOperationRunner({
      store,
      getScope,
      api: { request: vi.fn() },
    }),
  };
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let fail = false;
  const consumed: string[] = [];
  const { result } = renderHook(
    () =>
      useWorkScanQueue<string>(async (code) => {
        await gate;
        if (fail) throw new Error('lost');
        consumed.push(code);
      }, 'settle:s1'),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <OperationContext.Provider value={runtime}>
          {children}
        </OperationContext.Provider>
      ),
    }
  );
  await waitFor(() => expect(result.current.ready).toBe(true));
  act(() => {
    result.current.enqueue('A');
    result.current.enqueue('B');
  });
  let settled = false;
  const done = result.current.settle().then(() => {
    settled = true;
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(settled).toBe(false);
  release();
  await act(async () => done);
  expect(consumed).toEqual(['A', 'B']);

  fail = true;
  act(() => result.current.enqueue('C'));
  await expect(result.current.settle()).rejects.toThrow('lost');
});

it('settle 은 기다리는 사이 새로 받은 입력(아직 저장 중)까지 보낸 뒤에 풀린다', async () => {
  const store = createOperationStore(crypto.randomUUID());
  const getScope = async () => 'local-test-worker';
  const runtime = {
    store,
    getScope,
    runner: createOperationRunner({
      store,
      getScope,
      api: { request: vi.fn() },
    }),
  };
  const draft = store.draft;
  // B 의 저장을 붙잡는다 — A 가 다 보내져 처리 큐가 비는 순간 B 는 아직 저장 큐에 있다
  let releaseSave!: () => void;
  const saveHeld = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  vi.spyOn(store, 'draft').mockImplementation(async (id, update) => {
    if (
      update &&
      (update([]) as { data: string }[]).some((e) => e.data === 'B')
    )
      await saveHeld;
    return draft(id, update);
  });
  let releaseA!: () => void;
  const aHeld = new Promise<void>((resolve) => {
    releaseA = resolve;
  });
  const consumed: string[] = [];
  const { result } = renderHook(
    () =>
      useWorkScanQueue<string>(async (code) => {
        if (code === 'A') await aHeld;
        consumed.push(code);
      }, 'settle-late:s1'),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <OperationContext.Provider value={runtime}>
          {children}
        </OperationContext.Provider>
      ),
    }
  );
  await waitFor(() => expect(result.current.ready).toBe(true));
  act(() => result.current.enqueue('A'));
  // A 가 저장을 마치고 처리 중(붙잡힘)이다
  await waitFor(() => expect(result.current.head()?.data).toBe('A'));
  let settled = false;
  const done = result.current.settle().then(() => {
    settled = true;
  });
  // settle 이 시작된 뒤에 받은 입력
  act(() => result.current.enqueue('B'));
  releaseA();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(consumed).toEqual(['A']);
  expect(settled).toBe(false);
  releaseSave();
  await act(async () => done);
  expect(consumed).toEqual(['A', 'B']);
});

function leavingFixture() {
  const store = createOperationStore(crypto.randomUUID());
  const getScope = async () => 'local-test-worker';
  const runtime = {
    store,
    getScope,
    runner: createOperationRunner({
      store,
      getScope,
      api: { request: vi.fn() },
    }),
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <OperationContext.Provider value={runtime}>
      {children}
    </OperationContext.Provider>
  );
  return { store, wrapper };
}

it('결과 모름을 남기고 떠난 화면의 큐는 뒤에 줄 선 입력을 보내지 않고 저장해 둔다', async () => {
  const { store, wrapper } = leavingFixture();
  let releaseHead!: () => void;
  const consumed: string[] = [];
  let checking = false;
  const { result, unmount } = renderHook(
    () =>
      useWorkScanQueue<string>(
        async (code) => {
          if (code === 'A')
            await new Promise<void>((resolve) => (releaseHead = resolve));
          consumed.push(code);
        },
        'outbound:s1',
        () => checking
      ),
    { wrapper }
  );
  act(() => {
    result.current.enqueue('A');
    result.current.enqueue('B');
  });
  await waitFor(() => expect(releaseHead).toBeDefined());
  await waitFor(() => expect(result.current.unsaved()).toBe(false));
  checking = true;
  unmount();
  await act(async () => releaseHead());
  await waitFor(() => expect(consumed).toContain('A'));
  // 줄 선 입력이 처리될 시간을 준다 — 떠난 큐는 그래도 보내지 않는다
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  expect(consumed).toEqual(['A']);
  expect(
    (
      await store.draft<Array<{ data: string }>>(
        'local-test-worker:scan:outbound:s1'
      )
    )?.map((e) => e.data)
  ).toEqual(['B']);
});

it('결과 모름이 남아도 뒤 입력이 아직 저장되지 않았으면 떠나지 못한다', async () => {
  const { store, wrapper } = leavingFixture();
  const draft = store.draft;
  let holdSave!: () => void;
  vi.spyOn(store, 'draft').mockImplementation(async (id, update) => {
    if (update && !holdSave)
      await new Promise<void>((resolve) => (holdSave = resolve));
    return draft(id, update);
  });
  const { result } = renderHook(
    () =>
      useWorkScanQueue<string>(
        async () => {},
        'outbound:s1',
        () => true
      ),
    { wrapper }
  );
  act(() => {
    result.current.enqueue('A');
  });
  await waitFor(() => expect(holdSave).toBeDefined());
  expect(result.current.unsaved()).toBe(true);
  const leave = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(leave);
  expect(leave.defaultPrevented).toBe(true);
  await act(async () => holdSave());
});

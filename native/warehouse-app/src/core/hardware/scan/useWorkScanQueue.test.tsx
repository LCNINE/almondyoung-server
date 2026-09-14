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

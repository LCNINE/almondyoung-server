import { act, renderHook, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { expect, it, vi } from 'vitest';
import { createTestWorkRuntime } from '../../domains/inbound/__fixtures__/workRuntime';
import { useWorkReadiness } from './useWorkReadiness';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

it('로그인 전에는 검사하지 않고 로그인하면 준비한다', async () => {
  const runtime = createTestWorkRuntime({ request: vi.fn() });
  const scope = vi.spyOn(runtime, 'getScope');
  const restore = vi.spyOn(runtime.runner, 'restore');
  const { result, rerender } = renderHook(
    ({ authed }) => useWorkReadiness(runtime, authed),
    {
      initialProps: { authed: false },
    }
  );
  expect(result.current.state.status).toBe('signed_out');
  expect(scope).not.toHaveBeenCalled();
  expect(restore).not.toHaveBeenCalled();
  act(() => rerender({ authed: true }));
  await waitFor(() =>
    expect(result.current.state).toEqual({ status: 'ready', scope: 'fixture' })
  );
  expect(restore).toHaveBeenCalledTimes(1);
});

it('scope 확인 실패를 scope 단계 실패로 표시한다', async () => {
  const runtime = createTestWorkRuntime({ request: vi.fn() });
  vi.spyOn(runtime, 'getScope').mockRejectedValueOnce(
    new Error('scope unavailable')
  );
  const restore = vi.spyOn(runtime.runner, 'restore');

  const { result } = renderHook(() => useWorkReadiness(runtime, true));

  await waitFor(() =>
    expect(result.current.state).toEqual({
      status: 'failed',
      step: 'scope',
      message: 'scope unavailable',
    })
  );
  expect(restore).not.toHaveBeenCalled();
});

it('복구 실패를 restore 단계 실패로 표시한다', async () => {
  const runtime = createTestWorkRuntime({ request: vi.fn() });
  vi.spyOn(runtime.runner, 'restore').mockRejectedValueOnce(
    new Error('store unavailable')
  );

  const { result } = renderHook(() => useWorkReadiness(runtime, true));

  await waitFor(() =>
    expect(result.current.state).toEqual({
      status: 'failed',
      step: 'restore',
      message: 'store unavailable',
    })
  );
});

it('재확인 중 pending 재시도 실패를 retry 단계 실패로 표시한다', async () => {
  const runtime = createTestWorkRuntime({ request: vi.fn() });
  const retry = vi
    .spyOn(runtime.runner, 'retryPending')
    .mockRejectedValue(new Error('retry unavailable'));
  const { result } = renderHook(() => useWorkReadiness(runtime, true));
  await waitFor(() => expect(result.current.state.status).toBe('ready'));

  await act(async () => result.current.recheck());

  expect(result.current.state).toEqual({
    status: 'failed',
    step: 'retry',
    message: 'retry unavailable',
  });
  expect(retry).toHaveBeenCalledTimes(1);
});

it('실패 뒤 재확인이 끝까지 성공하면 ready로 돌아간다', async () => {
  const runtime = createTestWorkRuntime({ request: vi.fn() });
  vi.spyOn(runtime.runner, 'restore').mockRejectedValueOnce(
    new Error('store unavailable')
  );
  const retry = vi.spyOn(runtime.runner, 'retryPending');
  const { result } = renderHook(() => useWorkReadiness(runtime, true));
  await waitFor(() => expect(result.current.state.status).toBe('failed'));

  await act(async () => result.current.recheck());

  expect(result.current.state).toEqual({ status: 'ready', scope: 'fixture' });
  expect(retry).toHaveBeenCalledTimes(1);
});

it('동시 재확인은 하나의 Promise와 pending 재시도를 공유한다', async () => {
  const runtime = createTestWorkRuntime({ request: vi.fn() });
  const retryGate = deferred<void>();
  const retry = vi
    .spyOn(runtime.runner, 'retryPending')
    .mockImplementation(() => retryGate.promise);
  const { result } = renderHook(() => useWorkReadiness(runtime, true));
  await waitFor(() => expect(result.current.state.status).toBe('ready'));

  let first!: Promise<void>;
  let second!: Promise<void>;
  act(() => {
    first = result.current.recheck();
    second = result.current.recheck();
  });

  expect(second).toBe(first);
  await waitFor(() => expect(retry).toHaveBeenCalledTimes(1));
  await act(async () => {
    retryGate.resolve();
    await first;
  });
  expect(result.current.state).toEqual({ status: 'ready', scope: 'fixture' });
});

it('최종 scope가 바뀌면 scope 단계 실패로 남긴다', async () => {
  const runtime = createTestWorkRuntime({ request: vi.fn() });
  vi.spyOn(runtime, 'getScope')
    .mockResolvedValueOnce('account-a')
    .mockResolvedValueOnce('account-b');
  const { result } = renderHook(() => useWorkReadiness(runtime, true));

  await waitFor(() =>
    expect(result.current.state).toEqual({
      status: 'failed',
      step: 'scope',
      message: '로그인을 다시 확인해 주세요.',
    })
  );
});

it('이전 runtime의 지연 scope 완료는 새 runtime 상태와 복구를 건드리지 않는다', async () => {
  const runtimeA = createTestWorkRuntime({ request: vi.fn() });
  const runtimeB = createTestWorkRuntime({ request: vi.fn() });
  const oldScope = deferred<string>();
  vi.spyOn(runtimeA, 'getScope').mockImplementationOnce(() => oldScope.promise);
  const oldRestore = vi.spyOn(runtimeA.runner, 'restore');
  const { result, rerender } = renderHook(
    ({ runtime }) => useWorkReadiness(runtime, true),
    { initialProps: { runtime: runtimeA } }
  );
  await waitFor(() => expect(runtimeA.getScope).toHaveBeenCalledTimes(1));

  act(() => rerender({ runtime: runtimeB }));
  expect(result.current.state.status).toBe('checking_scope');
  await waitFor(() =>
    expect(result.current.state).toEqual({ status: 'ready', scope: 'fixture' })
  );

  await act(async () => {
    oldScope.resolve('account-a');
    await oldScope.promise;
  });
  expect(result.current.state).toEqual({ status: 'ready', scope: 'fixture' });
  expect(oldRestore).not.toHaveBeenCalled();
});

it('이전 runtime의 지연 restore 실패는 새 runtime의 ready를 덮지 않는다', async () => {
  const runtimeA = createTestWorkRuntime({ request: vi.fn() });
  const runtimeB = createTestWorkRuntime({ request: vi.fn() });
  const oldRestore = deferred<void>();
  vi.spyOn(runtimeA.runner, 'restore').mockImplementationOnce(
    () => oldRestore.promise
  );
  const { result, rerender } = renderHook(
    ({ runtime }) => useWorkReadiness(runtime, true),
    { initialProps: { runtime: runtimeA } }
  );
  await waitFor(() => expect(result.current.state.status).toBe('restoring'));

  act(() => rerender({ runtime: runtimeB }));
  await waitFor(() =>
    expect(result.current.state).toEqual({ status: 'ready', scope: 'fixture' })
  );

  await act(async () => {
    oldRestore.reject(new Error('old store failed'));
    await oldRestore.promise.catch(() => {});
  });
  expect(result.current.state).toEqual({ status: 'ready', scope: 'fixture' });
});

it('이전 owner에서 보관한 recheck는 계정 전환 뒤 실행되지 않는다', async () => {
  const runtimeA = createTestWorkRuntime({ request: vi.fn() });
  const runtimeB = createTestWorkRuntime({ request: vi.fn() });
  const scopeA = vi.spyOn(runtimeA, 'getScope');
  const retryA = vi.spyOn(runtimeA.runner, 'retryPending');
  const { result, rerender } = renderHook(
    ({ runtime }) => useWorkReadiness(runtime, true),
    { initialProps: { runtime: runtimeA } }
  );
  await waitFor(() => expect(result.current.state.status).toBe('ready'));
  const staleRecheck = result.current.recheck;

  act(() => rerender({ runtime: runtimeB }));
  await waitFor(() =>
    expect(result.current.state).toEqual({ status: 'ready', scope: 'fixture' })
  );
  await act(async () => staleRecheck());

  expect(scopeA).toHaveBeenCalledTimes(2);
  expect(retryA).not.toHaveBeenCalled();
  expect(result.current.state).toEqual({ status: 'ready', scope: 'fixture' });
});

it('로그아웃 중 도착한 scope 결과를 무시하고 I/O를 이어가지 않는다', async () => {
  const runtime = createTestWorkRuntime({ request: vi.fn() });
  const oldScope = deferred<string>();
  vi.spyOn(runtime, 'getScope').mockImplementationOnce(() => oldScope.promise);
  const restore = vi.spyOn(runtime.runner, 'restore');
  const { result, rerender } = renderHook(
    ({ authed }) => useWorkReadiness(runtime, authed),
    { initialProps: { authed: true } }
  );
  await waitFor(() => expect(runtime.getScope).toHaveBeenCalledTimes(1));

  act(() => rerender({ authed: false }));
  expect(result.current.state).toEqual({ status: 'signed_out' });
  await act(async () => {
    oldScope.resolve('account-a');
    await oldScope.promise;
  });

  expect(result.current.state).toEqual({ status: 'signed_out' });
  expect(restore).not.toHaveBeenCalled();
});

it('StrictMode cleanup 뒤 이전 검사 실패가 새 ready를 덮지 않는다', async () => {
  const runtime = createTestWorkRuntime({ request: vi.fn() });
  const firstScope = deferred<string>();
  vi.spyOn(runtime, 'getScope')
    .mockImplementationOnce(() => firstScope.promise)
    .mockResolvedValue('fixture');
  const { result } = renderHook(() => useWorkReadiness(runtime, true), {
    wrapper: StrictMode,
  });
  await waitFor(() =>
    expect(result.current.state).toEqual({ status: 'ready', scope: 'fixture' })
  );

  await act(async () => {
    firstScope.reject(new Error('stale scope failure'));
    await firstScope.promise.catch(() => {});
  });

  expect(result.current.state).toEqual({ status: 'ready', scope: 'fixture' });
});

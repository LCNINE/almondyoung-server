import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { OperationContext, type WorkRuntime } from './OperationContext';
import { createOperationStore } from './operationStore';
import { useWorkDraft } from './useWorkDraft';

function setup() {
  const store = createOperationStore(crypto.randomUUID());
  // 다음 한 번의 getScope 만 붙잡는다.
  let scopeGate: Promise<void> | null = null;
  let failLoads = false;
  const runtime = {
    store: {
      ...store,
      draft: (async (id: string, update?: (old: unknown) => unknown) => {
        if (failLoads && !update) throw new Error('연결 끊김');
        return store.draft(id, update as never);
      }) as typeof store.draft,
    },
    getScope: async () => {
      const gate = scopeGate;
      scopeGate = null;
      if (gate) await gate;
      return 'scope';
    },
  } as unknown as WorkRuntime;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <OperationContext.Provider value={runtime}>
      {children}
    </OperationContext.Provider>
  );
  return {
    wrapper,
    gateTaken: () => scopeGate === null,
    holdNextScope(gate: Promise<void>) {
      scopeGate = gate;
    },
    failLoads(value: boolean) {
      failLoads = value;
    },
  };
}

describe('useWorkDraft', () => {
  it('다시 불러오면 실패를 지우고 저장된 값을 읽는다', async () => {
    const env = setup();
    env.failLoads(true);
    const { result } = renderHook(() => useWorkDraft('k', { n: 0 }), {
      wrapper: env.wrapper,
    });
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.ready).toBe(false);

    env.failLoads(false);
    act(() => result.current.reload());

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.error).toBeUndefined();
    expect(result.current.value).toEqual({ n: 0 });
  });

  it('다시 불러오기는 앞서 시작한 저장이 끝난 뒤에 읽는다', async () => {
    const env = setup();
    const { result } = renderHook(() => useWorkDraft('k', { n: 0 }), {
      wrapper: env.wrapper,
    });
    await waitFor(() => expect(result.current.ready).toBe(true));

    let release!: () => void;
    env.holdNextScope(new Promise<void>((r) => (release = r)));
    let first!: Promise<void>;
    act(() => {
      first = result.current.update(() => ({ n: 1 }));
    });
    await waitFor(() => expect(env.gateTaken()).toBe(true));
    act(() => result.current.reload());
    let second!: Promise<void>;
    act(() => {
      second = result.current.update((prev) => ({ n: prev.n + 10 }));
    });
    // 붙잡힌 첫 저장보다 뒤 작업이 먼저 끝날 기회를 준다.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    release();
    await act(async () => {
      await first;
      await second;
    });

    expect(await result.current.read()).toEqual({ n: 11 });
    await waitFor(() => expect(result.current.value).toEqual({ n: 11 }));
  });
});

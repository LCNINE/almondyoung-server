import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { authQueryKeys } from '@/lib/services/auth/query-keys';
import {
  endReveal,
  isRevealing,
  revealPhaseOf,
  startReveal,
} from './pii-notices';
import { leaveRevealedScreen, revealScreen } from './pii-reveal-cleanup';

/** 요청에 [보기] 헤더가 붙었는지에 따라 원문/가린 값을 돌려주는 가짜 서버 */
const server = (path: string) => {
  const calls: string[] = [];
  const queryFn = async () => {
    const value = isRevealing(path) ? 'raw' : 'masked';
    calls.push(value);
    return value;
  };
  return { calls, queryFn };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** [보기] — 이 화면의 쿼리를 원문으로 다시 받는다 */
const pressReveal = async (queryClient: QueryClient, path: string) => {
  startReveal(path);
  await queryClient.invalidateQueries({ type: 'active' });
};

const newClient = () =>
  new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });

describe('leaveRevealedScreen', () => {
  let queryClient: QueryClient;
  const subs: (() => void)[] = [];

  beforeEach(() => {
    endReveal();
    queryClient = newClient();
  });

  afterEach(() => {
    for (const unsubscribe of subs.splice(0)) unsubscribe();
    endReveal();
    queryClient.clear();
  });

  it('두 화면이 같이 쓰는 쿼리 — A 에서 [보기] 후 B 로 가면 B 의 관찰자도 원문을 들고 있지 않고 다시 받는다', async () => {
    const api = server('/payments/a');
    const key = ['users', 'u-1'];
    const onA = new QueryObserver(queryClient, {
      queryKey: key,
      queryFn: api.queryFn,
    });
    const offA = onA.subscribe(() => {});
    await flush();
    await pressReveal(queryClient, '/payments/a');
    expect(onA.getCurrentResult().data).toBe('raw');

    // B 가 먼저 구독하고(같은 키라 active 로 남는다) A 가 떠난다
    const onB = new QueryObserver(queryClient, {
      queryKey: key,
      queryFn: api.queryFn,
    });
    subs.push(onB.subscribe(() => {}));
    offA();
    leaveRevealedScreen(queryClient);

    expect(onB.getCurrentResult().data).not.toBe('raw');
    await flush();
    expect(onB.getCurrentResult().data).toBe('masked');
    expect(api.calls).toEqual(['masked', 'raw', 'masked']);
  });

  it('enabled:false 관찰자 — 요청은 막혀도 캐시의 원문을 돌려주지 않는다', async () => {
    const api = server('/a');
    const key = ['detail', 'd-1'];
    const shown = new QueryObserver(queryClient, {
      queryKey: key,
      queryFn: api.queryFn,
    });
    const off = shown.subscribe(() => {});
    await flush();
    await pressReveal(queryClient, '/a');
    const idle = new QueryObserver(queryClient, {
      queryKey: key,
      queryFn: api.queryFn,
      enabled: false,
    });
    subs.push(idle.subscribe(() => {}));
    off();
    leaveRevealedScreen(queryClient);
    expect(idle.getCurrentResult().data).toBeUndefined();
  });

  it('권한 쿼리는 지우지 않는다 — 안내가 «확인 중»으로 깜빡이지 않게', () => {
    queryClient.setQueryData(authQueryKeys.myPermissions(), {
      permissions: new Set(),
    });
    startReveal('/a');
    leaveRevealedScreen(queryClient);
    expect(
      queryClient.getQueryData(authQueryKeys.myPermissions())
    ).toBeDefined();
  });

  it('[보기]를 누른 적이 없으면 캐시를 하나도 바꾸지 않는다(원문 권한자·스위치 꺼짐)', async () => {
    const api = server('/a');
    const active = new QueryObserver(queryClient, {
      queryKey: ['active'],
      queryFn: api.queryFn,
    });
    subs.push(active.subscribe(() => {}));
    await flush();
    queryClient.setQueryData(['inactive'], 'cached');
    const events: string[] = [];
    subs.push(
      queryClient.getQueryCache().subscribe((e) => events.push(e.type))
    );

    leaveRevealedScreen(queryClient);
    await flush();

    expect(events).toEqual([]);
    expect(queryClient.getQueryData(['inactive'])).toBe('cached');
    expect(active.getCurrentResult().data).toBe('masked');
    expect(api.calls).toEqual(['masked']);
  });

  it('셸 밖 화면으로 나갔다가 돌아와도 원문 캐시를 다시 보여 주지 않는다', async () => {
    const api = server('/a');
    const first = new QueryObserver(queryClient, {
      queryKey: ['a'],
      queryFn: api.queryFn,
    });
    const off = first.subscribe(() => {});
    await flush();
    await pressReveal(queryClient, '/a');
    off();
    leaveRevealedScreen(queryClient);
    const back = new QueryObserver(queryClient, {
      queryKey: ['a'],
      queryFn: api.queryFn,
    });
    expect(back.getCurrentResult().data).toBeUndefined();
  });
});

describe('revealScreen', () => {
  let queryClient: QueryClient;
  const subs: (() => void)[] = [];

  beforeEach(() => {
    endReveal();
    queryClient = newClient();
  });

  afterEach(() => {
    for (const unsubscribe of subs.splice(0)) unsubscribe();
    endReveal();
    queryClient.clear();
  });

  it('재조회가 끝나기 전에는 pending, 성공한 뒤에 shown', async () => {
    let release: () => void = () => {};
    let gate = Promise.resolve();
    const observer = new QueryObserver(queryClient, {
      queryKey: ['d'],
      queryFn: async () => {
        await gate;
        return isRevealing('/d') ? 'raw' : 'masked';
      },
    });
    subs.push(observer.subscribe(() => {}));
    await flush();

    gate = new Promise((resolve) => (release = () => resolve()));
    const done = revealScreen(queryClient, '/d');
    expect(revealPhaseOf('/d')).toBe('pending');
    expect(observer.getCurrentResult().data).toBe('masked');
    release();
    await done;
    expect(revealPhaseOf('/d')).toBe('shown');
    expect(observer.getCurrentResult().data).toBe('raw');
  });

  it('첫 (가린) 요청이 도는 중에 [보기]를 눌러도 그 요청에 얹히지 않고 원문으로 다시 받은 뒤에야 shown', async () => {
    const calls: string[] = [];
    const pending: (() => void)[] = [];
    const observer = new QueryObserver(queryClient, {
      queryKey: ['first'],
      queryFn: () => {
        const value = isRevealing('/d') ? 'raw' : 'masked';
        calls.push(value);
        return new Promise<string>((resolve) =>
          pending.push(() => resolve(value))
        );
      },
    });
    subs.push(observer.subscribe(() => {}));
    expect(calls).toEqual(['masked']);

    const done = revealScreen(queryClient, '/d');
    // 먼저 시작된 가린 요청이 나중에 끝나도 결과가 되지 않는다
    pending[0]?.();
    await flush();
    expect(revealPhaseOf('/d')).toBe('pending');
    for (const resolve of pending.slice(1)) resolve();
    await done;
    expect(calls).toEqual(['masked', 'raw']);
    expect(revealPhaseOf('/d')).toBe('shown');
    expect(observer.getCurrentResult().data).toBe('raw');
  });

  it('재조회가 실패하면 보기를 끄고 가린 상태로 되돌린다([보기]가 다시 뜬다)', async () => {
    let fail = false;
    const ok = new QueryObserver(queryClient, {
      queryKey: ['ok'],
      queryFn: async () => (isRevealing('/d') ? 'raw' : 'masked'),
    });
    const broken = new QueryObserver(queryClient, {
      queryKey: ['broken'],
      queryFn: async () => {
        if (fail) throw new Error('down');
        return 'masked';
      },
    });
    subs.push(
      ok.subscribe(() => {}),
      broken.subscribe(() => {})
    );
    await flush();

    fail = true;
    await revealScreen(queryClient, '/d');
    expect(revealPhaseOf('/d')).toBe('idle');
    expect(isRevealing('/d')).toBe(false);
    expect(ok.getCurrentResult().data).not.toBe('raw');
    await flush();
    expect(ok.getCurrentResult().data).toBe('masked');
  });

  it('재조회 중에 화면을 떠났으면 돌아온 결과로 보기 중이 되지 않는다', async () => {
    let release: () => void = () => {};
    let gate = Promise.resolve();
    const observer = new QueryObserver(queryClient, {
      queryKey: ['d'],
      queryFn: async () => {
        await gate;
        return 'x';
      },
    });
    subs.push(observer.subscribe(() => {}));
    await flush();
    gate = new Promise((resolve) => (release = () => resolve()));
    const done = revealScreen(queryClient, '/d');
    leaveRevealedScreen(queryClient);
    release();
    await done;
    expect(revealPhaseOf('/d')).toBe('idle');
  });
});

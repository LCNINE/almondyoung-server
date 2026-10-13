import {
  chooseNavigation,
  createBackGuard,
  guardedNavigate,
  onPop,
  registerNavigationGuard,
  routeLinkClick,
  shouldPushSentinel,
} from './navigation-guard';

describe('routeLinkClick', () => {
  const base = {
    insidePreview: false,
    dirty: true,
    sameOrigin: true,
    samePage: false,
    modified: false,
    newTab: false,
  };

  it('미리보기 안 링크는 dirty 여도 확인 없이 막는다', () => {
    expect(routeLinkClick({ ...base, insidePreview: true })).toBe('block');
    expect(routeLinkClick({ ...base, insidePreview: true, dirty: false })).toBe(
      'block'
    );
  });

  it('dirty 인 앱 내 다른 페이지 링크는 확인을 받는다', () => {
    expect(routeLinkClick(base)).toBe('confirm');
  });

  it('dirty 가 아니거나 외부·새 탭·같은 페이지면 통과한다', () => {
    expect(routeLinkClick({ ...base, dirty: false })).toBe('pass');
    expect(routeLinkClick({ ...base, sameOrigin: false })).toBe('pass');
    expect(routeLinkClick({ ...base, newTab: true })).toBe('pass');
    expect(routeLinkClick({ ...base, modified: true })).toBe('pass');
    expect(routeLinkClick({ ...base, samePage: true })).toBe('pass');
  });
});

describe('routeLinkClick 우선순위', () => {
  const base = {
    insidePreview: false,
    dirty: true,
    sameOrigin: true,
    samePage: false,
    modified: false,
    newTab: false,
  };

  it.each([
    ['수정키', { modified: true }],
    ['새 탭', { newTab: true }],
    ['외부 주소', { sameOrigin: false }],
    ['같은 페이지 해시', { samePage: true }],
  ])('미리보기 링크는 %s 여도 막는다', (_, over) => {
    expect(routeLinkClick({ ...base, insidePreview: true, ...over })).toBe(
      'block'
    );
  });

  it.each([
    ['수정키', { modified: true }],
    ['새 탭', { newTab: true }],
    ['외부 주소', { sameOrigin: false }],
  ])('미리보기 밖 %s 링크는 dirty 여도 통과한다', (_, over) => {
    expect(routeLinkClick({ ...base, ...over })).toBe('pass');
  });
});

describe('guardedNavigate', () => {
  it('가드가 없으면 바로 이동하고, 있으면 가드에 맡긴다', () => {
    const go = jest.fn();
    guardedNavigate(go);
    expect(go).toHaveBeenCalledTimes(1);

    const guard = jest.fn();
    const unregister = registerNavigationGuard(guard);
    guardedNavigate(go);
    expect(guard).toHaveBeenCalledWith(go);
    expect(go).toHaveBeenCalledTimes(1);

    unregister();
    guardedNavigate(go);
    expect(go).toHaveBeenCalledTimes(2);
  });

  it('나중에 등록한 가드가 해제돼도 다른 가드를 지우지 않는다', () => {
    const a = registerNavigationGuard(jest.fn());
    const guardB = jest.fn();
    registerNavigationGuard(guardB);

    a();
    guardedNavigate(jest.fn());
    expect(guardB).toHaveBeenCalled();
  });
});

describe('shouldPushSentinel', () => {
  it('dirty 이고 현재 항목이 우리 센티넬이 아닐 때만 쌓는다', () => {
    expect(shouldPushSentinel(null, true)).toBe(true);
    expect(shouldPushSentinel({ __NA: true }, true)).toBe(true);
    expect(shouldPushSentinel({ timeSaleGuard: true }, true)).toBe(false);
    expect(shouldPushSentinel(null, false)).toBe(false);
  });
});

describe('onPop', () => {
  const base = {
    dirty: true,
    ignoreFlag: false,
    confirming: false,
    confirmResult: null,
  };

  it('무시 플래그가 있으면 한 번 소비하고 아무것도 하지 않는다', () => {
    expect(onPop({ ...base, ignoreFlag: true })).toBe('consume');
  });

  it('확인 중이거나 dirty 가 아니면 건너뛴다', () => {
    expect(onPop({ ...base, confirming: true })).toBe('skip');
    expect(onPop({ ...base, dirty: false })).toBe('skip');
  });

  it('dirty 이면 먼저 확인을 요청한다', () => {
    expect(onPop(base)).toBe('ask');
  });

  it('확인 결과: 취소는 머물고, 확인은 떠난다', () => {
    expect(onPop({ ...base, confirmResult: false })).toBe('stay');
    expect(onPop({ ...base, confirmResult: true })).toBe('leave');
  });
});

describe('chooseNavigation', () => {
  it('센티넬이 맨 위면 replace, 아니면 push', () => {
    expect(chooseNavigation({ timeSaleGuard: true })).toBe('replace');
    expect(chooseNavigation({ __NA: true, timeSaleGuard: true })).toBe(
      'replace'
    );
    expect(chooseNavigation({ __NA: true })).toBe('push');
    expect(chooseNavigation(null)).toBe('push');
  });
});

// 메모리 안의 브라우저 history 모형. back() 의 popstate 와 타이머는 비동기라 settle() 에서 흘려보낸다.
const WORKSPACE = '/mall/marketing/time-sale';
const LIST = '/mall/marketing/time-sale';

function simulate(start: string[], answers: boolean[] = []) {
  let entries = start.map((url) => ({ url, state: { __NA: true } as unknown }));
  let index = entries.length - 1;
  const pops: (() => void)[] = [];
  let timers: (() => void)[] = [];
  const effects: (() => void)[] = [];
  const asked: string[] = [];
  let dirty = false;

  const history = {
    get state() {
      return entries[index].state;
    },
    pushState(state: unknown, _: string, url?: string) {
      entries = entries.slice(0, index + 1);
      entries.push({ url: url ?? entries[index].url, state });
      index++;
    },
    back() {
      if (index > 0) pops.push(() => index--);
    },
  };

  const router = {
    push(url: string) {
      history.pushState({ __NA: true }, '', url);
      leaveIfAway();
    },
    replace(url: string) {
      entries[index] = { url, state: { __NA: true } };
      leaveIfAway();
    },
  };

  let guard: ReturnType<typeof createBackGuard> | null = null;

  const setDirty = (next: boolean) => {
    dirty = next;
    effects.push(() => guard?.sync(dirty));
  };

  const mount = () => {
    dirty = false;
    guard = createBackGuard({
      history,
      href: () => entries[index].url,
      confirm: (message) => {
        asked.push(message);
        return answers.shift() ?? false;
      },
      discard: () => setDirty(false),
      fallback: () => router.replace(LIST),
      setTimer: (run) => {
        timers.push(run);
        return () => {
          timers = timers.filter((t) => t !== run);
        };
      },
    });
  };

  function leaveIfAway() {
    if (guard && entries[index].url !== WORKSPACE) {
      guard.dispose();
      guard = null;
    }
  }

  const settle = () => {
    for (let round = 0; round < 10; round++) {
      while (effects.length) effects.shift()!();
      if (pops.length) {
        pops.shift()!();
        guard?.onPopState();
        leaveIfAway();
        if (!guard && entries[index].url === WORKSPACE) mount();
        continue;
      }
      if (!timers.length) return;
      const due = timers;
      timers = [];
      due.forEach((t) => t());
    }
  };

  if (entries[index].url === WORKSPACE) mount();

  return {
    asked,
    get url() {
      return entries[index].url;
    },
    get top() {
      return entries[index].state;
    },
    edit: () => {
      setDirty(true);
      settle();
    },
    clean: () => {
      setDirty(false);
      settle();
    },
    // effect 만 돌고 back 의 popstate 는 아직 도착하지 않은 상태.
    cleanPending: () => {
      setDirty(false);
      while (effects.length) effects.shift()!();
    },
    back: () => {
      history.back();
      settle();
    },
    approvedNavigate: (path: string) => {
      guard?.release();
      setDirty(false);
      router[chooseNavigation(history.state)](path);
      settle();
    },
  };
}

describe('뒤로가기 경고 시나리오(createBackGuard + 메모리 history)', () => {
  it('(a) 목록→편집→Back 취소→Back 확인→이전 페이지', () => {
    const b = simulate(['/home', WORKSPACE], [false, true]);
    b.edit();
    b.back();
    expect(b.url).toBe(WORKSPACE);
    expect(b.asked).toHaveLength(1);
    b.back();
    expect(b.asked).toHaveLength(2);
    expect(b.url).toBe('/home');
  });

  it('(b) 편집→저장→Back 한 번에 나간다', () => {
    const b = simulate(['/home', WORKSPACE]);
    b.edit();
    b.clean();
    b.back();
    expect(b.url).toBe('/home');
    expect(b.asked).toHaveLength(0);
  });

  it('(c) 직접 진입→편집→Back 확인→목록', () => {
    const b = simulate([WORKSPACE], [true]);
    b.edit();
    b.back();
    expect(b.asked).toHaveLength(1);
    expect(b.url).toBe(LIST);
    expect(b.top).not.toHaveProperty(SENTINEL);
  });

  it('(d) 편집→사이드바 이동 승인→새 페이지에서 Back 한 번에 돌아온다', () => {
    const b = simulate(['/home', WORKSPACE]);
    b.edit();
    b.approvedNavigate('/orders');
    expect(b.url).toBe('/orders');
    b.back();
    expect(b.url).toBe(WORKSPACE);
    expect(b.top).not.toHaveProperty(SENTINEL);
    expect(b.asked).toHaveLength(0);
  });

  it('(e) 편집→섹션 전환으로 버림→Back 한 번에 나간다', () => {
    const b = simulate(['/home', WORKSPACE]);
    b.edit();
    b.clean();
    expect(b.top).not.toHaveProperty(SENTINEL);
    b.back();
    expect(b.url).toBe('/home');
    expect(b.asked).toHaveLength(0);
  });

  it('(f) 직접 진입→편집→저장→재편집→Back 확인→목록(앞으로가기 항목에 속지 않음)', () => {
    const b = simulate([WORKSPACE], [true]);
    b.edit();
    b.clean();
    b.edit();
    b.back();
    expect(b.asked).toHaveLength(1);
    expect(b.url).toBe(LIST);
    expect(b.top).not.toHaveProperty(SENTINEL);
  });

  it('버린 직후 back 이 끝나기 전에 다시 편집해도 센티넬이 다시 쌓인다', () => {
    const b = simulate(['/home', WORKSPACE], [true]);
    b.edit();
    b.cleanPending();
    b.edit();
    expect(b.top).toHaveProperty(SENTINEL, true);
    b.back();
    expect(b.asked).toHaveLength(1);
    expect(b.url).toBe('/home');
  });
});

const SENTINEL = 'timeSaleGuard';

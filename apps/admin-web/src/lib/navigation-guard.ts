// 미저장 변경이 있는 화면이 "떠나기 전 확인" 콜백을 등록하는 곳. 사이드바 등 router.push 호출부가 먼저 묻는다.
type Guard = (go: () => void) => void;

let current: Guard | null = null;

export function registerNavigationGuard(guard: Guard) {
  current = guard;

  // 내가 등록한 가드일 때만 해제한다(다른 화면이 덮어썼으면 건드리지 않는다).
  return () => {
    if (current === guard) current = null;
  };
}

// 가드가 있으면 확인을 거쳐 이동하고, 없으면 바로 이동한다.
export function guardedNavigate(go: () => void) {
  if (current) current(go);
  else go();
}

export type LinkClickInput = {
  insidePreview: boolean;
  dirty: boolean;
  sameOrigin: boolean;
  samePage: boolean;
  modified: boolean;
  newTab: boolean;
};

// 문서 링크 클릭 처리 결정: 미리보기 링크는 항상 막고(확인 없음), dirty 인 앱 내 이동만 확인한다.
export function routeLinkClick(
  input: LinkClickInput
): 'block' | 'confirm' | 'pass' {
  if (input.insidePreview) return 'block';
  if (!input.dirty || input.modified || input.newTab) return 'pass';
  if (!input.sameOrigin || input.samePage) return 'pass';

  return 'confirm';
}

// 뒤로가기 경고용 센티넬 history 항목의 표식.
export const SENTINEL_KEY = 'timeSaleGuard';

function isSentinel(state: unknown) {
  return !!state && typeof state === 'object' && SENTINEL_KEY in state;
}

// 센티넬이 맨 위에서 이동이 승인되면 replace 로 센티넬 항목을 새 페이지로 바꿔, Back 이 원래 화면으로 돌아오게 한다.
export function chooseNavigation(state: unknown): 'push' | 'replace' {
  return isSentinel(state) ? 'replace' : 'push';
}

// 승인된 이동 실행: 현재 history 상태에 맞춰 push/replace 를 고른다.
export function navigateTo(
  router: { push: (p: string) => void; replace: (p: string) => void },
  path: string
) {
  router[chooseNavigation(window.history.state)](path);
}

// dirty 가 됐을 때 센티넬을 쌓을지: 이미 우리 항목 위에 있으면 또 쌓지 않는다(항상 최대 1개).
export function shouldPushSentinel(state: unknown, dirty: boolean) {
  return dirty && !isSentinel(state);
}

export type PopInput = {
  dirty: boolean;
  ignoreFlag: boolean;
  confirming: boolean;
  // null = 아직 묻지 않음, true/false = 네이티브 confirm 결과.
  confirmResult: boolean | null;
};

// popstate 처리 결정. 센티넬을 스스로 지우려고 부른 back 은 consume, 확인 도중 재진입은 skip.
export function onPop(
  input: PopInput
): 'consume' | 'skip' | 'ask' | 'stay' | 'leave' {
  if (input.ignoreFlag) return 'consume';
  if (input.confirming || !input.dirty) return 'skip';
  if (input.confirmResult === null) return 'ask';
  if (!input.confirmResult) return 'stay';

  return 'leave';
}

export type BackGuardDeps = {
  history: {
    readonly state: unknown;
    pushState(state: unknown, unused: string, url?: string): void;
    back(): void;
  };
  href: () => string;
  confirm: (message: string) => boolean;
  // 편집본을 버린다(화면 dirty 해제).
  discard: () => void;
  // 확인 후 back 으로 못 떠났을 때(이전 항목 없음) 갈 곳.
  fallback: () => void;
  setTimer: (run: () => void, ms: number) => () => void;
};

export const LEAVE_MESSAGE =
  '저장하지 않은 변경 사항이 있습니다. 페이지를 나가시겠습니까?';

// 브라우저는 이전 항목 유무를 알려주지 않으므로(history.length 는 앞으로가기 항목도 센다) back 후 이 시간 안에 못 떠나면 폴백한다.
export const LEAVE_FALLBACK_MS = 300;

// 뒤로가기 경고: dirty 동안 센티넬을 최대 1개 두고, popstate 에 네이티브 confirm 으로 묻는다.
// dirty→clean 전환은 전부 sync(false) 한 길로 센티넬을 지운다(승인된 라우트 이동만 release 로 예외).
export function createBackGuard(deps: BackGuardDeps) {
  const { history } = deps;
  let dirty = false,
    on = false,
    ignoreNext = false,
    confirming = false;
  let cancelFallback: (() => void) | null = null;

  const pushSentinel = () => {
    const state = history.state;
    const base = state && typeof state === 'object' ? state : {};
    history.pushState({ ...base, [SENTINEL_KEY]: true }, '', deps.href());
    on = true;
  };

  // 떠나기에 성공했다(popstate·pagehide·언마운트): 폴백을 취소한다.
  const left = () => {
    cancelFallback?.();
    cancelFallback = null;
  };

  return {
    sync(next: boolean) {
      dirty = next;

      if (next) {
        // 지우려고 부른 back 이 아직 도착 전이면 맨 위가 센티넬이라 쌓지 않는다(도착 때 다시 쌓음).
        if (shouldPushSentinel(history.state, true)) pushSentinel();
        else on = true;
        return;
      }

      if (!on) return;
      on = false;
      if (isSentinel(history.state)) {
        ignoreNext = true;
        history.back();
      }
    },

    // 승인된 라우트 이동: 센티넬은 navigateTo 의 replace 가 덮으므로 back 하지 않는다.
    release() {
      on = false;
    },

    onPopState() {
      if (cancelFallback) return left();

      const input = { dirty, ignoreFlag: ignoreNext, confirming };
      const first = onPop({ ...input, confirmResult: null });

      if (first === 'consume') {
        ignoreNext = false;
        if (dirty && shouldPushSentinel(history.state, true)) pushSentinel();
        return;
      }
      if (first !== 'ask') return;

      // 1) 센티넬은 방금 빠졌다 → 2) 묻기 → 3) 취소면 다시 쌓고, 확인이면 버리고 back + 폴백 타이머.
      on = false;
      confirming = true;
      const ok = deps.confirm(LEAVE_MESSAGE);
      confirming = false;

      if (onPop({ ...input, confirmResult: ok }) === 'stay')
        return pushSentinel();

      dirty = false;
      deps.discard();
      history.back();
      cancelFallback = deps.setTimer(() => {
        cancelFallback = null;
        deps.fallback();
      }, LEAVE_FALLBACK_MS);
    },

    left,
    dispose: left,
  };
}

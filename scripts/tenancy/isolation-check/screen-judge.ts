import {
  TENANT_ONE_ONLY_UPSTREAMS,
  type TenantOneOnlyUpstream,
} from '../../../apps/admin-web/src/lib/tenant-shell/shell-brand';

/**
 * 화면 실측의 판정 — 브라우저가 본 것(`browser.ts`)을 받아 순수하게 판정한다. 브라우저를 모르니 단위로 잰다.
 */

/** 화면에서 나온 글자 하나와 그 출처(«/mall/tags 탭 제목» 같은). */
export interface SeenText {
  readonly where: string;
  readonly text: string;
}

/**
 * 금지어가 나온 곳들. 대소문자를 가리지 않는다. 금지어 목록은 비공개 값이라 레포에 두지 않는다(로컬 파일·라이브 Secret) —
 * 그래서 출력에도 목록 전체가 아니라 걸린 낱말만 나온다.
 */
export function forbiddenHits(seen: readonly SeenText[], words: readonly string[]): string[] {
  const hits: string[] = [];
  for (const s of seen) {
    const text = s.text.toLowerCase();
    for (const word of words) if (text.includes(word.toLowerCase())) hits.push(`${s.where} «${word}»`);
  }
  return hits;
}

/** 테넌트 2 의 브라우저가 닿아도 되는 곳 — 테넌트 도메인(호스트:포트)과 테넌트 2 버킷의 URL 접두사. */
export interface AllowedNetwork {
  readonly hosts: readonly string[];
  readonly prefixes: readonly string[];
}

/** 허용 밖 요청을 호스트별로 묶는다(«호스트 (N건, 예: 첫 URL)»). `data:`·`blob:`·`about:` 은 네트워크가 아니다. */
export function offListRequests(urls: readonly string[], allowed: AllowedNetwork): string[] {
  const off = new Map<string, string[]>();
  for (const raw of urls) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:' && url.protocol !== 'ws:' && url.protocol !== 'wss:')
      continue;
    if (allowed.hosts.includes(url.host)) continue;
    if (allowed.prefixes.some((p) => raw.startsWith(p))) continue;
    off.set(url.host, [...(off.get(url.host) ?? []), raw]);
  }
  return [...off.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([host, list]) => `${host} (${list.length}건, 예: ${list[0]})`);
}

/**
 * 브라우저가 테넌트 1 만 섬기는 업스트림으로 가는 길 — admin-web 의 브라우저 프록시 이름(`const/api-const.ts` 의 `/proxy/<이름>`).
 * 업스트림 목록은 admin-web 의 `TENANT_ONE_ONLY_UPSTREAMS` 를 그대로 쓴다 — 거기 하나가 늘면 이 표가 타입으로 빨개진다.
 * 게이트(`tenant-shell.gate.spec.ts`)는 코드를, 여기는 실제 요청을 잰다 — 셸이 숨긴 블록이 그래도 부르면 여기서 빨개진다.
 */
const BROWSER_PROXY_OF: Readonly<Record<TenantOneOnlyUpstream, string>> = {
  medusa: 'medusa',
  wallet: 'wallet',
  membership: 'membership',
  notification: 'notification',
  'channel-adapter': 'channel',
  ugc: 'ugc',
  analytics: 'analytics',
  search: 'search',
};
const TENANT_ONE_ONLY_PATH = new RegExp(
  `^(/api)?/proxy/(${TENANT_ONE_ONLY_UPSTREAMS.map((u) => BROWSER_PROXY_OF[u]).join('|')})(/|$)|^/api/fulfillment/channel-dispatch(/|$)`,
);

export function tenantOneUpstreamCalls(urls: readonly string[]): string[] {
  return urls.filter((raw) => {
    try {
      return TENANT_ONE_ONLY_PATH.test(new URL(raw).pathname);
    } catch {
      return false;
    }
  });
}

/**
 * 인증서 SAN(`tls` 의 `subjectaltname`, «DNS:a, DNS:b») 중 테넌트 도메인이 아닌 이름. 와일드카드는 테넌트 도메인 하나를
 * 바로 덮을 때만 테넌트의 이름으로 본다 — 한 인증서에 다른 회사 주소가 같이 실리면 브라우저 인증서 정보에 그대로 보인다.
 */
export function foreignSanNames(subjectAltName: string, tenantHosts: readonly string[]): string[] {
  const entries = subjectAltName
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (entries.length === 0) return ['(SAN 없음)'];
  const covers = (wildcard: string, host: string) => {
    const base = wildcard.slice(2);
    return host.endsWith(`.${base}`) && !host.slice(0, -base.length - 1).includes('.');
  };
  const hosts = tenantHosts.map((h) => h.toLowerCase());
  return entries.flatMap((entry) => {
    if (!entry.startsWith('DNS:')) return [entry];
    const name = entry.slice(4).toLowerCase();
    if (hosts.includes(name)) return [];
    if (name.startsWith('*.') && hosts.some((h) => covers(name, h))) return [];
    return [name];
  });
}

/** 브라우저로 한 화면을 연 결과. */
export interface ScreenVisit {
  /** 연 경로 */
  readonly path: string;
  /** 리디렉트 끝 문서 응답의 상태(없으면 null) */
  readonly status: number | null;
  readonly finalUrl: string;
  readonly title: string;
  /** 보이는 글자(`innerText`) */
  readonly text: string;
}

/**
 * 200 으로 그려지지만 «열린» 게 아닌 화면의 문구. 출처가 바뀌면 `screen-refusal-texts.spec.ts` 가 빨갛다.
 * 권한 거절(ForbiddenPanel)·권한 조회 실패·Next 의 not-found·주소 교차 거절·Next 클라이언트 오류.
 */
export const SCREEN_REFUSAL_TEXTS = [
  '접근 권한이 없습니다',
  '권한 정보를 불러오지 못했습니다',
  '페이지를 찾을 수 없습니다',
  '이 주소에서 쓸 수 없는 계정입니다',
  'Application error',
] as const;

/** 화면이 열렸으면 null, 아니면 무엇이 달랐는지. 쿼리는 화면이 스스로 붙이기도 하므로 경로만 본다. */
export function openProblem(v: ScreenVisit): string | null {
  if (v.status === null) return '문서 응답 없음';
  if (v.status !== 200) return String(v.status);
  if (new URL(v.finalUrl).pathname !== v.path) return `→ ${v.finalUrl}`;
  const refusal = SCREEN_REFUSAL_TEXTS.find((t) => v.text.includes(t));
  return refusal ? `«${refusal}»` : null;
}

/** 목록 밖 경로가 404 면 null. 미들웨어가 rewrite 하므로 주소는 그대로이고 상태만 404 다. */
export function notFoundProblem(v: ScreenVisit): string | null {
  if (v.status === 404) return null;
  const moved = new URL(v.finalUrl).pathname !== v.path ? ` → ${v.finalUrl}` : '';
  return `${v.status ?? '문서 응답 없음'}${moved}`;
}

/** 테넌트 셸이 목록과 상관없이 여는 경로 — `/`(첫 화면으로 보낸다)와 미들웨어의 테넌트 공개 경로 중 화면인 것. */
const TENANT_SHELL_OPEN = new Set(['/', '/wrong-account']);
const segments = (path: string) => path.split('/').filter(Boolean);
const isDynamic = (seg: string) => seg.startsWith('[') && seg.endsWith(']');

/**
 * 목록 밖 대표 경로. 허용 화면이 있는 영역(첫 세그먼트)은 목록 밖 화면 전부 — 이웃 화면이 가장 새기 쉽다. 다른 영역은 첫 화면
 * 하나. 판정은 미들웨어가 경로로만 하므로 동적 세그먼트는 아무 값(`0`)으로 채운다.
 * `screens` 는 `screen-access.ts` 의 화면 전부 — 새 영역이 생기면 저절로 대표가 늘어난다.
 */
export function outsidePaths(screens: readonly string[], allowlist: readonly string[]): string[] {
  const allowedAreas = new Set(allowlist.map((s) => segments(s)[0]));
  const seenAreas = new Set<string>();
  const out: string[] = [];
  for (const screen of screens) {
    if (TENANT_SHELL_OPEN.has(screen) || allowlist.includes(screen)) continue;
    const area = segments(screen)[0];
    if (!allowedAreas.has(area)) {
      if (seenAreas.has(area)) continue;
      seenAreas.add(area);
    }
    out.push(
      `/${segments(screen)
        .map((s) => (isDynamic(s) ? '0' : s))
        .join('/')}`,
    );
  }
  return out;
}

/** 허용 목록의 화면 경로를 실제 행으로 채운다(`[masterId]` → ids.masterId). 값이 없으면 null — 그 화면은 잴 행이 없다. */
export function concretePath(screen: string, ids: Readonly<Record<string, string>>): string | null {
  const out: string[] = [];
  for (const seg of segments(screen)) {
    if (!isDynamic(seg)) {
      out.push(seg);
      continue;
    }
    const value = ids[seg.slice(1, -1)];
    if (!value) return null;
    out.push(encodeURIComponent(value));
  }
  return `/${out.join('/')}`;
}

/** 주소 교차에서 «거절»로 알아보는 화면 문구 — 셸의 계정 거절(`/wrong-account`)과 권한 거절(ForbiddenPanel). */
const CROSS_REFUSAL_TEXTS = ['이 주소에서 쓸 수 없는 계정입니다', '접근 권한이 없습니다'] as const;

/**
 * 남의 주소로 로그인한 뒤 화면을 연 결과가 거절이면 null. 안 열린 것만으로는 부족하다 — 500·깨진 로그인도 «안 열림»이라 문이
 * 빠져도 초록이 된다. 그래서 알아본 거절(셸의 거절 화면, 로그인 화면의 오류 문구)만 통과다.
 */
export function crossRefusal(v: ScreenVisit, loginError: string | null): string | null {
  if (loginError) return null;
  if (CROSS_REFUSAL_TEXTS.some((t) => v.text.includes(t))) return null;
  const problem = openProblem(v);
  return problem === null ? `열렸다 — ${v.finalUrl}` : `거절이 아니다 — ${problem}`;
}

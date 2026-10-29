/**
 * 백엔드가 개인정보를 가렸다고 알린 응답(`X-Pii-*` 헤더) 해석과 [보기] 상태. 화면 위 안내는 응답이 아니라
 * 권한·화면·가림 모드로 정한다(`pii-screens.ts`) — 캐시로 다시 그린 화면엔 응답이 없기 때문이다.
 */

import type { RevealPhase } from './pii-screens';

export type PiiMaskReason = 'no-permission' | 'reveal-required' | 'unavailable' | 'record-failed';

export interface PiiMeta {
  readonly maskedKinds: readonly string[];
  readonly reason: PiiMaskReason | null;
  readonly redactedPaths: readonly string[];
  /** 기본 가림 모드에서 권한자에게만 온다 — [보기] 로 같은 요청을 다시 보내면 원문이 온다. */
  readonly revealable: boolean;
}

const REASONS: readonly PiiMaskReason[] = ['no-permission', 'reveal-required', 'unavailable', 'record-failed'];

const list = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

export function parsePiiHeaders(get: (name: string) => string | undefined | null): PiiMeta | null {
  const masked = get('x-pii-masked');
  if (!masked || masked === 'none') return null;
  const reason = REASONS.find((candidate) => candidate === get('x-pii-mask-reason')) ?? null;
  return {
    maskedKinds: list(masked),
    reason,
    redactedPaths: list(get('x-pii-redacted') ?? undefined),
    revealable: get('x-pii-revealable') === '1',
  };
}

let revealPath: string | null = null;
let revealPhase: Exclude<RevealPhase, 'idle'> = 'pending';
const revealListeners = new Set<() => void>();

function emitReveal(): void {
  for (const listener of revealListeners) listener();
}

/** [보기] — 이 화면(실제 pathname)에 머무는 동안 모든 요청에 `X-Pii-Reveal` 을 붙인다. 원문 재조회가 끝나기 전은 `pending`. */
export function startReveal(pathname: string): void {
  revealPath = pathname;
  revealPhase = 'pending';
  emitReveal();
}

/** 원문 재조회가 성공했을 때. 그 사이 화면을 떠났거나 다른 화면에서 다시 눌렀으면 바꾸지 않는다. */
export function markRevealShown(pathname: string): void {
  if (revealPath !== pathname || revealPhase !== 'pending') return;
  revealPhase = 'shown';
  emitReveal();
}

/** 켜져 있었으면 true. */
export function endReveal(): boolean {
  if (revealPath === null) return false;
  revealPath = null;
  emitReveal();
  return true;
}

export function isRevealing(pathname: string): boolean {
  return revealPath !== null && revealPath === pathname;
}

export function revealPhaseOf(pathname: string): RevealPhase {
  return isRevealing(pathname) ? revealPhase : 'idle';
}

/** 요청마다 부른다. 재시도 요청이 들고 온 옛 헤더도 꺼진 상태면 지운다. */
export function applyRevealHeader(
  headers: { set(name: string, value: string): unknown; delete(name: string): unknown },
  pathname: string,
): void {
  if (isRevealing(pathname)) headers.set('x-pii-reveal', '1');
  else headers.delete('x-pii-reveal');
}

export function subscribeReveal(listener: () => void): () => void {
  revealListeners.add(listener);
  return () => revealListeners.delete(listener);
}

const REASON_TEXT: Readonly<Record<PiiMaskReason, string>> = {
  'no-permission': '개인정보 보기 권한이 없습니다.',
  'reveal-required': '[보기]를 누르면 원문이 열리고 열람 기록이 남습니다.',
  unavailable: '권한을 확인하지 못했습니다(잠시 뒤 다시 시도).',
  'record-failed': '열람 기록을 남기지 못해 가렸습니다(잠시 뒤 다시 시도).',
};

/** 일시 장애로 가려진 GET 응답은 데이터가 아니라 오류로 다룬다 — 쓰기는 이미 처리된 뒤라 오류로 바꾸면 중복 처리된다. */
export function transientPiiError(meta: PiiMeta | null, method: string | undefined): string | null {
  if (meta?.reason !== 'unavailable' && meta?.reason !== 'record-failed') return null;
  if ((method ?? 'get').toLowerCase() !== 'get') return null;
  return REASON_TEXT[meta.reason];
}

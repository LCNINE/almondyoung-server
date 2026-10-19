/**
 * 백엔드가 개인정보를 가렸다고 알린 응답(`X-Pii-*` 헤더)을 화면 위 안내로 모은다. 가린 값이 «없음»이나
 * 진짜 값처럼 보이지 않게, 화면마다 필드를 손대지 않고 셸 한 곳에서 이유를 보인다.
 */

export type PiiMaskReason = 'no-permission' | 'reveal-required' | 'unavailable' | 'record-failed';

export interface PiiMeta {
  readonly maskedKinds: readonly string[];
  readonly reason: PiiMaskReason | null;
  readonly redactedPaths: readonly string[];
  /** 기본 가림 모드에서 권한자에게만 온다 — [보기] 로 같은 요청을 다시 보내면 원문이 온다. */
  readonly revealable: boolean;
}

export interface PiiNotice extends PiiMeta {
  readonly url: string;
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

const notices = new Map<string, PiiNotice>();
const listeners = new Set<() => void>();
let snapshot: readonly PiiNotice[] = [];
const revealQueue = new Set<string>();

function publish(): void {
  snapshot = [...notices.values()];
  for (const listener of listeners) listener();
}

/** 응답마다 부른다. 가리지 않은 응답(null)이 오면 그 주소의 안내를 지운다. */
export function reportPiiResponse(url: string, meta: PiiMeta | null): void {
  if (meta === null) {
    if (notices.delete(url)) publish();
    return;
  }
  notices.set(url, { url, ...meta });
  publish();
}

export function clearPiiNotices(): void {
  notices.clear();
  revealQueue.clear();
  publish();
}

export function piiNotices(): readonly PiiNotice[] {
  return snapshot;
}

export function subscribePiiNotices(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** [보기] — 다음 요청 한 번에만 `X-Pii-Reveal` 을 붙인다. */
export function markReveal(urls: readonly string[]): void {
  for (const url of urls) revealQueue.add(url);
}

export function consumeReveal(url: string): boolean {
  return revealQueue.delete(url);
}

const REASON_TEXT: Readonly<Record<PiiMaskReason, string>> = {
  'no-permission': '개인정보 보기 권한이 없습니다.',
  'reveal-required': '[보기]를 누르면 원문이 열리고 열람 기록이 남습니다.',
  unavailable: '권한을 확인하지 못했습니다(잠시 뒤 다시 시도).',
  'record-failed': '열람 기록을 남기지 못해 가렸습니다(잠시 뒤 다시 시도).',
};

const PRIORITY: readonly PiiMaskReason[] = ['unavailable', 'record-failed', 'reveal-required', 'no-permission'];

export function piiBannerText(current: readonly PiiNotice[]): string | null {
  if (current.length === 0) return null;
  const reason = PRIORITY.find((candidate) => current.some((notice) => notice.reason === candidate)) ?? 'no-permission';
  return `이 화면의 개인정보 일부가 가려져 있습니다 — ${REASON_TEXT[reason]}`;
}

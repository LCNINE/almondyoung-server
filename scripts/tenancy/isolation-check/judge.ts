/** 실측 한 번의 HTTP 응답. 본문은 JSON 이면 파싱한 값, 아니면 글자 그대로. */
export interface Probe {
  readonly status: number;
  readonly body: unknown;
}

export type Verdict = { readonly ok: true } | { readonly ok: false; readonly detail: string };
/** 잴 수 없었다(로컬에 그 앱이 없다 등). 로컬은 경고, 라이브(strict)는 실패다. */
export type Skipped = { readonly ok: 'skipped'; readonly reason: string };

export const pass: Verdict = { ok: true };
export const fail = (detail: string): Verdict => ({ ok: false, detail });
export const skip = (reason: string): Skipped => ({ ok: 'skipped', reason });

/** Nest(`message`)·Next 라우트(`error`) 오류 봉투의 문구. */
export function messageOf(body: unknown): string {
  if (typeof body === 'string') return body.slice(0, 120);
  if (typeof body !== 'object' || body === null) return '';
  const record = body as Record<string, unknown>;
  for (const key of ['message', 'error']) {
    const v = record[key];
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) return v.join(', ');
  }
  return '';
}

/**
 * 403 이 «테넌트 문»의 거절인가. 상태만 보면 안 된다 — 테넌트 2 역할에 없는 권한의 라우트는 문이 꺼져 있어도
 * 권한 거절로 403 이라, 문 하나를 빼도 초록으로 남는다. 그래서 문의 문구까지 본다.
 */
export function refusedByTenantGate(probe: Probe, gateMessage: string): Verdict {
  const message = messageOf(probe.body);
  if (probe.status === 403 && message === gateMessage) return pass;
  if (probe.status >= 200 && probe.status < 300) return fail(`${probe.status} — 남의 테넌트 응답이 나왔다`);
  return fail(`${probe.status} «${message}» — 테넌트 문의 거절(«${gateMessage}»)이 아니다`);
}

/**
 * 테넌트 2 목록에 테넌트 1 행이 없는가. 테넌트 1 목록이 비면 «겹침 없음»이 아무것도 증명하지 않으므로 실패로 본다
 * (둘 다 빈 DB 를 봐도 초록이 된다).
 */
export function onlyOwnRows(ids: { tenantOne: readonly string[]; tenantTwo: readonly string[] }): Verdict {
  if (ids.tenantOne.length === 0) return fail('테넌트 1 목록이 비어 있다 — 겹침을 잴 수 없다');
  const one = new Set(ids.tenantOne);
  const shared = ids.tenantTwo.filter((id) => one.has(id));
  if (shared.length > 0)
    return fail(`테넌트 1 행 ${shared.length}개가 테넌트 2 목록에 있다 (${shared.slice(0, 3).join(', ')})`);
  return pass;
}

/** 액세스 토큰의 `tenant` 클레임. 서명은 보지 않는다 — 판정은 서버들의 몫이고, 여기선 «어느 테넌트로 받았나»만 본다. */
export function tokenTenantOf(token: string): string | undefined {
  const payload = token.split('.')[1];
  if (!payload) return undefined;
  try {
    const claims: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof claims !== 'object' || claims === null || !('tenant' in claims)) return undefined;
    return typeof claims.tenant === 'string' && claims.tenant !== '' ? claims.tenant : undefined;
  } catch {
    return undefined;
  }
}

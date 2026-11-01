import type { Probe } from './judge';

export interface ProbeOptions {
  /** `Authorization: Bearer` — 서비스를 직접 부를 때 */
  readonly bearer?: string;
  /** `Cookie: accessToken=` — admin-web 라우트(브라우저가 부르는 길)를 부를 때 */
  readonly cookieToken?: string;
  readonly json?: unknown;
  readonly form?: FormData;
  readonly headers?: Record<string, string>;
}

const TIMEOUT_MS = 30_000;

/** 한 번 부르고 상태·본문을 돌려준다. 응답 상태로 던지지 않는다 — 판정은 judge 의 몫이다. */
export async function probe(method: string, url: string, opts: ProbeOptions = {}): Promise<Probe> {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  if (opts.cookieToken) headers.cookie = `accessToken=${opts.cookieToken}`;
  if (opts.json !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(url, {
    method,
    headers,
    body: opts.form ?? (opts.json === undefined ? undefined : JSON.stringify(opts.json)),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // 본문이 JSON 이 아니면 글자 그대로
  }
  return { status: res.status, body };
}

/** 2xx 가 아니면 던진다 — 준비 단계(만들기·목록 읽기)용. 판정 대상 호출에는 쓰지 않는다. */
export async function expectOk(method: string, url: string, opts: ProbeOptions = {}): Promise<unknown> {
  const r = await probe(method, url, opts);
  if (r.status < 200 || r.status >= 300) {
    throw new Error(`${method} ${new URL(url).pathname} → ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  }
  return r.body;
}

/** `fn` 이 참을 낼 때까지 기다린다. 끝까지 거짓이면 마지막 값을 돌려준다. */
export async function waitFor<T>(
  fn: () => Promise<T>,
  done: (v: T) => boolean,
  timeoutMs: number,
  everyMs = 2_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last = await fn();
  while (!done(last) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, everyMs));
    last = await fn();
  }
  return last;
}

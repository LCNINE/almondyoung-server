import { randomUUID } from 'node:crypto';
import { type ClientRequest } from 'node:http';
import { request } from 'node:https';
import { type WowpressRequest, type WowpressResponse, type WowpressTransport } from './wowpress.types';

function encodeBody(req: WowpressRequest): { headers: Record<string, string>; payload: Buffer | null } {
  if (req.form) {
    const boundary = `----wowpress${randomUUID()}`;
    const parts = Object.entries(req.form).map(
      ([name, value]) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
    );
    return {
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.from(`${parts.join('')}--${boundary}--\r\n`, 'utf8'),
    };
  }
  if (req.json !== undefined) {
    return { headers: { 'content-type': 'application/json' }, payload: Buffer.from(JSON.stringify(req.json), 'utf8') };
  }
  return { headers: {}, payload: null };
}

function parseBody(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export const WOWPRESS_DEADLINE_MS = 30_000;
export const WOWPRESS_MAX_BODY_BYTES = 1024 * 1024;

interface TransportOptions {
  requestImpl?: typeof request;
  deadlineMs?: number;
  maxBodyBytes?: number;
}

// global fetch 는 GET 본문을 거부하는데 토큰 발급(GET /api/login/issue)이 본문을 요구해 node:https 로 보낸다
export function createHttpsWowpressTransport(options: TransportOptions = {}): WowpressTransport {
  const requestImpl = options.requestImpl ?? request;
  const deadlineMs = options.deadlineMs ?? WOWPRESS_DEADLINE_MS;
  const maxBodyBytes = options.maxBodyBytes ?? WOWPRESS_MAX_BODY_BYTES;

  return (req) => {
    const { headers, payload } = encodeBody(req);
    if (payload) headers['content-length'] = String(payload.length);
    if (req.token) headers.authorization = `Bearer ${req.token}`;
    return new Promise<WowpressResponse>((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };
      const abort = (err: Error) => {
        finish(() => reject(err));
        r.destroy();
      };
      let r: ClientRequest;
      try {
        r = requestImpl(req.url, { method: req.method, headers }, (res) => {
          const chunks: Buffer[] = [];
          let total = 0;
          res.on('data', (c: Buffer) => {
            total += c.length;
            if (total > maxBodyBytes) {
              abort(new Error(`wowpress response exceeds ${maxBodyBytes} bytes: ${req.method} ${req.url}`));
              return;
            }
            chunks.push(c);
          });
          res.on('end', () =>
            finish(() =>
              resolve({ status: res.statusCode ?? 0, body: parseBody(Buffer.concat(chunks).toString('utf8')) }),
            ),
          );
          res.on('error', (err) => finish(() => reject(err)));
        });
      } catch (err) {
        // 마감 타이머는 요청이 만들어진 뒤에만 건다 — 여기서 나가면 정리할 것이 없다
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      // 소켓 idle 타임아웃은 바이트를 찔끔 보내는 서버에 안 걸려 전체 마감을 따로 둔다
      const timer = setTimeout(
        () => abort(new Error(`wowpress request exceeded ${deadlineMs}ms deadline: ${req.method} ${req.url}`)),
        deadlineMs,
      );
      r.on('error', (err) => finish(() => reject(err)));
      if (payload) r.write(payload);
      r.end();
    });
  };
}

export const httpsWowpressTransport: WowpressTransport = createHttpsWowpressTransport();

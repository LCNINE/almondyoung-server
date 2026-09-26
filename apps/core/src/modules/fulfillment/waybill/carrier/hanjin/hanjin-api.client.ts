import { CarrierError, RetryAfter } from '../carrier-gateway.interface';
import type { HanjinConfig } from './hanjin.config';
import type { HanjinHmacSigner } from './hanjin-hmac.signer';

type HanjinHost = 'order' | 'print';

// 호출량 제한 초과 (정본 §5 — 배송정보 API 10 TPS SpikeArrest). 트래픽 저지 정책이 백엔드 앞에서 튕긴
// 것이라 요청은 처리되지 않았다 → 재시도해도 안전한 «일시적 거절»이다. 응답의 HTTP 상태는 미상이다
// (DEV 는 초당 ~100건에도 재현되지 않았다, #916) — 그래서 상태코드가 아니라 바디의 errorCode 로만 판별한다.
// 문서는 배송정보만 명시하지만 다른 API 가 같은 코드를 내도 같은 뜻이므로 호스트·경로를 가리지 않는다.
const RATE_LIMITED_ERROR_CODE = '-103';
const RATE_LIMITED_RETRY_AFTER: RetryAfter = { kind: 'after_ms', ms: 1000 }; // 슬라이딩 창이 1초다

function isRateLimited(body: unknown): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    'errorCode' in body &&
    String(body.errorCode) === RATE_LIMITED_ERROR_CODE
  );
}

function parseJsonOrNull(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function rateLimitedError(httpStatus: number): CarrierError {
  return new CarrierError(
    `Hanjin rejected the request: ${RATE_LIMITED_ERROR_CODE} Too many request`,
    'transient_rejection',
    {
      carrier: 'hanjin',
      code: RATE_LIMITED_ERROR_CODE,
      httpStatus,
      retryAfter: RATE_LIMITED_RETRY_AFTER,
    },
  );
}

export class HanjinApiClient {
  constructor(
    private readonly config: HanjinConfig,
    private readonly signer: HanjinHmacSigner,
  ) {}

  async post<T = unknown>(host: HanjinHost, path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', host, path, undefined, body);
  }

  async get<T = unknown>(host: HanjinHost, path: string, query: Record<string, string> = {}): Promise<T> {
    return this.request<T>('GET', host, path, query, undefined);
  }

  private baseUrl(host: HanjinHost): string {
    return host === 'print' ? this.config.printBaseUrl : this.config.orderBaseUrl;
  }

  private async request<T>(
    method: 'GET' | 'POST',
    host: HanjinHost,
    path: string,
    query: Record<string, string> | undefined,
    body: unknown,
  ): Promise<T> {
    const qs = query && Object.keys(query).length ? '?' + new URLSearchParams(query).toString() : '';
    const url = `${this.baseUrl(host)}${path}${qs}`;
    const headers = this.signer.sign(method, url); // 서명은 쿼리 포함 URL로

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      throw new CarrierError('Hanjin request did not produce a definitive response', 'unknown_outcome', {
        carrier: 'hanjin',
        code: error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'transport_error',
        cause: error,
      });
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      if (isRateLimited(parseJsonOrNull(text))) throw rateLimitedError(response.status);
      const details = { carrier: 'hanjin', code: `http_${response.status}`, httpStatus: response.status };
      if (response.status === 408 || response.status === 429 || response.status >= 500) {
        throw new CarrierError(
          `Hanjin request outcome is unknown: ${response.status} - ${text}`,
          'unknown_outcome',
          details,
        );
      }
      throw new CarrierError(
        `Hanjin request was rejected: ${response.status} - ${text}`,
        'definitive_rejection',
        details,
      );
    }

    let parsed: T;
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- fetch's json() is untyped `any`; assignable to `T` with no cast
      parsed = await response.json();
    } catch (error) {
      throw new CarrierError('Hanjin returned an invalid JSON response', 'unknown_outcome', {
        carrier: 'hanjin',
        code: 'invalid_response',
        httpStatus: response.status,
        cause: error,
      });
    }
    if (isRateLimited(parsed)) throw rateLimitedError(response.status);
    return parsed;
  }
}

import { CarrierError } from '../carrier-gateway.interface';
import type { HanjinConfig } from './hanjin.config';
import type { HanjinHmacSigner } from './hanjin-hmac.signer';

type HanjinHost = 'order' | 'print';

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

    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- fetch's json() is untyped `any`; assignable to `T` with no cast
      return await response.json();
    } catch (error) {
      throw new CarrierError('Hanjin returned an invalid JSON response', 'unknown_outcome', {
        carrier: 'hanjin',
        code: 'invalid_response',
        httpStatus: response.status,
        cause: error,
      });
    }
  }
}

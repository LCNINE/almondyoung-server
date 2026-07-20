import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { authHeader } from './authHeader';

export class ConflictError extends Error {}

export interface ApiClient {
  request<T>(opts: {
    method?: string;
    path: string;
    body?: unknown;
    idempotencyKey?: string;
  }): Promise<T>;
}

export function createApiClient(deps: {
  baseUrl: string;
  getToken: () => Promise<string>;
  authMode: 'bearer' | 'cookie';
  doFetch?: typeof tauriFetch;
}): ApiClient {
  const doFetch = deps.doFetch ?? tauriFetch;

  async function once(opts: {
    method: string;
    path: string;
    body?: unknown;
    idempotencyKey?: string;
  }): Promise<Response> {
    const token = await deps.getToken();
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...authHeader(token, deps.authMode),
    };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;
    return doFetch(`${deps.baseUrl}${opts.path}`, {
      method: opts.method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  }

  return {
    async request<T>(o: {
      method?: string;
      path: string;
      body?: unknown;
      idempotencyKey?: string;
    }): Promise<T> {
      const method = o.method ?? 'GET';
      let res = await once({ ...o, method });
      // Optimistic-lock: one retry on 409 (idempotency-key makes it safe).
      if (res.status === 409) res = await once({ ...o, method });
      if (res.status === 409) {
        const j = await res.json().catch(() => ({}));
        throw new ConflictError(
          (j as { message?: string }).message ?? 'version conflict'
        );
      }
      if (!res.ok) throw new Error(`${method} ${o.path} → ${res.status}`);
      if (res.status === 204) return undefined as T;
      return (await res.json()) as T;
    },
  };
}

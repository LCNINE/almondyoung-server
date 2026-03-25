import { PimClientPort } from './pim.port';

export class PimHttpClient implements PimClientPort {
  constructor(
    private readonly baseURL: string,
    private readonly apiKey?: string,
    private readonly timeoutMs: number = 10000,
  ) {}

  private async withRetry<T>(fn: () => Promise<T>, retries = 2, baseDelayMs = 300): Promise<T> {
    let attempt = 0;
    let lastErr: any;
    while (attempt <= retries) {
      try {
        return await fn();
      } catch (err: any) {
        lastErr = err;
        const status = err?.status;
        const retryable = !status || (status >= 500 && status < 600);
        if (!retryable || attempt === retries) break;
        const delay = baseDelayMs * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
        attempt++;
      }
    }
    throw lastErr;
  }

  private async request<T>(path: string, init?: RequestInit & { query?: Record<string, string> }): Promise<T> {
    const url = new URL(path, this.baseURL);
    if (init?.query) {
      for (const [k, v] of Object.entries(init.query)) url.searchParams.set(k, v);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;
      if (init?.headers) Object.assign(headers, init.headers as any);
      const res = await fetch(url, { ...init, headers, signal: controller.signal });
      if (!res.ok) {
        const err: any = new Error(`HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
      if (res.status === 204) return undefined as unknown as T;
      return (await res.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  async createMaster(input: any, idempotencyKey?: string): Promise<{ masterId: string }> {
    const data = await this.withRetry(() =>
      this.request<{ id?: string; masterId?: string }>('/masters', {
        method: 'POST',
        body: JSON.stringify(input),
        headers: idempotencyKey ? ({ 'Idempotency-Key': idempotencyKey } as any) : undefined,
      }),
    );
    return { masterId: data.id || (data.masterId as string) };
  }

  async getMasterDetail(masterId: string): Promise<any> {
    return this.withRetry(() => this.request<any>(`/masters/${masterId}`));
  }

  async generateVariants(masterId: string): Promise<void> {
    await this.withRetry(() => this.request<void>(`/variants/masters/${masterId}`, { method: 'POST' }));
  }

  async deleteMaster(masterId: string): Promise<void> {
    await this.withRetry(() => this.request<void>(`/masters/${masterId}`, { method: 'DELETE' }));
  }
}

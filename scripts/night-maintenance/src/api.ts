export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly ambiguous = false,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ApiOptions {
  loginUrl: string;
  loginId: string;
  password: string;
  allowedOrigins: string[];
  checkWrite: (url: string, method: string) => void | Promise<void>;
  fetcher?: typeof fetch;
  dryRun?: boolean;
  maxLatencyMs?: number;
}

export class AdminApi {
  private token?: string;
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: ApiOptions) {
    this.fetcher = options.fetcher ?? fetch;
  }

  async login(): Promise<void> {
    const response = await this.fetcher(this.options.loginUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ loginId: this.options.loginId, password: this.options.password, rememberMe: false }),
      signal: AbortSignal.timeout(20000),
    });
    let body: { accessToken?: string; data?: { accessToken?: string } };
    try {
      body = (await response.json()) as typeof body;
    } catch {
      throw new ApiError('Invalid login response', response.status);
    }
    const token = body.data?.accessToken ?? body.accessToken;

    if (!response.ok || !token) throw new ApiError('Administrator login failed', response.status);
    this.token = token;
  }

  principal(): { roles: string[]; scopes: string[] } {
    if (!this.token) throw new Error('Administrator is not authenticated');
    try {
      const claims = JSON.parse(Buffer.from(this.token.split('.')[1], 'base64url').toString());
      const roles = Array.isArray(claims.roles) ? claims.roles : [];
      const scopes = Array.isArray(claims.scopes) ? claims.scopes : String(claims.scope ?? '').split(' ');
      return { roles, scopes };
    } catch {
      throw new Error('Administrator token claims unavailable');
    }
  }

  async request<T = unknown>(url: string, method = 'GET', body?: unknown): Promise<{ status: number; data: T }> {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !this.options.allowedOrigins.includes(parsed.origin)) {
      throw new Error('Unapproved API origin');
    }

    const writes = !['GET', 'HEAD'].includes(method);
    if (writes && this.options.dryRun) throw new Error('Mutations disabled in dry run');
    if (!this.token) await this.login();

    for (let attempt = 0; attempt < 2; attempt++) {
      if (writes) await this.options.checkWrite(url, method);
      const started = Date.now();
      let response: Response;

      try {
        response = await this.fetcher(url, {
          method,
          headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
          body: writes && method !== 'DELETE' ? JSON.stringify(body ?? {}) : undefined,
          signal: AbortSignal.timeout(60000),
        });
      } catch {
        throw new ApiError(`API network failure: ${method} ${parsed.pathname}`, undefined, writes);
      }

      const text = await response.text();
      if (response.status === 401 && attempt === 0) {
        await this.login();
        continue;
      }

      if (!response.ok) {
        throw new ApiError(
          `API rejected request: ${method} ${parsed.pathname}`,
          response.status,
          writes && response.status >= 500,
        );
      }
      if (Date.now() - started > (this.options.maxLatencyMs ?? 10000)) {
        throw new ApiError(`API exceeded latency limit: ${method} ${parsed.pathname}`, response.status, writes);
      }

      let data: T;
      try {
        data = text ? (JSON.parse(text) as T) : (undefined as T);
      } catch {
        throw new ApiError('Invalid API JSON response', response.status, writes);
      }
      return { status: response.status, data };
    }

    throw new ApiError('Authentication retry exhausted', 401);
  }
}

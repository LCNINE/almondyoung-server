'use client';

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type BrowserLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface BrowserLoggerContext {
  serviceName?: string;
  component?: string;
  route?: string;
  endpoint?: string;
  attributes?: Record<string, unknown>;
}

export interface BrowserLogOptions {
  message?: string;
  error?: unknown;
  attributes?: Record<string, unknown>;
}

export interface BrowserLogger {
  debug(event: string, options?: BrowserLogOptions): void;
  info(event: string, options?: BrowserLogOptions): void;
  warn(event: string, options?: BrowserLogOptions): void;
  error(event: string, options?: BrowserLogOptions): void;
  child(context: BrowserLoggerContext): BrowserLogger;
}

export interface BrowserObservabilityOptions extends BrowserLoggerContext {
  captureErrors?: boolean;
  propagateFetchTrace?: boolean;
}

const REDACTED = '[REDACTED]';
const PAGE_TRACE_ID_KEY = 'ay.page_trace_id';
const FETCH_PATCHED_KEY = '__ay_observability_fetch_patched__';
const ERRORS_PATCHED_KEY = '__ay_observability_errors_patched__';
const REDACT_KEY_PATTERN =
  /(^|[-_.])?(authorization|cookie|set-cookie|token|secret|password|passwd|paymentkey|payment_key|apikey|api_key|clientsecret|client_secret|refreshtoken|refresh_token|accesstoken|access_token|idtoken|id_token)($|[-_.])?/i;

function browserServiceName(): string {
  return process.env.NEXT_PUBLIC_OTEL_SERVICE_NAME ?? process.env.NEXT_PUBLIC_SERVICE_NAME ?? 'web';
}

function deploymentEnvironment(): string {
  return process.env.NEXT_PUBLIC_SST_STAGE ?? process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV ?? 'production';
}

function shouldRedactKey(key: string): boolean {
  return REDACT_KEY_PATTERN.test(key);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeJsonValue(value: unknown, depth = 0): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value as JsonPrimitive;
  }
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return serializeError(value);
  if (Array.isArray(value)) {
    if (depth >= 4) return '[MaxDepth]';
    return value.slice(0, 50).map((item) => safeJsonValue(item, depth + 1));
  }
  if (isPlainObject(value)) {
    if (depth >= 4) return '[MaxDepth]';
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 100)
        .map(([key, nested]) => [key, shouldRedactKey(key) ? REDACTED : safeJsonValue(nested, depth + 1)]),
    );
  }
  return String(value);
}

function sanitizeAttributes(attributes: Record<string, unknown> = {}): Record<string, JsonValue> {
  return Object.fromEntries(
    Object.entries(attributes).map(([key, value]) => [key, shouldRedactKey(key) ? REDACTED : safeJsonValue(value)]),
  );
}

function serializeError(error: unknown): Record<string, JsonValue> {
  if (!error) return {};
  if (error instanceof Error) {
    return {
      'error.type': error.name,
      'error.message': error.message,
      'error.stack': error.stack ?? null,
    };
  }
  return { 'error.message': safeJsonValue(error) };
}

function randomHex(bytes: number): string {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function newTraceId(): string {
  let traceId = randomHex(16);
  while (/^0+$/.test(traceId)) traceId = randomHex(16);
  return traceId;
}

function newSpanId(): string {
  let spanId = randomHex(8);
  while (/^0+$/.test(spanId)) spanId = randomHex(8);
  return spanId;
}

function getPageTraceId(): string {
  try {
    const existing = window.sessionStorage.getItem(PAGE_TRACE_ID_KEY);
    if (existing && /^[0-9a-f]{32}$/.test(existing)) return existing;
    const next = newTraceId();
    window.sessionStorage.setItem(PAGE_TRACE_ID_KEY, next);
    return next;
  } catch {
    return newTraceId();
  }
}

function createTraceparent(): { traceparent: string; traceId: string; spanId: string } {
  const traceId = getPageTraceId();
  const spanId = newSpanId();
  return {
    traceparent: `00-${traceId}-${spanId}-01`,
    traceId,
    spanId,
  };
}

function shouldPropagateTo(input: RequestInfo | URL): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const url = input instanceof Request ? new URL(input.url) : new URL(String(input), window.location.origin);
    if (url.pathname.startsWith('/_next/') || url.pathname === '/favicon.ico') return false;
    return url.origin === window.location.origin;
  } catch {
    return false;
  }
}

function isPrefetchRequest(headers: Headers): boolean {
  const purpose = headers.get('purpose') ?? headers.get('sec-purpose') ?? '';
  return purpose.toLowerCase().includes('prefetch') || headers.has('next-router-prefetch');
}

function sendPayload(endpoint: string, payload: Record<string, JsonValue>, traceparent: string): void {
  const body = JSON.stringify(payload);
  void fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      traceparent,
    },
    credentials: 'same-origin',
    keepalive: true,
    body,
  }).catch(() => {
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }));
    }
  });
}

class DefaultBrowserLogger implements BrowserLogger {
  constructor(
    private readonly loggerContext: Required<Omit<BrowserLoggerContext, 'attributes'>> & {
      attributes: Record<string, unknown>;
    },
  ) {}

  child(childContext: BrowserLoggerContext): BrowserLogger {
    return createBrowserLogger({
      serviceName: childContext.serviceName ?? this.loggerContext.serviceName,
      component: childContext.component ?? this.loggerContext.component,
      route: childContext.route ?? this.loggerContext.route,
      endpoint: childContext.endpoint ?? this.loggerContext.endpoint,
      attributes: {
        ...this.loggerContext.attributes,
        ...(childContext.attributes ?? {}),
      },
    });
  }

  debug(event: string, options: BrowserLogOptions = {}): void {
    this.emit('debug', event, options);
  }

  info(event: string, options: BrowserLogOptions = {}): void {
    this.emit('info', event, options);
  }

  warn(event: string, options: BrowserLogOptions = {}): void {
    this.emit('warn', event, options);
  }

  error(event: string, options: BrowserLogOptions = {}): void {
    this.emit('error', event, options);
  }

  private emit(level: BrowserLogLevel, event: string, options: BrowserLogOptions): void {
    if (typeof window === 'undefined') return;

    const trace = createTraceparent();
    const attributes = sanitizeAttributes({
      ...this.loggerContext.attributes,
      ...(options.attributes ?? {}),
      ...serializeError(options.error),
      event,
      trace_id: trace.traceId,
      span_id: trace.spanId,
      trace_flags: '01',
      'service.name': this.loggerContext.serviceName,
      service_name: this.loggerContext.serviceName,
      'deployment.environment': deploymentEnvironment(),
      deployment_environment: deploymentEnvironment(),
      component: this.loggerContext.component,
      route: this.loggerContext.route || window.location.pathname,
      runtime: 'browser',
      user_agent: navigator.userAgent,
    });

    sendPayload(
      this.loggerContext.endpoint,
      {
        timestamp: new Date().toISOString(),
        severity: level,
        message: options.message ?? event,
        ...attributes,
      },
      trace.traceparent,
    );
  }
}

export function createBrowserLogger(context: BrowserLoggerContext = {}): BrowserLogger {
  return new DefaultBrowserLogger({
    serviceName: context.serviceName ?? browserServiceName(),
    component: context.component ?? 'browser',
    route: context.route ?? '',
    endpoint: context.endpoint ?? '/api/observability/log',
    attributes: context.attributes ?? {},
  });
}

export function installBrowserTracePropagation(): void {
  if (typeof window === 'undefined') return;
  const globalWindow = window as typeof window & Record<string, unknown>;
  if (globalWindow[FETCH_PATCHED_KEY]) return;

  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (!shouldPropagateTo(input)) return originalFetch(input, init);

    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (isPrefetchRequest(headers)) return originalFetch(input, init);

    if (!headers.has('traceparent')) {
      headers.set('traceparent', createTraceparent().traceparent);
    }

    return originalFetch(input, {
      ...init,
      headers,
    });
  };

  globalWindow[FETCH_PATCHED_KEY] = true;
}

export function installBrowserErrorLogging(context: BrowserLoggerContext = {}): void {
  if (typeof window === 'undefined') return;
  const globalWindow = window as typeof window & Record<string, unknown>;
  if (globalWindow[ERRORS_PATCHED_KEY]) return;

  const logger = createBrowserLogger({
    ...context,
    component: context.component ?? 'browser.global-error',
  });

  window.addEventListener('error', (event) => {
    logger.error('browser.window_error', {
      error: event.error ?? event.message,
      attributes: {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      },
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    logger.error('browser.unhandled_rejection', {
      error: event.reason,
    });
  });

  globalWindow[ERRORS_PATCHED_KEY] = true;
}

export function installBrowserObservability(options: BrowserObservabilityOptions = {}): void {
  if (options.propagateFetchTrace ?? true) installBrowserTracePropagation();
  if (options.captureErrors ?? true) installBrowserErrorLogging(options);
}

import { context, trace, type Attributes } from '@opentelemetry/api';
import { logs, SeverityNumber, type LogAttributes } from '@opentelemetry/api-logs';

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LoggerContext {
  serviceName?: string;
  component?: string;
  route?: string;
  runtime?: string;
  attributes?: Record<string, unknown>;
}

export interface LogOptions {
  message?: string;
  error?: unknown;
  attributes?: Record<string, unknown>;
}

export interface WebLogger {
  debug(event: string, options?: LogOptions): void;
  info(event: string, options?: LogOptions): void;
  warn(event: string, options?: LogOptions): void;
  error(event: string, options?: LogOptions): void;
  child(context: LoggerContext): WebLogger;
}

export interface BrowserLogIngestOptions extends LoggerContext {
  maxBodyBytes?: number;
}

const REDACTED = '[REDACTED]';
const REDACT_KEY_PATTERN =
  /(^|[-_.])?(authorization|cookie|set-cookie|token|secret|password|passwd|paymentkey|payment_key|apikey|api_key|clientsecret|client_secret|refreshtoken|refresh_token|accesstoken|access_token|idtoken|id_token)($|[-_.])?/i;

const severityByLevel: Record<LogLevel, SeverityNumber> = {
  debug: SeverityNumber.DEBUG,
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
};

function defaultServiceName(): string {
  return process.env.OTEL_SERVICE_NAME ?? process.env.NEXT_PUBLIC_OTEL_SERVICE_NAME ?? 'web';
}

function deploymentEnvironment(): string {
  return process.env.SST_STAGE ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development';
}

function currentTraceAttributes(): Record<string, string> {
  const spanContext = trace.getActiveSpan()?.spanContext();
  if (!spanContext) return {};
  return {
    trace_id: spanContext.traceId,
    span_id: spanContext.spanId,
    trace_flags: `0${spanContext.traceFlags.toString(16)}`.slice(-2),
  };
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
    const entries = Object.entries(value).slice(0, 100);
    return Object.fromEntries(
      entries.map(([key, nested]) => [key, shouldRedactKey(key) ? REDACTED : safeJsonValue(nested, depth + 1)]),
    );
  }
  return String(value);
}

function shouldRedactKey(key: string): boolean {
  return REDACT_KEY_PATTERN.test(key);
}

function sanitizeAttributes(attributes: Record<string, unknown> = {}): Record<string, JsonValue> {
  return Object.fromEntries(
    Object.entries(attributes).map(([key, value]) => [key, shouldRedactKey(key) ? REDACTED : safeJsonValue(value)]),
  );
}

function toOtelAttributes(attributes: Record<string, JsonValue>): LogAttributes {
  const flat: LogAttributes = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      flat[key] = value;
      continue;
    }
    flat[key] = JSON.stringify(value);
  }
  return flat;
}

function writeStdout(level: LogLevel, record: Record<string, JsonValue>) {
  const line = JSON.stringify(record);
  if (level === 'error') {
    console.error(line);
    return;
  }
  if (level === 'warn') {
    console.warn(line);
    return;
  }
  if (level === 'debug') {
    console.debug(line);
    return;
  }
  console.info(line);
}

class DefaultWebLogger implements WebLogger {
  constructor(private readonly loggerContext: Required<Omit<LoggerContext, 'attributes'>> & { attributes: Record<string, unknown> }) {}

  child(childContext: LoggerContext): WebLogger {
    return createWebLogger({
      serviceName: childContext.serviceName ?? this.loggerContext.serviceName,
      component: childContext.component ?? this.loggerContext.component,
      route: childContext.route ?? this.loggerContext.route,
      runtime: childContext.runtime ?? this.loggerContext.runtime,
      attributes: {
        ...this.loggerContext.attributes,
        ...(childContext.attributes ?? {}),
      },
    });
  }

  debug(event: string, options: LogOptions = {}): void {
    this.emit('debug', event, options);
  }

  info(event: string, options: LogOptions = {}): void {
    this.emit('info', event, options);
  }

  warn(event: string, options: LogOptions = {}): void {
    this.emit('warn', event, options);
  }

  error(event: string, options: LogOptions = {}): void {
    this.emit('error', event, options);
  }

  private emit(level: LogLevel, event: string, options: LogOptions) {
    const serviceName = this.loggerContext.serviceName;
    const traceAttributes = currentTraceAttributes();
    const attributes = sanitizeAttributes({
      ...this.loggerContext.attributes,
      ...(options.attributes ?? {}),
      ...serializeError(options.error),
      ...traceAttributes,
      event,
      'service.name': serviceName,
      service_name: serviceName,
      'deployment.environment': deploymentEnvironment(),
      deployment_environment: deploymentEnvironment(),
      component: this.loggerContext.component,
      runtime: this.loggerContext.runtime,
      ...(this.loggerContext.route ? { route: this.loggerContext.route } : {}),
    });

    const message = options.message ?? event;
    const record: Record<string, JsonValue> = {
      timestamp: new Date().toISOString(),
      severity: level,
      message,
      ...attributes,
    };

    writeStdout(level, record);
    logs.getLogger(serviceName).emit({
      context: context.active(),
      severityNumber: severityByLevel[level],
      severityText: level.toUpperCase(),
      eventName: event,
      body: message,
      attributes: toOtelAttributes(attributes),
    });
  }
}

export function createWebLogger(context: LoggerContext = {}): WebLogger {
  return new DefaultWebLogger({
    serviceName: context.serviceName ?? defaultServiceName(),
    component: context.component ?? 'web',
    route: context.route ?? '',
    runtime: context.runtime ?? 'next-server',
    attributes: context.attributes ?? {},
  });
}

function safeLogLevel(value: unknown): LogLevel {
  return value === 'debug' || value === 'info' || value === 'warn' || value === 'error' ? value : 'info';
}

function safeEventName(value: unknown): string {
  if (typeof value !== 'string') return 'browser.log';
  const event = value.trim();
  return /^[a-z0-9][a-z0-9._-]{0,127}$/i.test(event) ? event : 'browser.log';
}

function safeMessage(value: unknown, fallback: string): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.length > 1000 ? value.slice(0, 1000) : value || fallback;
}

function browserPayloadAttributes(payload: Record<string, unknown>): Record<string, unknown> {
  const ignored = new Set(['message', 'severity', 'level']);
  return Object.fromEntries(Object.entries(payload).filter(([key]) => !ignored.has(key)));
}

export async function handleBrowserLogRequest(
  request: Request,
  options: BrowserLogIngestOptions = {},
): Promise<Response> {
  const logger = createWebLogger({
    ...options,
    component: options.component ?? 'browser-log-ingest',
    route: options.route ?? '/api/observability/log',
    runtime: options.runtime ?? 'browser',
  });
  const maxBodyBytes = options.maxBodyBytes ?? 64 * 1024;

  let rawBody = '';
  try {
    rawBody = await request.text();
  } catch (error) {
    logger.warn('browser.log_ingest.body_read_failed', { error });
    return new Response(null, { status: 400 });
  }

  if (rawBody.length > maxBodyBytes) {
    logger.warn('browser.log_ingest.payload_too_large', {
      attributes: {
        body_bytes: rawBody.length,
        max_body_bytes: maxBodyBytes,
      },
    });
    return new Response(null, { status: 413 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch (error) {
    logger.warn('browser.log_ingest.invalid_json', { error });
    return new Response(null, { status: 400 });
  }

  if (!isPlainObject(payload)) {
    logger.warn('browser.log_ingest.invalid_payload');
    return new Response(null, { status: 400 });
  }

  const event = safeEventName(payload.event);
  const level = safeLogLevel(payload.severity ?? payload.level);
  logger[level](event, {
    message: safeMessage(payload.message, event),
    attributes: {
      source_runtime: 'browser',
      ...browserPayloadAttributes(payload),
    },
  });

  return new Response(null, { status: 204 });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function addHostFromUrl(hosts: Set<string>, value?: string | null) {
  if (!value) return;
  try {
    const url = value.startsWith('http://') || value.startsWith('https://') ? new URL(value) : new URL(`https://${value}`);
    hosts.add(url.hostname);
  } catch {
    // Ignore malformed optional environment values.
  }
}

export function buildInternalTracePropagationUrls(extraUrls: Array<string | undefined | null> = []): RegExp[] {
  const hosts = new Set<string>(['localhost', '127.0.0.1']);
  const envUrls = [
    process.env.NEXT_PUBLIC_BASE_URL,
    process.env.NEXT_PUBLIC_WALLET_WEB_URL,
    process.env.NEXT_PUBLIC_WALLET_API_URL,
    process.env.WALLET_API_URL,
    process.env.ALMONDYOUNG_API_URL,
    process.env.MEDUSA_API_URL,
    process.env.USER_SERVICE_URL,
    process.env.MEMBERSHIP_SERVICE_URL,
    process.env.NOTIFICATION_SERVICE_URL,
    process.env.CHANNEL_ADAPTER_SERVICE_URL,
    process.env.FILE_SERVICE_URL,
    process.env.UGC_SERVICE_URL,
    process.env.AUTH_WEB_ORIGIN,
    process.env.NEXT_PUBLIC_BACKEND_DOMAIN,
    process.env.BACKEND_DOMAIN,
    ...extraUrls,
  ];

  for (const url of envUrls) addHostFromUrl(hosts, url);

  const patterns: RegExp[] = [];
  for (const host of Array.from(hosts)) {
    if (host === 'localhost' || host === '127.0.0.1') {
      patterns.push(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//);
      continue;
    }
    patterns.push(new RegExp(`^https:\\/\\/([a-z0-9-]+\\.)?${escapeRegExp(host)}(:\\d+)?\\/`, 'i'));
  }
  return patterns;
}

export type WebLogAttributes = Attributes;

import { logs } from '@opentelemetry/api-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { LoggerProvider, SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

let registered = false;
let provider: LoggerProvider | null = null;

export interface RegisterOtelLogsOptions {
  serviceName?: string;
  endpoint?: string;
  instanceId?: string;
  token?: string;
  deploymentEnvironment?: string;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function authHeaders(instanceId?: string, token?: string): Record<string, string> | undefined {
  if (!instanceId || !token) return undefined;
  return {
    Authorization: `Basic ${Buffer.from(`${instanceId}:${token}`).toString('base64')}`,
  };
}

export function registerOtelLogs(options: RegisterOtelLogsOptions = {}): void {
  if (registered || process.env.NEXT_RUNTIME === 'edge') return;

  const endpoint = options.endpoint ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) return;

  const serviceName = options.serviceName ?? process.env.OTEL_SERVICE_NAME ?? 'web';
  const deploymentEnvironment =
    options.deploymentEnvironment ?? process.env.SST_STAGE ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development';
  const headers = authHeaders(
    options.instanceId ?? process.env.GRAFANA_OTLP_INSTANCE_ID,
    options.token ?? process.env.GRAFANA_OTLP_TOKEN,
  );

  provider = new LoggerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      'deployment.environment': deploymentEnvironment,
      service_name: serviceName,
      deployment_environment: deploymentEnvironment,
      runtime: 'next-server',
    }),
    processors: [
      new SimpleLogRecordProcessor(
        new OTLPLogExporter({
          url: `${trimTrailingSlash(endpoint)}/v1/logs`,
          headers,
        }),
      ),
    ],
  });

  logs.setGlobalLoggerProvider(provider);
  registered = true;

  process.once('SIGTERM', () => {
    void provider?.shutdown();
  });
  process.once('SIGINT', () => {
    void provider?.shutdown();
  });
}

export async function flushOtelLogs(): Promise<void> {
  await provider?.forceFlush();
}

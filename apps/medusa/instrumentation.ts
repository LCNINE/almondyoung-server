import { registerOtel } from '@medusajs/medusa';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

export function register() {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) {
    console.log('OTEL_EXPORTER_OTLP_ENDPOINT not set, skipping instrumentation');
    return;
  }

  const exporter = new OTLPTraceExporter({
    url: `${endpoint.replace(/\/+$/, '')}/v1/traces`,
  });

  registerOtel({
    serviceName: process.env.OTEL_SERVICE_NAME ?? 'almond-young-medusa',
    exporter,
    instrument: {
      http: true,
      workflows: true,
      query: true,
      db: true,
    },
  });
}

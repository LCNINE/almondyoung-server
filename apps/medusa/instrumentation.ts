import { registerOtel } from '@medusajs/medusa';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';

export function register() {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) {
    console.log('OTEL_EXPORTER_OTLP_ENDPOINT not set, skipping instrumentation');
    return;
  }

  const exporter = new OTLPTraceExporter({
    url: `${endpoint.replace(/\/+$/, '')}/v1/traces`,
  });
  const logExporter = new OTLPLogExporter({
    url: `${endpoint.replace(/\/+$/, '')}/v1/logs`,
  });

  registerOtel({
    serviceName: process.env.OTEL_SERVICE_NAME ?? 'almond-young-medusa',
    exporter,
    logRecordProcessors: [new BatchLogRecordProcessor(logExporter)],
    instrument: {
      http: true,
      workflows: true,
      query: true,
      db: true,
    },
  });
}

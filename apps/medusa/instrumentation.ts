// src/instrumentation.ts
import { registerOtel } from '@medusajs/medusa';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

const exporter = new OTLPTraceExporter({
  url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
});

export function register() {
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

import { registerOtel } from '@medusajs/medusa';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { RedactingLogExporter } from './src/observability/redacting-log-exporter';
import { RedactingSpanExporter } from './src/observability/redacting-span-exporter';

export function register() {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) {
    console.log('OTEL_EXPORTER_OTLP_ENDPOINT not set, skipping instrumentation');
    return;
  }

  // Medusa v2.13.4 는 HTTP span 에 요청 헤더를 통째로 스프레드한다. redaction 래퍼가
  // 내보내기 직전에 걸러낸다 — 자세한 근거는
  // docs/superpowers/specs/2026-08-14-medusa-otel-credential-redaction-design.md
  const exporter = new RedactingSpanExporter(
    new OTLPTraceExporter({
      url: `${endpoint.replace(/\/+$/, '')}/v1/traces`,
    }),
  );
  const logExporter = new RedactingLogExporter(
    new OTLPLogExporter({
      url: `${endpoint.replace(/\/+$/, '')}/v1/logs`,
    }),
  );

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

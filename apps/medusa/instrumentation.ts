import { registerOtel } from '@medusajs/medusa';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { RedactingLogExporter } from './src/observability/redacting-log-exporter';
import { RedactingSpanExporter } from './src/observability/redacting-span-exporter';
import { startMetricsServer } from './src/observability/metrics-server';
import { createTraceSampler } from './src/observability/trace-sampler';

export function register() {
  // Prometheus /metrics (:PORT+10000). OTLP endpoint 유무와 무관하게 연다 — 아래 early return 앞에 둔다.
  // 쿠폰 자동발급 카운터(#775)가 여기로 나간다. 포트 파생 규칙은 metrics-server.ts.
  startMetricsServer();

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
    // 샘플링은 기본값(전량)에 기대지 않고 명시한다 — 정책·비율·근거는 src/observability/trace-sampler.ts (#710).
    sampler: createTraceSampler(),
    instrument: {
      http: true,
      workflows: true,
      // query/db 는 끈다 (#710). 둘이 span 수의 지배 항이다 — query 는 graph/remote query 마다,
      // db 는 SQL 문마다 span 을 만든다. 단일 태스크가 CPU 포화 상태(#852·#853)라 이 계측이
      // 가장 무겁게 걸리는 곳이고, #855(store/admin 분리)의 전후 비교에서 교란 변수를 빼야 한다.
      // 느린 쿼리 추적이 필요해지면 샘플링 비율 안에서 다시 켜고, 그 결정을 여기에 적는다.
      query: false,
      db: false,
    },
  });
}

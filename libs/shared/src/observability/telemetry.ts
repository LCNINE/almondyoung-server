import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

export interface StartTelemetryOptions {
  /** OTEL_SERVICE_NAME 미설정 시 사용할 기본 서비스명. */
  serviceName: string;
}

/**
 * 모든 NestJS 서비스의 공용 OpenTelemetry 부트스트랩 (trace + log export).
 *
 * ★ 반드시 서비스 진입점에서 **가장 먼저** 호출한다. pino/http/pg 등 계측 대상 모듈이
 *   로드되기 전에 SDK 가 require 훅을 걸어야 trace_id 주입·자동계측이 성립한다. 관례:
 *   main.ts 첫 줄 `import './tracing'`, 그 tracing.ts 가 이 함수만 호출.
 *
 * ★ 이 모듈은 반드시 deep 경로(`@app/shared/observability/telemetry`)로 import 한다.
 *   `@app/shared` 배럴을 당기면 배럴이 re-export 하는 다른 모듈들이 SDK 시작 전에 로드되어
 *   계측을 놓친다.
 *
 * 전송 경로는 env 로 자동 분기:
 *  - `OTEL_EXPORTER_OTLP_ENDPOINT` 미설정 → no-op (로컬/테스트)
 *  - `GRAFANA_OTLP_INSTANCE_ID` + `GRAFANA_OTLP_TOKEN` 설정 → Grafana Cloud 직접 전송용
 *    Basic auth 헤더 추가 (VPC 밖 서비스, 예: user-service)
 *  - 미설정 → 헤더 없이 내부 Alloy 로 (VPC 안 Fargate 서비스)
 */
export function startTelemetry(options: StartTelemetryOptions): void {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) return;

  const instanceId = process.env.GRAFANA_OTLP_INSTANCE_ID;
  const token = process.env.GRAFANA_OTLP_TOKEN;
  const headers =
    instanceId && token
      ? {
          Authorization: `Basic ${Buffer.from(`${instanceId}:${token}`).toString('base64')}`,
        }
      : undefined;

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? options.serviceName,
    }),
    traceExporter: new OTLPTraceExporter({
      url: `${endpoint}/v1/traces`,
      headers,
    }),
    // pino 로그 → OTel 로그 브리지(instrumentation-pino, 아래 auto-instrumentations 에 포함)가
    // 이 LoggerProvider 로 자동 전달. trace_id 동봉되어 Loki↔Tempo 상관의 토대가 된다.
    logRecordProcessors: [
      new BatchLogRecordProcessor(
        new OTLPLogExporter({
          url: `${endpoint}/v1/logs`,
          headers,
        }),
      ),
    ],
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  sdk.start();

  process.on('SIGTERM', () => sdk.shutdown());
  process.on('SIGINT', () => sdk.shutdown());
}

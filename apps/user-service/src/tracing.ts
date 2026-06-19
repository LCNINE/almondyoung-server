import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
// user-service 는 lcnine-auth 앱(별도 SST 앱)에 살아 lcnine-services 의 in-VPC Alloy 로
// 보내면 auth→services 순환 의존이 생긴다. 그래서 Next.js 앱들과 동일하게 Grafana Cloud
// OTLP 게이트웨이로 직접 보낸다. auth 는 Basic base64(instanceId:token) 헤더가 필요.
const instanceId = process.env.GRAFANA_OTLP_INSTANCE_ID;
const token = process.env.GRAFANA_OTLP_TOKEN;

if (endpoint) {
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? 'user-service',
    }),
    traceExporter: new OTLPTraceExporter({
      url: `${endpoint}/v1/traces`,
      headers:
        instanceId && token
          ? {
              Authorization: `Basic ${Buffer.from(`${instanceId}:${token}`).toString('base64')}`,
            }
          : undefined,
    }),
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

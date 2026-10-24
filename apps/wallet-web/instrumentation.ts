import { registerOTel, OTLPHttpProtoTraceExporter } from '@vercel/otel';
import { buildInternalTracePropagationUrls } from '@packages/web-observability';

export async function register() {
  // VPC 밖 Lambda 라 내부 Alloy 에 닿지 못해 Grafana Cloud OTLP 게이트웨이로 직접 보낸다.
  // 엔드포인트가 없으면 exporter 를 붙이지 않아 no-op.
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const instanceId = process.env.GRAFANA_OTLP_INSTANCE_ID;
  const token = process.env.GRAFANA_OTLP_TOKEN;
  const serviceName = process.env.OTEL_SERVICE_NAME ?? 'wallet-web';

  registerOTel({
    serviceName,
    ...(endpoint
      ? {
          // http/protobuf — 같은 span 을 JSON 의 46% 크기로 보낸다(2026-10-24 실측). 게이트웨이가 도쿄라 리전 간 전송비가 크기에 비례한다.
          traceExporter: new OTLPHttpProtoTraceExporter({
            url: `${endpoint}/v1/traces`,
            headers:
              instanceId && token
                ? {
                    Authorization: `Basic ${Buffer.from(`${instanceId}:${token}`).toString('base64')}`,
                  }
                : undefined,
          }),
        }
      : {}),
    instrumentationConfig: {
      fetch: {
        propagateContextUrls: buildInternalTracePropagationUrls(),
      },
    },
  });

  if (process.env.NEXT_RUNTIME !== 'edge') {
    const { registerOtelLogs } = await import('@packages/web-observability/otel-node');
    registerOtelLogs({ serviceName, endpoint, instanceId, token });
  }
}

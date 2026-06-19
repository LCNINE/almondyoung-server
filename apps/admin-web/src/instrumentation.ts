import { registerOTel, OTLPHttpJsonTraceExporter } from '@vercel/otel';

export function register() {
  // VPC 밖 Lambda 라 내부 Alloy 에 닿지 못해 Grafana Cloud OTLP 게이트웨이로 직접 보낸다.
  // 엔드포인트가 없으면 exporter 를 붙이지 않아 no-op.
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const instanceId = process.env.GRAFANA_OTLP_INSTANCE_ID;
  const token = process.env.GRAFANA_OTLP_TOKEN;

  registerOTel({
    serviceName: process.env.OTEL_SERVICE_NAME ?? 'admin-web',
    ...(endpoint
      ? {
          traceExporter: new OTLPHttpJsonTraceExporter({
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
  });
}

import { NodeSDK } from '@opentelemetry/sdk-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
const serviceName = process.env.OTEL_SERVICE_NAME

console.log('[OTEL] Initializing tracing...', { serviceName, endpoint })

if (!endpoint || !serviceName) {
  console.warn('[OTEL] Missing OTEL_EXPORTER_OTLP_ENDPOINT or OTEL_SERVICE_NAME, skipping tracing')
} else {
  const sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter({ url: endpoint }),
    instrumentations: [getNodeAutoInstrumentations()],
    serviceName,
  })

  sdk.start()
  console.log('[OTEL] SDK started successfully')
}

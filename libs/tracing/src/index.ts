console.log('[OTEL] Loading tracing module...')

try {
  const { NodeSDK } = require('@opentelemetry/sdk-node')
  const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http')
  const { FastifyInstrumentation } = require('@opentelemetry/instrumentation-fastify')
  const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http')

  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  const serviceName = process.env.OTEL_SERVICE_NAME

  console.log('[OTEL] Initializing tracing...', { serviceName, endpoint })

  if (!endpoint || !serviceName) {
    console.warn('[OTEL] Missing OTEL_EXPORTER_OTLP_ENDPOINT or OTEL_SERVICE_NAME, skipping tracing')
  } else {
    const sdk = new NodeSDK({
      traceExporter: new OTLPTraceExporter({ url: endpoint }),
      instrumentations: [
        new HttpInstrumentation(),
        new FastifyInstrumentation(),
      ],
      serviceName,
    })

    sdk.start()
    console.log('[OTEL] SDK started successfully')
  }
} catch (error) {
  console.error('[OTEL] Failed to load tracing:', error)
}
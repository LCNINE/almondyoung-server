import { NodeSDK } from "@opentelemetry/sdk-node"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http"
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http"
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http"
import { Resource } from "@opentelemetry/resources"
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions"
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics"
import { SimpleLogRecordProcessor } from "@opentelemetry/sdk-logs"

export function register() {
  const collectorEndpoint =
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
    "https://otel-collector-development-9a32.up.railway.app"

  const resource = new Resource({
    [ATTR_SERVICE_NAME]:
      process.env.OTEL_SERVICE_NAME ?? "almondyoung-storefront",
  })

  const sdk = new NodeSDK({
    resource,
    traceExporter: new OTLPTraceExporter({
      url: `${collectorEndpoint}/v1/traces`,
    }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: `${collectorEndpoint}/v1/metrics`,
      }),
    }),
    logRecordProcessors: [
      new SimpleLogRecordProcessor(
        new OTLPLogExporter({
          url: `${collectorEndpoint}/v1/logs`,
        })
      ),
    ],
  })

  sdk.start()
}

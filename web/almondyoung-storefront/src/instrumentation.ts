import { registerOTel, OTLPHttpJsonTraceExporter } from "@vercel/otel"
import {
  type Sampler,
  type SamplingResult,
  type Context,
  type SpanKind,
  type Attributes,
  type Link,
  SamplingDecision,
} from "@opentelemetry/api"
import {
  ParentBasedSampler,
  AlwaysOffSampler,
} from "@opentelemetry/sdk-trace-base"

const DROP_PREFIXES = ["/_next/image", "/_next/static", "/favicon.ico"]

class AppSampler implements Sampler {
  shouldSample(
    _context: Context,
    _traceId: string,
    spanName: string,
    _spanKind: SpanKind,
    attributes: Attributes,
    _links: Link[]
  ): SamplingResult {
    const target =
      (attributes["http.target"] as string | undefined) ??
      (attributes["url.path"] as string | undefined) ??
      spanName

    if (DROP_PREFIXES.some((prefix) => target.includes(prefix))) {
      return { decision: SamplingDecision.NOT_RECORD }
    }


    return { decision: SamplingDecision.RECORD_AND_SAMPLED }
  }

  toString(): string {
    return "AppSampler"
  }
}

export function register() {
  const endpoint =
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
    "https://otel-collector-development-9a32.up.railway.app"

  registerOTel({
    serviceName: process.env.OTEL_SERVICE_NAME ?? "almondyoung-storefront",
    traceExporter: new OTLPHttpJsonTraceExporter({
      url: `${endpoint}/v1/traces`,
    }),
    traceSampler: new ParentBasedSampler({
      root: new AppSampler(),
      remoteParentSampled: new AppSampler(),
      remoteParentNotSampled: new AlwaysOffSampler(),
    }),
    instrumentationConfig: {
      fetch: {
        propagateContextUrls: [/.*/],
      },
    },
  })
}

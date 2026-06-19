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
  // 명시적으로 설정된 경우에만 trace 를 내보낸다. 엔드포인트가 없으면
  // exporter 를 붙이지 않아 no-op 으로 둔다 (이전의 Railway dev collector
  // 하드코딩 fallback 은 운영 trace 가 외부로 새어 제거됨).
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT

  registerOTel({
    serviceName: process.env.OTEL_SERVICE_NAME ?? "almondyoung-storefront",
    ...(endpoint
      ? {
          traceExporter: new OTLPHttpJsonTraceExporter({
            url: `${endpoint}/v1/traces`,
          }),
        }
      : {}),
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

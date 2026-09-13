import { ParentBasedSampler, TraceIdRatioBasedSampler } from '@medusajs/framework/opentelemetry/sdk-trace-node';
import type { Sampler } from '@medusajs/framework/opentelemetry/sdk-trace-node';

/**
 * 트레이스 샘플링 정책 — 코드에 명시한다 (#710).
 *
 * `libs/shared/src/observability/trace-sampler.ts` 와 같은 정책의 복제다. apps/medusa 는 번들러
 * 없이 런타임에 뜨므로 `@app/shared` 별칭을 못 쓴다(docs: packages-alias-resolution-by-tree).
 * 정책을 바꾸면 두 파일을 같이 고친다 — `libs/shared/src/observability/telemetry.spec.ts` 의
 * 가드가 기본 비율이 갈리는 것을 막는다.
 *
 * Medusa 는 단일 태스크가 CPU 포화 상태라(#852·#853) 계측 비용이 가장 무겁게 걸리는 곳이다.
 * `parentbased_traceidratio` — 상위 span 결정을 따르고 root 만 비율로 뽑는다. 비율은
 * `OTEL_TRACES_SAMPLER_ARG` 로 조정한다.
 */
export const DEFAULT_TRACE_SAMPLE_RATIO = 0.1;
export const TRACE_SAMPLE_RATIO_ENV = 'OTEL_TRACES_SAMPLER_ARG';

export function resolveTraceSampleRatio(raw: string | undefined = process.env[TRACE_SAMPLE_RATIO_ENV]): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_TRACE_SAMPLE_RATIO;
  const ratio = Number(raw);
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
    throw new Error(`${TRACE_SAMPLE_RATIO_ENV} must be a number in [0, 1], got "${raw}"`);
  }
  return ratio;
}

export function createTraceSampler(ratio: number = resolveTraceSampleRatio()): Sampler {
  return new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(ratio) });
}

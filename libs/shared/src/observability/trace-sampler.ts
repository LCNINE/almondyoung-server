import { tracing } from '@opentelemetry/sdk-node';

/**
 * 트레이스 샘플링 정책 — 코드에 명시한다 (#710).
 *
 * 배경: `NodeSDK` 는 sampler 를 안 주면 `parentbased_always_on`, 즉 **전량 샘플링**으로
 * 떨어진다. 그 기본값에 기대는 동안 「샘플링을 정한 적이 없다」와 「100% 를 정했다」가
 * 구별되지 않았고, CPU 포화 진단(#852·#853)에서 계측 오버헤드가 얼마인지 아무도 몰랐다.
 *
 * 정책: `parentbased_traceidratio`. 상위 span 이 있으면 그 결정을 따르고(서비스 경계를 넘어도
 * 한 트레이스가 통째로 남거나 통째로 빠진다), root 만 비율로 뽑는다. 비율은
 * `OTEL_TRACES_SAMPLER_ARG` 로 서비스별 조정 가능. tail sampling(에러·느린 트레이스 전량 보존)은
 * Alloy 쪽 후속(#713)이다.
 *
 * `OTEL_TRACES_SAMPLER` env 는 읽지 않는다 — 이 파일이 정본이고, env 로 정책 종류까지 바꾸면
 * 「어디서 정해졌나」가 다시 흐려진다.
 */
export const DEFAULT_TRACE_SAMPLE_RATIO = 0.1;
export const TRACE_SAMPLE_RATIO_ENV = 'OTEL_TRACES_SAMPLER_ARG';

/**
 * 비율을 env 에서 읽는다. 없으면 기본값, 있는데 [0, 1] 밖이거나 숫자가 아니면 부팅을 죽인다 —
 * 잘못 적힌 값이 조용히 기본값으로 떨어지면 「설정했다」는 믿음만 남는다.
 */
export function resolveTraceSampleRatio(raw: string | undefined = process.env[TRACE_SAMPLE_RATIO_ENV]): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_TRACE_SAMPLE_RATIO;
  const ratio = Number(raw);
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
    throw new Error(`${TRACE_SAMPLE_RATIO_ENV} must be a number in [0, 1], got "${raw}"`);
  }
  return ratio;
}

export function createTraceSampler(ratio: number = resolveTraceSampleRatio()): tracing.Sampler {
  return new tracing.ParentBasedSampler({ root: new tracing.TraceIdRatioBasedSampler(ratio) });
}

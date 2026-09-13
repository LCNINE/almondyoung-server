import { api, tracing } from '@opentelemetry/sdk-node';
import { DEFAULT_TRACE_SAMPLE_RATIO, createTraceSampler, resolveTraceSampleRatio } from './trace-sampler';

const TRACE_ID = '0af7651916cd43dd8448eb211c80319c';
const SPAN_ID = 'b7ad6b7169203331';

function rootDecision(sampler: tracing.Sampler, traceId = TRACE_ID) {
  return sampler.shouldSample(api.ROOT_CONTEXT, traceId, 'op', api.SpanKind.SERVER, {}, []).decision;
}

describe('resolveTraceSampleRatio', () => {
  it('env 가 없으면 코드의 기본값이다', () => {
    expect(resolveTraceSampleRatio(undefined)).toBe(DEFAULT_TRACE_SAMPLE_RATIO);
    expect(resolveTraceSampleRatio('')).toBe(DEFAULT_TRACE_SAMPLE_RATIO);
  });

  it('env 가 있으면 그 값이다', () => {
    expect(resolveTraceSampleRatio('0.25')).toBe(0.25);
    expect(resolveTraceSampleRatio('1')).toBe(1);
    expect(resolveTraceSampleRatio('0')).toBe(0);
  });

  it('숫자가 아니거나 [0, 1] 밖이면 조용히 기본값으로 떨어지지 않고 throw 한다', () => {
    expect(() => resolveTraceSampleRatio('abc')).toThrow('OTEL_TRACES_SAMPLER_ARG');
    expect(() => resolveTraceSampleRatio('1.5')).toThrow('OTEL_TRACES_SAMPLER_ARG');
    expect(() => resolveTraceSampleRatio('-0.1')).toThrow('OTEL_TRACES_SAMPLER_ARG');
  });
});

describe('createTraceSampler', () => {
  it('root span 은 비율로 뽑힌다 — 0 이면 전부 버리고 1 이면 전부 남긴다', () => {
    expect(rootDecision(createTraceSampler(0))).toBe(tracing.SamplingDecision.NOT_RECORD);
    expect(rootDecision(createTraceSampler(1))).toBe(tracing.SamplingDecision.RECORD_AND_SAMPLED);
  });

  it('상위 span 이 sampled 면 비율과 무관하게 따라간다 (parent-based)', () => {
    const parent = api.trace.setSpanContext(api.ROOT_CONTEXT, {
      traceId: TRACE_ID,
      spanId: SPAN_ID,
      traceFlags: api.TraceFlags.SAMPLED,
      isRemote: true,
    });
    const decision = createTraceSampler(0).shouldSample(parent, TRACE_ID, 'op', api.SpanKind.SERVER, {}, []).decision;
    expect(decision).toBe(tracing.SamplingDecision.RECORD_AND_SAMPLED);
  });

  it('상위 span 이 not-sampled 면 비율과 무관하게 버린다', () => {
    const parent = api.trace.setSpanContext(api.ROOT_CONTEXT, {
      traceId: TRACE_ID,
      spanId: SPAN_ID,
      traceFlags: api.TraceFlags.NONE,
      isRemote: true,
    });
    const decision = createTraceSampler(1).shouldSample(parent, TRACE_ID, 'op', api.SpanKind.SERVER, {}, []).decision;
    expect(decision).toBe(tracing.SamplingDecision.NOT_RECORD);
  });
});

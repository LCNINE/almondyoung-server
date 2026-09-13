import { ROOT_CONTEXT, SpanKind, TraceFlags, trace } from '@medusajs/framework/opentelemetry/api';
import { SamplingDecision } from '@medusajs/framework/opentelemetry/sdk-trace-node';
import { DEFAULT_TRACE_SAMPLE_RATIO, createTraceSampler, resolveTraceSampleRatio } from '../trace-sampler';

const TRACE_ID = '0af7651916cd43dd8448eb211c80319c';
const SPAN_ID = 'b7ad6b7169203331';

describe('resolveTraceSampleRatio', () => {
  it('env 가 없으면 코드의 기본값이다', () => {
    expect(resolveTraceSampleRatio(undefined)).toBe(DEFAULT_TRACE_SAMPLE_RATIO);
  });

  it('env 가 있으면 그 값, 범위 밖이면 throw', () => {
    expect(resolveTraceSampleRatio('0.5')).toBe(0.5);
    expect(() => resolveTraceSampleRatio('2')).toThrow('OTEL_TRACES_SAMPLER_ARG');
    expect(() => resolveTraceSampleRatio('x')).toThrow('OTEL_TRACES_SAMPLER_ARG');
  });
});

describe('createTraceSampler', () => {
  it('root 는 비율로, 자식은 부모를 따른다', () => {
    expect(createTraceSampler(0).shouldSample(ROOT_CONTEXT, TRACE_ID, 'op', SpanKind.SERVER, {}, []).decision).toBe(
      SamplingDecision.NOT_RECORD,
    );
    expect(createTraceSampler(1).shouldSample(ROOT_CONTEXT, TRACE_ID, 'op', SpanKind.SERVER, {}, []).decision).toBe(
      SamplingDecision.RECORD_AND_SAMPLED,
    );
    const sampledParent = trace.setSpanContext(ROOT_CONTEXT, {
      traceId: TRACE_ID,
      spanId: SPAN_ID,
      traceFlags: TraceFlags.SAMPLED,
      isRemote: true,
    });
    expect(createTraceSampler(0).shouldSample(sampledParent, TRACE_ID, 'op', SpanKind.SERVER, {}, []).decision).toBe(
      SamplingDecision.RECORD_AND_SAMPLED,
    );
  });
});

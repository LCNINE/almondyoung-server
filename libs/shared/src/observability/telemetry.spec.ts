import * as fs from 'fs';
import * as path from 'path';
import { shouldIgnoreIncomingRequest } from './telemetry';

describe('shouldIgnoreIncomingRequest', () => {
  it('/metrics 를 제외한다', () => {
    expect(shouldIgnoreIncomingRequest('/metrics')).toBe(true);
  });

  it('/metrics?foo=1 를 제외한다 (query string)', () => {
    expect(shouldIgnoreIncomingRequest('/metrics?foo=1')).toBe(true);
  });

  it('/health 는 포함한다 (범위 밖)', () => {
    expect(shouldIgnoreIncomingRequest('/health')).toBe(false);
  });

  it('/api/orders 는 포함한다', () => {
    expect(shouldIgnoreIncomingRequest('/api/orders')).toBe(false);
  });

  it('undefined 는 포함한다', () => {
    expect(shouldIgnoreIncomingRequest(undefined)).toBe(false);
  });
});

/**
 * 가드 (#710): 샘플러가 두 진입점 모두에서 «명시»돼 있는지. NodeSDK 는 sampler 를 안 주면
 * 전량 샘플링으로 조용히 떨어지므로, 누가 이 줄을 지우면 정책이 사라진 게 아니라 100% 로
 * 돌아간다. apps/medusa 는 루트 jest 에서 제외돼 있어 소스를 직접 읽는다.
 */
describe('trace sampler 는 코드에 명시돼 있다 (#710)', () => {
  const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');

  it('startTelemetry 가 sampler 를 넘긴다', () => {
    expect(read('./telemetry.ts')).toMatch(/sampler:\s*createTraceSampler\(\)/);
  });

  it('Medusa registerOtel 이 sampler 를 넘기고 query/db 계측을 끈다', () => {
    const src = read('../../../../apps/medusa/instrumentation.ts');
    expect(src).toMatch(/sampler:\s*createTraceSampler\(\)/);
    expect(src).toMatch(/query:\s*false/);
    expect(src).toMatch(/db:\s*false/);
  });

  it('두 트리의 기본 비율이 같다 (Medusa 는 @app/shared 를 못 써서 복제본이다)', () => {
    const pick = (src: string) => src.match(/DEFAULT_TRACE_SAMPLE_RATIO = ([0-9.]+)/)?.[1];
    expect(pick(read('./trace-sampler.ts'))).toBeDefined();
    expect(pick(read('../../../../apps/medusa/src/observability/trace-sampler.ts'))).toBe(
      pick(read('./trace-sampler.ts')),
    );
  });
});

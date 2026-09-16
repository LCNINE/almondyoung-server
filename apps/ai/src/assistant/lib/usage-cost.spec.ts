import type OpenAI from 'openai';
import { MODEL, logUsage } from './openai';

type Logged = Record<string, unknown>;

/**
 * 응답이 밝히는 실제 모델명. 요청한 별칭(gpt-5)과 다른 날짜 스냅샷으로 풀린다 —
 * 그 차이를 로그로 볼 수 있어야 "정말 이 모델이 답했나" 를 확인할 수 있다.
 */
const SERVED_MODEL = 'gpt-5-2025-08-07';

function capture(usage: OpenAI.CompletionUsage, env: Record<string, string> = {}): Logged {
  const before = { ...process.env };
  Object.assign(process.env, env);

  let logged: Logged = {};
  const spy = jest.spyOn(console, 'info').mockImplementation((_label, payload) => {
    logged = payload as Logged;
  });

  try {
    logUsage(usage, {}, SERVED_MODEL);
  } finally {
    spy.mockRestore();
    process.env = before;
  }
  return logged;
}

const usage = (promptTokens: number, completionTokens: number, cached: number) =>
  ({
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
    prompt_tokens_details: { cached_tokens: cached },
  }) as OpenAI.CompletionUsage;

describe('logUsage 비용 계산', () => {
  it('단가가 없으면 금액을 지어내지 않는다', () => {
    const logged = capture(usage(1000, 100, 800));

    expect(logged.estimatedCost).toContain('단가 미설정');
    // 모르는 것과 0원인 것은 다르다.
    expect(logged).not.toHaveProperty('estimatedUsd');
  });

  it('캐시 적중분을 정가로 두 번 세지 않는다', () => {
    // prompt 10,000 중 8,000 이 캐시. 입력 $1, 캐시 $0.1, 출력 $2 / 1M
    const logged = capture(usage(10_000, 1_000, 8_000), {
      OPENAI_PRICE_INPUT_PER_MTOK: '1',
      OPENAI_PRICE_CACHED_INPUT_PER_MTOK: '0.1',
      OPENAI_PRICE_OUTPUT_PER_MTOK: '2',
    });

    // 신규 2,000 × $1 + 캐시 8,000 × $0.1 + 출력 1,000 × $2 = 0.002 + 0.0008 + 0.002
    expect(logged.estimatedUsd).toBeCloseTo(0.0048, 6);
  });

  it('캐시 단가가 없으면 할인 없이 본다 — 싸게 잡지 않는다', () => {
    const logged = capture(usage(10_000, 0, 8_000), {
      OPENAI_PRICE_INPUT_PER_MTOK: '1',
      OPENAI_PRICE_OUTPUT_PER_MTOK: '2',
    });

    expect(logged.estimatedUsd).toBeCloseTo(0.01, 6);
  });

  it('캐시 적중률과 실제 응답 모델을 함께 찍는다', () => {
    const logged = capture(usage(10_000, 100, 8_000));

    expect(logged.cacheHitRate).toBe(0.8);
    // 요청한 이름만 찍으면 "정말 이 모델이 답했나" 를 로그로 확인할 수 없다.
    // 기본 모델은 env 로 바뀌므로 상수를 그대로 본다 — 여기에 이름을 박으면
    // 모델을 갈 때마다 관계없는 테스트가 깨진다.
    expect(logged.servedModel).toBe(SERVED_MODEL);
    expect(logged.requestedModel).toBe(MODEL);
  });
});

import Anthropic from '@anthropic-ai/sdk';
import type { Usage } from '@anthropic-ai/sdk/resources/messages';
import { ServiceUnavailableError } from '@app/shared';

export const MODEL = 'claude-sonnet-5';
const MODEL_PRICING = { input: 3, output: 15 };

/**
 * 인증은 부르는 쪽(컨트롤러의 가드)이 이미 끝냈다. 여기서는 키만 본다 —
 * 키가 없으면 기능이 통째로 없는 것이므로 503 이다.
 *
 * 클라이언트를 매번 새로 만들지 않는다. 내부 keep-alive 풀을 들고 있어서,
 * 요청마다 새로 만들면 연결이 재사용되지 않는다.
 */
let cached: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (cached) return cached;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new ServiceUnavailableError('ANTHROPIC_API_KEY 가 설정되지 않았습니다.');
  }

  cached = new Anthropic({ apiKey });
  return cached;
}

/** 실측 단가 파악용. 출력 단가가 입력의 5배라 thinking 분량이 비용을 좌우한다. */
export function logUsage(stage: string, usage: Usage, extra: Record<string, unknown> = {}) {
  const inputCost = (usage.input_tokens / 1_000_000) * MODEL_PRICING.input;
  const outputCost = (usage.output_tokens / 1_000_000) * MODEL_PRICING.output;
  console.info(`[ai/product-description] usage`, {
    stage,
    model: MODEL,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    estimatedUsd: Number((inputCost + outputCost).toFixed(4)),
    estimatedKrw: Math.round((inputCost + outputCost) * 1380),
    ...extra,
  });
}

/** Anthropic 쪽 실패만 상태코드로 옮긴다. 그 외 예외는 전역 처리로 넘겨 500 이 되게 둔다. */
export function toAnthropicErrorResponse(err: unknown): Response | null {
  if (err instanceof Anthropic.RateLimitError) {
    return Response.json({ message: 'AI 요청이 몰려 있습니다. 잠시 후 다시 시도해주세요.' }, { status: 429 });
  }
  if (err instanceof Anthropic.APIError) {
    // 상태코드만으로는 원인을 못 좁힌다 — 400 은 스키마·이미지·요청크기 어느 쪽이든 난다.
    console.error('[ai/product-description] Anthropic API 오류', {
      // SDK 가 APIError.status 를 any 로 선언해 둬서 좁혀 준다. 값 자체는 HTTP 상태코드다.
      status: err.status as number | undefined,
      message: err.message.slice(0, 500),
      body: JSON.stringify(err.error ?? {}).slice(0, 1500),
    });
    return Response.json({ message: `AI 호출에 실패했습니다. (${err.status})` }, { status: 502 });
  }
  return null;
}

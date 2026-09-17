import OpenAI from 'openai';
import { ServiceUnavailableError } from '@app/shared';
import { positiveNumberEnv } from '../../platform/env';

/**
 * 어시스턴트가 쓰는 모델. env 로 바꾼다 — 코드에 박아 두면 모델을 갈 때마다 재빌드가 필요하다.
 * (같은 앱의 AI 상품설명은 Anthropic 을 쓴다. 둘은 별개 기능·별개 키다.)
 *
 * 기본값이 gpt-5 인 이유 — 도구를 여러 번 도는 작업은 한 발화에 모델을 5~10번 부르고,
 * 그때마다 시스템 프롬프트와 대화가 통째로 다시 실린다. 출력 단가가 비싼 모델을 기본으로
 * 두면 그 배수만큼 곱해진다. 더 나은 판단이 필요하면 ASSISTANT_MODEL 로 올린다.
 */
export function model(): string {
  return process.env.ASSISTANT_MODEL || 'gpt-5';
}

/**
 * 인증은 컨트롤러의 가드가 이미 끝냈다. 여기서는 키만 본다.
 *
 * 클라이언트를 요청마다 새로 만들지 않는다 — 내부 keep-alive 풀을 들고 있어서
 * 매번 새로 만들면 연결이 재사용되지 않는다.
 */
let cached: OpenAI | null = null;

export function getOpenAiClient(): OpenAI {
  if (cached) return cached;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new ServiceUnavailableError('OPENAI_API_KEY 가 설정되지 않았습니다.');
  }

  cached = new OpenAI({ apiKey });
  return cached;
}

/**
 * 100만 토큰당 USD. 모델 단가는 우리가 정하는 값이 아니라 공급자가 바꾸는 값이라
 * 코드에 박지 않고 env 로 받는다 — 틀린 숫자가 로그에 찍히면 그걸 보고 비용 판단을 한다.
 *
 * 미설정이면 토큰 수만 찍고 금액은 생략한다. 단가를 모르는 것과 0원인 것은 다르다.
 *
 * 설정 (공급자 가격표를 보고 채운다):
 *   OPENAI_PRICE_INPUT_PER_MTOK · OPENAI_PRICE_OUTPUT_PER_MTOK
 *   OPENAI_PRICE_CACHED_INPUT_PER_MTOK — 캐시 적중분. 보통 입력가보다 훨씬 싸다
 */
function price(key: string): number | null {
  const raw = process.env[key];
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

const usdToKrw = () => positiveNumberEnv('USD_TO_KRW', 1380);

/**
 * 이번 호출의 비용. 단가가 하나라도 없으면 null 을 준다.
 *
 * 캐시 적중분은 prompt_tokens 에 포함돼 오므로 빼고 계산한다. 그냥 더하면 캐시된 몫을
 * 정가로 두 번 세어 실제보다 비싸게 나온다.
 */
function estimateUsd(usage: OpenAI.CompletionUsage): number | null {
  const inputPrice = price('OPENAI_PRICE_INPUT_PER_MTOK');
  const outputPrice = price('OPENAI_PRICE_OUTPUT_PER_MTOK');
  if (inputPrice === null || outputPrice === null) return null;

  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
  const fresh = Math.max(usage.prompt_tokens - cached, 0);
  // 캐시 단가를 안 주면 할인 없이 본다 — 실제보다 비싸게 잡히지, 싸게 잡히지 않는다.
  const cachedPrice = price('OPENAI_PRICE_CACHED_INPUT_PER_MTOK') ?? inputPrice;

  return (
    (fresh / 1_000_000) * inputPrice +
    (cached / 1_000_000) * cachedPrice +
    (usage.completion_tokens / 1_000_000) * outputPrice
  );
}

/** 실측 단가 파악용. 도구를 여러 번 도는 작업이라 턴이 쌓이면 비용이 튄다. */
export function logUsage(
  usage: OpenAI.CompletionUsage | undefined,
  extra: Record<string, unknown> = {},
  /**
   * 응답이 밝힌 실제 모델. 우리가 요청한 이름과 다를 수 있다 — 별칭은 날짜가 붙은
   * 스냅샷으로 풀리고, 계정이 못 쓰는 이름은 아예 다른 것이 응답할 수도 있다.
   * 요청값만 찍으면 "정말 이 모델이 답한 게 맞나" 를 로그로 확인할 수 없다.
   */
  servedModel?: string,
) {
  if (!usage) return;

  const cachedTokens = usage.prompt_tokens_details?.cached_tokens ?? 0;
  const usd = estimateUsd(usage);

  console.info('[ai/assistant] usage', {
    requestedModel: model(),
    servedModel: servedModel ?? '(응답에 없음)',
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    cachedTokens,
    // 캐시가 얼마나 먹었는지. 낮으면 매 요청 바뀌는 값이 프롬프트 앞쪽에 섞인 것이다.
    cacheHitRate: usage.prompt_tokens > 0 ? Number((cachedTokens / usage.prompt_tokens).toFixed(2)) : 0,
    ...(usd === null
      ? { estimatedCost: '단가 미설정 (OPENAI_PRICE_*_PER_MTOK)' }
      : { estimatedUsd: Number(usd.toFixed(5)), estimatedKrw: Math.round(usd * usdToKrw()) }),
    ...extra,
  });
}

/** OpenAI 오류를 사용자 문장으로 옮긴다. 상태코드를 그대로 보여주지 않는다. */
export function toUserMessage(err: unknown): string {
  const status = (err as { status?: number })?.status;
  if (status === 429) return 'AI 요청이 몰려 있습니다. 잠시 후 다시 시도해 주세요.';
  if (status === 401 || status === 403) return 'AI 사용 권한을 확인해 주세요.';
  return '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}

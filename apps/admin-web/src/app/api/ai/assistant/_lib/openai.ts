import OpenAI from 'openai';
import { getTokenPayload } from '@/lib/auth/get-token-payload';

/**
 * 어시스턴트는 OpenAI 를 쓴다 — 키는 core 와 같은 `PRODUCT_AI_OPENAI_API_KEY` 다.
 * (같은 저장소의 AI 상품설명은 Anthropic 을 쓴다. 둘은 별개 기능·별개 키다.)
 */
export const MODEL = 'gpt-5.5';

type Guard =
  | { client: OpenAI; error?: never }
  | { client?: never; error: Response };

export async function requireAssistantClient(): Promise<Guard> {
  const payload = await getTokenPayload();
  if (!payload) {
    return {
      error: Response.json({ message: '인증이 필요합니다.' }, { status: 401 }),
    };
  }

  const apiKey = process.env.PRODUCT_AI_OPENAI_API_KEY;
  if (!apiKey) {
    return {
      error: Response.json(
        { message: 'PRODUCT_AI_OPENAI_API_KEY 가 설정되지 않았습니다.' },
        { status: 503 }
      ),
    };
  }

  return { client: new OpenAI({ apiKey }) };
}

/** 실측 단가 파악용. 도구를 여러 번 도는 작업이라 턴이 쌓이면 비용이 튄다. */
export function logUsage(
  usage: OpenAI.CompletionUsage | undefined,
  extra: Record<string, unknown> = {}
) {
  if (!usage) return;
  console.info('[ai/assistant] usage', {
    model: MODEL,
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    cachedTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
    ...extra,
  });
}

/** OpenAI 쪽 실패만 상태코드로 옮긴다. 그 외 예외는 전역 처리로 넘겨 500 이 되게 둔다. */
export function toOpenAiErrorResponse(err: unknown): Response | null {
  if (err instanceof OpenAI.RateLimitError) {
    return Response.json(
      { message: 'AI 요청이 몰려 있습니다. 잠시 후 다시 시도해주세요.' },
      { status: 429 }
    );
  }
  if (err instanceof OpenAI.APIError) {
    // 상태코드만으로는 원인을 못 좁힌다 — 400 은 스키마·요청크기 어느 쪽이든 난다.
    console.error('[ai/assistant] OpenAI API 오류', {
      status: err.status,
      message: err.message?.slice(0, 500),
    });
    return Response.json(
      { message: `AI 호출에 실패했습니다. (${err.status})` },
      { status: 502 }
    );
  }
  return null;
}

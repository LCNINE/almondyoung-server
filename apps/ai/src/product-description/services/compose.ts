import type Anthropic from '@anthropic-ai/sdk';
import {
  DEFAULT_PRODUCT_DESCRIPTION_PROMPT,
  buildSystemPrompt,
  createProductImageDirective,
  type ExtractResult,
} from '@packages/product-description';
import { MODEL, logUsage, toAnthropicErrorResponse } from './anthropic';
import { urlEnv } from '../../platform/env';

/**
 * 함수로 둔다 — 모듈 상수로 두면 ConfigModule 이 envFilePath 를 읽기 전에 평가된다.
 * 컨트롤러까지 정적 import 로 엮여 있어서 ai.module.ts 가 로드되는 중에 값이 굳는다.
 */
const coreApiUrl = () => urlEnv('CORE_API_URL', 'http://localhost:3100');
const PROMPT_SCOPE = 'product-description';

/**
 * Core 호출에 실을 인증 헤더. ai 앱은 자기 신원이 없으므로 부른 사람의 것을 그대로 전달한다 —
 * 서비스 계정을 두면 어드민이 못 보는 프롬프트도 읽히게 된다.
 */
export type ComposeCallContext = {
  authHeaders?: Record<string, string>;
  signal?: AbortSignal;
};

export type ComposeRequest = {
  result: ExtractResult;
  productName?: string;
  hint?: string;
  /** 고른 양식 ID. 없거나 못 찾으면 코드 기본 프롬프트를 쓴다. */
  presetId?: string;
  /** 양식 이름. 어시스턴트는 ID 를 모르므로 이름으로 고른다. */
  presetTitle?: string;
};

/**
 * 어드민이 고른 양식. 조회 실패는 치명적이지 않으므로 기본 프롬프트로 폴백한다 —
 * Core 가 잠깐 죽어도 AI 초안 기능 자체는 계속 동작해야 한다.
 */
async function loadEditablePrompt(
  presetId: string | undefined,
  presetTitle: string | undefined,
  authHeaders: Record<string, string>,
): Promise<string> {
  if (!presetId && !presetTitle) return DEFAULT_PRODUCT_DESCRIPTION_PROMPT;

  try {
    const res = await fetch(`${coreApiUrl()}/ai-prompts?scope=${encodeURIComponent(PROMPT_SCOPE)}`, {
      cache: 'no-store',
      headers: authHeaders,
    });
    if (!res.ok) return DEFAULT_PRODUCT_DESCRIPTION_PROMPT;

    const presets = (await res.json()) as { id: string; title?: string; content: string }[];
    const wanted = presetTitle?.trim().toLowerCase();
    const preset =
      presets.find((item) => item.id === presetId) ??
      (wanted ? presets.find((item) => item.title?.trim().toLowerCase() === wanted) : undefined);
    return preset?.content?.trim() ? preset.content : DEFAULT_PRODUCT_DESCRIPTION_PROMPT;
  } catch {
    return DEFAULT_PRODUCT_DESCRIPTION_PROMPT;
  }
}

export async function composeProductDescription(
  client: Anthropic,
  body: ComposeRequest,
  ctx: ComposeCallContext = {},
): Promise<Response> {
  const { authHeaders = {}, signal } = ctx;
  const result = body.result;
  if (!result || !Array.isArray(result.images) || result.images.length === 0) {
    return Response.json({ message: '이미지 분석 결과가 없습니다.' }, { status: 400 });
  }

  // directive 는 서버가 만든다 — 클라이언트가 보낸 문자열을 그대로 본문에 넣으면
  // 어떤 fileId 든 상세설명에 심을 수 있다.
  const analysis = {
    images: result.images.map((image) => ({
      kind: image.kind,
      content: image.content,
      directive: createProductImageDirective({ fileId: image.fileId, alt: '' }),
    })),
    facts: result.facts,
    features: result.features,
    usageSteps: result.usageSteps,
    cautions: result.cautions,
  };

  const context = [
    body.productName ? `상품명: ${body.productName}` : null,
    body.hint ? `추가 요청: ${body.hint}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const editablePrompt = await loadEditablePrompt(body.presetId, body.presetTitle, authHeaders);

  try {
    const message = await client.messages.create(
      {
        model: MODEL,
        max_tokens: 16000,
        output_config: { effort: 'medium' },
        system: buildSystemPrompt(editablePrompt),
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text' as const,
                text: [
                  context,
                  '이미지 분석 결과:',
                  JSON.stringify(analysis, null, 2),
                  '위 분석 결과로 상세페이지를 작성해주세요.',
                ]
                  .filter(Boolean)
                  .join('\n\n'),
              },
            ],
          },
        ],
      },
      { signal },
    );

    logUsage('compose', message.usage, { images: result.images.length });

    if (message.stop_reason === 'refusal') {
      return Response.json(
        {
          message: 'AI 가 이 요청을 처리하지 않았습니다. 다른 이미지로 시도해주세요.',
        },
        { status: 422 },
      );
    }

    const markdown = message.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();

    if (!markdown) {
      return Response.json({ message: '생성된 내용이 없습니다.' }, { status: 502 });
    }

    return Response.json({
      markdown,
      truncated: message.stop_reason === 'max_tokens',
    });
  } catch (err) {
    const mapped = toAnthropicErrorResponse(err);
    if (mapped) return mapped;
    throw err;
  }
}

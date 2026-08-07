import { createProductImageDirective } from '@packages/product-description';
import type { ExtractResult } from '@/features/mall/products-detail/components/description/ai-draft';
import {
  DEFAULT_PRODUCT_DESCRIPTION_PROMPT,
  buildSystemPrompt,
} from '@/features/mall/products-detail/components/description/product-description-prompt';
import {
  MODEL,
  logUsage,
  requireAiClient,
  toAnthropicErrorResponse,
} from '../_lib/anthropic';
import { coreAuthHeaders } from '../../prompts/_lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CORE_API_URL = process.env.ALMONDYOUNG_API_URL ?? 'http://localhost:3000';
const PROMPT_SCOPE = 'product-description';

type RequestBody = {
  result: ExtractResult;
  productName?: string;
  hint?: string;
  /** 고른 양식 ID. 없거나 못 찾으면 코드 기본 프롬프트를 쓴다. */
  presetId?: string;
};

/**
 * 어드민이 고른 양식. 조회 실패는 치명적이지 않으므로 기본 프롬프트로 폴백한다 —
 * Core 가 잠깐 죽어도 AI 초안 기능 자체는 계속 동작해야 한다.
 */
async function loadEditablePrompt(presetId?: string): Promise<string> {
  if (!presetId) return DEFAULT_PRODUCT_DESCRIPTION_PROMPT;

  try {
    const res = await fetch(
      `${CORE_API_URL.replace(/\/+$/, '')}/ai-prompts?scope=${encodeURIComponent(PROMPT_SCOPE)}`,
      { cache: 'no-store', headers: await coreAuthHeaders() }
    );
    if (!res.ok) return DEFAULT_PRODUCT_DESCRIPTION_PROMPT;

    const presets = (await res.json()) as { id: string; content: string }[];
    const preset = presets.find((item) => item.id === presetId);
    return preset?.content?.trim()
      ? preset.content
      : DEFAULT_PRODUCT_DESCRIPTION_PROMPT;
  } catch {
    return DEFAULT_PRODUCT_DESCRIPTION_PROMPT;
  }
}

export async function POST(request: Request): Promise<Response> {
  const guard = await requireAiClient();
  if (guard.error) return guard.error;

  const body = (await request.json()) as RequestBody;
  const result = body.result;
  if (!result || !Array.isArray(result.images) || result.images.length === 0) {
    return Response.json(
      { message: '이미지 분석 결과가 없습니다.' },
      { status: 400 }
    );
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

  const editablePrompt = await loadEditablePrompt(body.presetId);

  try {
    const message = await guard.client.messages.create({
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
    });

    logUsage('compose', message.usage, { images: result.images.length });

    if (message.stop_reason === 'refusal') {
      return Response.json(
        {
          message:
            'AI 가 이 요청을 처리하지 않았습니다. 다른 이미지로 시도해주세요.',
        },
        { status: 422 }
      );
    }

    const markdown = message.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();

    if (!markdown) {
      return Response.json(
        { message: '생성된 내용이 없습니다.' },
        { status: 502 }
      );
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

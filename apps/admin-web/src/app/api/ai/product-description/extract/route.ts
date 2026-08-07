import {
  EXTRACT_SCHEMA,
  type ExtractResult,
} from '@/features/mall/products-detail/components/description/ai-draft';
import { EXTRACT_PROMPT } from '@/features/mall/products-detail/components/description/product-description-prompt';
import {
  MODEL,
  logUsage,
  requireAiClient,
  toAnthropicErrorResponse,
} from '../_lib/anthropic';
import {
  IMAGES_PER_CHUNK,
  loadImageChunk,
  toImageBlocks,
} from '../_lib/images';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RequestBody = {
  fileIds: string[];
};

export async function POST(request: Request): Promise<Response> {
  const guard = await requireAiClient();
  if (guard.error) return guard.error;

  const body = (await request.json()) as RequestBody;
  const fileIds = Array.isArray(body.fileIds)
    ? body.fileIds.filter(Boolean)
    : [];
  if (fileIds.length === 0) {
    return Response.json(
      { message: '이미지를 1장 이상 첨부해주세요.' },
      { status: 400 }
    );
  }
  if (fileIds.length > IMAGES_PER_CHUNK) {
    return Response.json(
      {
        message: `한 번에 분석할 수 있는 이미지는 ${IMAGES_PER_CHUNK}장까지입니다.`,
      },
      { status: 400 }
    );
  }

  let images;
  try {
    images = await loadImageChunk(fileIds);
  } catch (err) {
    console.error('[ai/product-description] 이미지 로드 실패', {
      fileIds,
      error: err instanceof Error ? err.message : err,
    });
    return Response.json(
      {
        message:
          err instanceof Error ? err.message : '이미지 로드에 실패했습니다.',
      },
      { status: 400 }
    );
  }

  const fileIdGuide = images
    .map((image, index) => `${index + 1}번 이미지 → fileId: ${image.fileId}`)
    .join('\n');

  try {
    const message = await guard.client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      // 추출은 판단보다 옮겨적기에 가깝다. 스펙표를 놓치기 시작하면 'medium' 으로 올린다.
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: EXTRACT_SCHEMA },
      },
      system: EXTRACT_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            ...toImageBlocks(images),
            {
              type: 'text' as const,
              text: `첨부 이미지의 fileId 는 순서대로 다음과 같습니다.\n${fileIdGuide}\n\n각 이미지에서 사실을 뽑아주세요.`,
            },
          ],
        },
      ],
    });

    logUsage('extract', message.usage, { images: images.length });

    if (message.stop_reason === 'refusal') {
      return Response.json(
        {
          message:
            'AI 가 이 이미지를 처리하지 않았습니다. 다른 이미지로 시도해주세요.',
        },
        { status: 422 }
      );
    }

    const raw = message.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();

    if (!raw) {
      return Response.json(
        { message: '이미지 분석 결과가 비어 있습니다.' },
        { status: 502 }
      );
    }

    // 구조화 출력이라 형식은 보장되지만, max_tokens 로 잘리면 JSON 이 미완성으로 온다.
    let result: ExtractResult;
    try {
      result = JSON.parse(raw) as ExtractResult;
    } catch {
      console.error('[ai/product-description] 추출 JSON 파싱 실패', {
        stopReason: message.stop_reason,
        length: raw.length,
      });
      return Response.json(
        {
          message:
            '이미지 분석 결과를 읽지 못했습니다. 장수를 줄여 다시 시도해주세요.',
        },
        { status: 502 }
      );
    }

    return Response.json({ result });
  } catch (err) {
    const mapped = toAnthropicErrorResponse(err);
    if (mapped) return mapped;
    throw err;
  }
}

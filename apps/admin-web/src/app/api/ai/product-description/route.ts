import Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';
import { getTokenPayload } from '@/lib/auth/get-token-payload';
import { createProductImageDirective } from '@packages/product-description';
import {
  DEFAULT_PRODUCT_DESCRIPTION_PROMPT,
  buildSystemPrompt,
} from '@/features/mall/products-detail/components/description/product-description-prompt';
import { coreAuthHeaders } from '../prompts/_lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const FILE_SERVICE_URL = process.env.FILE_SERVICE_URL ?? 'http://localhost:3080';
const CORE_API_URL = process.env.ALMONDYOUNG_API_URL ?? 'http://localhost:3000';
const PROMPT_SCOPE = 'product-description';

/**
 * 이 라우트가 프로젝트에서 유일한 Anthropic 사용처다 — 여기만 바꾸면 AI 초안만 영향받는다.
 * 품질이 아쉬우면 'claude-opus-5' ($5/$25) 로 되돌린다. 단가는 백만 토큰당 USD.
 */
const MODEL = 'claude-sonnet-5';
const MODEL_PRICING = { input: 3, output: 15 };
const MAX_IMAGES = 30;
/**
 * Claude API 는 요청 전체가 32MB 를 넘으면 거부한다. base64 는 원본의 약 1.37배라
 * 원본 합계는 20MB 아래로 묶는다. 장당 한도는 축소 후 기준.
 */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
/** 스펙표의 작은 글씨까지 읽히면서 용량은 감당되는 선. */
const MAX_IMAGE_EDGE = 2000;
const SUPPORTED_MEDIA_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
] as const;

type SupportedMediaType = (typeof SUPPORTED_MEDIA_TYPES)[number];

type RequestBody = {
  fileIds: string[];
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

function isSupportedMediaType(value: string): value is SupportedMediaType {
  return (SUPPORTED_MEDIA_TYPES as readonly string[]).includes(value);
}

/**
 * S3 로 302 리다이렉트되면 content-type 이 octet-stream 으로 오는 경우가 있어
 * 헤더를 못 믿는다. 파일 시그니처(매직 바이트)로 실제 형식을 판별한다.
 */
function sniffMediaType(buffer: Buffer): SupportedMediaType | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return 'image/png';
  if (buffer.subarray(0, 3).toString('ascii') === 'GIF') return 'image/gif';
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

/**
 * 긴 변이 MAX_IMAGE_EDGE 를 넘거나 장당 한도를 넘으면 축소한다.
 * 축소가 필요한 경우에만 JPEG 로 재인코딩 — 그대로 통과하는 이미지는 원본 화질을 지킨다.
 */
async function shrinkIfNeeded(
  buffer: Buffer,
  mediaType: SupportedMediaType
): Promise<{ buffer: Buffer; mediaType: SupportedMediaType }> {
  const image = sharp(buffer, { animated: false });
  const meta = await image.metadata();
  const longestEdge = Math.max(meta.width ?? 0, meta.height ?? 0);

  if (longestEdge <= MAX_IMAGE_EDGE && buffer.byteLength <= MAX_IMAGE_BYTES) {
    return { buffer, mediaType };
  }

  const resized = await image
    .resize({
      width: MAX_IMAGE_EDGE,
      height: MAX_IMAGE_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 85 })
    .toBuffer();

  return { buffer: resized, mediaType: 'image/jpeg' };
}

async function fetchImage(fileId: string) {
  const res = await fetch(
    `${FILE_SERVICE_URL.replace(/\/+$/, '')}/files/public/${encodeURIComponent(fileId)}`
  );
  if (!res.ok) {
    throw new Error(`이미지를 불러오지 못했습니다. (fileId: ${fileId}, status: ${res.status})`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  const headerType = (res.headers.get('content-type') ?? '').split(';')[0].trim();
  const mediaType = isSupportedMediaType(headerType)
    ? headerType
    : sniffMediaType(buffer);

  if (!mediaType) {
    throw new Error(
      `지원하지 않는 이미지 형식입니다. (fileId: ${fileId}, type: ${headerType || '알 수 없음'})`
    );
  }

  // 원본이 크면 서버에서 줄인다 — 어드민이 이미지를 미리 손보게 만들지 않기 위해서.
  const normalized = await shrinkIfNeeded(buffer, mediaType);
  if (normalized.buffer.byteLength > MAX_IMAGE_BYTES) {
    const mb = (normalized.buffer.byteLength / 1024 / 1024).toFixed(1);
    throw new Error(
      `이미지가 너무 큽니다. (fileId: ${fileId}, 축소 후에도 ${mb}MB)`
    );
  }

  return {
    mediaType: normalized.mediaType,
    data: normalized.buffer.toString('base64'),
    bytes: normalized.buffer.byteLength,
  };
}

export async function POST(request: Request): Promise<Response> {
  const payload = await getTokenPayload();
  if (!payload) {
    return Response.json({ message: '인증이 필요합니다.' }, { status: 401 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json(
      { message: 'ANTHROPIC_API_KEY 가 설정되지 않았습니다.' },
      { status: 503 }
    );
  }

  const body = (await request.json()) as RequestBody;
  const fileIds = Array.isArray(body.fileIds) ? body.fileIds.filter(Boolean) : [];
  if (fileIds.length === 0) {
    return Response.json({ message: '이미지를 1장 이상 첨부해주세요.' }, { status: 400 });
  }
  if (fileIds.length > MAX_IMAGES) {
    return Response.json(
      { message: `이미지는 한 번에 최대 ${MAX_IMAGES}장까지 첨부할 수 있습니다.` },
      { status: 400 }
    );
  }

  let images: { mediaType: SupportedMediaType; data: string; bytes: number }[];
  try {
    images = await Promise.all(fileIds.map(fetchImage));

    const totalBytes = images.reduce((sum, image) => sum + image.bytes, 0);
    if (totalBytes > MAX_TOTAL_BYTES) {
      const mb = (totalBytes / 1024 / 1024).toFixed(1);
      throw new Error(
        `이미지 총 용량이 너무 큽니다. (${mb}MB — 합계 20MB 이하) 장수를 줄여 나눠서 생성해주세요.`
      );
    }
  } catch (err) {
    console.error('[ai/product-description] 이미지 로드 실패', {
      fileIds,
      fileServiceUrl: FILE_SERVICE_URL,
      error: err instanceof Error ? err.message : err,
    });
    return Response.json(
      { message: err instanceof Error ? err.message : '이미지 로드에 실패했습니다.' },
      { status: 400 }
    );
  }

  const directiveGuide = fileIds
    .map(
      (fileId, index) =>
        `${index + 1}번 이미지 → ${createProductImageDirective({ fileId, alt: '' })}`
    )
    .join('\n');

  const context = [
    body.productName ? `상품명: ${body.productName}` : null,
    body.hint ? `추가 요청: ${body.hint}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const editablePrompt = await loadEditablePrompt(body.presetId);
  const client = new Anthropic({ apiKey });

  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: 'medium' },
      system: buildSystemPrompt(editablePrompt),
      messages: [
        {
          role: 'user',
          content: [
            ...images.map((image) => ({
              type: 'image' as const,
              source: {
                type: 'base64' as const,
                media_type: image.mediaType,
                data: image.data,
              },
            })),
            {
              type: 'text' as const,
              text: [
                context,
                '이미지별 directive 문자열:',
                directiveGuide,
                '위 이미지들로 상세페이지를 작성해주세요.',
              ]
                .filter(Boolean)
                .join('\n\n'),
            },
          ],
        },
      ],
    });

    // 실측 단가 파악용. 출력 단가가 입력의 5배라 thinking 분량이 비용을 좌우한다.
    const usage = message.usage;
    const inputCost = (usage.input_tokens / 1_000_000) * MODEL_PRICING.input;
    const outputCost = (usage.output_tokens / 1_000_000) * MODEL_PRICING.output;
    console.info('[ai/product-description] usage', {
      model: MODEL,
      images: fileIds.length,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      estimatedUsd: Number((inputCost + outputCost).toFixed(4)),
      estimatedKrw: Math.round((inputCost + outputCost) * 1380),
    });

    if (message.stop_reason === 'refusal') {
      return Response.json(
        { message: 'AI 가 이 요청을 처리하지 않았습니다. 다른 이미지로 시도해주세요.' },
        { status: 422 }
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

    return Response.json({ markdown, truncated: message.stop_reason === 'max_tokens' });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return Response.json(
        { message: 'AI 요청이 몰려 있습니다. 잠시 후 다시 시도해주세요.' },
        { status: 429 }
      );
    }
    if (err instanceof Anthropic.APIError) {
      return Response.json(
        { message: `AI 호출에 실패했습니다. (${err.status})` },
        { status: 502 }
      );
    }
    throw err;
  }
}

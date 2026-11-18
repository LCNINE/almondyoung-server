import type Anthropic from '@anthropic-ai/sdk';
import type { PixelRegion } from '@packages/product-description';
import { MODEL, logUsage } from './anthropic';
import { type LoadedImage, toImageBlocks } from './images';

const LOCATE_SCHEMA = {
  type: 'object',
  properties: {
    boxes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          x1: { type: 'integer' },
          y1: { type: 'integer' },
          x2: { type: 'integer' },
          y2: { type: 'integer' },
        },
        required: ['index', 'x1', 'y1', 'x2', 'y2'],
        additionalProperties: false,
      },
    },
  },
  required: ['boxes'],
  additionalProperties: false,
} as const;

type LocatedBox = { index: number; x1: number; y1: number; x2: number; y2: number };

/**
 * 좌표 다시 묻기 한 번의 상한. 추출 호출(약 20초) 뒤에 이어 붙는 일이라, 늦어지면 어드민 프록시의
 * 60초 제한을 넘겨 이미 얻은 사실까지 잃는다. 넘기면 끊고 추출 좌표를 쓴다 (실측 5~8초).
 */
const LOCATE_TIMEOUT_MS = 15_000;

/**
 * 잘라 쓸 영역의 좌표를 이미지 한 장씩 다시 묻는다.
 *
 * 추출 호출 안에서 받은 좌표는 여러 이미지·여러 일을 한꺼번에 시켜 크게 어긋난다 — 컬러표 실측에서
 * 칩 중심이 이미지 폭의 10% 남짓 밀렸다. 같은 모델에 "이 이미지에서 이 대상들의 상자만" 물으면
 * 1% 안쪽으로 맞았다(2026-11-18). 다시 묻기가 실패하면 처음 좌표를 그대로 돌려준다 — 영역은
 * 있으면 좋은 부가 정보라 추출 전체를 실패시키지 않는다.
 */
export async function locateRegions(
  client: Anthropic,
  image: LoadedImage,
  regions: PixelRegion[],
  signal?: AbortSignal,
): Promise<PixelRegion[]> {
  if (regions.length === 0 || !image.size) return regions;

  const targets = regions.map((region, i) => `${i + 1}. ${region.label}`).join('\n');

  try {
    const message = await client.messages.create(
      {
        model: MODEL,
        max_tokens: 2000,
        output_config: {
          effort: 'medium',
          format: { type: 'json_schema', schema: LOCATE_SCHEMA },
        },
        messages: [
          {
            role: 'user',
            content: [
              ...toImageBlocks([image]),
              {
                type: 'text' as const,
                text: [
                  `이 이미지는 ${image.size.width}×${image.size.height}px 입니다.`,
                  '아래 대상마다 경계 상자를 픽셀 좌표로 주세요. x1,y1 은 왼쪽 위, x2,y2 는 오른쪽 아래입니다.',
                  '대상 하나에 상자 하나입니다. 같은 대상이 여러 번 보이면(예: 같은 컬러 칩이 두 줄) 가장 크고 선명한 하나만 잡습니다.',
                  '대상이 잘리지 않게 테두리에 약간의 여백을 둡니다. index 는 아래 번호이고, 이미지에 없는 대상은 뺍니다.',
                  targets,
                ].join('\n'),
              },
            ],
          },
        ],
      },
      { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(LOCATE_TIMEOUT_MS)]) : AbortSignal.timeout(LOCATE_TIMEOUT_MS) },
    );

    logUsage('locate', message.usage, { regions: regions.length });

    const raw = message.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');
    const { boxes } = JSON.parse(raw) as { boxes: LocatedBox[] };

    return regions.flatMap((region, i) => {
      const box = boxes.find((candidate) => candidate.index === i + 1);
      if (!box || box.x2 <= box.x1 || box.y2 <= box.y1) return [];

      return [{ label: region.label, left: box.x1, top: box.y1, width: box.x2 - box.x1, height: box.y2 - box.y1 }];
    });
  } catch (err) {
    // 부른 쪽(브라우저)이 끊은 것이면 그대로 올린다. 시간 초과·모델 오류는 추출 좌표로 넘어간다.
    if (signal?.aborted) throw err;

    console.warn('[ai/product-description] 영역 좌표 다시 묻기 실패 — 추출 좌표를 쓴다', {
      fileId: image.fileId,
      error: err instanceof Error ? err.message : String(err),
    });

    return regions;
  }
}

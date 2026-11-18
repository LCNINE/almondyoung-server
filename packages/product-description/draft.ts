/**
 * AI 초안은 두 단계로 나뉜다.
 *
 *   1) 추출 — 이미지를 8장씩 나눠 병렬로 보내고, 이미지에서 읽어낸 사실만 JSON 으로 받는다.
 *   2) 작성 — 추출 결과를 합쳐 마크다운 상세페이지를 한 번에 쓴다.
 *
 * 한 번에 다 시키면 호출 하나가 60초를 넘어 CloudFront 가 끊는다. 출력 토큰 수가
 * 소요 시간을 지배하므로, "짧은 추출 여러 번 + 긴 작성 한 번" 으로 쪼개면 각 호출이
 * 벽 아래로 내려온다. 이미지 20장·20MB 제약도 청크 단위가 되어 자연히 풀린다.
 */

/**
 * 한 번의 추출 호출에 넣는 이미지 장수. 서버(_lib/images.ts)의 IMAGES_PER_CHUNK 와
 * 같은 값이어야 한다 — 넘기면 서버가 400 으로 막는다.
 */
export const IMAGES_PER_CHUNK = 8;

export function chunkFileIds(fileIds: string[], size: number): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < fileIds.length; i += size) {
    chunks.push(fileIds.slice(i, i + size));
  }
  return chunks;
}

export const IMAGE_KINDS = ['제품컷', '스펙표', '사용예시', '브랜드소개', '구성품', '기타'] as const;

export type ImageKind = (typeof IMAGE_KINDS)[number];

/** 원본에서 잘라 쓸 만한 영역. 원본 폭·높이에 대한 0~1 비율이다 (directive.ts 의 ImageCrop 과 같은 축). */
export type ImageRegion = {
  /** 무엇이 담긴 영역인지. 옵션 칩이면 옵션 코드·이름을 그대로 적는다 (예: "MG04 문 펄"). */
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

/** 모델이 돌려주는 픽셀 좌표 영역. 서버가 원본 크기로 나눠 ImageRegion 으로 바꾼다. */
export type PixelRegion = {
  label: string;
  left: number;
  top: number;
  width: number;
  height: number;
};

export type ExtractedImage = {
  fileId: string;
  kind: ImageKind;
  /** 이미지에서 읽어낸 내용을 한국어로 옮긴 것. 본문 배치 판단의 근거가 된다. */
  content: string;
  /** 이 기능 이전에 만든 추출 결과에는 없다. */
  regions?: ImageRegion[];
  /** 원본 픽셀 크기. 작성 단계가 영역이 확대해도 버틸 만큼 큰지 판단하는 데 쓴다. */
  size?: { width: number; height: number };
};

/** 모르는 항목은 빈 문자열. 작성 단계가 그 행을 스펙 표에서 빼고 확인 필요 주석을 남긴다. */
export type ExtractedFacts = {
  brand: string;
  capacity: string;
  origin: string;
  composition: string;
  expiry: string;
};

export type ExtractResult = {
  images: ExtractedImage[];
  facts: ExtractedFacts;
  features: string[];
  usageSteps: string[];
  cautions: string[];
};

const stringArray = { type: 'array', items: { type: 'string' } } as const;

/** Claude 구조화 출력용 스키마. 중간 산출물이 깨지면 작성 단계가 통째로 망가진다. */
export const EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    images: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          fileId: { type: 'string' },
          kind: { type: 'string', enum: [...IMAGE_KINDS] },
          content: { type: 'string' },
          regions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                left: { type: 'integer' },
                top: { type: 'integer' },
                width: { type: 'integer' },
                height: { type: 'integer' },
              },
              required: ['label', 'left', 'top', 'width', 'height'],
              additionalProperties: false,
            },
          },
        },
        required: ['fileId', 'kind', 'content', 'regions'],
        additionalProperties: false,
      },
    },
    facts: {
      type: 'object',
      properties: {
        brand: { type: 'string' },
        capacity: { type: 'string' },
        origin: { type: 'string' },
        composition: { type: 'string' },
        expiry: { type: 'string' },
      },
      required: ['brand', 'capacity', 'origin', 'composition', 'expiry'],
      additionalProperties: false,
    },
    features: stringArray,
    usageSteps: stringArray,
    cautions: stringArray,
  },
  required: ['images', 'facts', 'features', 'usageSteps', 'cautions'],
  additionalProperties: false,
} as const;

const EMPTY_FACTS: ExtractedFacts = {
  brand: '',
  capacity: '',
  origin: '',
  composition: '',
  expiry: '',
};

/**
 * 청크별 추출 결과를 하나로 합친다. facts 는 먼저 값이 채워진 청크가 이긴다 —
 * 같은 항목을 여러 이미지가 말하면 대개 같은 값이고, 다르면 앞 이미지가 대표 컷이다.
 */
export function mergeExtractResults(results: ExtractResult[]): ExtractResult {
  const merged: ExtractResult = {
    images: [],
    facts: { ...EMPTY_FACTS },
    features: [],
    usageSteps: [],
    cautions: [],
  };

  for (const result of results) {
    merged.images.push(...result.images);
    merged.features.push(...result.features);
    merged.usageSteps.push(...result.usageSteps);
    merged.cautions.push(...result.cautions);

    for (const key of Object.keys(merged.facts) as (keyof ExtractedFacts)[]) {
      if (!merged.facts[key] && result.facts?.[key]) {
        merged.facts[key] = result.facts[key];
      }
    }
  }

  return merged;
}

/** 한 이미지에서 쓸 영역 상한. 칩이 8개(4컬러 × 2줄)인 컬러표까지 담는다. */
const MAX_REGIONS_PER_IMAGE = 8;

/** 너무 작은 영역은 확대하면 뭉개진다 — 원본의 4% 미만 변은 버린다. */
const MIN_REGION_SIDE = 0.04;

/**
 * 모델이 준 픽셀 좌표를 원본 크기로 나눠 0~1 비율로 바꾼다. 원본 밖으로 나간 부분은 잘라 내고,
 * 크기를 모르거나 너무 작아진 영역은 버린다 — 좌표는 모델의 추정이라 그대로 믿지 않는다.
 */
export function normalizeRegions(
  regions: PixelRegion[] | undefined,
  size: { width: number; height: number } | undefined,
): ImageRegion[] {
  if (!regions?.length || !size || size.width <= 0 || size.height <= 0) return [];

  return regions
    .flatMap((region) => {
      const left = Math.max(0, region.left);
      const top = Math.max(0, region.top);
      const right = Math.min(size.width, region.left + region.width);
      const bottom = Math.min(size.height, region.top + region.height);

      const x = left / size.width;
      const y = top / size.height;
      const w = (right - left) / size.width;
      const h = (bottom - top) / size.height;
      const label = region.label.trim();

      if (!label || w < MIN_REGION_SIDE || h < MIN_REGION_SIDE) return [];

      return [{ label, x: round4(x), y: round4(y), w: round4(w), h: round4(h) }];
    })
    .slice(0, MAX_REGIONS_PER_IMAGE);
}

function round4(n: number): number {
  return Math.floor(n * 10000) / 10000;
}

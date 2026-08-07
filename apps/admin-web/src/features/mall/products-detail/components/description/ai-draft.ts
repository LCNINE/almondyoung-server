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

export const IMAGE_KINDS = [
  '제품컷',
  '스펙표',
  '사용예시',
  '브랜드소개',
  '구성품',
  '기타',
] as const;

export type ImageKind = (typeof IMAGE_KINDS)[number];

export type ExtractedImage = {
  fileId: string;
  kind: ImageKind;
  /** 이미지에서 읽어낸 내용을 한국어로 옮긴 것. 본문 배치 판단의 근거가 된다. */
  content: string;
};

/** 모르는 항목은 빈 문자열. 작성 단계가 `-` 로 채우고 확인 필요 주석을 남긴다. */
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
        },
        required: ['fileId', 'kind', 'content'],
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

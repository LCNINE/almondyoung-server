import { extractDirectiveImageKeys } from '../../import/services/product-import-image.directive';
import type { AssembledRow } from './bulk-upload.assembler';
import type { RowError, PrefillRow, UploadedBundle } from './bulk-session.types';
import type { PrefillBundle } from './form-export.types';
import type { FlatCategory } from './form-export.snapshot.reader';

/**
 * 수정 행의 옵션 구조가 스냅샷과 **완전히 같은지** 본다.
 *
 * 위험선은 "구조 변경 vs 표시명 변경"이 아니라 정확히 **variant 별 optionValueId 집합이
 * 바뀌는가**다(스펙 §2.4). 바뀌면 `_comboKey` 가 달라져 매칭 인계가 깨지고, 매칭 없는
 * variant 는 `MATCHING_MISSING` 이라 재고 게이팅을 못 받아 **무한 판매된다**.
 *
 * 그래서 옵션값 추가·삭제와 축 변경을 지금 막는다. 여는 것은 additive 지만 열어놓고
 * 좁히는 것은 못 한다(스펙 §3.7).
 */
export function checkOptionStructure(uploaded: UploadedBundle, base: PrefillBundle): RowError[] {
  const errors: RowError[] = [];
  const push = (message: string, sheet: RowError['sheet'] = '옵션') => errors.push({ sheet, rowNumber: 0, message });

  const baseValueKeys = new Set(base.options.map((o) => o.optionValueKey ?? ''));
  const uploadedValueKeys = new Set(uploaded.options.map((o) => o.optionValueKey ?? ''));

  const added = [...uploadedValueKeys].filter((k) => !baseValueKeys.has(k));
  const removed = [...baseValueKeys].filter((k) => !uploadedValueKeys.has(k));
  if (added.length > 0) push(`옵션값을 추가할 수 없습니다: ${added.join(', ')}`);
  if (removed.length > 0) push(`옵션값을 삭제할 수 없습니다: ${removed.join(', ')}`);

  // 한 옵션키에 옵션명이 두 값으로 적히면 어느 쪽이 맞는지 알 수 없다.
  const nameByGroup = new Map<string, string>();
  for (const row of uploaded.options) {
    const groupKey = row.optionKey ?? '';
    const name = row.optionName ?? '';
    const seen = nameByGroup.get(groupKey);
    if (seen === undefined) nameByGroup.set(groupKey, name);
    else if (seen !== name) push(`같은 옵션키에 서로 다른 옵션명이 적혀 있습니다: ${groupKey}`);
  }

  const baseCombos = new Set(base.variants.map((v) => v.combination ?? ''));
  const uploadedCombos = new Set(uploaded.variants.map((v) => v.combination ?? ''));
  const addedCombos = [...uploadedCombos].filter((c) => !baseCombos.has(c));
  const removedCombos = [...baseCombos].filter((c) => !uploadedCombos.has(c));
  if (addedCombos.length > 0) push(`없던 조합을 만들 수 없습니다: ${addedCombos.join(', ')}`, '조합');
  if (removedCombos.length > 0) push(`조합 행을 지울 수 없습니다: ${removedCombos.join(', ')}`, '조합');

  return errors;
}

/** RFC 4122 형태 UUID(대소문자 무관). 버전 자릿수를 특정하지 않는다 — file-service 가 어떤 버전을 찍든 fileId 다. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 이미지 시트의 '원본' 칸 한 값을 분류한다. URL 소싱은 이 스펙이 제거한 기능이라 http(s)
 * 스킴이면 오류다 — v3 의 URL 이미지 파이프라인을 대체하는 결정(MEMORY 참고)과 일치한다.
 */
export function classifyImageSource(sourceValue: string): { kind: 'file_id' | 'file_name' } | { error: string } {
  try {
    const url = new URL(sourceValue);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return { error: 'URL 은 지원하지 않습니다. 파일을 직접 올리거나 파일명을 적어주세요.' };
    }
  } catch {
    // URL 로 파싱되지 않는다 — fileId 나 파일명으로 계속 판정한다.
  }
  if (UUID_RE.test(sourceValue)) return { kind: 'file_id' };
  return { kind: 'file_name' };
}

/** 이미지키를 담을 수 있는 '상품' 시트 열. 변경 여부를 이 단위로 본다(아래 `PrefilledImages`). */
export const IMAGE_BEARING_PRODUCT_KEYS = ['thumbnailImageKey', 'additionalImageKeys', 'description'] as const;
export type ImageBearingProductKey = (typeof IMAGE_BEARING_PRODUCT_KEYS)[number];

/**
 * 수정 행에서 "이 참조는 프리필 그대로다"를 판정할 근거. 신규 행에는 없다(기준이 없다).
 *
 * `keys` 는 `base_snapshot.images` 의 키 집합이다 — 그 키들은 다운로드 시점에 실제 파일
 * (fileId)로 해석돼 있던 것이라, 값이 그대로면 지금도 유효한 참조다.
 */
export interface PrefilledImages {
  keys: Set<string>;
  /** 이번 업로드에서 값이 바뀌지 않은 이미지 관련 열. */
  unchanged: Set<ImageBearingProductKey>;
}

/**
 * 행 하나가 참조하는 이미지키를 찾아 (imageKey, usage) 로 정리한다.
 *
 * 용도는 참조 지점이 정한다 — 대표·부가 칸은 `main`, 본문 디렉티브는 `description`
 * (컨텍스트별 MIME·크기 제약이 달라 같은 파일도 두 용도로 각각 올라간다). 본문에 이미
 * `fileId="…"` 로 박힌 디렉티브는 건드리지 않는다 — 프리필된 상세설명은 그 형태이고
 * 이미 해석된 참조라, `extractDirectiveImageKeys` 가 `imageKey` 속성만 뽑아 자연히
 * 걸러진다.
 *
 * **`prefilled` 를 주면 "안 건드린 프리필 참조"는 오류가 아니다.** 파서는 '이미지' 시트가
 * 통째로 없는 파일을 의도적으로 허용하는데(필수는 '상품' 시트뿐 — bulk-upload.parser.ts:137),
 * 그 관용이 여기서 뒤집혀 있었다: 프리필된 `대표이미지키=IMG-1` 이 그대로인 행까지 "이미지
 * 시트에 없는 이미지키"로 전부 invalid 이 됐다. 이미지를 건드리지도 않은 수정 행이 시트 하나
 * 없앴다고 통째로 죽는 것은 관용의 정반대다.
 *
 * 그 대신 **변경된** 칸은 여전히 시트에서 해석돼야 한다 — 작업자가 키를 새로 적었다면 그
 * 키의 원본이 어디 있는지 파일이 말해야 하고, 아니면 그건 진짜 오타다.
 *
 * 관용으로 통과한 참조는 `refs` 에 **담지 않는다**. `refs` 는 "3단계가 파일을 붙여야 할
 * 목록"이고, 안 바뀐 프리필 이미지는 4단계의 포크가 이미 들고 있어 할 일이 없다(필요하면
 * `base_snapshot.images` 에 fileId 가 그대로 있다).
 */
export function resolveImageRefs(
  row: AssembledRow,
  images: Map<string, { rowNumber: number; sourceValue: string }>,
  prefilled?: PrefilledImages,
): { refs: Array<{ imageKey: string; usage: 'main' | 'description' }>; errors: RowError[] } {
  const refs: Array<{ imageKey: string; usage: 'main' | 'description' }> = [];
  const errors: RowError[] = [];
  const seen = new Set<string>();
  const identifier = row.rowKey || `(행 ${row.rowNumber})`;

  const addRef = (imageKey: string, usage: 'main' | 'description', source: ImageBearingProductKey) => {
    const dedupeKey = `${usage}:${imageKey}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    if (!images.has(imageKey)) {
      if (prefilled?.unchanged.has(source) && prefilled.keys.has(imageKey)) return;
      errors.push({
        sheet: '이미지',
        rowNumber: 0,
        message: `[${identifier}] 이미지 시트에 없는 이미지키를 참조했습니다: ${imageKey}`,
      });
      return;
    }
    refs.push({ imageKey, usage });
  };

  const product = row.bundle.product;

  const thumbnailKey = (product.thumbnailImageKey ?? '').trim();
  if (thumbnailKey !== '') addRef(thumbnailKey, 'main', 'thumbnailImageKey');

  const additionalRaw = (product.additionalImageKeys ?? '').trim();
  if (additionalRaw !== '') {
    for (const key of additionalRaw
      .split('|')
      .map((k) => k.trim())
      .filter((k) => k !== '')) {
      addRef(key, 'main', 'additionalImageKeys');
    }
  }

  for (const key of extractDirectiveImageKeys(product.description)) {
    addRef(key, 'description', 'description');
  }

  return { refs, errors };
}

/**
 * `flattenCategoryTree` 가 만든 이름 경로를 id 배열로 묶는다. 값이 **배열**인 이유는
 * 형제 중 동명 카테고리가 있으면 경로 문자열이 같아지기 때문이다(1단계 검증 보고서 8b 가
 * 앞으로 넘긴 항목) — `resolveCategories` 가 이 모호성을 조회 시점에 판정한다.
 */
export function buildCategoryPathIndex(flat: FlatCategory[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const cat of flat) {
    const existing = index.get(cat.path);
    if (existing) existing.push(cat.id);
    else index.set(cat.path, [cat.id]);
  }
  return index;
}

/**
 * 한 상품의 '카테고리' 시트 행을 이름 경로 → id 로 해석한다.
 *
 * 인덱스 조회가 0개면 경로가 없는 것이고, 2개 이상이면 모호한 것이다 — 어느 쪽도 조용히
 * 하나를 고르지 않는다. 카테고리는 노출 위치를 정하므로 잘못 고르면 발행 후에나 발견된다.
 * `rowNumber` 는 접합 단계에서 잃으므로 0 으로 두고 경로 문자열을 메시지에 싣는다.
 *
 * **0행 조기 return 은 "행 없음 = 변경 없음" 규약의 두 번째 방어선이다.** 첫 번째는
 * `flattenBundle` 이다 — 카테고리 행이 없으면 `category.set` 을 아예 담지 않으므로, 호출부
 * (`validateOne`)의 `'category.set' in fields` 게이트가 이 함수를 부르지도 않는다. 예전에는
 * 그 게이트가 빈 문자열 때문에 열렸고, 그러면 여기 조기 return 이 대표 개수 검사를 건너뛰어
 * **카테고리 전량 해제가 유효한 payload 로 굳었다**. 지금은 두 겹이 같은 방향을 가리킨다.
 */
export function resolveCategories(
  rows: PrefillRow[],
  index: Map<string, string[]>,
): { categoryIds: string[]; primaryCategoryId?: string; errors: RowError[] } {
  if (rows.length === 0) return { categoryIds: [], errors: [] };

  const errors: RowError[] = [];
  const push = (message: string) => errors.push({ sheet: '카테고리', rowNumber: 0, message });

  const categoryIds: string[] = [];
  const seenPaths = new Set<string>();
  let primaryCategoryId: string | undefined;

  // 대표 개수는 "작업자가 대표여부에 Y 를 적었는가"라는, 경로 해석 성공 여부와는 독립된
  // 사실이다. 성공 분기 안에서만 세면 경로 오타 한 건이 "경로 없음" + "대표 0개" 두 오류로
  // 갈라져 보이고, 작업자가 엉뚱한 다른 행에 Y 를 하나 더 붙이는 오조치를 유도한다
  // (Task 7 리뷰 라운드 1). 그래서 아래 루프의 continue 분기보다 먼저, 입력 행 전체의
  // 원시 값에서 센다 — 중복·미해석·모호 여부와 무관하게 "몇 행이 Y 라고 적었는가"만 본다.
  const primaryCount = rows.filter((row) => (row.isPrimary ?? '').trim() === 'Y').length;

  for (const row of rows) {
    const path = (row.categoryPath ?? '').trim();
    const isPrimary = (row.isPrimary ?? '').trim() === 'Y';

    if (seenPaths.has(path)) {
      push(`같은 카테고리가 중복 지정되었습니다: ${path}`);
      continue;
    }
    seenPaths.add(path);

    const ids = index.get(path) ?? [];
    if (ids.length === 0) {
      push(`카테고리 경로를 찾을 수 없습니다: ${path}`);
      continue;
    }
    if (ids.length > 1) {
      push(`카테고리 경로가 모호합니다(같은 이름의 카테고리가 둘 이상): ${path}`);
      continue;
    }

    // categoryIds·primaryCategoryId 는 해석에 성공한 행에서만 채운다 — 대표 개수 판정과
    // 달리, 이 두 값은 실제로 커밋에 쓰일 값이라 해석되지 않은 행을 반영하면 안 된다.
    categoryIds.push(ids[0]);
    if (isPrimary) primaryCategoryId = ids[0];
  }

  if (primaryCount !== 1) {
    push(`대표 카테고리는 정확히 1개여야 합니다 (현재 ${primaryCount}개).`);
  }

  return { categoryIds, primaryCategoryId, errors };
}

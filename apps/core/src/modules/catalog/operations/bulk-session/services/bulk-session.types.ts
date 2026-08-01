import type { PrefillBundle, PrefillRow } from './form-export.types';

/** 필드경로 → 셀 문자열. 세 상태(base·mine·current) 가 전부 이 모양이다. */
export type FlatFields = Record<string, string>;

export type ConflictMap = Record<string, { base: string; mine: string; current: string }>;
export type ConflictDecision = 'overwrite' | 'skip';
export type ConflictDecisionMap = Record<string, ConflictDecision>;

/** 업로드 시트에 **실제로 존재한** 열(ColumnDef.key) 집합. §F2 의 "열 삭제 ≠ 비움" 규칙이 이걸 쓴다. */
export interface PresentColumns {
  products: Set<string>;
  options: Set<string>;
  variants: Set<string>;
  categories: Set<string>;
  constraints: Set<string>;
}

/** 상품 하나가 워크북에서 차지하는 행 전량. 업로드 쪽 shape 은 PrefillBundle 에서 images 만 뺀 것이다. */
export type UploadedBundle = Pick<PrefillBundle, 'product' | 'options' | 'variants' | 'categories' | 'constraint'>;

/** 행 오류 하나. 어느 시트 몇 행인지까지 보여줘야 작업자가 파일에서 그 자리를 찾는다. */
export interface RowError {
  sheet: '상품' | '옵션' | '조합' | '카테고리' | '구매제약' | '이미지';
  rowNumber: number;
  message: string;
}

/**
 * items.input 의 shape — 업로드 원본(정규화 후)이다.
 *
 * `present` 가 `Set` 이 아니라 **배열**인 것이 중요하다. 이 값은 jsonb 로 저장되는데
 * `JSON.stringify(new Set(['a']))` 는 `{}` 다 — Set 을 그대로 담으면 왕복 후 "존재한 열이
 * 하나도 없다"가 되어 모든 수정 행의 변경분이 통째로 사라진다. 되읽는 쪽에서
 * `toPresentColumns` 로 Set 으로 되살린다.
 */
export interface BulkItemInput {
  bundle: UploadedBundle;
  present: {
    products: string[];
    options: string[];
    variants: string[];
    categories: string[];
    constraints: string[];
  };
  /** 접합 단계에서 이미 붙은 행 오류(상품키 누락·중복, 구매제약 2행 등). */
  errors: RowError[];
}

export function toPresentColumns(present: BulkItemInput['present']): PresentColumns {
  return {
    products: new Set(present.products),
    options: new Set(present.options),
    variants: new Set(present.variants),
    categories: new Set(present.categories),
    constraints: new Set(present.constraints),
  };
}

export function isBulkItemInput(value: unknown): value is BulkItemInput {
  if (typeof value !== 'object' || value === null) return false;
  // 타입을 좁혀서 필드 존재 검사만 한다. 실제 판정은 아래 typeof·Array.isArray 검사들.
  const v = value as Partial<BulkItemInput>;
  return (
    typeof v.bundle === 'object' &&
    v.bundle !== null &&
    typeof v.present === 'object' &&
    v.present !== null &&
    Array.isArray(v.present.products) &&
    Array.isArray(v.errors)
  );
}

/**
 * items.payload 의 shape. 4단계가 이걸 읽어 draft 를 만든다.
 *
 * **옵션 구조는 별도 필드로 담지 않는다.** 여기에 `optionPlan` 선언이 있었는데 2단계의 어느
 * 경로도 채우지 않아, 4단계가 그걸 믿고 시작하면 항상 `undefined` 를 받는 함정이었다.
 * 4단계는 `fields` 의 스코프 키(`optionGroup:<옵션키>.*` / `optionValue:<옵션값키>.*`)에서
 * 구조를 복원한다 — 되파싱은 `parseFieldPath`(bulk-session.fields.ts)가 한 곳에서 판다.
 * (수정 행은 애초에 옵션 구조를 바꿀 수 없다 — 스펙 §3.7, `checkOptionStructure`.)
 */
export interface BulkItemPayload {
  /** 적용할 필드경로 → 값. update 는 변경분만, create 는 입력 전체. */
  fields: FlatFields;
  /** '카테고리경로' 를 해석한 결과. category.set 이 fields 에 있을 때만 채워진다. */
  categoryIds?: string[];
  primaryCategoryId?: string;
  /** 이 행이 참조하는 (imageKey, usage). 3단계가 fileId 로 해석한다. */
  imageRefs?: Array<{ imageKey: string; usage: 'main' | 'description' }>;
}

/**
 * jsonb 로 왕복한 값의 가드. v3 의 `isProductRecord` 와 같은 이유로 둔다 — 롤링 배포에서
 * 옛 코드가 쓴 payload 를 새 코드가 읽을 수 있고, 그때 죽는 대신 그 행만 실패시켜야 한다.
 */
export function isPrefillBundle(value: unknown): value is PrefillBundle {
  if (typeof value !== 'object' || value === null) return false;
  // 타입을 좁혀서 필드 존재 검사만 한다. 실제 판정은 아래 typeof·Array.isArray 검사들.
  const v = value as Partial<PrefillBundle>;
  return (
    typeof v.product === 'object' &&
    v.product !== null &&
    Array.isArray(v.options) &&
    Array.isArray(v.variants) &&
    Array.isArray(v.categories)
  );
}

/**
 * `product_bulk_items.base_snapshot` 컬럼의 shape — 양식 잡 items 의 스냅샷 번들에
 * **권위 있는** `pricing_editable` 을 하나 얹은 것이다.
 *
 * 왜 얹는가: "이 상품의 가격을 임포트로 표현할 수 있는가"는 양식 다운로드 시점에 얼린
 * 판정이고, 그 판정의 원본은 `product_form_export_items.pricing_editable` 컬럼이다. 검증기가
 * 그 사실을 스냅샷 판매가 셀이 센티넬 문자열인지로 **역산**하면, `PRICING_SENTINEL` 을 언젠가
 * 바꾸는 순간 이미 저장된 스냅샷 전부에서 판정이 조용히 뒤집힌다. 파싱 슬라이스가 컬럼을
 * 하나 더 읽어 여기 실어두면 그 역산이 통째로 사라진다.
 *
 * **optional 인 이유**는 롤링 배포다 — 이 필드를 싣기 전 코드가 쓴 행이 검증 슬라이스에
 * 남아 있을 수 있고, 그때는 검증기가 옛 역산으로 폴백한다(bulk-session-job.manager.ts).
 */
export interface BulkBaseSnapshot extends PrefillBundle {
  pricingEditable?: boolean;
}

/**
 * `base_snapshot` 의 가드. 구조 검사는 `isPrefillBundle` 과 **같다** — 더한 필드가 optional
 * 이라 존재를 요구할 수 없고, 요구하면 위 주석의 롤링 배포 폴백이 막힌다. 이름을 따로 둔
 * 것은 호출부에서 "이건 export 스냅샷이 아니라 base_snapshot 이다"가 보이게 하기 위해서다.
 */
export function isBulkBaseSnapshot(value: unknown): value is BulkBaseSnapshot {
  return isPrefillBundle(value);
}

export function isBulkItemPayload(value: unknown): value is BulkItemPayload {
  if (typeof value !== 'object' || value === null) return false;
  // 타입을 좁혀서 필드 존재 검사만 한다. 실제 판정은 아래 typeof 검사.
  const v = value as Partial<BulkItemPayload>;
  return typeof v.fields === 'object' && v.fields !== null;
}

export type { PrefillRow };

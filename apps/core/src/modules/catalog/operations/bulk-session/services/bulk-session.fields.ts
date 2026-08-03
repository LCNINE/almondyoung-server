import {
  CATEGORY_COLUMNS,
  CONSTRAINT_COLUMNS,
  OPTION_COLUMNS,
  PRODUCT_COLUMNS,
  VARIANT_COLUMNS,
} from './form-export.sheets';
import type { FlatFields, PresentColumns, UploadedBundle } from './bulk-session.types';

/** 옵션 시트에서 그룹 스코프에 속한 열. 정체성 키는 제외한다. */
const OPTION_GROUP_KEYS = new Set(['optionName', 'optionSortOrder']);
/** 옵션 시트에서 값 스코프에 속한 열. 정체성 키는 제외한다. 나머지는 모두 여기로 흘러간다. */
const OPTION_IDENTITY_KEYS = new Set(['rowKey', 'optionKey', 'optionValueKey']);

const has = (present: Set<string> | undefined, key: string): boolean => present === undefined || present.has(key);

/**
 * 번들을 `필드경로 → 문자열` 평면 맵으로 눕힌다.
 *
 * `present` 를 주면 **그 시트에 실제로 있던 열만** 담는다. 작업자가 열을 통째로 지운 것은
 * "이 필드는 이번에 안 건드림"이지 "비움"이 아니다 — 이 구분이 없으면 열 하나를 지운
 * 파일이 전 행의 그 필드를 날린다. 프리필(스냅샷·현재)에는 present 를 주지 않는다.
 *
 * **열 삭제와 행 삭제는 다른 축이고, 둘 다 "변경 없음"이다.** 열 부재는 `present`(업로드
 * 전용)로, 하위 시트의 행 부재는 아래 카테고리·구매제약 분기로 다룬다 — 후자는 `present`
 * 와 달리 **세 상태(base·mine·current)에 모두 같은 규칙으로** 걸린다. 비대칭을 만들지 않는
 * 근거: diff 는 `base[k] ?? ''` / `current[k] ?? ''` 로 읽으므로(bulk-session.diff.ts:12,27)
 * base·current 쪽에서는 "키를 빼는 것"과 "빈 문자열로 담는 것"이 **완전히 같은 결과**다.
 * 즉 프리필 쪽만 예외로 두어 얻는 것이 없고, 세 상태가 같은 함수를 통과한다는 이 설계의
 * 뼈대(§F2)만 깨진다.
 */
export function flattenBundle(bundle: UploadedBundle, present?: PresentColumns): FlatFields {
  const out: FlatFields = {};

  for (const col of PRODUCT_COLUMNS) {
    if (col.key === 'rowKey') continue; // 행 정체성이지 값이 아니다
    if (!has(present?.products, col.key)) continue;
    out[`product.${col.key}`] = bundle.product[col.key] ?? '';
  }

  for (const row of bundle.options) {
    const groupKey = row.optionKey ?? '';
    const valueKey = row.optionValueKey ?? '';
    for (const col of OPTION_COLUMNS) {
      if (OPTION_IDENTITY_KEYS.has(col.key)) continue; // 정체성이지 값이 아니다
      if (!has(present?.options, col.key)) continue;
      // 그룹 스코프 열
      if (OPTION_GROUP_KEYS.has(col.key)) {
        out[`optionGroup:${groupKey}.${col.key}`] = row[col.key] ?? '';
      } else {
        // 모든 다른 열은 값 스코프로 간다 (새 열 추가 시 자동 포함)
        out[`optionValue:${valueKey}.${col.key}`] = row[col.key] ?? '';
      }
    }
  }

  for (const row of bundle.variants) {
    const combo = row.combination ?? '';
    for (const col of VARIANT_COLUMNS) {
      if (col.key === 'rowKey' || col.key === 'combination') continue; // 정체성이지 값이 아니다
      // combinationLabel 은 사람이 읽으라고 둔 읽기 전용 참고 열일 뿐 비교 대상이 아니다 (스펙 §3.4).
      if (col.key === 'combinationLabel') continue;
      if (!has(present?.variants, col.key)) continue;
      out[`variant:${combo}.${col.key}`] = row[col.key] ?? '';
    }
  }

  // 카테고리는 **집합**이다. 행 하나하나를 필드로 두면 순서 하나 바뀐 것이 전부 변경으로
  // 보인다. 정렬 조인한 단일 필드로 두면 "카테고리 배정이 바뀌었다" 한 줄로 뜬다.
  // 대표는 `*` 로 표시한다 — 대표만 옮겨도 변경으로 잡혀야 한다.
  //
  // **행이 하나도 없으면 이 필드를 아예 담지 않는다.** 계약은 "카테고리 행 없음 = 카테고리
  // 변경 없음"이다(bulk-upload.assembler.ts 의 행 삭제 규약). 빈 문자열로 담으면, 1,000행
  // 양식에서 자기가 손댈 30건만 남기려고 하위 시트를 필터한 파일이 나머지 상품의 카테고리를
  // **전량 해제**하는 변경분을 만든다 — 노출 위치가 사라지는 종류라 발행 후에나 발견된다.
  if (bundle.categories.length > 0 && has(present?.categories, 'categoryPath')) {
    out['category.set'] = bundle.categories
      .map((row) => `${row.categoryPath ?? ''}${(row.isPrimary ?? '') === 'Y' ? '*' : ''}`)
      .sort()
      .join('|');
  }

  // 구매제약도 같다 — 행이 없으면 "변경 없음"이고, 해제는 값 칸을 비운 **행**으로 표현한다.
  const constraint = bundle.constraint;
  if (constraint) {
    for (const col of CONSTRAINT_COLUMNS) {
      if (col.key === 'rowKey') continue;
      if (!has(present?.constraints, col.key)) continue;
      out[`constraint.${col.key}`] = constraint[col.key] ?? '';
    }
  }

  return out;
}

const LABEL_BY_KEY = new Map<string, string>([
  ...PRODUCT_COLUMNS.map((c) => [`product.${c.key}`, c.label] as const),
  ...OPTION_COLUMNS.map((c) => [c.key, c.label] as const),
  ...VARIANT_COLUMNS.map((c) => [c.key, c.label] as const),
  ...CATEGORY_COLUMNS.map((c) => [c.key, c.label] as const),
  ...CONSTRAINT_COLUMNS.map((c) => [`constraint.${c.key}`, c.label] as const),
  ['category.set', '카테고리'],
]);

/** 스코프가 붙는 필드경로의 세 조각. `product.*`·`constraint.*`·`category.set` 은 스코프가 없다. */
export interface ParsedFieldPath {
  scope: 'optionGroup' | 'optionValue' | 'variant';
  /** 옵션키 / 옵션값키 / 조합키. **빈 문자열일 수 있다** — 아래 정규식 주석 참조. */
  scopeKey: string;
  /** ColumnDef.key (예: `optionName`, `basePrice`). */
  key: string;
}

/**
 * `optionGroup:<옵션키>.<열>` / `optionValue:<옵션값키>.<열>` / `variant:<조합>.<열>` 을
 * 세 조각으로 되판다. 그 형태가 아니면 null(= 스코프 없는 평범한 경로).
 *
 * **export 인 이유는 4단계다.** payload 의 `fields` 만으로 옵션 구조를 복원하려면 이 되파싱이
 * 필요한데, 정규식을 그쪽에 다시 적으면 두 벌이 어긋나는 순간(예: 아래 빈 스코프 처리)
 * 조용히 갈린다. 한 곳에서 판다.
 *
 * 스코프 부분이 `(.*)` 인 것이 중요하다 — **옵션 없는 상품의 `combination` 은 빈 문자열이
 * 계약**이고(form-export.snapshot.reader.ts:263-267, 스펙 오너 확정) 그 경로는
 * `variant:.basePrice` 가 된다. `(.+)` 로 최소 1자를 요구하면 그 흔한 상품의 조합 필드가
 * 전부 매칭에 실패해 프리뷰에 원시 경로가 그대로 뜬다.
 */
export function parseFieldPath(path: string): ParsedFieldPath | null {
  const scoped = /^(optionGroup|optionValue|variant):(.*)\.([^.]+)$/.exec(path);
  if (!scoped) return null;
  const [, scope, scopeKey, key] = scoped;
  // 정규식 첫 그룹이 세 리터럴만 매칭하므로 이 좁힘은 안전하다. 유니온 리터럴로 되돌리는
  // 다른 방법(리터럴 배열 + includes)은 같은 사실을 더 길게 적을 뿐이다.
  return { scope: scope as ParsedFieldPath['scope'], scopeKey, key };
}

/**
 * 필드경로를 사람이 읽는 라벨로 바꾼다. 화면(3·4단계 admin-web)이 매핑을 또 들고 있지
 * 않도록 서버가 준다 — 헤더 라벨이 바뀌면 한 곳만 고치면 된다.
 */
export function fieldLabel(path: string): string {
  const direct = LABEL_BY_KEY.get(path);
  if (direct) return direct;

  const parsed = parseFieldPath(path);
  if (parsed) {
    const label = LABEL_BY_KEY.get(parsed.key) ?? parsed.key;
    const noun = parsed.scope === 'optionGroup' ? '옵션' : parsed.scope === 'optionValue' ? '옵션값' : '조합';
    // 스코프키가 비면(옵션 없는 상품의 단일 기본 조합) 접미를 생략한다 — `판매가 (조합 )`
    // 처럼 빈 자리가 남으면 사람이 "무엇의 조합인지 안 보인다"고 읽는다.
    return parsed.scopeKey === '' ? `${label} (${noun})` : `${label} (${noun} ${parsed.scopeKey})`;
  }
  return path;
}

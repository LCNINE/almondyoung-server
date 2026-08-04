import { parseFieldPath } from './bulk-session.fields';
import type { FlatFields, PrefillRow, RowError } from './bulk-session.types';
import type { AddOptionDto, ModifyOptionDisplayDto } from '../../../catalog.types';

/**
 * 옵션 시트 → 상품 도메인 `optionDiff` 입력 변환기. 순수 함수만 담는다 — DB 를 타지 않는다.
 *
 * 워크북의 옵션키는 진짜 DB UUID 다(수정 행에서만). 신규 행에서는 작업자가 지은 임의 문자열
 * 이라 `buildOptionAdd` 가 `valueNameByKey` 를 남겨, 옵션을 만든 뒤 그 이름으로 실제 id 를
 * 되찾을 수 있게 한다.
 */

/** 워크북 옵션값키 하나가 담은 정보. */
interface ParsedValue {
  key: string;
  displayName: string;
  colorCode?: string;
  sortOrder: number;
}

/** 워크북 옵션키 하나가 담은 정보 — 등장 순서대로 값들을 들고 있다. */
interface ParsedGroup {
  key: string;
  displayName: string;
  sortOrder: number;
  values: ParsedValue[];
}

interface ParsedOptionSheet {
  /** 등장 순서를 보존한 그룹 목록. */
  groups: ParsedGroup[];
  /** 옵션값키 → 그 값이 속한 것으로 관측된 그룹키 집합. 크기가 1 초과면 값키가 두 그룹에 걸친 것. */
  valueGroupKeys: Map<string, Set<string>>;
  /** `variant:<조합>` 스코프에서 관측한 조합 문자열 그대로(아직 `+` 로 안 쪼갬). */
  comboKeys: Set<string>;
}

/** 빈칸이면 0, 숫자가 아니어도 0(컬럼이 `integer notNull default 0` — catalog.schema.ts:403,432). */
function toSortOrder(raw: string): number {
  if (raw === '') return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 그룹·값·조합 구조를 복원한다. `buildOptionAdd` 와 `checkCreateStructure` 가 공유한다 —
 * 되파싱 로직을 두 벌 두면(bulk-session.fields.ts:119 의 정규식 이유와 같은 근거로) 조용히
 * 갈린다.
 *
 * **그룹 귀속·그룹 순서·값 순서는 전부 `optionRows`(업로드 번들의 옵션 행, `bundle.options`)
 * 에서 온다** — 한 행이 `optionKey` 와 `optionValueKey` 를 같이 들고 있어(`form-export.sheets.ts:66,68`
 * 의 OPTION_COLUMNS) 추론이 필요 없다.
 *
 * (리뷰 2026-08-03 로 확정된 결함) 예전 구현은 `fields` 의 **키 삽입 순서**에서 "마지막으로
 * 등장한 그룹 키"를 추론해 값을 붙였는데, 이건 옵션 시트 행이 그룹별로 뭉쳐 있을 때만 맞다.
 * JS 객체는 이미 있는 키를 재대입해도 삽입 위치가 안 움직이므로, 행이 (색상,빨강) →
 * (사이즈,S) → (색상,파랑) 순이면 `optionValue:C2.*`(파랑) 를 만날 시점의 "마지막 그룹"이
 * `S` 로 잘못 관측된다 — 신규 상품은 빈 템플릿에 사람이 직접 적으므로 행 순서를 강제할
 * 것이 없어 이 편집이 흔하다. 그래서 그룹 귀속은 `fields` 가 아니라 `optionRows` 에서
 * 직접 읽는다.
 *
 * **값(표시명·색상·정렬)은 계속 `fields` 에서 읽는다** — 그래야 열 삭제(`present`) 규약이
 * 유지된다(`flattenBundle` 이 없는 열을 아예 안 담는 것이 "안 건드림"의 표현이다).
 */
function parseOptionSheet(fields: FlatFields, optionRows: PrefillRow[]): ParsedOptionSheet {
  const groupByKey = new Map<string, ParsedGroup>();
  const groups: ParsedGroup[] = [];
  const valueGroupKeys = new Map<string, Set<string>>();
  const comboKeys = new Set<string>();

  const groupFor = (key: string): ParsedGroup => {
    const existing = groupByKey.get(key);
    if (existing) return existing;
    const created: ParsedGroup = { key, displayName: '', sortOrder: 0, values: [] };
    groupByKey.set(key, created);
    groups.push(created);
    return created;
  };

  // 1) 그룹 귀속·순서·값 순서 — optionRows 가 유일한 권위 있는 출처다.
  for (const row of optionRows) {
    const groupKey = row.optionKey ?? '';
    const valueKey = row.optionValueKey ?? '';
    // 옵션키·옵션값키가 빈 행은 건너뛴다 — 그 자체는 상위 검증기가 이미 잡는다.
    if (groupKey === '' || valueKey === '') continue;

    const group = groupFor(groupKey);

    let seenGroups = valueGroupKeys.get(valueKey);
    if (!seenGroups) {
      seenGroups = new Set();
      valueGroupKeys.set(valueKey, seenGroups);
    }
    seenGroups.add(groupKey);

    if (!group.values.some((v) => v.key === valueKey)) {
      group.values.push({ key: valueKey, displayName: '', sortOrder: 0 });
    }
  }

  // 2) 실제 표시값은 fields 에서 — parseFieldPath 로 되파싱해 해당 그룹/값 객체에 반영한다.
  for (const path of Object.keys(fields)) {
    const parsed = parseFieldPath(path);
    if (!parsed) continue;
    const raw = (fields[path] ?? '').trim();

    if (parsed.scope === 'variant') {
      comboKeys.add(parsed.scopeKey);
      continue;
    }

    if (parsed.scope === 'optionGroup') {
      const group = groupByKey.get(parsed.scopeKey);
      if (!group) continue; // optionRows 에 없는 그룹키 — 있을 수 없지만 방어적으로 무시
      if (parsed.key === 'optionName') group.displayName = raw;
      else if (parsed.key === 'optionSortOrder') group.sortOrder = toSortOrder(raw);
      continue;
    }

    // optionValue 스코프 — 그 값키가 속한 것으로 관측된 그룹(들) 전부에 반영한다.
    const groupKeys = valueGroupKeys.get(parsed.scopeKey);
    if (!groupKeys) continue;
    for (const groupKey of groupKeys) {
      const group = groupByKey.get(groupKey);
      if (!group) continue;
      const value = group.values.find((v) => v.key === parsed.scopeKey);
      if (!value) continue;
      if (parsed.key === 'optionValueName') value.displayName = raw;
      else if (parsed.key === 'colorCode') {
        if (raw !== '') value.colorCode = raw;
      } else if (parsed.key === 'valueSortOrder') value.sortOrder = toSortOrder(raw);
    }
  }

  return { groups, valueGroupKeys, comboKeys };
}

/** 신규 행에서 조립한 옵션 추가 계획. */
export interface OptionPlan {
  /** 워크북 옵션키 → { 표시명, 정렬, 값들 } — 신규 행에서만 채워진다. */
  add: AddOptionDto[];
  /** 신규 행: 워크북 옵션값키 → (그룹표시명, 값표시명). 생성 후 실제 id 를 찾는 열쇠(F7). */
  valueNameByKey: Map<string, { groupName: string; valueName: string }>;
}

/**
 * 신규 행의 옵션 시트 필드를 `OptionDiff.add` 로 조립한다. 구조 검증은 하지 않는다 —
 * `checkCreateStructure` 가 별도로 담당한다.
 *
 * @param optionRows 이 상품의 업로드 번들 옵션 행(`BulkItemInput['bundle']['options']`) —
 * 그룹 귀속·순서의 유일한 권위 있는 출처다(`parseOptionSheet` 참조).
 */
export function buildOptionAdd(fields: FlatFields, optionRows: PrefillRow[]): { plan: OptionPlan; errors: RowError[] } {
  const { groups } = parseOptionSheet(fields, optionRows);
  const add: AddOptionDto[] = [];
  const valueNameByKey = new Map<string, { groupName: string; valueName: string }>();

  for (const group of groups) {
    const values: AddOptionDto['values'] = group.values.map((value) => {
      const entry: AddOptionDto['values'][number] = { displayName: value.displayName, sortOrder: value.sortOrder };
      if (value.colorCode !== undefined) entry.colorCode = value.colorCode;
      valueNameByKey.set(value.key, { groupName: group.displayName, valueName: value.displayName });
      return entry;
    });
    add.push({ displayName: group.displayName, sortOrder: group.sortOrder, values });
  }

  return { plan: { add, valueNameByKey }, errors: [] };
}

/**
 * 신규 행 옵션 구조를 검증한다 — 스펙에 없던 갭. **(a)(b)(c)(d) 를 검사한다:** (a) 한 그룹 안
 * 값 표시명 중복, (b) 같은 값키가 두 그룹에 걸침, (c) `variant:<조합>` 이 참조하는 옵션값키가
 * 옵션 시트에 없음, (d) 같은 조합이 두 번 제출됨.
 *
 * (d) 는 `fields`(FlatFields) 만으로는 관측 불가능하다 — `flattenBundle` 이
 * `variant:<조합>.<열>` 을 평면 맵의 키로 쓰므로(bulk-session.fields.ts:57-66), 같은 조합을
 * 쓴 두 원본 행이 있어도 평면화 단계에서 뒤 행의 값이 앞 행의 값을 덮어써 "몇 번 나왔는지"가
 * 이미 사라진다(마지막 값이 조용히 이긴다, 부록 C.4). 그래서 평면화 **이전** 원본
 * `bundle.variants` 배열을 `variantRows` 로 따로 받아 그 위에서 직접 중복을 센다.
 *
 * @param optionRows `buildOptionAdd` 와 같다 — 그룹 귀속의 유일한 권위 있는 출처.
 * @param variantRows 이 상품의 업로드 번들 조합 행(`BulkItemInput['bundle']['variants']`) —
 * (d) 검사의 유일한 출처. 옵션 없는 상품은 조합 문자열이 빈 값(`''`)이고 그런 행은 정확히
 * 하나여야 한다는 계약이라(`resolveCreatedCombos`, bulk-draft.applier.ts:223-226), 빈 문자열도
 * 다른 조합과 동일하게 중복 검사 대상이다.
 */
export function checkCreateStructure(
  fields: FlatFields,
  optionRows: PrefillRow[],
  variantRows: PrefillRow[],
): RowError[] {
  const { groups, valueGroupKeys, comboKeys } = parseOptionSheet(fields, optionRows);
  const errors: RowError[] = [];
  const push = (message: string): void => {
    errors.push({ sheet: '옵션', rowNumber: 0, message });
  };

  const knownValueKeys = new Set<string>();
  for (const group of groups) {
    const nameCounts = new Map<string, number>();
    for (const value of group.values) {
      knownValueKeys.add(value.key);
      if (value.displayName === '') continue;
      nameCounts.set(value.displayName, (nameCounts.get(value.displayName) ?? 0) + 1);
    }
    for (const [name, count] of nameCounts) {
      if (count > 1) push(`한 옵션 그룹 안에서 옵션값 표시명이 중복되었습니다: ${name}`);
    }
  }

  for (const [valueKey, groupKeys] of valueGroupKeys) {
    if (groupKeys.size > 1) push(`옵션값키가 여러 옵션 그룹에 걸쳐 있습니다: ${valueKey}`);
  }

  for (const combo of comboKeys) {
    if (combo === '') continue; // 옵션 없는 상품의 계약(variant:.) — 검사 제외
    for (const part of combo.split('+')) {
      if (!knownValueKeys.has(part)) {
        push(`조합이 옵션 시트에 없는 옵션값키를 참조합니다: ${part} (조합: ${combo})`);
      }
    }
  }

  // (d) 같은 조합이 두 번 제출됐는지 — 평면화 이전 원본 행에서 직접 센다(함수 독스트링 참조).
  // 빈 문자열(옵션 없는 상품)도 다른 조합과 동일하게 취급한다: 그런 상품은 조합 행이
  // 정확히 하나여야 정상이고, 둘 이상이면 뒤 값이 앞 값을 조용히 덮어쓰는 같은 사고다.
  const seenCombos = new Set<string>();
  const duplicatedCombos = new Set<string>();
  for (const row of variantRows) {
    const combo = row.combination ?? '';
    if (seenCombos.has(combo)) duplicatedCombos.add(combo);
    else seenCombos.add(combo);
  }
  for (const combo of duplicatedCombos) {
    errors.push({
      sheet: '조합',
      rowNumber: 0,
      message: `같은 조합이 두 번 이상 적혀 있습니다: ${combo || '(옵션 없음)'}`,
    });
  }

  return errors;
}

/**
 * 수정 행의 옵션 시트 필드를 `OptionDiff.modifyDisplay` 로 조립한다. 값 스코프 변경은
 * 소속 그룹을 필드경로에서 알 수 없으므로 `optionGroupId: ''` 로 담고 값 하나당 항목을
 * 하나씩 낸다 — 호출부(적용기)가 DB 를 읽어 실제 소속을 채운다.
 */
export function buildOptionModify(fields: FlatFields): { modify: ModifyOptionDisplayDto[]; errors: RowError[] } {
  const errors: RowError[] = [];
  const push = (message: string): void => {
    errors.push({ sheet: '옵션', rowNumber: 0, message });
  };

  const entries = new Map<string, ModifyOptionDisplayDto>();
  // 값 스코프 항목의 `values[0]` 을 직접 들고 있는다 — `entry.values` 를 매번 다시 인덱싱하면
  // TypeScript 가 optional 배열의 좁힘을 유지하지 못한다(값 하나당 항목 하나이므로 안전하게
  // 참조 하나로 대체할 수 있다).
  const valueEntries = new Map<string, NonNullable<ModifyOptionDisplayDto['values']>[number]>();

  for (const path of Object.keys(fields)) {
    const parsed = parseFieldPath(path);
    if (!parsed || parsed.scope === 'variant') continue;
    const raw = (fields[path] ?? '').trim();

    if (parsed.scope === 'optionGroup') {
      const mapKey = `group:${parsed.scopeKey}`;
      let entry = entries.get(mapKey);
      if (!entry) {
        entry = { optionGroupId: parsed.scopeKey };
        entries.set(mapKey, entry);
      }
      if (parsed.key === 'optionName') {
        if (raw === '') push('옵션 그룹 표시명은 비울 수 없습니다.');
        else entry.displayName = raw;
      } else if (parsed.key === 'optionSortOrder') {
        entry.sortOrder = toSortOrder(raw);
      }
      continue;
    }

    // optionValue 스코프 — 값 하나당 항목을 하나씩 낸다(같은 값키를 다시 만나면 항목을 갱신).
    const mapKey = `value:${parsed.scopeKey}`;
    let valueEntry = valueEntries.get(parsed.scopeKey);
    if (!valueEntry) {
      valueEntry = { optionValueId: parsed.scopeKey };
      valueEntries.set(parsed.scopeKey, valueEntry);
      entries.set(mapKey, { optionGroupId: '', values: [valueEntry] });
    }

    if (parsed.key === 'optionValueName') {
      if (raw === '') push('옵션값 표시명은 비울 수 없습니다.');
      else valueEntry.displayName = raw;
    } else if (parsed.key === 'colorCode') {
      // 빈칸은 undefined(미변경) 가 아니라 명시적으로 지운다 — core 가 `!== undefined` 로
      // 처리하므로(product-masters.service.ts:1620) undefined 로 두면 조용히 무시된다. 컬럼이
      // nullable varchar(7) 이라 실제로 지워지고, `ModifyOptionDisplayDto.values[].colorCode`
      // 도 그 값을 표현하도록 `string | null` 로 넓혀 두었다(catalog.types.ts:147, 승인된 예외).
      valueEntry.colorCode = raw === '' ? null : raw;
    } else if (parsed.key === 'valueSortOrder') {
      valueEntry.sortOrder = toSortOrder(raw);
    }
  }

  return { modify: [...entries.values()], errors };
}

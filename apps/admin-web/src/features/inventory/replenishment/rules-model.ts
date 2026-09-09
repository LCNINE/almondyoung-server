import type {
  DemandGrade,
  GradeRuleDto,
  GradeRulesDto,
  LeadTimeObservationDto,
  LeadTimeRuleDto,
  OverrideMode,
  ReplenishmentSettingsDto,
  SkuOverrideRowDto,
  UpdateReplenishmentSettingsDto,
  UpsertLeadTimeRuleDto,
  UpsertSkuOverrideDto,
} from '@/lib/types/dto/inventory';
import { serverMessageOf } from './suggestion-model';

export type SettingsField = keyof Omit<
  ReplenishmentSettingsDto,
  'key' | 'updatedAt'
>;
export type SettingsForm = Record<SettingsField, string>;
export type Reflection = 'immediate' | 'recompute';

/**
 * 스펙 §6 「반영 시점」. 이 문구는 **필드마다가 아니라 절(섹션)마다 한 번** 낸다 —
 * 20개 입력에 전문을 붙이면 배지가 라벨보다 길어지고 정작 차이가 안 읽힌다.
 */
export const REFLECTION_LABELS: Record<Reflection, string> = {
  immediate: '저장 즉시 제안에 반영',
  recompute: '다음 야간 재계산(또는 지금 재계산)에 반영',
};

/**
 * 필드별 제약은 **서버 `UpdateReplenishmentSettingsDto` 의 class-validator 와 같은 범위**다.
 * 클라가 느슨하면 통과시킨 값이 서버에서 400 이 되고 영어 배열 메시지가 그대로 토스트에 뜬다.
 */
export type SettingsFieldSpec = {
  key: SettingsField;
  label: string;
  reflection: Reflection;
  /** 비워 두면 null 로 저장된다(서버가 nullable 로 받는 필드) */
  nullable?: boolean;
  integer?: boolean;
  date?: boolean;
  /** 포함 하한 (`@Min`) */
  min?: number;
  /** 포함 상한 (`@Max`) */
  max?: number;
  /** 배타 하한 (`@IsPositive` 등) */
  exclusiveMin?: number;
};

/** 순서 = 화면 순서. reflection 은 스펙 §6 「반영 시점」. */
export const SETTINGS_FIELDS: SettingsFieldSpec[] = [
  // ── 프로필을 바꾸는 입력 (다음 재계산에 반영) ──
  {
    key: 'adiThreshold',
    label: 'ADI 임계 (기본 1.32)',
    reflection: 'recompute',
    exclusiveMin: 0,
  },
  {
    key: 'cv2Threshold',
    label: 'CV² 임계 (기본 0.49)',
    reflection: 'recompute',
    exclusiveMin: 0,
  },
  {
    key: 'classificationWindowDays',
    label: '분류 창 (일)',
    reflection: 'recompute',
    integer: true,
    min: 30,
    max: 1095,
  },
  {
    key: 'paramWindowDaysFrequent',
    label: '파라미터 창 — smooth·erratic (일)',
    reflection: 'recompute',
    integer: true,
    min: 7,
    max: 1095,
  },
  {
    key: 'paramWindowDaysSparse',
    label: '파라미터 창 — intermittent·lumpy (일)',
    reflection: 'recompute',
    integer: true,
    min: 7,
    max: 1095,
  },
  {
    key: 'minDemandEvents',
    label: '최소 수요 발생일',
    reflection: 'recompute',
    integer: true,
    min: 1,
  },
  {
    key: 'gradeACut',
    label: '등급 A 누적 매출 컷',
    reflection: 'recompute',
    min: 0,
    max: 1,
  },
  {
    key: 'gradeBCut',
    label: '등급 B 누적 매출 컷',
    reflection: 'recompute',
    min: 0,
    max: 1,
  },
  {
    key: 'demandCoreSince',
    label: 'D0 — core 수요 시작일',
    reflection: 'recompute',
    nullable: true,
    date: true,
  },
  {
    key: 'demandRecomputeDays',
    label: '야간 재계산 창 (일)',
    reflection: 'recompute',
    integer: true,
    min: 1,
    max: 365,
  },
  {
    key: 'leadTimeWindowDays',
    label: '리드타임 관측 창 (일)',
    reflection: 'recompute',
    integer: true,
    min: 30,
    max: 1095,
  },
  // ── 읽는 시점에 계산되는 입력 (저장 즉시 반영) ──
  {
    key: 'minLeadTimeObservations',
    label: '관측을 믿는 최소 건수',
    reflection: 'immediate',
    integer: true,
    min: 1,
  },
  {
    key: 'consolidationBufferDays',
    label: '통합 버퍼 (일, 전사 축)',
    reflection: 'immediate',
    integer: true,
    min: 0,
  },
  {
    key: 'defaultLeadTimeDays',
    label: '기본 발주 리드타임 (일)',
    reflection: 'immediate',
    min: 0,
  },
  {
    key: 'defaultLeadTimeStdDays',
    label: '기본 발주 리드타임 σ (일, 비우면 cv·μ)',
    reflection: 'immediate',
    nullable: true,
    min: 0,
  },
  {
    key: 'defaultTransferLeadTimeDays',
    label: '기본 이동 리드타임 (일)',
    reflection: 'immediate',
    min: 0,
  },
  {
    key: 'defaultTransferLeadTimeStdDays',
    label: '기본 이동 리드타임 σ (일)',
    reflection: 'immediate',
    nullable: true,
    min: 0,
  },
  {
    key: 'defaultLeadTimeCv',
    label: 'σ 기본 비율 (cv)',
    reflection: 'immediate',
    min: 0,
    max: 2,
  },
  {
    key: 'defaultCoverDays',
    label: '기본 발주 커버 (일)',
    reflection: 'immediate',
    integer: true,
    min: 0,
  },
  {
    key: 'defaultTransferCoverDays',
    label: '기본 이동 커버 (일)',
    reflection: 'immediate',
    integer: true,
    min: 0,
  },
];

export type SettingsSection = {
  reflection: Reflection;
  title: string;
  description: string;
  /** 절 머리에 한 번 내는 반영 시점 문구 */
  note: string;
  fields: SettingsFieldSpec[];
};

/** 전역 탭은 반영 시점으로 갈린 두 절이다 — 그래서 문구가 절마다 한 번씩만 붙는다. */
export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    reflection: 'recompute',
    title: '수요 · 리드타임 프로필 입력',
    description:
      '창 길이 · 임계 · 등급 컷 · D0 · 재계산 일수는 야간 배치(03:40)가 만드는 프로필을 바꿉니다. 급하면 POST /replenishment/profiles/recompute 로 즉시 다시 계산할 수 있습니다.',
    note: REFLECTION_LABELS.recompute,
    fields: SETTINGS_FIELDS.filter((f) => f.reflection === 'recompute'),
  },
  {
    reflection: 'immediate',
    title: '읽는 시점 계산 입력 (기본값)',
    description:
      '규칙이 없는 공급사 · 경로가 떨어지는 전역 기본값과, 관측을 믿는 기준입니다.',
    note: REFLECTION_LABELS.immediate,
    fields: SETTINGS_FIELDS.filter((f) => f.reflection === 'immediate'),
  },
];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MEMO_MAX_LENGTH = 255;

/**
 * DTO → 폼. 키를 하나씩 적는 것은 장황해 보이지만 `{} as SettingsForm` 대신 이렇게 두면
 * 필드를 빠뜨렸을 때 **tsc 가 잡는다** (`as` 는 그 검사를 통째로 지운다).
 */
export function settingsFormFrom(dto: ReplenishmentSettingsDto): SettingsForm {
  const s = (v: number | string | null): string =>
    v === null ? '' : String(v);
  return {
    adiThreshold: s(dto.adiThreshold),
    cv2Threshold: s(dto.cv2Threshold),
    classificationWindowDays: s(dto.classificationWindowDays),
    paramWindowDaysFrequent: s(dto.paramWindowDaysFrequent),
    paramWindowDaysSparse: s(dto.paramWindowDaysSparse),
    minDemandEvents: s(dto.minDemandEvents),
    minLeadTimeObservations: s(dto.minLeadTimeObservations),
    leadTimeWindowDays: s(dto.leadTimeWindowDays),
    gradeACut: s(dto.gradeACut),
    gradeBCut: s(dto.gradeBCut),
    demandCoreSince: s(dto.demandCoreSince),
    demandRecomputeDays: s(dto.demandRecomputeDays),
    consolidationBufferDays: s(dto.consolidationBufferDays),
    defaultLeadTimeDays: s(dto.defaultLeadTimeDays),
    defaultLeadTimeStdDays: s(dto.defaultLeadTimeStdDays),
    defaultTransferLeadTimeDays: s(dto.defaultTransferLeadTimeDays),
    defaultTransferLeadTimeStdDays: s(dto.defaultTransferLeadTimeStdDays),
    defaultLeadTimeCv: s(dto.defaultLeadTimeCv),
    defaultCoverDays: s(dto.defaultCoverDays),
    defaultTransferCoverDays: s(dto.defaultTransferCoverDays),
  };
}

function parseNumberField(
  raw: string,
  integer: boolean
): { value: number | null; error: string | null } {
  const s = raw.trim();
  if (s === '') return { value: null, error: null };
  const n = Number(s);
  if (!Number.isFinite(n)) return { value: null, error: '숫자여야 합니다' };
  if (integer && !Number.isInteger(n))
    return { value: null, error: '정수여야 합니다' };
  return { value: n, error: null };
}

function rangeError(spec: SettingsFieldSpec, value: number): string | null {
  if (spec.exclusiveMin !== undefined && value <= spec.exclusiveMin)
    return `${spec.exclusiveMin} 보다 커야 합니다`;
  if (spec.min !== undefined && value < spec.min)
    return `${spec.min} 이상이어야 합니다`;
  if (spec.max !== undefined && value > spec.max)
    return `${spec.max} 이하여야 합니다`;
  return null;
}

/**
 * 숫자 필드 대입. nullable 둘만 `null` 을 받고 나머지는 `number` 만 받으므로
 * 분기해 둔다 — `payload as UpdateReplenishmentSettingsDto` 로 뭉개면 nullable 이
 * 아닌 필드에 null 을 실어 보내도 tsc 가 침묵한다.
 */
function assignNumberField(
  payload: UpdateReplenishmentSettingsDto,
  key: SettingsField,
  value: number | null
): void {
  switch (key) {
    case 'demandCoreSince':
      return; // 날짜 필드는 아래 별도 분기가 다룬다
    case 'defaultLeadTimeStdDays':
      payload.defaultLeadTimeStdDays = value;
      return;
    case 'defaultTransferLeadTimeStdDays':
      payload.defaultTransferLeadTimeStdDays = value;
      return;
    default:
      if (value === null) return;
      payload[key] = value;
  }
}

export function settingsPayloadFrom(
  form: SettingsForm,
  base: ReplenishmentSettingsDto
): {
  payload: UpdateReplenishmentSettingsDto;
  errors: Partial<Record<SettingsField, string>>;
} {
  const payload: UpdateReplenishmentSettingsDto = {};
  const errors: Partial<Record<SettingsField, string>> = {};

  for (const spec of SETTINGS_FIELDS) {
    const raw = form[spec.key].trim();

    if (spec.key === 'demandCoreSince') {
      const next = raw === '' ? null : raw;
      if (next !== null && !ISO_DATE.test(next)) {
        errors[spec.key] = 'YYYY-MM-DD 형식이어야 합니다';
        continue;
      }
      if (next !== base.demandCoreSince) payload.demandCoreSince = next;
      continue;
    }

    const parsed = parseNumberField(raw, spec.integer === true);
    if (parsed.error !== null) {
      errors[spec.key] = parsed.error;
      continue;
    }

    const currentRaw = base[spec.key];
    const current = typeof currentRaw === 'number' ? currentRaw : null;
    // 안 바뀐 필드는 payload 에 안 실리므로 서버가 볼 일도 없다 — 범위 검사도 하지 않는다.
    // 전부 검사하면 서버 값이 클라 범위를 벗어났을 때(누가 SQL 로 직접 넣는 식) 손대지도
    // 않은 필드에 오류가 서서 **무관한 필드의 저장까지 영구히 막히고 빠져나갈 길이 없다.**
    if (parsed.value === current) continue;

    if (parsed.value === null) {
      if (spec.nullable !== true) {
        errors[spec.key] = '필수 항목입니다';
        continue;
      }
    } else {
      const range = rangeError(spec, parsed.value);
      if (range !== null) {
        errors[spec.key] = range;
        continue;
      }
    }

    assignNumberField(payload, spec.key, parsed.value);
  }

  // 교차 검증 오류는 **사용자가 실제로 바꾼 입력** 옆에 붙인다. 손대지도 않은 A 컷 밑에
  // 빨간 글씨가 뜨면 사람은 자기가 고친 B 컷을 의심하지 못한다.
  const aChanged = payload.gradeACut !== undefined;
  const bChanged = payload.gradeBCut !== undefined;
  if (
    errors.gradeACut === undefined &&
    errors.gradeBCut === undefined &&
    (aChanged || bChanged)
  ) {
    const aCut = payload.gradeACut ?? base.gradeACut;
    const bCut = payload.gradeBCut ?? base.gradeBCut;
    if (aCut >= bCut) {
      if (aChanged) errors.gradeACut = 'A 컷은 B 컷보다 작아야 합니다';
      if (bChanged) errors.gradeBCut = 'B 컷은 A 컷보다 커야 합니다';
    }
  }

  return { payload, errors };
}

// ── 공급사 · 경로 공용 (같은 `UpsertLeadTimeRuleDto` 를 쓴다) ──

export type LeadTimeDraft = {
  leadTimeDays: string;
  leadTimeStdDays: string;
  coverDays: string;
};

export const EMPTY_LEAD_TIME_DRAFT: LeadTimeDraft = {
  leadTimeDays: '',
  leadTimeStdDays: '',
  coverDays: '',
};

/** 규칙 행 → 입력 폼. `0` 을 빈칸으로 만들지 않는다(`!= null` 이지 truthy 가 아니다). */
export function leadTimeDraftFrom(rule: LeadTimeRuleDto | null): LeadTimeDraft {
  if (rule === null) return { ...EMPTY_LEAD_TIME_DRAFT };
  return {
    leadTimeDays: String(rule.leadTimeDays),
    leadTimeStdDays:
      rule.leadTimeStdDays === null ? '' : String(rule.leadTimeStdDays),
    coverDays: String(rule.coverDays),
  };
}

/** 공급사 · 경로 표의 관측 셀 — 두 탭이 같은 문자열을 쓴다. */
export function formatLeadTimeObservation(
  observation: LeadTimeObservationDto | null
): string {
  if (observation === null) return '—';
  const std =
    observation.stdDays === null ? '—' : observation.stdDays.toFixed(1);
  return `${observation.observations}건 · ${observation.meanDays.toFixed(1)} · ${std}`;
}

export function routeRuleKey(
  fromWarehouseId: string,
  toWarehouseId: string
): string {
  return `${fromWarehouseId}:${toWarehouseId}`;
}

/**
 * 새 경로 행의 draft 키. 창고를 고르기 전 `routeRuleKey('', '')` 을 쓰면 창고를 고르는
 * 순간 키가 바뀌어 **그 전에 친 리드타임 · σ · 커버가 조용히 사라진다.** 실제 경로 키와
 * 겹치지 않는 합성 키를 쓰고, 저장 시점에만 실제 경로로 옮긴다.
 */
export const NEW_ROUTE_DRAFT_KEY = '__new-route__';

/**
 * 새 경로를 추가할 수 있는지, 못 한다면 왜인지. 이 판정이 서버 400(같은 창고) · 409(중복)를
 * 막는 유일한 방어라 컴포넌트가 아니라 여기 둔다.
 */
export type RouteAddIssue =
  | 'incomplete'
  | 'same-warehouse'
  | 'duplicate'
  | null;

export const ROUTE_ADD_ISSUE_LABELS: Record<
  Exclude<RouteAddIssue, null | 'incomplete'>,
  string
> = {
  'same-warehouse': '출발과 도착 창고가 같습니다',
  duplicate: '이미 목록에 있는 경로입니다',
};

export function routeAddIssue(input: {
  from: string;
  to: string;
  knownKeys: ReadonlySet<string>;
}): RouteAddIssue {
  if (input.from === '' || input.to === '') return 'incomplete';
  if (input.from === input.to) return 'same-warehouse';
  if (input.knownKeys.has(routeRuleKey(input.from, input.to)))
    return 'duplicate';
  return null;
}

export function leadTimeRulePayloadFrom(form: LeadTimeDraft): {
  payload: UpsertLeadTimeRuleDto | null;
  error: string | null;
} {
  const lead = parseNumberField(form.leadTimeDays, false);
  if (lead.error !== null || lead.value === null || lead.value < 0)
    return { payload: null, error: '리드타임(일)은 0 이상의 숫자여야 합니다' };
  const std = parseNumberField(form.leadTimeStdDays, false);
  if (std.error !== null || (std.value !== null && std.value < 0))
    return { payload: null, error: 'σ 는 0 이상의 숫자이거나 비워 둡니다' };
  const cover = parseNumberField(form.coverDays, true);
  if (cover.error !== null || cover.value === null || cover.value < 0)
    return { payload: null, error: '커버 일수는 0 이상의 정수여야 합니다' };
  return {
    payload: {
      leadTimeDays: lead.value,
      leadTimeStdDays: std.value,
      coverDays: cover.value,
    },
    error: null,
  };
}

// ── SKU 예외 ──

export type SkuOverrideDraft = {
  mode: OverrideMode;
  excludedUntil: string;
  safetyStock: string;
  alpha: string;
  memo: string;
};

export const EMPTY_SKU_OVERRIDE_DRAFT: SkuOverrideDraft = {
  mode: 'auto',
  excludedUntil: '',
  safetyStock: '',
  alpha: '',
  memo: '',
};

export function skuOverrideDraftFrom(row: SkuOverrideRowDto): SkuOverrideDraft {
  return {
    mode: row.mode,
    excludedUntil: row.excludedUntil ?? '',
    safetyStock: row.safetyStock === null ? '' : String(row.safetyStock),
    alpha: row.alpha === null ? '' : String(row.alpha),
    memo: row.memo ?? '',
  };
}

export function skuOverridePayloadFrom(form: SkuOverrideDraft): {
  payload: UpsertSkuOverrideDto | null;
  error: string | null;
} {
  const until = form.excludedUntil.trim();
  if (until !== '' && !ISO_DATE.test(until))
    return { payload: null, error: '제외 종료일은 YYYY-MM-DD 형식입니다' };
  const safetyStock = parseNumberField(form.safetyStock, true);
  if (
    safetyStock.error !== null ||
    (safetyStock.value !== null && safetyStock.value < 0)
  )
    return {
      payload: null,
      error: '안전재고는 0 이상의 정수이거나 비워 둡니다',
    };
  const alpha = parseNumberField(form.alpha, false);
  if (
    alpha.error !== null ||
    (alpha.value !== null && (alpha.value <= 0 || alpha.value >= 1))
  )
    return { payload: null, error: 'α 는 0 과 1 사이(배타)이거나 비워 둡니다' };
  const memo = form.memo.trim();
  if (memo.length > MEMO_MAX_LENGTH)
    return {
      payload: null,
      error: `메모는 ${MEMO_MAX_LENGTH}자 이하여야 합니다`,
    };
  // `auto` + 전부 비움은 아무것도 덮지 않는 예외 행이다 — 서버는 받아 주지만 화면에는
  // 지우는 것 말고는 할 일이 없는 행이 남는다. 예외를 없애려는 것이면 「지우기」가 맞다.
  if (
    form.mode === 'auto' &&
    until === '' &&
    safetyStock.value === null &&
    alpha.value === null &&
    memo === ''
  )
    return {
      payload: null,
      error:
        '예외로 저장할 값이 없습니다 — 모드를 「제외」로 하거나 안전재고 · α · 메모 중 하나는 채우세요. 예외를 없애려면 「지우기」입니다',
    };
  return {
    payload: {
      mode: form.mode,
      excludedUntil: until === '' ? null : until,
      safetyStock: safetyStock.value,
      alpha: alpha.value,
      memo: memo === '' ? null : memo,
    },
    error: null,
  };
}

/** SKU 후보 · 선택 배지가 같은 문자열을 쓴다 — 두 벌로 두면 한쪽만 바뀐다. */
export function skuLabelOf(sku: { name: string; code: string }): string {
  return `${sku.name} (${sku.code})`;
}

// ── 등급 ──

export const DEMAND_GRADES: readonly DemandGrade[] = ['A', 'B', 'C'];

export type GradeForm = Record<DemandGrade, string>;

export const EMPTY_GRADE_FORM: GradeForm = { A: '', B: '', C: '' };

/**
 * 응답 → 폼. 시드가 3행을 보장하지만 **응답에 빠진 등급은 빈칸으로 남긴다** — 없는 값을
 * `0` 같은 것으로 채우면 사람이 안 건드려도 서버 제약을 어기는 값이 저장된다.
 */
export function gradeFormFrom(dto: GradeRulesDto): GradeForm {
  const form: GradeForm = { ...EMPTY_GRADE_FORM };
  for (const item of dto.items) form[item.grade] = String(item.alpha);
  return form;
}

export function gradeItemsFrom(form: GradeForm): {
  items: GradeRuleDto[] | null;
  error: string | null;
} {
  const items: GradeRuleDto[] = [];
  for (const grade of DEMAND_GRADES) {
    const { value, error } = parseNumberField(form[grade], false);
    if (error !== null || value === null || value <= 0 || value >= 1)
      return {
        items: null,
        error: `등급 ${grade} 의 α 는 0 과 1 사이(배타)여야 합니다`,
      };
    items.push({ grade, alpha: value });
  }
  return { items, error: null };
}

// ── 실패 토스트 문구 ──

/**
 * 저장 · 삭제 실패 토스트 문구. `try/catch` 마다 흩어져 있던
 * `serverMessageOf(e) ?? '…에 실패했습니다.'` 를 한 곳으로 모은 것.
 */
export function failureMessage(error: unknown, fallback: string): string {
  return serverMessageOf(error) ?? fallback;
}

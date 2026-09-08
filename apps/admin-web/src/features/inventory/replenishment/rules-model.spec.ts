import type {
  LeadTimeObservationDto,
  ReplenishmentSettingsDto,
  SkuOverrideRowDto,
} from '@/lib/types/dto/inventory';
import { CustomError } from '@/lib/api/customError';
import {
  EMPTY_GRADE_FORM,
  EMPTY_LEAD_TIME_DRAFT,
  EMPTY_SKU_OVERRIDE_DRAFT,
  NEW_ROUTE_DRAFT_KEY,
  REFLECTION_LABELS,
  ROUTE_ADD_ISSUE_LABELS,
  SETTINGS_FIELDS,
  SETTINGS_SECTIONS,
  failureMessage,
  formatLeadTimeObservation,
  gradeFormFrom,
  gradeItemsFrom,
  leadTimeDraftFrom,
  leadTimeRulePayloadFrom,
  routeAddIssue,
  routeRuleKey,
  settingsFormFrom,
  settingsPayloadFrom,
  skuLabelOf,
  skuOverrideDraftFrom,
  skuOverridePayloadFrom,
  type SettingsField,
} from './rules-model';

const base: ReplenishmentSettingsDto = {
  key: 'default',
  adiThreshold: 1.32,
  cv2Threshold: 0.49,
  classificationWindowDays: 365,
  paramWindowDaysFrequent: 90,
  paramWindowDaysSparse: 365,
  minDemandEvents: 3,
  minLeadTimeObservations: 5,
  leadTimeWindowDays: 365,
  gradeACut: 0.8,
  gradeBCut: 0.95,
  demandCoreSince: null,
  demandRecomputeDays: 14,
  consolidationBufferDays: 7,
  defaultLeadTimeDays: 30,
  defaultLeadTimeStdDays: null,
  defaultTransferLeadTimeDays: 14,
  defaultTransferLeadTimeStdDays: null,
  defaultLeadTimeCv: 0.25,
  defaultCoverDays: 30,
  defaultTransferCoverDays: 14,
  updatedAt: '2026-09-08T00:00:00.000Z',
};

describe('settings form ↔ payload', () => {
  it('DTO → 폼은 전부 문자열, null 은 빈 문자열', () => {
    const form = settingsFormFrom(base);
    expect(form.adiThreshold).toBe('1.32');
    expect(form.defaultLeadTimeStdDays).toBe('');
    expect(form.demandCoreSince).toBe('');
  });

  it('바뀐 필드만 payload 에 담고 숫자로 바꾼다. 빈 nullable 은 null', () => {
    const form = {
      ...settingsFormFrom(base),
      demandRecomputeDays: '21',
      defaultLeadTimeStdDays: '4',
      demandCoreSince: '2026-07-01',
    };
    const { payload, errors } = settingsPayloadFrom(form, base);
    expect(errors).toEqual({});
    expect(payload).toEqual({
      demandRecomputeDays: 21,
      defaultLeadTimeStdDays: 4,
      demandCoreSince: '2026-07-01',
    });

    const withStd: ReplenishmentSettingsDto = {
      ...base,
      defaultLeadTimeStdDays: 4,
    };
    const cleared = settingsPayloadFrom(
      { ...settingsFormFrom(withStd), defaultLeadTimeStdDays: '' },
      withStd
    );
    expect(cleared.errors).toEqual({});
    expect(cleared.payload).toEqual({ defaultLeadTimeStdDays: null });
  });

  it('바뀐 값이 없으면 payload 는 빈 객체', () => {
    expect(settingsPayloadFrom(settingsFormFrom(base), base)).toEqual({
      payload: {},
      errors: {},
    });
  });

  it('정수 필드에 소수 · 숫자 아닌 값 · 날짜 형식 위반은 errors', () => {
    expect(
      settingsPayloadFrom(
        { ...settingsFormFrom(base), demandRecomputeDays: '2.5' },
        base
      ).errors.demandRecomputeDays
    ).toMatch(/정수/);
    expect(
      settingsPayloadFrom(
        { ...settingsFormFrom(base), adiThreshold: 'abc' },
        base
      ).errors.adiThreshold
    ).toMatch(/숫자/);
    expect(
      settingsPayloadFrom(
        { ...settingsFormFrom(base), demandCoreSince: '2026/07/01' },
        base
      ).errors.demandCoreSince
    ).toMatch(/YYYY-MM-DD/);
    expect(
      settingsPayloadFrom(
        { ...settingsFormFrom(base), defaultLeadTimeDays: '' },
        base
      ).errors.defaultLeadTimeDays
    ).toMatch(/필수/);
  });

  // R29-③: 클라 검증이 서버(class-validator)보다 느슨하면 통과시킨 값이 400 이 되고
  // 영어 배열 메시지가 토스트에 뜬다. 서버 제약과 같은 범위를 클라가 먼저 막는다.
  it('서버 제약과 같은 범위를 막는다 — 음수 · 0 · 상한 초과', () => {
    const at = (field: SettingsField, value: string) =>
      settingsPayloadFrom({ ...settingsFormFrom(base), [field]: value }, base)
        .errors[field];

    // @IsPositive() — 0 은 서버에서 거절된다
    expect(at('adiThreshold', '0')).toBeDefined();
    expect(at('cv2Threshold', '0')).toBeDefined();
    // @Min(1)
    expect(at('minDemandEvents', '0')).toBeDefined();
    expect(at('minLeadTimeObservations', '0')).toBeDefined();
    // @Min(0)
    expect(at('consolidationBufferDays', '-5')).toBeDefined();
    expect(at('defaultCoverDays', '-1')).toBeDefined();
    expect(at('defaultLeadTimeDays', '-0.5')).toBeDefined();
    expect(at('defaultLeadTimeStdDays', '-1')).toBeDefined();
    // @Min(30) @Max(1095)
    expect(at('classificationWindowDays', '29')).toBeDefined();
    expect(at('classificationWindowDays', '1096')).toBeDefined();
    expect(at('leadTimeWindowDays', '29')).toBeDefined();
    // @Min(7) @Max(1095)
    expect(at('paramWindowDaysFrequent', '6')).toBeDefined();
    expect(at('paramWindowDaysSparse', '1096')).toBeDefined();
    // @Min(1) @Max(365)
    expect(at('demandRecomputeDays', '366')).toBeDefined();
    // @Min(0) @Max(1)
    expect(at('gradeBCut', '1.2')).toBeDefined();
    // @Min(0) @Max(2)
    expect(at('defaultLeadTimeCv', '2.5')).toBeDefined();

    // 경계값은 통과한다
    expect(at('classificationWindowDays', '30')).toBeUndefined();
    expect(at('classificationWindowDays', '1095')).toBeUndefined();
    expect(at('consolidationBufferDays', '0')).toBeUndefined();
  });

  // 안 바뀐 필드는 payload 에 안 실려 서버가 볼 일이 없다. 그런데도 검사하면 서버 값이
  // 클라 범위를 벗어났을 때(누가 SQL 로 직접 넣는 식) **손대지도 않은 필드 때문에 무관한
  // 필드의 저장까지 영구히 막히고 화면에서 빠져나갈 길이 없다.**
  it('범위 검사는 바뀐 필드에만 건다 — 서버 값이 범위 밖이어도 다른 필드는 저장된다', () => {
    const outOfRange: ReplenishmentSettingsDto = {
      ...base,
      defaultLeadTimeCv: 2.5, // 서버 @Max(2) 밖
      minDemandEvents: 0, // 서버 @Min(1) 밖
    };
    const result = settingsPayloadFrom(
      { ...settingsFormFrom(outOfRange), demandRecomputeDays: '21' },
      outOfRange
    );
    expect(result.errors).toEqual({});
    expect(result.payload).toEqual({ demandRecomputeDays: 21 });

    // 그 필드를 실제로 건드리면 그때는 막는다.
    expect(
      settingsPayloadFrom(
        { ...settingsFormFrom(outOfRange), defaultLeadTimeCv: '3' },
        outOfRange
      ).errors.defaultLeadTimeCv
    ).toBeDefined();
  });

  it('A 컷 ≥ B 컷 은 errors — 오류는 사용자가 바꾼 입력에 붙는다', () => {
    const aChanged = settingsPayloadFrom(
      { ...settingsFormFrom(base), gradeACut: '0.96' },
      base
    );
    expect(aChanged.errors.gradeACut).toMatch(/B/);
    expect(aChanged.errors.gradeBCut).toBeUndefined();

    // R29-②: B 만 건드렸으면 오류는 B 옆에 뜬다 — 손대지도 않은 A 밑이 아니라.
    const bChanged = settingsPayloadFrom(
      { ...settingsFormFrom(base), gradeBCut: '0.5' },
      base
    );
    expect(bChanged.errors.gradeBCut).toMatch(/A/);
    expect(bChanged.errors.gradeACut).toBeUndefined();

    // 둘 다 바꿔 어긋나면 둘 다 표시한다.
    const bothChanged = settingsPayloadFrom(
      { ...settingsFormFrom(base), gradeACut: '0.9', gradeBCut: '0.7' },
      base
    );
    expect(bothChanged.errors.gradeACut).toBeDefined();
    expect(bothChanged.errors.gradeBCut).toBeDefined();
  });

  it('모든 필드가 반영 시점을 갖는다 — 창 · 임계 · 컷 · D0 · 재계산 일수는 recompute, 나머지는 immediate', () => {
    const byKey = new Map(SETTINGS_FIELDS.map((f) => [f.key, f.reflection]));
    const recompute: SettingsField[] = [
      'adiThreshold',
      'cv2Threshold',
      'classificationWindowDays',
      'paramWindowDaysFrequent',
      'paramWindowDaysSparse',
      'minDemandEvents',
      'leadTimeWindowDays',
      'gradeACut',
      'gradeBCut',
      'demandCoreSince',
      'demandRecomputeDays',
    ];
    const immediate: SettingsField[] = [
      'minLeadTimeObservations',
      'consolidationBufferDays',
      'defaultLeadTimeDays',
      'defaultLeadTimeStdDays',
      'defaultTransferLeadTimeDays',
      'defaultTransferLeadTimeStdDays',
      'defaultLeadTimeCv',
      'defaultCoverDays',
      'defaultTransferCoverDays',
    ];
    for (const k of recompute) expect(byKey.get(k)).toBe('recompute');
    for (const k of immediate) expect(byKey.get(k)).toBe('immediate');

    // 개수를 상수로 박는 대신 폼 키 전수와 대조한다 — 필드를 추가하고 SETTINGS_FIELDS 에
    // 넣는 것을 잊으면 그 필드가 화면에서 조용히 사라지므로 이쪽이 판별력이 있다.
    expect([...byKey.keys()].sort()).toEqual(
      Object.keys(settingsFormFrom(base)).sort()
    );
    expect([...recompute, ...immediate].sort()).toEqual(
      [...byKey.keys()].sort()
    );
  });

  // R31: 「반영 시점」 문구는 필드마다가 아니라 절(섹션)마다 한 번 낸다.
  it('절은 반영 시점별로 둘이고, 모든 필드가 정확히 한 절에 한 번 들어간다', () => {
    expect(SETTINGS_SECTIONS.map((s) => s.reflection)).toEqual([
      'recompute',
      'immediate',
    ]);
    for (const section of SETTINGS_SECTIONS) {
      expect(section.note).toBe(REFLECTION_LABELS[section.reflection]);
      for (const f of section.fields)
        expect(f.reflection).toBe(section.reflection);
    }
    const flattened = SETTINGS_SECTIONS.flatMap((s) =>
      s.fields.map((f) => f.key)
    );
    expect(flattened.sort()).toEqual(SETTINGS_FIELDS.map((f) => f.key).sort());
    expect(new Set(flattened).size).toBe(flattened.length);
  });
});

describe('leadTimeRulePayloadFrom', () => {
  it('σ 빈값은 null, 커버는 정수', () => {
    expect(
      leadTimeRulePayloadFrom({
        leadTimeDays: '25',
        leadTimeStdDays: '',
        coverDays: '40',
      })
    ).toEqual({
      payload: { leadTimeDays: 25, leadTimeStdDays: null, coverDays: 40 },
      error: null,
    });
    expect(
      leadTimeRulePayloadFrom({
        leadTimeDays: '',
        leadTimeStdDays: '',
        coverDays: '40',
      }).error
    ).toMatch(/리드타임/);
    expect(
      leadTimeRulePayloadFrom({
        leadTimeDays: '25',
        leadTimeStdDays: '',
        coverDays: '4.5',
      }).error
    ).toMatch(/정수/);
    expect(
      leadTimeRulePayloadFrom({
        leadTimeDays: '-1',
        leadTimeStdDays: '',
        coverDays: '40',
      }).error
    ).toMatch(/리드타임/);
    expect(
      leadTimeRulePayloadFrom({
        leadTimeDays: '25',
        leadTimeStdDays: '-2',
        coverDays: '40',
      }).error
    ).toMatch(/σ/);
  });
});

describe('skuOverridePayloadFrom', () => {
  it('auto + 안전재고 · α, excluded + until', () => {
    expect(
      skuOverridePayloadFrom({
        mode: 'auto',
        excludedUntil: '',
        safetyStock: '40',
        alpha: '0.01',
        memo: '',
      })
    ).toEqual({
      payload: {
        mode: 'auto',
        excludedUntil: null,
        safetyStock: 40,
        alpha: 0.01,
        memo: null,
      },
      error: null,
    });
    expect(
      skuOverridePayloadFrom({
        mode: 'excluded',
        excludedUntil: '2026-12-31',
        safetyStock: '',
        alpha: '',
        memo: '시즌오프',
      })
    ).toEqual({
      payload: {
        mode: 'excluded',
        excludedUntil: '2026-12-31',
        safetyStock: null,
        alpha: null,
        memo: '시즌오프',
      },
      error: null,
    });
    expect(
      skuOverridePayloadFrom({
        mode: 'auto',
        excludedUntil: '',
        safetyStock: '-1',
        alpha: '',
        memo: '',
      }).error
    ).toMatch(/안전재고/);
    expect(
      skuOverridePayloadFrom({
        mode: 'auto',
        excludedUntil: '',
        safetyStock: '',
        alpha: '1',
        memo: '',
      }).error
    ).toMatch(/α/);
    // (0, 1) 배타 — 서버 `IsOpenUnitInterval` 과 같은 경계.
    expect(
      skuOverridePayloadFrom({
        mode: 'auto',
        excludedUntil: '',
        safetyStock: '',
        alpha: '0',
        memo: '',
      }).error
    ).toMatch(/α/);
    expect(
      skuOverridePayloadFrom({
        mode: 'excluded',
        excludedUntil: '2026/12/31',
        safetyStock: '',
        alpha: '',
        memo: '',
      }).error
    ).toMatch(/YYYY-MM-DD/);
    // 서버 @MaxLength(255)
    expect(
      skuOverridePayloadFrom({
        mode: 'auto',
        excludedUntil: '',
        safetyStock: '',
        alpha: '',
        memo: 'ㄱ'.repeat(256),
      }).error
    ).toMatch(/메모/);
  });

  // `auto` + 전부 비움을 통과시키면 SKU 만 고르고 「추가」를 눌렀을 때 아무것도 덮지 않는
  // 예외 행이 생긴다 — 서버는 받아 주므로 여기서 막는 것 말고는 막을 데가 없다.
  it('아무것도 덮지 않는 예외는 거절한다 — 「제외」거나 값이 하나는 있어야', () => {
    expect(skuOverridePayloadFrom(EMPTY_SKU_OVERRIDE_DRAFT)).toEqual({
      payload: null,
      error: expect.stringMatching(/지우기/),
    });
    // 모드가 「제외」면 그 자체가 뜻이 있다.
    expect(
      skuOverridePayloadFrom({
        ...EMPTY_SKU_OVERRIDE_DRAFT,
        mode: 'excluded',
      }).error
    ).toBeNull();
    // 값이 하나라도 있으면 통과. 안전재고 `0` 도 값이다.
    for (const filled of [
      { safetyStock: '0' },
      { alpha: '0.01' },
      { memo: '단종 예정' },
      { excludedUntil: '2026-12-31' },
    ]) {
      expect(
        skuOverridePayloadFrom({ ...EMPTY_SKU_OVERRIDE_DRAFT, ...filled }).error
      ).toBeNull();
    }
  });
});

describe('gradeFormFrom', () => {
  it('응답 → 폼. 빠진 등급은 빈칸으로 남긴다', () => {
    expect(
      gradeFormFrom({
        items: [
          { grade: 'A', alpha: 0.02 },
          { grade: 'B', alpha: 0.05 },
          { grade: 'C', alpha: 0.1 },
        ],
      })
    ).toEqual({ A: '0.02', B: '0.05', C: '0.1' });
    // 시드가 3행을 보장하지만, 빠진 등급을 0 같은 것으로 채우면 사람이 손대지도 않은
    // 값이 서버 제약((0,1) 배타)을 어긴 채 저장된다.
    expect(gradeFormFrom({ items: [{ grade: 'B', alpha: 0.05 }] })).toEqual({
      A: '',
      B: '0.05',
      C: '',
    });
    expect(gradeFormFrom({ items: [] })).toEqual(EMPTY_GRADE_FORM);
  });
});

describe('routeAddIssue', () => {
  const known = new Set([routeRuleKey('wh-1', 'wh-2')]);

  it('미선택 · 같은 창고 · 중복을 각각 구분한다', () => {
    expect(routeAddIssue({ from: '', to: 'wh-2', knownKeys: known })).toBe(
      'incomplete'
    );
    expect(routeAddIssue({ from: 'wh-1', to: '', knownKeys: known })).toBe(
      'incomplete'
    );
    // 서버 400 을 막는다
    expect(routeAddIssue({ from: 'wh-1', to: 'wh-1', knownKeys: known })).toBe(
      'same-warehouse'
    );
    // 서버 409(또는 조용한 덮어쓰기)를 막는다
    expect(routeAddIssue({ from: 'wh-1', to: 'wh-2', knownKeys: known })).toBe(
      'duplicate'
    );
    // 반대 방향은 다른 경로다
    expect(
      routeAddIssue({ from: 'wh-2', to: 'wh-1', knownKeys: known })
    ).toBeNull();
    expect(
      routeAddIssue({ from: 'wh-3', to: 'wh-4', knownKeys: known })
    ).toBeNull();
  });

  it('보여 줄 이유에는 문구가 있다', () => {
    expect(ROUTE_ADD_ISSUE_LABELS['same-warehouse']).toBeTruthy();
    expect(ROUTE_ADD_ISSUE_LABELS.duplicate).toBeTruthy();
  });
});

describe('skuLabelOf', () => {
  it('후보 버튼과 선택 배지가 같은 문자열을 쓴다', () => {
    expect(skuLabelOf({ name: '아몬드 200g', code: 'ALM-200' })).toBe(
      '아몬드 200g (ALM-200)'
    );
  });
});

describe('gradeItemsFrom', () => {
  it('세 등급 전부 (0,1)', () => {
    expect(gradeItemsFrom({ A: '0.02', B: '0.05', C: '0.1' })).toEqual({
      items: [
        { grade: 'A', alpha: 0.02 },
        { grade: 'B', alpha: 0.05 },
        { grade: 'C', alpha: 0.1 },
      ],
      error: null,
    });
    expect(gradeItemsFrom({ A: '0', B: '0.05', C: '0.1' }).error).toMatch(/A/);
    expect(gradeItemsFrom({ A: '0.02', B: '1', C: '0.1' }).error).toMatch(/B/);
    expect(gradeItemsFrom({ A: '0.02', B: '0.05', C: '' }).error).toMatch(/C/);
  });
});

describe('표 셀 · 폼 직렬화 (공급사 · 경로 · SKU 예외 공용)', () => {
  const observation: LeadTimeObservationDto = {
    observations: 12,
    meanDays: 27.44,
    stdDays: 3.5,
    windowFrom: '2025-09-08',
    windowTo: '2026-09-08',
  };

  it('관측 셀은 「n건 · 평균 · σ」, 없으면 —', () => {
    expect(formatLeadTimeObservation(observation)).toBe('12건 · 27.4 · 3.5');
    expect(formatLeadTimeObservation({ ...observation, stdDays: null })).toBe(
      '12건 · 27.4 · —'
    );
    expect(formatLeadTimeObservation(null)).toBe('—');
  });

  it('규칙 → 드래프트는 0 을 빈칸으로 만들지 않는다', () => {
    expect(
      leadTimeDraftFrom({
        leadTimeDays: 0,
        leadTimeStdDays: 0,
        coverDays: 0,
        updatedAt: '2026-09-08T00:00:00.000Z',
      })
    ).toEqual({ leadTimeDays: '0', leadTimeStdDays: '0', coverDays: '0' });
    expect(
      leadTimeDraftFrom({
        leadTimeDays: 25,
        leadTimeStdDays: null,
        coverDays: 40,
        updatedAt: '2026-09-08T00:00:00.000Z',
      })
    ).toEqual({ leadTimeDays: '25', leadTimeStdDays: '', coverDays: '40' });
    expect(leadTimeDraftFrom(null)).toEqual(EMPTY_LEAD_TIME_DRAFT);
  });

  it('SKU 예외 행 → 드래프트도 0 · 빈 메모를 구분한다', () => {
    const row: SkuOverrideRowDto = {
      skuId: 'sku-1',
      skuCode: 'A-1',
      skuName: '아몬드',
      mode: 'excluded',
      excludedUntil: '2026-12-31',
      safetyStock: 0,
      alpha: null,
      memo: null,
      updatedAt: '2026-09-08T00:00:00.000Z',
    };
    expect(skuOverrideDraftFrom(row)).toEqual({
      mode: 'excluded',
      excludedUntil: '2026-12-31',
      safetyStock: '0',
      alpha: '',
      memo: '',
    });
    expect(EMPTY_SKU_OVERRIDE_DRAFT.mode).toBe('auto');
  });

  // R28: 새 경로 행의 draft 키가 `${from}:${to}` 면 창고를 고르기 전에는 ':' 이고,
  // 창고를 고르는 순간 그 전에 친 리드타임 · σ · 커버가 조용히 사라진다.
  it('새 경로 draft 키는 어떤 실제 경로 키와도 겹치지 않는다', () => {
    expect(routeRuleKey('wh-1', 'wh-2')).toBe('wh-1:wh-2');
    expect(NEW_ROUTE_DRAFT_KEY).not.toBe(routeRuleKey('', ''));
    expect(NEW_ROUTE_DRAFT_KEY).not.toBe(routeRuleKey('wh-1', 'wh-2'));
  });
});

describe('failureMessage', () => {
  it('서버 메시지를 쓰고, 없으면 폴백', () => {
    expect(
      failureMessage(
        new CustomError({
          message: '공급사를 찾을 수 없습니다',
          statusCode: 404,
        }),
        '저장에 실패했습니다.'
      )
    ).toBe('공급사를 찾을 수 없습니다');
    expect(failureMessage(new Error('boom'), '저장에 실패했습니다.')).toBe(
      '저장에 실패했습니다.'
    );
    expect(failureMessage(null, '삭제에 실패했습니다.')).toBe(
      '삭제에 실패했습니다.'
    );
  });
});

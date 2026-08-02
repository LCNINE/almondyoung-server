import { buildOptionAdd, buildOptionModify, checkCreateStructure } from './bulk-draft.options';
import { flattenBundle } from './bulk-session.fields';
import type { FlatFields, PrefillRow, UploadedBundle } from './bulk-session.types';

/** 신규 행의 전형적인 옵션 필드 — 색상(빨강/파랑) 축 하나. */
const createFields: FlatFields = {
  'optionGroup:C.optionName': '색상',
  'optionGroup:C.optionSortOrder': '1',
  'optionValue:C1.optionValueName': '빨강',
  'optionValue:C1.colorCode': '#FF0000',
  'optionValue:C1.valueSortOrder': '1',
  'optionValue:C2.optionValueName': '파랑',
  'optionValue:C2.colorCode': '',
  'optionValue:C2.valueSortOrder': '2',
  'variant:C1.basePrice': '10000',
  'variant:C2.basePrice': '10000',
};

/** `createFields` 가 나타내는 옵션 시트 원본 행 — 그룹 귀속의 권위 있는 출처(bundle.options). */
const createOptionRows: PrefillRow[] = [
  {
    rowKey: 'P1',
    optionKey: 'C',
    optionName: '색상',
    optionValueKey: 'C1',
    optionValueName: '빨강',
    optionSortOrder: '1',
    colorCode: '#FF0000',
    valueSortOrder: '1',
  },
  {
    rowKey: 'P1',
    optionKey: 'C',
    optionName: '색상',
    optionValueKey: 'C2',
    optionValueName: '파랑',
    optionSortOrder: '1',
    colorCode: '',
    valueSortOrder: '2',
  },
];

describe('buildOptionAdd (신규 행)', () => {
  it('그룹과 값을 optionDiff.add 로 조립한다', () => {
    const { plan, errors } = buildOptionAdd(createFields, createOptionRows);

    expect(errors).toEqual([]);
    expect(plan.add).toHaveLength(1);
    expect(plan.add[0].displayName).toBe('색상');
    expect(plan.add[0].sortOrder).toBe(1);
    expect(plan.add[0].values).toEqual([
      { displayName: '빨강', colorCode: '#FF0000', sortOrder: 1 },
      { displayName: '파랑', sortOrder: 2 },
    ]);
  });

  it('생성 후 id 를 찾을 열쇠(그룹명·값명)를 워크북 키별로 남긴다', () => {
    const { plan } = buildOptionAdd(createFields, createOptionRows);

    expect(plan.valueNameByKey.get('C1')).toEqual({ groupName: '색상', valueName: '빨강' });
    expect(plan.valueNameByKey.get('C2')).toEqual({ groupName: '색상', valueName: '파랑' });
  });

  it('옵션 축이 없는 상품은 빈 계획을 낸다', () => {
    const { plan, errors } = buildOptionAdd({ 'variant:.basePrice': '10000' }, []);

    expect(errors).toEqual([]);
    expect(plan.add).toEqual([]);
  });

  it('그룹이 번갈아 나오는 옵션 시트에서도 값이 제 그룹에 붙는다', () => {
    // 행 순서: (C,색상,C1,빨강) → (S,사이즈,S1,스몰) → (C,색상,C2,파랑) → (S,사이즈,S2,라지)
    // 키 삽입 순서로 추론하면 파랑이 사이즈 그룹으로 새는 결함이 있었다(리뷰 2026-08-03).
    // 그룹 귀속은 행에서 오므로 색상=[빨강,파랑], 사이즈=[스몰,라지] 여야 한다.
    const optionRows: PrefillRow[] = [
      {
        rowKey: 'P1',
        optionKey: 'C',
        optionName: '색상',
        optionValueKey: 'C1',
        optionValueName: '빨강',
        optionSortOrder: '1',
        colorCode: '#FF0000',
        valueSortOrder: '1',
      },
      {
        rowKey: 'P1',
        optionKey: 'S',
        optionName: '사이즈',
        optionValueKey: 'S1',
        optionValueName: '스몰',
        optionSortOrder: '2',
        colorCode: '',
        valueSortOrder: '1',
      },
      {
        rowKey: 'P1',
        optionKey: 'C',
        optionName: '색상',
        optionValueKey: 'C2',
        optionValueName: '파랑',
        optionSortOrder: '1',
        colorCode: '',
        valueSortOrder: '2',
      },
      {
        rowKey: 'P1',
        optionKey: 'S',
        optionName: '사이즈',
        optionValueKey: 'S2',
        optionValueName: '라지',
        optionSortOrder: '2',
        colorCode: '',
        valueSortOrder: '2',
      },
    ];
    // fields 는 실제 flattenBundle 이 이 행 순서로 만들어낼 키 삽입 순서 그대로 구성한다 —
    // 결함이 재현되는 조건(그룹이 번갈아 나옴)을 손으로 흉내 내지 않고 실물로 만든다.
    const bundle: UploadedBundle = { product: {}, options: optionRows, variants: [], categories: [], constraint: null };
    const fields = flattenBundle(bundle);

    const { plan, errors } = buildOptionAdd(fields, optionRows);

    expect(errors).toEqual([]);
    const color = plan.add.find((g) => g.displayName === '색상');
    const size = plan.add.find((g) => g.displayName === '사이즈');
    expect(color?.values).toEqual([
      { displayName: '빨강', colorCode: '#FF0000', sortOrder: 1 },
      { displayName: '파랑', sortOrder: 2 },
    ]);
    expect(size?.values).toEqual([
      { displayName: '스몰', sortOrder: 1 },
      { displayName: '라지', sortOrder: 2 },
    ]);
    expect(plan.valueNameByKey.get('C1')).toEqual({ groupName: '색상', valueName: '빨강' });
    expect(plan.valueNameByKey.get('C2')).toEqual({ groupName: '색상', valueName: '파랑' });
    expect(plan.valueNameByKey.get('S1')).toEqual({ groupName: '사이즈', valueName: '스몰' });
    expect(plan.valueNameByKey.get('S2')).toEqual({ groupName: '사이즈', valueName: '라지' });
  });
});

describe('checkCreateStructure (신규 행 구조 검증 — 스펙에 없던 갭)', () => {
  it('한 그룹 안에서 값 표시명이 겹치면 오류다', () => {
    const errors = checkCreateStructure(
      {
        ...createFields,
        'optionValue:C2.optionValueName': '빨강',
      },
      createOptionRows,
    );

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('빨강');
  });

  it('조합이 옵션 시트에 없는 옵션값키를 가리키면 오류다', () => {
    const errors = checkCreateStructure({ ...createFields, 'variant:C9.basePrice': '10000' }, createOptionRows);

    expect(errors.some((e) => e.message.includes('C9'))).toBe(true);
  });

  it('정상 구조에는 오류가 없다', () => {
    expect(checkCreateStructure(createFields, createOptionRows)).toEqual([]);
  });
});

describe('buildOptionModify (수정 행)', () => {
  it('표시명·색상·정렬 변경을 그룹/값 스코프로 나눠 담는다', () => {
    const { modify, errors } = buildOptionModify({
      'optionGroup:g-1.optionName': '컬러',
      'optionValue:v-1.optionValueName': '레드',
      'optionValue:v-1.colorCode': '#FF0000',
      'optionValue:v-2.valueSortOrder': '3',
    });

    expect(errors).toEqual([]);
    // 값의 소속 그룹은 필드경로에 없다 — 값 변경만 있는 값은 optionGroupId 를 모르므로
    // 그룹 항목과 별개로 담기지 않고, 호출부가 실제 소속을 채워 넣는다.
    expect(modify).toEqual([
      { optionGroupId: 'g-1', displayName: '컬러' },
      { optionGroupId: '', values: [{ optionValueId: 'v-1', displayName: '레드', colorCode: '#FF0000' }] },
      { optionGroupId: '', values: [{ optionValueId: 'v-2', sortOrder: 3 }] },
    ]);
  });

  it('옵션명을 비우면 행 오류다 (core 가 조용히 무시하므로)', () => {
    const { errors } = buildOptionModify({ 'optionGroup:g-1.optionName': '' });

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('비울 수 없습니다');
  });

  it('옵션값명을 비워도 행 오류다', () => {
    const { errors } = buildOptionModify({ 'optionValue:v-1.optionValueName': '' });

    expect(errors).toHaveLength(1);
  });

  it('색상코드는 비울 수 있다 — core 가 !== undefined 로 처리한다', () => {
    const { modify, errors } = buildOptionModify({ 'optionValue:v-1.colorCode': '' });

    expect(errors).toEqual([]);
    expect(modify[0].values?.[0]).toEqual({ optionValueId: 'v-1', colorCode: null });
  });
});

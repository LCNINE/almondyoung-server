import { itemVersionState, itemVersionStateLabel } from './item-version-state';

describe('itemVersionState', () => {
  it('draft 가 있으면 버전 발행이다', () => {
    expect(itemVersionState({ draftVersionId: 'v1', changes: [] })).toBe('version');
  });

  it('draft 가 없고 변경분이 있으면 정책만 적용이다', () => {
    // `as` 캐스팅을 쓰지 않는다(레포 규칙) — BulkSessionItemChange 를 온전히 만든다.
    expect(
      itemVersionState({
        draftVersionId: null,
        changes: [
          {
            field: 'variant:c1.availabilityOverride',
            label: '판매상태재정의 (조합 c1)',
            before: '',
            after: '품절',
          },
        ],
      })
    ).toBe('policy-only');
  });

  it('draft 도 변경분도 없으면 변경 없음이다', () => {
    expect(itemVersionState({ draftVersionId: null, changes: [] })).toBe('no-change');
  });
});

describe('itemVersionStateLabel', () => {
  it('버전 발행 행에는 배지를 달지 않는다', () => {
    // 대다수가 이 상태다 — 전부에 배지를 달면 예외가 눈에 안 띈다.
    expect(itemVersionStateLabel('version')).toBeNull();
  });

  it('나머지 둘은 이유를 밝힌다', () => {
    expect(itemVersionStateLabel('policy-only')).toBe('판매정책만 적용 (새 버전 없음)');
    expect(itemVersionStateLabel('no-change')).toBe('변경 없음 (새 버전 없음)');
  });
});

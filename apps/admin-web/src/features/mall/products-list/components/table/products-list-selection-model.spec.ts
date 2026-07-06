import {
  selectedIdsFromRowSelection,
  reconcileSelectedSnapshots,
  type SelectedProductSnapshot,
} from './products-list-selection-model';

const snap = (
  masterId: string,
  name = masterId,
  thumbnail: string | null = null,
): SelectedProductSnapshot => ({ masterId, name, thumbnail });

describe('selectedIdsFromRowSelection', () => {
  it('truthy 값을 가진 키만 반환한다', () => {
    expect(selectedIdsFromRowSelection({ a: true, b: false, c: true })).toEqual([
      'a',
      'c',
    ]);
  });

  it('빈 선택은 빈 배열', () => {
    expect(selectedIdsFromRowSelection({})).toEqual([]);
  });
});

describe('reconcileSelectedSnapshots', () => {
  it('현재 페이지에 로드된 선택 행의 스냅샷을 담고 changed=true', () => {
    const { changed, next } = reconcileSelectedSnapshots(
      {},
      { p1: true },
      [snap('p1', '상품1', 'thumb1.jpg'), snap('p2', '상품2')],
    );
    expect(changed).toBe(true);
    expect(next).toEqual({ p1: snap('p1', '상품1', 'thumb1.jpg') });
  });

  it('현재 페이지에 없어도 이전 스냅샷이 있으면 유지한다(교차 페이지)', () => {
    const prev = { p1: snap('p1', '상품1', 'thumb1.jpg') };
    const { changed, next } = reconcileSelectedSnapshots(
      prev,
      { p1: true, p2: true },
      [snap('p2', '상품2')], // p1 은 다른 페이지라 로드 안 됨
    );
    expect(changed).toBe(true);
    expect(next.p1).toEqual(snap('p1', '상품1', 'thumb1.jpg'));
    expect(next.p2).toEqual(snap('p2', '상품2'));
  });

  it('선택 해제된 id 는 스냅샷에서 제거하고 changed=true', () => {
    const prev = { p1: snap('p1'), p2: snap('p2') };
    const { changed, next } = reconcileSelectedSnapshots(
      prev,
      { p1: true, p2: false },
      [],
    );
    expect(changed).toBe(true);
    expect(next).toEqual({ p1: snap('p1') });
  });

  it('변화가 없으면 changed=false (렌더 루프 방지)', () => {
    const prev = { p1: snap('p1', '상품1', 'thumb1.jpg') };
    const { changed } = reconcileSelectedSnapshots(
      prev,
      { p1: true },
      [snap('p1', '상품1', 'thumb1.jpg')],
    );
    expect(changed).toBe(false);
  });

  it('로드도 안 됐고 이전 스냅샷도 없으면 masterId 를 이름 폴백으로 쓴다', () => {
    const { next } = reconcileSelectedSnapshots({}, { orphan: true }, []);
    expect(next.orphan).toEqual({
      masterId: 'orphan',
      name: 'orphan',
      thumbnail: null,
    });
  });
});

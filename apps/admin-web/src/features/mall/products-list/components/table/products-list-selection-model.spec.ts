import {
  selectedIdsFromRowSelection,
  reconcileSelectedSnapshots,
  selectionFromItems,
  type SelectedProductSnapshot,
} from './products-list-selection-model';

const snap = (
  masterId: string,
  name = masterId,
  thumbnail: string | null = null,
  flags: Partial<
    Pick<
      SelectedProductSnapshot,
      | 'hideMembershipPriceForNonMembers'
      | 'isVisibleToMembersOnly'
      | 'isOverseas'
    >
  > = {}
): SelectedProductSnapshot => ({
  masterId,
  name,
  thumbnail,
  hideMembershipPriceForNonMembers: false,
  isVisibleToMembersOnly: false,
  isOverseas: false,
  ...flags,
});

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
      hideMembershipPriceForNonMembers: false,
      isVisibleToMembersOnly: false,
      isOverseas: false,
    });
  });

  it('같은 키 집합에서 한 필드만 바뀌면 changed=true 로 갱신한다', () => {
    const prev = { p1: snap('p1', '상품1', 'thumb1.jpg') };
    const { changed, next } = reconcileSelectedSnapshots(
      prev,
      { p1: true },
      [snap('p1', '상품1-수정', 'thumb1.jpg')],
    );
    expect(changed).toBe(true);
    expect(next.p1).toEqual(snap('p1', '상품1-수정', 'thumb1.jpg'));
  });

  it('정책 플래그만 바뀌어도 changed=true 로 갱신한다', () => {
    const prev = { p1: snap('p1', '상품1', 't.jpg', { isOverseas: false }) };
    const { changed, next } = reconcileSelectedSnapshots(
      prev,
      { p1: true },
      [snap('p1', '상품1', 't.jpg', { isOverseas: true })],
    );
    expect(changed).toBe(true);
    expect(next.p1.isOverseas).toBe(true);
  });
});

describe('selectionFromItems', () => {
  // 세 플래그의 모든 쌍이 어딘가에서 갈려야 맞바뀜(swap)을 잡는다. 항목이 둘뿐이면
  // 어떤 쌍은 두 항목 모두에서 값이 같을 수 있고(예: 두 항목 다 h=o), 그 쌍은 서로
  // 바꿔 넣어도 출력이 그대로라 안 잡힌다. 그래서 각 플래그가 정확히 한 항목에서만
  // true 인 3항목을 쓴다 — 이러면 임의의 두 플래그를 골라도 반드시 값이 갈리는 항목이
  // 있다(아래 '세 쌍 검산' 참고).
  const items = [
    { masterId: 'a', hideMembershipPriceForNonMembers: true, isVisibleToMembersOnly: false, isOverseas: false },
    { masterId: 'b', hideMembershipPriceForNonMembers: false, isVisibleToMembersOnly: true, isOverseas: false },
    { masterId: 'c', hideMembershipPriceForNonMembers: false, isVisibleToMembersOnly: false, isOverseas: true },
  ];

  it('모든 id 를 선택 상태로 만든다', () => {
    expect(selectionFromItems(items).rowSelection).toEqual({ a: true, b: true, c: true });
  });

  it('masterId 를 스냅샷에 그대로 옮긴다', () => {
    const { snapshots } = selectionFromItems(items);
    expect(snapshots.a.masterId).toBe('a');
    expect(snapshots.b.masterId).toBe('b');
    expect(snapshots.c.masterId).toBe('c');
  });

  // 세 쌍 검산 (h=hideMembershipPriceForNonMembers, v=isVisibleToMembersOnly, o=isOverseas):
  //   h↔v: a 에서 h=true,v=false 로 갈림 → 스왑하면 a.hideMembershipPriceForNonMembers 가
  //        false 로 나와 아래 단언과 어긋난다.
  //   h↔o: a 에서 h=true,o=false 로 갈림(c 에서도 h=false,o=true 로 갈림) → 스왑하면
  //        a.hideMembershipPriceForNonMembers 가 false 로 나와 어긋난다.
  //   v↔o: b 에서 v=true,o=false 로 갈림(c 에서도 v=false,o=true 로 갈림) → 스왑하면
  //        b.isVisibleToMembersOnly 가 false 로 나와 어긋난다.
  // 세 쌍 모두 최소 한 항목에서 값이 갈리므로, 어떤 두 필드를 맞바꿔도 아래 단언 중
  // 하나는 반드시 깨진다.
  it('정책 플래그를 스냅샷에 그대로 옮긴다 — 일괄 정책 모달의 영향 건수가 여기 달렸다', () => {
    const { snapshots } = selectionFromItems(items);
    expect(snapshots.a.hideMembershipPriceForNonMembers).toBe(true);
    expect(snapshots.a.isVisibleToMembersOnly).toBe(false);
    expect(snapshots.a.isOverseas).toBe(false);
    expect(snapshots.b.hideMembershipPriceForNonMembers).toBe(false);
    expect(snapshots.b.isVisibleToMembersOnly).toBe(true);
    expect(snapshots.b.isOverseas).toBe(false);
    expect(snapshots.c.hideMembershipPriceForNonMembers).toBe(false);
    expect(snapshots.c.isVisibleToMembersOnly).toBe(false);
    expect(snapshots.c.isOverseas).toBe(true);
  });

  it('이름과 썸네일은 비운다 — 서버가 주지 않는다', () => {
    const { snapshots } = selectionFromItems(items);
    expect(snapshots.a.name).toBe('');
    expect(snapshots.a.thumbnail).toBeNull();
  });

  it('빈 배열이면 빈 선택을 준다', () => {
    expect(selectionFromItems([])).toEqual({ rowSelection: {}, snapshots: {} });
  });
});

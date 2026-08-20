import { selectEntrancePassword, selectEntrancePasswordForMerge } from './entrance-password.selection';

const at = (iso: string, pw: string | null) => ({ orderDate: new Date(iso), entrancePassword: pw });

describe('selectEntrancePassword', () => {
  it('주문이 하나면 그 비번을 쓴다', () => {
    expect(selectEntrancePassword([at('2026-08-01', '#1111')])).toBe('#1111');
  });

  it('합배송에서 비번이 다르면 최신 주문의 것을 쓴다', () => {
    expect(
      selectEntrancePassword([at('2026-08-01', '#1111'), at('2026-08-03', '#2222'), at('2026-08-02', '#3333')]),
    ).toBe('#2222');
  });

  it('최신 주문에 비번이 없으면 비번 있는 주문 중 최신 것을 쓴다', () => {
    expect(selectEntrancePassword([at('2026-08-01', '#1111'), at('2026-08-03', null)])).toBe('#1111');
  });

  it('아무 주문에도 비번이 없으면 null 이다', () => {
    expect(selectEntrancePassword([at('2026-08-01', null), at('2026-08-03', null)])).toBeNull();
  });

  it('주문이 없으면 null 이다', () => {
    expect(selectEntrancePassword([])).toBeNull();
  });
});

describe('selectEntrancePasswordForMerge', () => {
  const source = (createdIso: string, pw: string | null, orderIsos: (string | null)[]) => ({
    entrancePassword: pw,
    createdAt: new Date(createdIso),
    orderDates: orderIsos.map((iso) => (iso ? new Date(iso) : null)),
  });

  it('원본이 하나면 그 상자의 비번을 그대로 쓴다 — 분할이 비번을 잃으면 안 된다', () => {
    expect(selectEntrancePasswordForMerge([source('2026-08-05', '#1111', ['2026-08-01'])])).toBe('#1111');
  });

  it('합배송에서는 가장 최근 주문을 실은 상자의 비번을 쓴다', () => {
    expect(
      selectEntrancePasswordForMerge([
        source('2026-08-10', '#1111', ['2026-08-01']),
        source('2026-08-10', '#2222', ['2026-08-03']),
        source('2026-08-10', '#3333', ['2026-08-02']),
      ]),
    ).toBe('#2222');
  });

  it('상자가 여러 주문을 실었으면 그 중 최신 주문일이 그 상자를 대표한다', () => {
    // 이미 한 번 합배송된 상자가 다시 합배송될 수 있다. 그 상자의 비번은 자기가 실은
    // 주문 중 최신 것에서 왔으므로, 대표 주문일도 최신 것이어야 순서가 어긋나지 않는다.
    expect(
      selectEntrancePasswordForMerge([
        source('2026-08-10', '#1111', ['2026-08-01', '2026-08-04']),
        source('2026-08-10', '#2222', ['2026-08-03']),
      ]),
    ).toBe('#1111');
  });

  it('비번이 없는 상자는 최신이어도 이기지 않는다', () => {
    expect(
      selectEntrancePasswordForMerge([
        source('2026-08-10', '#1111', ['2026-08-01']),
        source('2026-08-10', null, ['2026-08-09']),
      ]),
    ).toBe('#1111');
  });

  it('주문일을 못 찾으면 상자 생성 시각으로 대신한다 — 순서를 못 정해 조용히 지는 일이 없게', () => {
    expect(
      selectEntrancePasswordForMerge([
        source('2026-08-01', '#1111', [null]),
        source('2026-08-09', '#2222', [null]),
      ]),
    ).toBe('#2222');
  });

  it('어느 상자에도 비번이 없으면 null 이다', () => {
    expect(selectEntrancePasswordForMerge([source('2026-08-10', null, ['2026-08-01'])])).toBeNull();
    expect(selectEntrancePasswordForMerge([])).toBeNull();
  });
});

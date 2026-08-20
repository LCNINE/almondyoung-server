import { selectEntrancePassword } from './entrance-password.selection';

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

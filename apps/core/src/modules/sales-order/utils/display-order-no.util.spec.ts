import { extractDisplayOrderNo } from './display-order-no.util';

describe('extractDisplayOrderNo', () => {
  it('관리자 목록 표기(날짜-번호)에서 번호만 뽑는다', () => {
    expect(extractDisplayOrderNo('20260910-3900')).toBe('3900');
    expect(extractDisplayOrderNo('20260910_3900')).toBe('3900');
    expect(extractDisplayOrderNo('20260910 3900')).toBe('3900');
  });

  it('고객 화면·알림 표기(#번호)와 번호만 입력을 같은 값으로 읽는다', () => {
    expect(extractDisplayOrderNo('#3900')).toBe('3900');
    expect(extractDisplayOrderNo('3900')).toBe('3900');
    expect(extractDisplayOrderNo('  3900  ')).toBe('3900');
  });

  it('선행 0 은 버린다 — display_id 는 0 없이 저장된다', () => {
    expect(extractDisplayOrderNo('0390')).toBe('390');
    expect(extractDisplayOrderNo('20260910-0390')).toBe('390');
    expect(extractDisplayOrderNo('0')).toBe('0');
  });

  it('번호로 읽을 수 없으면 null — 빈 값으로 뭉개 전건 매칭시키지 않는다', () => {
    expect(extractDisplayOrderNo('order_01J8ABC')).toBeNull();
    expect(extractDisplayOrderNo('홍길동')).toBeNull();
    expect(extractDisplayOrderNo('')).toBeNull();
    expect(extractDisplayOrderNo('   ')).toBeNull();
    expect(extractDisplayOrderNo('39-00')).toBeNull();
  });

  it('8자리가 아닌 숫자-숫자는 주문번호 표기가 아니다', () => {
    expect(extractDisplayOrderNo('2026-3900')).toBeNull();
  });
});

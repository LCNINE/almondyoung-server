import {
  resolveSection,
  type SaleProduct,
} from '../../../../../../../packages/time-sale-ui';

const at = (time: string) => Date.parse(`2026-10-07T${time}:00+09:00`);
const sale = {
  startsAt: '2026-10-07T13:00:00+09:00',
  endsAt: '2026-10-07T16:00:00+09:00',
};
const a = {
  startsAt: '2026-10-07T13:00:00+09:00',
  endsAt: '2026-10-07T14:00:00+09:00',
};
const b = {
  startsAt: '2026-10-07T15:00:00+09:00',
  endsAt: '2026-10-07T16:00:00+09:00',
};
const card = (
  id: string,
  period: { startsAt: string; endsAt: string }
): SaleProduct => ({
  id,
  name: id,
  href: `/p/${id}`,
  price: 5000,
  originalPrice: 10000,
  soldOut: false,
  ...period,
});
const hideScheduled = { showScheduled: false, showEnded: false };

describe('섹션 기준 기간', () => {
  it('상세: 현재 상품 A(13-14시) 기준이면 추천 상품이 B(15-16시)뿐이어도 13:30 은 진행 중', () => {
    const section = resolveSection(at('13:30'), {
      sale: a,
      products: [card('b', b)],
      sectionPeriods: [a],
      display: hideScheduled,
    });

    expect(section.period).toEqual(a);
    expect(section.state).toBe('active');
    expect(section.hidden).toBe(false);
    expect(section.products).toEqual([]);
  });

  it('더보기: 현재 페이지가 B 뿐이어도 세일 전체(A, B) 기준으로 타이머가 A 를 따른다', () => {
    const section = resolveSection(at('13:30'), {
      sale,
      products: [card('b', b)],
      sectionPeriods: [a, b],
      display: { showScheduled: true, showEnded: true },
    });

    expect(section.period).toEqual(a);
    expect(section.state).toBe('active');
  });

  it('기준 기간 상태가 표시 설정에서 꺼져 있으면 숨긴다', () => {
    const section = resolveSection(at('12:00'), {
      sale,
      products: [card('a', a)],
      sectionPeriods: [a, b],
      display: hideScheduled,
    });

    expect(section.hidden).toBe(true);
  });

  it('기준 기간이 없으면 받은 상품으로 계산하고 모두 빠지면 숨긴다(어드민 호출 호환)', () => {
    const section = resolveSection(at('13:30'), {
      sale,
      products: [card('b', b)],
      display: hideScheduled,
    });

    expect(section.period).toEqual(b);
    expect(section.hidden).toBe(true);
  });
});

describe('서버 페이지 나누기', () => {
  it('현재 페이지 상품이 기간 필터로 모두 빠져도 페이지 링크가 있으면 숨기지 않는다', () => {
    const section = resolveSection(at('13:30'), {
      sale,
      products: [card('b1', b), card('b2', b)],
      display: hideScheduled,
      paged: true,
    });

    expect(section.products).toEqual([]);
    expect(section.hidden).toBe(false);
  });
});

describe('시계 전·미리보기', () => {
  it('마운트 전(now=0)에는 거르지도 숨기지도 않는다', () => {
    const section = resolveSection(0, {
      sale,
      products: [card('b', b)],
      sectionPeriods: [b],
      display: hideScheduled,
    });

    expect(section.products).toHaveLength(1);
    expect(section.hidden).toBe(false);
  });

  it('미리보기 상태가 있으면 그 상태를 쓰고 거르지 않는다', () => {
    const section = resolveSection(at('13:30'), {
      sale,
      products: [card('b', b)],
      display: hideScheduled,
      previewState: 'ended',
    });

    expect(section.state).toBe('ended');
    expect(section.products).toHaveLength(1);
    expect(section.hidden).toBe(false);
  });
});

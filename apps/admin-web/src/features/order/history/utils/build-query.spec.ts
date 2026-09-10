import { buildQuery } from './build-query';
import type { OrderHistoryFilter } from '../contexts/filter.context';

const base: OrderHistoryFilter = {
  type: 'pending',
  excludeTerminal: true,
  refundIssueOnly: false,
  quickDate: 'today',
  dateFrom: '2026-09-10',
  dateTo: '2026-09-10',
  keywordType: '통합검색',
};

describe('buildQuery — 주문내역 조회 조건', () => {
  it('주문번호 검색은 기간·구분·취소제외를 걸지 않는다', () => {
    const q = buildQuery({ ...base, keywordType: '주문번호', keyword: '20260910-3900' }, 0);
    expect(q.startDate).toBeUndefined();
    expect(q.endDate).toBeUndefined();
    expect(q.typeGroup).toBeUndefined();
    expect(q.excludeTerminal).toBeUndefined();
    expect(q.keyword).toBe('20260910-3900');
    expect(q.keywordType).toBe('orderNo');
  });

  it('주문번호 «유형»만 골라 두고 검색어가 비면 평소 조건 그대로다', () => {
    const q = buildQuery({ ...base, keywordType: '주문번호', keyword: '   ' }, 0);
    expect(q.startDate).toBe('2026-09-10');
    expect(q.typeGroup).toBe('pending');
    expect(q.keyword).toBeUndefined();
  });

  it('다른 키워드 유형은 종전대로 기간·구분을 유지한다', () => {
    const q = buildQuery({ ...base, keywordType: '수령자', keyword: '홍길동' }, 0);
    expect(q.startDate).toBe('2026-09-10');
    expect(q.endDate).toBe('2026-09-10');
    expect(q.typeGroup).toBe('pending');
    expect(q.keywordType).toBe('receiver');
  });

  it('취소/타임아웃 제외는 구분이 전체일 때만 보낸다 (기존 동작)', () => {
    expect(buildQuery({ ...base, type: 'all' }, 0).excludeTerminal).toBe(true);
    expect(buildQuery({ ...base, type: 'pending' }, 0).excludeTerminal).toBeUndefined();
  });

  it('환불이슈 모드는 구분·취소제외를 무시한다 (기존 동작)', () => {
    const q = buildQuery({ ...base, type: 'all', refundIssueOnly: true }, 0);
    expect(q.refundIssueOnly).toBe(true);
    expect(q.typeGroup).toBeUndefined();
    expect(q.excludeTerminal).toBeUndefined();
    // 환불이슈 모드는 기간으로 좁혀 보는 화면이라 기간은 그대로 둔다.
    expect(q.startDate).toBe('2026-09-10');
  });

  it('환불이슈 모드가 켜져 있으면 주문번호 검색이라도 기간을 풀지 않는다', () => {
    const q = buildQuery(
      { ...base, refundIssueOnly: true, keywordType: '주문번호', keyword: '3900' },
      0
    );
    expect(q.startDate).toBe('2026-09-10');
  });

  it('페이지네이션은 종전 그대로', () => {
    expect(buildQuery(base, 2)).toMatchObject({ limit: 50, offset: 100 });
  });
});

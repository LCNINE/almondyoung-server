import { countByReason, selectBackfillTargets } from './1016-backfill-targets';

const q = (externalOrderId: string, channel = 'medusa') => ({ channel, externalOrderId });
const so = (channelOrderId: string, status: string, salesChannel = 'medusa') => ({
  salesChannel,
  channelOrderId,
  status,
});

describe('selectBackfillTargets (#1016 5번 행, 스펙 §9.2)', () => {
  it('끝나지 않은 판매주문만 대상이다 — pending·confirmed·processing', () => {
    const result = selectBackfillTargets(
      [q('a'), q('b'), q('c')],
      [so('a', 'pending'), so('b', 'confirmed'), so('c', 'processing')],
    );
    expect(result.targets).toEqual([q('a'), q('b'), q('c')]);
    expect(result.skipped).toEqual([]);
  });

  it('취소·만료·출고 표시(셀메이트 shipped 포함)·배송완료는 뺀다', () => {
    const result = selectBackfillTargets(
      [q('a'), q('b'), q('c'), q('d')],
      [so('a', 'cancelled'), so('b', 'timeout'), so('c', 'shipped'), so('d', 'delivered')],
    );
    expect(result.targets).toEqual([]);
    expect(countByReason(result.skipped)).toEqual({
      'status:cancelled': 1,
      'status:timeout': 1,
      'status:shipped': 1,
      'status:delivered': 1,
    });
  });

  it('판매주문이 없으면 뺀다 — 보내면 core 가 NotFound 로 DLQ 에 쌓는다', () => {
    const result = selectBackfillTargets([q('a')], []);
    expect(result.targets).toEqual([]);
    expect(result.skipped).toEqual([{ ...q('a'), reason: 'no_sales_order' }]);
  });

  it('채널이 다르면 같은 주문번호라도 짝짓지 않는다', () => {
    const result = selectBackfillTargets([q('a', 'naver')], [so('a', 'pending', 'medusa')]);
    expect(result.skipped).toEqual([{ ...q('a', 'naver'), reason: 'no_sales_order' }]);
  });

  it('입구가 지원하지 않는 채널은 뺀다', () => {
    const result = selectBackfillTargets([q('a', 'coupang')], [so('a', 'pending', 'coupang')]);
    expect(result.skipped).toEqual([{ ...q('a', 'coupang'), reason: 'unsupported_channel' }]);
  });
});

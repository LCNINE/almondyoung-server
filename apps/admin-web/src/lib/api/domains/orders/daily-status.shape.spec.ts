import { normalizeDailyOrderStatus } from './daily-status.shape';
import type { DailyOrderStatusDto } from '@/lib/types/dto/orders';

const point = {
  bucket: '2026-10-18',
  pending: 1,
  preparing: 2,
  shipping: 3,
  delivered: 4,
  cancelled: 0,
  exchange: 0,
  return: 0,
  total: 10,
};

describe('normalizeDailyOrderStatus', () => {
  it('옛 core 응답(externalShipped 없음)은 0 으로 채운다', () => {
    const raw = { range: { from: 'a', to: 'b' }, series: [point] } as unknown as DailyOrderStatusDto;
    const out = normalizeDailyOrderStatus(raw);
    expect(out.series[0].externalShipped).toBe(0);
    expect(out.series[0].preparing).toBe(2);
    expect(out.range).toEqual({ from: 'a', to: 'b' });
  });

  it('새 응답의 값은 그대로 둔다', () => {
    const raw = { range: { from: 'a', to: 'b' }, series: [{ ...point, externalShipped: 7 }] };
    expect(normalizeDailyOrderStatus(raw).series[0].externalShipped).toBe(7);
  });

  it('series 가 비어도(없어도) 죽지 않는다', () => {
    const raw = { range: { from: 'a', to: 'b' } } as unknown as DailyOrderStatusDto;
    expect(normalizeDailyOrderStatus(raw).series).toEqual([]);
  });
});

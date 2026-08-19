import { NaverLastChangedStatusResponseSchema } from './naver.order.zod';
import { LastChangedTypeSchema, ProductOrderStatusSchema } from './naver-core.zod';

describe('네이버 변경 피드 스키마', () => {
  it('DISPATCHED 는 lastChangedType 값이지 productOrderStatus 값이 아니다', () => {
    expect(LastChangedTypeSchema.safeParse('DISPATCHED').success).toBe(true);
    expect(ProductOrderStatusSchema.safeParse('DISPATCHED').success).toBe(false);
  });

  it('발송 완료 항목을 파싱한다', () => {
    const parsed = NaverLastChangedStatusResponseSchema.safeParse({
      timestamp: '2026-08-19T00:00:00.000+09:00',
      traceId: 'trace-1',
      data: {
        count: 1,
        lastChangeStatuses: [
          {
            orderId: '2026081900000',
            productOrderId: '2026081900001',
            lastChangedType: 'DISPATCHED',
            paymentDate: '2026-08-19T00:00:00.000+09:00',
            lastChangedDate: '2026-08-19T01:00:00.000+09:00',
            productOrderStatus: 'DELIVERING',
            receiverAddressChanged: false,
          },
        ],
      },
    });
    expect(parsed.success).toBe(true);
  });

  it('more 객체를 파싱한다 — 페이징 입력이다', () => {
    const parsed = NaverLastChangedStatusResponseSchema.safeParse({
      timestamp: '2026-08-19T00:00:00.000+09:00',
      traceId: 'trace-2',
      data: {
        count: 300,
        lastChangeStatuses: [],
        more: { moreFrom: '2026-08-19T02:00:00.000+09:00', moreSequence: '17' },
      },
    });
    expect(parsed.success).toBe(true);
  });
});

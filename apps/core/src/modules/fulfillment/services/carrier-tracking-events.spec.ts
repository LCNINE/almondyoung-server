import type { CarrierScan } from '../waybill/carrier/carrier-gateway.interface';
import { carrierScansToTrackingEvents } from './carrier-tracking-events';

const dispatchedAt = new Date('2026-09-20T01:00:00.000Z');
const scan = (statusCode: string, status: CarrierScan['status'], iso: string, location?: string): CarrierScan => ({
  statusCode,
  status,
  occurredAt: new Date(iso),
  location,
});

describe('carrierScansToTrackingEvents', () => {
  it('in_transit·delivered 스캔을 시간순 수신 이벤트로 만든다', () => {
    const events = carrierScansToTrackingEvents(
      'HANJIN',
      [
        scan('66', 'delivered', '2026-09-21T06:00:00.000Z', '구로'),
        scan('11', 'in_transit', '2026-09-20T09:00:00.000Z', '부천(집)'),
      ],
      dispatchedAt,
    );
    expect(events).toEqual([
      {
        providerEventId: 'HANJIN:11:2026-09-20T09:00:00.000Z',
        status: 'in_transit',
        occurredAt: '2026-09-20T09:00:00.000Z',
        location: '부천(집)',
      },
      {
        providerEventId: 'HANJIN:66:2026-09-21T06:00:00.000Z',
        status: 'delivered',
        occurredAt: '2026-09-21T06:00:00.000Z',
        location: '구로',
      },
    ]);
  });

  // 수신 경로는 in_transit·delivered 만 안다. 특히 unknown 을 pending 처럼 흘리면 배송 중인 운송장이 뒤로 간다.
  it.each([
    ['01', 'pending'],
    ['08', 'pickup_missed'],
    ['03', 'canceled'],
    ['92', 'failed'],
    ['77', 'unknown'],
  ] as const)('%s(%s) 는 건너뛴다', (statusCode, status) => {
    expect(
      carrierScansToTrackingEvents('HANJIN', [scan(statusCode, status, '2026-09-20T09:00:00.000Z')], dispatchedAt),
    ).toEqual([]);
  });

  // 수신 경로는 출고 전 시각의 이벤트를 TRACKING_EVENT_BEFORE_DISPATCH(409)로 거절한다 — 한진의 07 집하출발은
  // 기사가 «집하하러» 출발한 시각이라 창고 출고보다 앞설 수 있다. 매 주기 409 를 쌓지 않게 미리 거른다.
  it('출고 시각보다 앞선 스캔은 건너뛴다', () => {
    expect(
      carrierScansToTrackingEvents('HANJIN', [scan('07', 'in_transit', '2026-09-20T00:59:59.999Z')], dispatchedAt),
    ).toEqual([]);
  });

  it('시각을 읽을 수 없는 스캔은 건너뛴다', () => {
    expect(carrierScansToTrackingEvents('HANJIN', [scan('11', 'in_transit', 'not-a-date')], dispatchedAt)).toEqual([]);
  });

  // 같은 id 가 다른 payload 로 두 번 가면 수신 경로가 PROVIDER_EVENT_ID_CONFLICT 로 거절한다 — 먼저 온 것만 남긴다.
  it('같은 코드·같은 시각의 스캔은 하나만 남긴다', () => {
    const events = carrierScansToTrackingEvents(
      'HANJIN',
      [
        scan('32', 'in_transit', '2026-09-20T09:00:00.000Z', '대전HUB'),
        scan('32', 'in_transit', '2026-09-20T09:00:00.000Z', '대전HUB2'),
      ],
      dispatchedAt,
    );
    expect(events).toHaveLength(1);
    expect(events[0].location).toBe('대전HUB');
  });

  it('location 이 없으면 필드를 생략한다', () => {
    const [event] = carrierScansToTrackingEvents(
      'HANJIN',
      [scan('11', 'in_transit', '2026-09-20T09:00:00.000Z')],
      dispatchedAt,
    );
    expect(event).not.toHaveProperty('location');
  });
});

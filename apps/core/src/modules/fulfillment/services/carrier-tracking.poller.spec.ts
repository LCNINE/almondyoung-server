import {
  CarrierCapabilities,
  CarrierCode,
  CarrierError,
  CarrierGateway,
  CarrierScan,
} from '../waybill/carrier/carrier-gateway.interface';
import { CarrierGatewayRegistry } from '../waybill/carrier/carrier-gateway.registry';
import { CarrierTrackingPoller, type CarrierTrackingTarget } from './carrier-tracking.poller';

class FakeGateway extends CarrierGateway {
  override readonly capabilities: CarrierCapabilities;
  readonly track: jest.Mock<Promise<CarrierScan[]>, [string]>;
  constructor(
    override readonly carrier: CarrierCode,
    private readonly configured = true,
    canTrack = true,
    track: (waybillNo: string) => Promise<CarrierScan[]> = () => Promise.resolve([]),
  ) {
    super();
    this.capabilities = { allocatesExternally: true, registersSeparately: true, canTrack, canCancel: false };
    this.track = jest.fn(track);
  }
  override isConfigured() {
    return this.configured;
  }
  override allocate(): never {
    throw new Error('unused');
  }
  override register(): never {
    throw new Error('unused');
  }
}

const now = new Date('2026-09-26T03:00:00.000Z');
const dispatchedAt = new Date('2026-09-24T01:00:00.000Z');
const target = (n: number, carrier: CarrierCode = 'HANJIN'): CarrierTrackingTarget => ({
  dispatchAttemptId: `attempt-${n}`,
  dispatchedAt,
  carrier,
  trackingNo: `wbl-${n}`,
});
const scan = (statusCode: string, status: CarrierScan['status'], iso: string): CarrierScan => ({
  statusCode,
  status,
  occurredAt: new Date(iso),
});

type RecordMock = jest.Mock<
  Promise<{ replayed: boolean; status: string }>,
  [string, { providerEventId: string; status: string }]
>;

function makePoller(options: {
  gateways: CarrierGateway[];
  targets?: CarrierTrackingTarget[];
  operational?: boolean;
  record?: RecordMock;
}) {
  const tracking = {
    recordProviderEvent:
      options.record ??
      (jest.fn((_id, input) => Promise.resolve({ replayed: false, status: input.status })) as RecordMock),
  };
  const workflowGate = { shouldRunCarrierTrackingPoll: jest.fn(() => options.operational ?? true) };
  const poller = new CarrierTrackingPoller(
    {} as never,
    new CarrierGatewayRegistry(options.gateways),
    tracking as never,
    workflowGate as never,
  );
  const findTargets = jest.spyOn(poller, 'findTargets').mockResolvedValue(options.targets ?? []);
  return { poller, tracking, findTargets };
}

describe('CarrierTrackingPoller.pollOnce', () => {
  it('정비 모드면 대상을 읽지도 않는다', async () => {
    const { poller, findTargets } = makePoller({ gateways: [new FakeGateway('HANJIN')], operational: false });
    expect(await poller.pollOnce(now)).toMatchObject({ skipped: 'maintenance' });
    expect(findTargets).not.toHaveBeenCalled();
  });

  // 라이브 Core 에는 HANJIN env 가 아직 없다 — 그 상태에서 폴러는 DB 도 캐리어도 건드리지 않아야 한다.
  it('추적 가능한(설정된·canTrack) 캐리어가 없으면 대상을 읽지 않는다', async () => {
    const { poller, findTargets } = makePoller({
      gateways: [new FakeGateway('HANJIN', false), new FakeGateway('CJ', true, false)],
    });
    expect(await poller.pollOnce(now)).toMatchObject({ skipped: 'no_trackable_carrier' });
    expect(findTargets).not.toHaveBeenCalled();
  });

  it('추적 가능한 캐리어로만, 14일 창으로 대상을 읽는다', async () => {
    const { poller, findTargets } = makePoller({
      gateways: [new FakeGateway('HANJIN'), new FakeGateway('CJ', false)],
    });
    await poller.pollOnce(now);
    expect(findTargets).toHaveBeenCalledWith(['HANJIN'], new Date('2026-09-12T03:00:00.000Z'));
  });

  it('스캔을 시간순으로 수신 경로에 넣고 배송완료를 센다', async () => {
    const gateway = new FakeGateway('HANJIN', true, true, () =>
      Promise.resolve([
        scan('66', 'delivered', '2026-09-25T06:00:00.000Z'),
        scan('11', 'in_transit', '2026-09-24T09:00:00.000Z'),
      ]),
    );
    const { poller, tracking } = makePoller({ gateways: [gateway], targets: [target(1)] });

    const result = await poller.pollOnce(now);

    expect(gateway.track).toHaveBeenCalledWith('wbl-1');
    expect(tracking.recordProviderEvent.mock.calls.map(([id, input]) => [id, input.providerEventId])).toEqual([
      ['attempt-1', 'HANJIN:11:2026-09-24T09:00:00.000Z'],
      ['attempt-1', 'HANJIN:66:2026-09-25T06:00:00.000Z'],
    ]);
    expect(result).toMatchObject({ targets: 1, tracked: 1, recorded: 2, delivered: 1 });
  });

  it('이미 기록된 스캔(재생)은 recorded 로 세지 않는다', async () => {
    const gateway = new FakeGateway('HANJIN', true, true, () =>
      Promise.resolve([scan('11', 'in_transit', '2026-09-24T09:00:00.000Z')]),
    );
    const record = jest.fn<ReturnType<RecordMock>, Parameters<RecordMock>>(() =>
      Promise.resolve({ replayed: true, status: 'in_transit' }),
    );
    const { poller } = makePoller({ gateways: [gateway], targets: [target(1)], record });
    expect(await poller.pollOnce(now)).toMatchObject({ recorded: 0 });
  });

  // 확정 거절(예: ERROR-02 체크디지트)은 그 운송장만의 문제다 — 다른 운송장까지 멈추면 안 된다.
  it('운송장 하나의 확정 거절은 그 건만 건너뛰고 계속한다', async () => {
    const gateway = new FakeGateway('HANJIN', true, true, (no) =>
      no === 'wbl-1'
        ? Promise.reject(new CarrierError('bad', 'definitive_rejection', { code: 'ERROR-02' }))
        : Promise.resolve([scan('11', 'in_transit', '2026-09-24T09:00:00.000Z')]),
    );
    const { poller } = makePoller({ gateways: [gateway], targets: [target(1), target(2)] });
    expect(await poller.pollOnce(now)).toMatchObject({ tracked: 1, carrierRejected: 1, recorded: 1 });
  });

  // -103(호출량 초과)·타임아웃은 다음 운송장도 똑같이 맞는다 — 주기를 끝내고 다음 주기에 다시 부른다(#916).
  it.each(['transient_rejection', 'unknown_outcome'] as const)('%s 면 이번 주기를 멈춘다', async (outcome) => {
    const gateway = new FakeGateway('HANJIN', true, true, () =>
      Promise.reject(new CarrierError('rate limited', outcome, { code: '-103' })),
    );
    const { poller } = makePoller({ gateways: [gateway], targets: [target(1), target(2)] });
    const result = await poller.pollOnce(now);
    expect(gateway.track).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ tracked: 0, aborted: '-103' });
  });

  // 뒤 이벤트가 앞 이벤트를 전제한다(in_transit → delivered). 하나가 거절되면 그 운송장의 나머지는 다음 주기로.
  it('수신 경로가 이벤트를 거절하면 그 운송장의 남은 이벤트는 넣지 않고 다음 운송장으로 간다', async () => {
    const gateway = new FakeGateway('HANJIN', true, true, () =>
      Promise.resolve([
        scan('11', 'in_transit', '2026-09-24T09:00:00.000Z'),
        scan('66', 'delivered', '2026-09-25T06:00:00.000Z'),
      ]),
    );
    const record: RecordMock = jest.fn((id, input) =>
      id === 'attempt-1'
        ? Promise.reject(new Error('conflict'))
        : Promise.resolve({ replayed: false, status: input.status }),
    );
    const { poller } = makePoller({ gateways: [gateway], targets: [target(1), target(2)], record });
    const result = await poller.pollOnce(now);
    expect(record.mock.calls.filter(([id]) => id === 'attempt-1')).toHaveLength(1);
    expect(result).toMatchObject({ ingestRejected: 1, recorded: 2, delivered: 1 });
  });

  // 92 배송불가·08 미집하·03 예약취소는 수신 경로에 자리가 없다(#917 분리). 조용히 버리면 적체가 안 보이므로
  // 마지막 스캔이 그 상태인 운송장 수를 센다. 뒤에 11 이 이어졌으면 이미 풀린 예외라 세지 않는다.
  it('마지막 스캔이 예외 상태(92·08·03)인 운송장을 센다', async () => {
    const byNo: Record<string, CarrierScan[]> = {
      'wbl-1': [scan('92', 'failed', '2026-09-25T06:00:00.000Z'), scan('11', 'in_transit', '2026-09-24T09:00:00.000Z')],
      'wbl-2': [
        scan('08', 'pickup_missed', '2026-09-24T09:00:00.000Z'),
        scan('11', 'in_transit', '2026-09-25T09:00:00.000Z'),
      ],
    };
    const gateway = new FakeGateway('HANJIN', true, true, (no) => Promise.resolve(byNo[no]));
    const { poller } = makePoller({ gateways: [gateway], targets: [target(1), target(2)] });
    expect(await poller.pollOnce(now)).toMatchObject({ exceptions: 1 });
  });

  it('대상 캐리어의 게이트웨이를 쓴다', async () => {
    const hanjin = new FakeGateway('HANJIN');
    const cj = new FakeGateway('CJ');
    const { poller } = makePoller({ gateways: [hanjin, cj], targets: [target(1, 'CJ')] });
    await poller.pollOnce(now);
    expect(cj.track).toHaveBeenCalledWith('wbl-1');
    expect(hanjin.track).not.toHaveBeenCalled();
  });
});

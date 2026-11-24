import {
  CarrierCapabilities,
  CarrierCode,
  CarrierError,
  CarrierGateway,
  CarrierScan,
} from '../waybill/carrier/carrier-gateway.interface';
import { CarrierGatewayRegistry } from '../waybill/carrier/carrier-gateway.registry';
import { CarrierTrackingChecker } from '../carrier-tracking/carrier-tracking.checker';
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
  recalled: false,
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
  saveFails?: (savedSoFar: number) => boolean;
}) {
  const tracking = {
    recordProviderEvent:
      options.record ??
      (jest.fn((_id, input) => Promise.resolve({ replayed: false, status: input.status })) as RecordMock),
  };
  const workflowGate = { shouldRunCarrierTrackingPoll: jest.fn(() => options.operational ?? true) };
  const saved: string[] = [];
  const db = {
    run: (fn: (tx: unknown) => Promise<unknown>) =>
      options.saveFails?.(saved.length)
        ? Promise.reject(new Error('db down'))
        : fn({
            insert: () => ({
              values: (row: { dispatchAttemptId: string; outcome: string }) => ({
                onConflictDoUpdate: () => {
                  saved.push(`${row.dispatchAttemptId}:${row.outcome}`);
                  return Promise.resolve();
                },
              }),
            }),
          }),
  };
  const checker = new CarrierTrackingChecker(
    db as never,
    new CarrierGatewayRegistry(options.gateways),
    tracking as never,
  );
  const poller = new CarrierTrackingPoller({} as never, checker, workflowGate as never);
  const findTargets = jest.spyOn(poller, 'findTargets').mockResolvedValue(options.targets ?? []);
  return { poller, tracking, findTargets, saved };
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
        ? Promise.reject(new CarrierError('bad', 'definitive_rejection', { code: 'ERROR-02', invalidWaybill: true }))
        : Promise.resolve([scan('11', 'in_transit', '2026-09-24T09:00:00.000Z')]),
    );
    const { poller } = makePoller({ gateways: [gateway], targets: [target(1), target(2)] });
    expect(await poller.pollOnce(now)).toMatchObject({ tracked: 1, carrierRejected: 1, recorded: 1 });
  });

  // -103(호출량 초과)은 다음 운송장도 똑같이 맞는다 — 주기를 끝내고 다음 주기에 다시 부른다(#916).
  it('호출량 초과면 이번 주기를 멈춘다', async () => {
    const gateway = new FakeGateway('HANJIN', true, true, () =>
      Promise.reject(new CarrierError('rate limited', 'transient_rejection', { code: '-103' })),
    );
    const { poller } = makePoller({ gateways: [gateway], targets: [target(1), target(2)] });
    const result = await poller.pollOnce(now);
    expect(gateway.track).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ tracked: 0, failed: 1, aborted: '-103' });
  });

  it('운송장 하나의 결과를 모르면 그 건만 남기고 계속한다', async () => {
    const gateway = new FakeGateway('HANJIN', true, true, (no) =>
      no === 'wbl-1'
        ? Promise.reject(new CarrierError('timeout', 'unknown_outcome', { code: 'timeout' }))
        : Promise.resolve([scan('11', 'in_transit', '2026-09-24T09:00:00.000Z')]),
    );
    const { poller, saved } = makePoller({ gateways: [gateway], targets: [target(1), target(2), target(3)] });
    const result = await poller.pollOnce(now);
    expect(result).toMatchObject({ tracked: 2, failed: 1, recorded: 2 });
    expect(result.aborted).toBeUndefined();
    expect(saved).toEqual(['attempt-1:unknown', 'attempt-2:scans', 'attempt-3:scans']);
  });

  it('잇달아 세 번 못 물으면 택배사 장애로 보고 멈춘다', async () => {
    const gateway = new FakeGateway('HANJIN', true, true, () =>
      Promise.reject(new CarrierError('down', 'unknown_outcome', { code: 'http_503' })),
    );
    const { poller, saved } = makePoller({ gateways: [gateway], targets: [1, 2, 3, 4].map((n) => target(n)) });
    expect(await poller.pollOnce(now)).toMatchObject({ failed: 3, aborted: 'http_503' });
    expect(gateway.track).toHaveBeenCalledTimes(3);
    expect(saved).toHaveLength(3);
  });

  it('사이에 답한 운송장이 있으면 연속으로 세지 않는다', async () => {
    const gateway = new FakeGateway('HANJIN', true, true, (no) =>
      no === 'wbl-3' ? Promise.resolve([]) : Promise.reject(new CarrierError('down', 'unknown_outcome', {})),
    );
    const { poller } = makePoller({ gateways: [gateway], targets: [1, 2, 3, 4, 5].map((n) => target(n)) });
    const result = await poller.pollOnce(now);
    expect(result).toMatchObject({ failed: 4, tracked: 1 });
    expect(result.aborted).toBeUndefined();
  });

  it('확인 결과를 남기지 못한 운송장이 나머지를 멈추지 않는다', async () => {
    const gateway = new FakeGateway('HANJIN');
    let first = true;
    const { poller } = makePoller({
      gateways: [gateway],
      targets: [target(1), target(2)],
      saveFails: () => {
        const fails = first;
        first = false;
        return fails;
      },
    });
    expect(await poller.pollOnce(now)).toMatchObject({ failed: 1, tracked: 1 });
  });

  it('되돌린 출고는 묻기만 하고 배송 이력에 넣지 않는다', async () => {
    const gateway = new FakeGateway('HANJIN', true, true, () =>
      Promise.resolve([scan('11', 'in_transit', '2026-09-24T09:00:00.000Z')]),
    );
    const { poller, tracking, saved } = makePoller({
      gateways: [gateway],
      targets: [{ ...target(1), recalled: true }],
    });
    expect(await poller.pollOnce(now)).toMatchObject({ tracked: 1, recorded: 0 });
    expect(tracking.recordProviderEvent).not.toHaveBeenCalled();
    expect(saved).toEqual(['attempt-1:scans']);
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

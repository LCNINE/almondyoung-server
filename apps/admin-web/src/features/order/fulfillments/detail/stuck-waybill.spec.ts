import type { ShipmentWaybillHistory } from '@/lib/types/dto/fulfillment';
import {
  abandonRisks,
  stuckReason,
  stuckWaybillOf,
  waybillErrorMessage,
} from './stuck-waybill';

const waybill = (
  over: Partial<ShipmentWaybillHistory>
): ShipmentWaybillHistory => ({
  id: 'wb-1',
  status: 'pending',
  trackingNo: null,
  carrier: 'HANJIN',
  manifestVersion: 3,
  issuedAt: null,
  voidedAt: null,
  lastError: null,
  nextAttemptAt: null,
  ...over,
});

const conflict = (message: string) => ({
  response: { status: 409, data: { code: 'CONFLICT', message } },
});

describe('stuckWaybillOf', () => {
  it('종료·발급된 송장만 있으면 멈춘 게 아니다', () => {
    expect(
      stuckWaybillOf({
        manifestVersion: 3,
        waybills: [
          waybill({ id: 'a', status: 'abandoned' }),
          waybill({ id: 'b', status: 'registered', trackingNo: '1' }),
        ],
      })
    ).toBeNull();
  });

  it('pending·allocated 행을 멈춘 송장으로 고른다', () => {
    const stuck = stuckWaybillOf({
      manifestVersion: 3,
      waybills: [
        waybill({ id: 'old', status: 'failed' }),
        waybill({ id: 'now', status: 'allocated', trackingNo: '5100' }),
      ],
    });
    expect(stuck?.waybill.id).toBe('now');
    expect(stuck?.contentChanged).toBe(false);
    expect(stuck && stuckReason(stuck)).toBeNull();
  });

  it('발급 시작 뒤 상자 내용이 바뀌면 이어 갈 수 없다고 알린다', () => {
    const stuck = stuckWaybillOf({
      manifestVersion: 4,
      waybills: [waybill({ manifestVersion: 3 })],
    });
    expect(stuck?.contentChanged).toBe(true);
    expect(stuck && stuckReason(stuck)).toBe(
      '상자 내용이 발급을 시작할 때와 달라 이어서 발급할 수 없어요.'
    );
  });

  it('일시적 거절로 기다리는 중이면 재시도 시각을 알린다', () => {
    const stuck = stuckWaybillOf(
      {
        manifestVersion: 3,
        waybills: [waybill({ nextAttemptAt: '2026-11-10T00:00:00.000Z' })],
      },
      new Date('2026-11-09T12:00:00.000Z')
    );
    expect(stuck && stuckReason(stuck)).toMatch(
      /^일시적 거절 — .* 이후 재시도$/
    );
  });

  it('옛 core 응답(lastError·nextAttemptAt 없음)도 받는다', () => {
    const { lastError: _l, nextAttemptAt: _n, ...old } = waybill({});
    expect(
      stuckWaybillOf({ manifestVersion: 3, waybills: [old] })?.retryNotice
    ).toBeNull();
  });
});

describe('abandonRisks', () => {
  it('allocated 는 받은 번호를 짚고 그 번호의 송장을 붙이지 말라고 한다', () => {
    const stuck = stuckWaybillOf({
      manifestVersion: 3,
      waybills: [waybill({ status: 'allocated', trackingNo: '510012345678' })],
    });
    const [first] = abandonRisks(stuck!);
    expect(first).toContain('510012345678');
    expect(first).toContain('붙이지 마세요');
  });

  it('pending 은 번호를 받았는지 모른다고 한다', () => {
    const stuck = stuckWaybillOf({
      manifestVersion: 3,
      waybills: [waybill({})],
    });
    expect(abandonRisks(stuck!)[0]).toContain('받았는지 확인되지 않았어요');
  });
});

describe('waybillErrorMessage', () => {
  it.each([
    [
      'WAYBILL_ABANDON_NOT_ALLOWED: wb-1 is registered',
      '그 사이 발급이 끝났어요. 중단할 필요가 없어요.',
    ],
    [
      'WAYBILL_ABANDON_NOT_ALLOWED: wb-1 is abandoned',
      '이미 끝난 발급이에요. 새로 발급하면 돼요.',
    ],
    [
      'WAYBILL_ABANDON_NOT_ALLOWED: wb-1 changed concurrently',
      '그 사이 송장 상태가 바뀌었어요. 화면을 다시 확인하세요.',
    ],
    [
      'WAYBILL_ABANDON_NOT_ALLOWED: reason required',
      '중단 사유를 적어 주세요.',
    ],
    [
      'WAYBILL_ABANDON_NOT_ALLOWED: active waybill is allocated; operator abandon required before reissue',
      '멈춘 발급이 있어요. 먼저 발급을 중단하세요.',
    ],
    ['WAYBILL_ACTIVE_EXISTS: s-1', '이 상자에 이미 진행 중인 송장이 있어요.'],
    [
      'WAYBILL_STALE_MANIFEST_VERSION: 4 != 3',
      '그 사이 상자 내용이 바뀌었어요. 화면을 다시 확인하고 발급하세요.',
    ],
    [
      'WAYBILL_NOT_DISPATCHABLE: shipment draft',
      '계획을 확정한 상자만 송장을 발급할 수 있어요. 출고 준비 화면에서 다시 준비하세요.',
    ],
    [
      'WAYBILL_TRANSIENT_CAP_EXCEEDED (3)',
      '한진이 계속 거절해 발급을 멈췄어요. 잠시 뒤 다시 발급하세요.',
    ],
  ])('%s', (message, expected) => {
    expect(waybillErrorMessage(conflict(message), '실패')).toBe(expected);
  });

  it('모르는 거절은 공용 문구로 돌린다', () => {
    expect(waybillErrorMessage(conflict('SOMETHING_ELSE: x'), '실패')).toBe(
      '다른 작업으로 상태가 변경되어 서버가 작업을 거부했습니다. SOMETHING_ELSE: x'
    );
  });
});

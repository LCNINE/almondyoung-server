import { RetryChannelSettlementRule } from './retry-channel-settlement.rule';
import type { DbTx } from '../../../inventory/schema/inventory.schema';

describe('RetryChannelSettlementRule (#1016 36번)', () => {
  const tx = {} as DbTx;
  const service = {
    settlementFingerprint: jest.fn().mockResolvedValue('r1:auto:2026-10-12T01:00:00.000Z'),
    hasSettlementToReissue: jest.fn().mockResolvedValue(true),
    reissueSettlements: jest.fn().mockResolvedValue(0),
  };
  const rule = new RetryChannelSettlementRule(service as never);

  it('실행 모드 — channel-adapter 가 일시 실패를 ack 하므로 다시 부르는 곳은 여기 하나다(PR 6)', () => {
    expect(rule.mode).toBe('act');
    expect(rule.row).toBe(36);
    expect(rule.situation).toEqual({ stage: 'cancel_request', states: ['settle_in_progress', 'settle_delayed'] });
    // 막 (다시) 시작한 정산은 60초 유예 안이라 첫 평가가 «할 일 없음»이 된다 — 10분이 아니라 1분 뒤에 다시 본다(스모크 발견 ④)
    expect(rule.idleRecheckMin).toBe(1);
  });

  it('거절(settle_refused)은 칸에 없다 — 리컨실러는 영구 거절을 다시 부르지 않는다', () => {
    expect(rule.situation.states).not.toContain('settle_refused');
  });

  it('다시 낸 것이 없으면 noop — 시도로 세지 않는다(D13 of 12번 스펙)', async () => {
    expect(await rule.act('so-1', tx)).toBe('noop');
    service.reissueSettlements.mockResolvedValueOnce(1);
    expect(await rule.act('so-1', tx)).toBe('acted');
  });

  it('지문·검사는 서비스에 위임한다', async () => {
    expect(await rule.fingerprint('so-1', tx)).toBe('r1:auto:2026-10-12T01:00:00.000Z');
    expect(await rule.check('so-1', tx)).toBe(true);
    expect(service.hasSettlementToReissue).toHaveBeenCalledWith('so-1', expect.any(Date), tx);
  });
});

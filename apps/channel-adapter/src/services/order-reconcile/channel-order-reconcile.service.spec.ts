import { ConflictError, NotFoundError } from '@app/shared';
import { ChannelOrderReconcileService } from './channel-order-reconcile.service';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'f1',
  channel: 'medusa',
  externalOrderId: 'order_1',
  kind: 'missing_order',
  status: 'open',
  humanReason: 'out_of_window',
  mode: 'observe',
  ...over,
});

function setup(found: unknown, opts: { block?: string | null; redeliverThrows?: boolean } = {}) {
  const repo = {
    findById: jest.fn(async () => found),
    close: jest.fn(async (): Promise<unknown> => ({ ...row(), status: 'closed' })),
    recordAttempt: jest.fn(async () => undefined),
  };
  const redelivery = {
    redeliver: jest.fn(async () => {
      if (opts.redeliverThrows) throw new Error('outbox down');
      return 'enqueued';
    }),
  };
  const manager = { manualRedeliveryBlock: jest.fn(async () => opts.block ?? null) };
  const service = new ChannelOrderReconcileService(repo as never, redelivery as never, manager as never);
  return { service, repo, redelivery, manager };
}

describe('ChannelOrderReconcileService', () => {
  it('수동 다시 배달은 관찰 모드·3일 밖이어도 실행한다', async () => {
    const { service, redelivery } = setup(row());
    await expect(service.redeliverFinding('f1')).resolves.toEqual({ result: 'enqueued' });
    expect(redelivery.redeliver).toHaveBeenCalledWith(expect.objectContaining({ id: 'f1' }));
  });

  it('지금 이벤트 실패가 열려 있으면 409 — 저장된 사유가 아니라 지금 상태로 본다 (리뷰 I-3)', async () => {
    const { service, redelivery } = setup(row({ humanReason: 'out_of_window' }), { block: 'event_failure_open' });
    await expect(service.redeliverFinding('f1')).rejects.toBeInstanceOf(ConflictError);
    expect(redelivery.redeliver).not.toHaveBeenCalled();
  });

  it('저장된 사유가 event_failure_open 이어도 지금 풀렸으면 보낸다 (리뷰 I-3)', async () => {
    const { service } = setup(row({ humanReason: 'event_failure_open' }), { block: null });
    await expect(service.redeliverFinding('f1')).resolves.toEqual({ result: 'enqueued' });
  });

  it('core 가 받을 수 없는 취소(출고된 SO)는 409 (리뷰 I-5)', async () => {
    const { service } = setup(row({ kind: 'cancel_not_applied', humanReason: 'core_status' }), { block: 'core_status' });
    await expect(service.redeliverFinding('f1')).rejects.toBeInstanceOf(ConflictError);
  });

  it('다시 배달이 던지면 오류를 시도로 남기고 다시 던진다 (리뷰 I-7)', async () => {
    const { service, repo } = setup(row(), { redeliverThrows: true });
    await expect(service.redeliverFinding('f1')).rejects.toThrow('outbox down');
    expect(repo.recordAttempt).toHaveBeenCalledWith('f1', 'error: outbox down');
  });

  it('없거나 닫힌 행은 404', async () => {
    await expect(setup(null).service.redeliverFinding('f1')).rejects.toBeInstanceOf(NotFoundError);
    await expect(setup(row({ status: 'closed' })).service.redeliverFinding('f1')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('종결은 열린 행만, 아니면 404', async () => {
    const { service, repo } = setup(row());
    await expect(service.closeFinding('f1', 'admin-1', '셀메이트로 나감')).resolves.toMatchObject({ status: 'closed' });
    repo.close.mockResolvedValueOnce(null);
    await expect(service.closeFinding('f1', 'admin-1', 'x')).rejects.toBeInstanceOf(NotFoundError);
  });
});

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

function setup(found: unknown) {
  const repo = {
    findById: jest.fn(async () => found),
    close: jest.fn(async (): Promise<unknown> => ({ ...row(), status: 'closed' })),
  };
  const redelivery = { redeliver: jest.fn(async () => 'enqueued') };
  const service = new ChannelOrderReconcileService(repo as never, redelivery as never, {} as never);
  return { service, repo, redelivery };
}

describe('ChannelOrderReconcileService', () => {
  it('수동 다시 배달은 관찰 모드·3일 밖이어도 실행한다', async () => {
    const { service, redelivery } = setup(row());
    await expect(service.redeliverFinding('f1')).resolves.toEqual({ result: 'enqueued' });
    expect(redelivery.redeliver).toHaveBeenCalledWith(expect.objectContaining({ id: 'f1' }));
  });

  it('이벤트 실패가 열린 행은 409', async () => {
    const { service } = setup(row({ humanReason: 'event_failure_open' }));
    await expect(service.redeliverFinding('f1')).rejects.toBeInstanceOf(ConflictError);
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

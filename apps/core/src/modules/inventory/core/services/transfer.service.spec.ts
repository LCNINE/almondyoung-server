import { TransferService } from './transfer.service';
import { wmsSchema } from '../../schema/inventory.schema';
import { DbService } from '@app/db';

/**
 * executeTransferJob 재실행 가드 단위 테스트 — DB 불요.
 * trx 는 executeTransferJob 이 실제로 부르는 메서드만 최소 대역으로 모킹한다.
 */
function buildTrx(opts: {
  job: { id: string; journalId: string | null };
  lines: Array<{
    id: string;
    skuId: string;
    quantity: number;
    fromLocationId: string | null;
    toLocationId: string | null;
    eventId: string | null;
    memo: string | null;
  }>;
  fromLoc: { warehouseId: string };
  toLoc: { warehouseId: string };
}) {
  // .select().from().where().for('update') → [job]  (FOR UPDATE 잠금 조회)
  const selectChain = {
    from: () => ({ where: () => ({ for: () => Promise.resolve([opts.job]) }) }),
  };
  const findFirstLoc = jest.fn().mockResolvedValueOnce(opts.fromLoc).mockResolvedValueOnce(opts.toLoc);
  const trx = {
    select: () => selectChain,
    query: {
      movementJobLines: { findMany: jest.fn().mockResolvedValue(opts.lines) },
      locations: { findFirst: findFirstLoc },
    },
    update: () => ({ set: () => ({ where: () => Promise.resolve(undefined) }) }),
    insert: () => ({ values: () => Promise.resolve(undefined) }),
    execute: jest.fn().mockResolvedValue(undefined),
  };
  return trx as never;
}

function build(trx: unknown) {
  const dbService = { run: (fn: (t: unknown) => unknown) => fn(trx) } as unknown as DbService<typeof wmsSchema>;
  const transferBetweenWarehouses = jest.fn().mockResolvedValue({ shipEventId: 'se', receiveEventId: 're' });
  const stockEventService = { transferBetweenWarehouses } as never;
  const commandService = { moveInternal: jest.fn() } as never;
  const svc = new TransferService(dbService, stockEventService, commandService);
  return { svc, transferBetweenWarehouses };
}

describe('TransferService.executeTransferJob 재실행 가드', () => {
  it('전 라인이 기실행(eventId 설정)이면 transferBetweenWarehouses 를 부르지 않는다(멱등 no-op)', async () => {
    const trx = buildTrx({
      job: { id: 'job1', journalId: 'j1' },
      lines: [
        { id: 'l1', skuId: 's', quantity: 5, fromLocationId: 'lf', toLocationId: 'lt', eventId: 'e1', memo: null },
        { id: 'l2', skuId: 's', quantity: 3, fromLocationId: 'lf', toLocationId: 'lt', eventId: 'e2', memo: null },
      ],
      fromLoc: { warehouseId: 'A' },
      toLoc: { warehouseId: 'B' },
    });
    const { svc, transferBetweenWarehouses } = build(trx);
    const result = await svc.executeTransferJob({ jobId: 'job1' });
    expect(transferBetweenWarehouses).not.toHaveBeenCalled();
    expect(result).toEqual({ jobId: 'job1', linesExecuted: 0 });
  });

  it('미실행 창고간 라인(eventId=null)은 transferBetweenWarehouses 로 무손실 이송한다', async () => {
    const trx = buildTrx({
      job: { id: 'job2', journalId: 'j2' },
      lines: [
        { id: 'l1', skuId: 's1', quantity: 7, fromLocationId: 'lf', toLocationId: 'lt', eventId: null, memo: 'm' },
      ],
      fromLoc: { warehouseId: 'A' },
      toLoc: { warehouseId: 'B' },
    });
    const { svc, transferBetweenWarehouses } = build(trx);
    const result = await svc.executeTransferJob({ jobId: 'job2' });
    expect(transferBetweenWarehouses).toHaveBeenCalledTimes(1);
    expect(transferBetweenWarehouses).toHaveBeenCalledWith('s1', 'A', 'lf', 'B', 'lt', 7, 'm', trx);
    expect(result).toEqual({ jobId: 'job2', linesExecuted: 1 });
  });
});

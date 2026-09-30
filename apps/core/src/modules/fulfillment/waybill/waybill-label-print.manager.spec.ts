import { DbService } from '@app/db';
import { DbTx, inventorySchema } from '../../inventory/schema/inventory.schema';
import { WaybillLabelContentAssembler, type PrintableLabel } from './waybill-label-content.assembler';
import { WaybillLabelPrintManager } from './waybill-label-print.manager';
import { WaybillLabelPrintRepository } from './waybill-label-print.repository';

/**
 * 잠금 순서(스펙 §13, 원장 Ruling F2): 박스 KEY SHARE → 활성 작업 항목 FOR UPDATE → 조립·기록.
 * 동시성 교착은 단위로 재현할 수 없어 호출 순서로 지킨다 — 발송이 박스 → 작업 항목 순이다.
 */
describe('WaybillLabelPrintManager.confirm — 잠금 순서', () => {
  const trx = {} as DbTx;
  const fingerprint = 'f'.repeat(64);

  function setup(shipment: { id: string } | null, activeWorkItem: { id: string } | null) {
    const calls: string[] = [];
    const prints = {
      lockShipmentKey: jest.fn(async () => {
        calls.push('lockShipmentKey');
        return shipment;
      }),
      lockActiveWorkItem: jest.fn(async () => {
        calls.push('lockActiveWorkItem');
        return activeWorkItem;
      }),
      listByShipments: jest.fn(async () => {
        calls.push('listByShipments');
        return [];
      }),
      record: jest.fn(async (_trx: DbTx, row: { fingerprint: string; revision: number }) => {
        calls.push('record');
        return { fingerprint: row.fingerprint, revision: row.revision, itemsSnapshot: [], printedAt: new Date(0) };
      }),
    };
    // 조립 결과는 이 테스트가 보는 필드(kind·fingerprint·content.items)만 채운다 — 나머지 모양은 조립 스펙이 지킨다.
    const label = { kind: 'printable', fingerprint, content: { items: [] } } as unknown as PrintableLabel;
    const assembler = {
      current: jest.fn(async () => {
        calls.push('assemble');
        return label;
      }),
    };
    const dbService = { run: (fn: (tx: DbTx) => Promise<unknown>) => fn(trx) };
    const manager = new WaybillLabelPrintManager(
      assembler as unknown as WaybillLabelContentAssembler,
      prints as unknown as WaybillLabelPrintRepository,
      dbService as unknown as DbService<typeof inventorySchema>,
    );
    return { manager, calls, prints };
  }

  it('박스 KEY SHARE 를 작업 항목 잠금보다 먼저 잡는다', async () => {
    const { manager, calls } = setup({ id: 'shp' }, { id: 'wi' });
    await manager.confirm('shp', fingerprint, { id: 'actor' });
    expect(calls).toEqual(['lockShipmentKey', 'lockActiveWorkItem', 'assemble', 'listByShipments', 'record']);
  });

  it('출고된 박스(활성 작업 항목 없음)도 진행해 기록한다', async () => {
    const { manager, calls } = setup({ id: 'shp' }, null);
    await expect(manager.confirm('shp', fingerprint, { id: 'actor' })).resolves.toMatchObject({ revision: 1 });
    expect(calls).toContain('record');
  });

  it('박스가 없으면 WAYBILL_SHIPMENT_NOT_FOUND — 작업 항목을 잠그지 않는다', async () => {
    const { manager, prints } = setup(null, null);
    await expect(manager.confirm('shp', fingerprint, { id: 'actor' })).rejects.toThrow(/^WAYBILL_SHIPMENT_NOT_FOUND:/);
    expect(prints.lockActiveWorkItem).not.toHaveBeenCalled();
  });
});

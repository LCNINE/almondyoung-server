import { randomUUID } from 'crypto';
import { eq, sql as rawSql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { isPreparationBlocked } from '../services/outbound-preparation-result';
import {
  ambientDbService,
  assembleOutbound,
  inRollbackTx,
  makeDb,
  seedPickableShipment,
  startBatchFor,
} from '../services/__support__';
import { assembleLabels, promoteToCarrierWaybill } from './__support__/label-fixtures';
import { LabelCurrencyGuard } from './label-currency.guard';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('재출력 게이트 (I5)', () => {
  jest.setTimeout(120_000);
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => sql.end({ timeout: 5 }));

  const actorOf = (box: { actorId: string }) => ({ id: box.actorId, roles: ['logistics_worker'] });

  async function preparedBox(tx: DbTx, qty: number, carrier: boolean) {
    const box = await seedPickableShipment(tx, qty);
    if (carrier) await promoteToCarrierWaybill(tx, box);
    await startBatchFor(tx, box);
    const { simple } = assembleOutbound(tx);
    await simple.prepare(box.shipmentId, actorOf(box), `prep-${randomUUID()}`, tx);
    const scan = (key: string) =>
      simple.scan(box.shipmentId, { barcode: box.barcode, quantity: 1, actor: actorOf(box), idempotencyKey: key }, tx);
    return { box, scan, labels: assembleLabels(ambientDbService(tx)) };
  }

  async function printCurrent(
    tx: DbTx,
    box: { shipmentId: string; actorId: string },
    labels: ReturnType<typeof assembleLabels>,
  ) {
    const { fingerprint } = await labels.render.render(box.shipmentId, tx);
    await labels.confirm.confirm(box.shipmentId, fingerprint, { id: box.actorId }, tx);
  }

  it('한진 송장 박스는 출력 확인 전에는 피킹 스캔이 LABEL_REPRINT_REQUIRED, 확인 뒤엔 진행된다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, scan, labels } = await preparedBox(tx, 2, true);
      await expect(scan(`scan-${randomUUID()}`)).rejects.toMatchObject({
        response: { code: 'LABEL_REPRINT_REQUIRED' },
      });
      await printCurrent(tx, box, labels);
      const state = await scan(`scan-${randomUUID()}`);
      expect(isPreparationBlocked(state)).toBe(false);
      // 한진 송장 박스가 검수·발송(lockAggregate 게이트)까지 통과해 끝까지 출고된다.
      const last = await scan(`scan-${randomUUID()}`);
      if (isPreparationBlocked(last)) throw new Error('Expected prepared outbound state');
      expect(last.status).toBe('shipped');
    });
  });

  it('피킹 게이트를 다 통과한 뒤 발송 직전(lockAggregate)에 송장이 바뀌면 발송이 LABEL_REPRINT_REQUIRED 로 거절된다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, scan, labels } = await preparedBox(tx, 1, true);
      await printCurrent(tx, box, labels);
      const original = LabelCurrencyGuard.prototype.assertCurrent;
      const callers: boolean[] = [];
      const spy = jest.spyOn(LabelCurrencyGuard.prototype, 'assertCurrent').mockImplementation(async function (
        this: LabelCurrencyGuard,
        ...args: Parameters<typeof original>
      ) {
        const fromDispatch = new Error().stack?.includes('lockAggregate') ?? false;
        callers.push(fromDispatch);
        if (fromDispatch) {
          await tx
            .update(wmsTables.shipments)
            .set({ entrancePassword: '#9999' })
            .where(eq(wmsTables.shipments.id, box.shipmentId));
        }
        return original.apply(this, args);
      });
      try {
        // 이 스캔은 discrete scan·completePick 게이트를 지나 lockAggregate 게이트에서만 걸린다.
        await expect(scan(`scan-${randomUUID()}`)).rejects.toMatchObject({
          response: { code: 'LABEL_REPRINT_REQUIRED' },
        });
        expect(callers.filter(Boolean)).toHaveLength(1);
        expect(callers.filter((c) => !c).length).toBeGreaterThanOrEqual(1);
      } finally {
        spy.mockRestore();
      }
    });
  });

  it('송장 내용이 바뀌면 다음 스캔이 막히고, 이미 처리된 스캔의 같은 키 재전송은 막히지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, scan, labels } = await preparedBox(tx, 2, true);
      await printCurrent(tx, box, labels);
      const key = `scan-${randomUUID()}`;
      const first = await scan(key);
      await tx
        .update(wmsTables.shipments)
        .set({ entrancePassword: '#9999' })
        .where(eq(wmsTables.shipments.id, box.shipmentId));
      const replay = await scan(key);
      expect(replay).toEqual(first);
      await expect(scan(`scan-${randomUUID()}`)).rejects.toMatchObject({
        response: { code: 'LABEL_REPRINT_REQUIRED' },
      });
    });
  });

  it('작업 도중 수하인이 바뀌면 전진 스캔은 WAYBILL_STALE 코드로 거절된다(앱이 읽는 code)', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, scan, labels } = await preparedBox(tx, 2, true);
      await printCurrent(tx, box, labels);
      await tx
        .update(wmsTables.shipments)
        .set({ recipientSnapshot: rawSql`recipient_snapshot || '{"detailAddress":"CHANGED"}'::jsonb` })
        .where(eq(wmsTables.shipments.id, box.shipmentId));
      await expect(scan(`scan-${randomUUID()}`)).rejects.toMatchObject({ response: { code: 'WAYBILL_STALE' } });
    });
  });

  it('수기 송장 박스는 출력 기록 없이도 끝까지 출고된다(면제)', async () => {
    await inRollbackTx(db, async (tx) => {
      const { scan } = await preparedBox(tx, 1, false);
      const state = await scan(`scan-${randomUUID()}`);
      if (isPreparationBlocked(state)) throw new Error('Expected prepared outbound state');
      expect(state.status).toBe('shipped');
    });
  });

  // 원장 Ruling F3 — 출고된 박스도 송장을 다시 뽑을 수 있어야 한다(#913 동작). 활성 작업 항목이 없으면 출고 완료된
  // 마지막 작업 항목의 배정으로 그린다. 배정은 불변이라 출력 때와 같은 내용·지문이다.
  it('출고 완료(shipped)된 한진 박스도 같은 지문·판차 1 로 다시 렌더되고 출력 확인된다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, scan, labels } = await preparedBox(tx, 1, true);
      const printed = await labels.render.render(box.shipmentId, tx);
      await labels.confirm.confirm(box.shipmentId, printed.fingerprint, { id: box.actorId }, tx);
      const last = await scan(`scan-${randomUUID()}`);
      if (isPreparationBlocked(last)) throw new Error('Expected prepared outbound state');
      expect(last.status).toBe('shipped');
      const [workItem] = await tx
        .select({ status: wmsTables.outboundBatchWorkItems.status })
        .from(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.id, box.workItemId));
      expect(workItem.status).toBe('completed');

      const again = await labels.render.render(box.shipmentId, tx);
      expect(again).toMatchObject({ fingerprint: printed.fingerprint, revision: 1 });
      const confirmed = await labels.confirm.confirm(box.shipmentId, again.fingerprint, { id: box.actorId }, tx);
      expect(confirmed.revision).toBe(1);
    });
  });

  it('작업 항목이 excluded 뿐인 박스는 배정이 있어도 WAYBILL_LABEL_NOT_ALLOCATED', async () => {
    await inRollbackTx(db, async (tx) => {
      const box = await seedPickableShipment(tx, 1);
      await promoteToCarrierWaybill(tx, box);
      await startBatchFor(tx, box);
      await tx
        .update(wmsTables.outboundBatchWorkItems)
        .set({ status: 'excluded', exclusionReason: 'test' })
        .where(eq(wmsTables.outboundBatchWorkItems.id, box.workItemId));
      const labels = assembleLabels(ambientDbService(tx));
      await expect(labels.render.render(box.shipmentId, tx)).rejects.toThrow(/^WAYBILL_LABEL_NOT_ALLOCATED:/);
    });
  });
});

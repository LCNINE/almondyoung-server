import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb, makeDbService } from '../services/__support__';
import * as f from '../order-progress/__support__/order-progress.fixtures';
import { DirectShipController } from './direct-ship.controller';
import { SupplierHandoffService } from '../supplier-shipment/supplier-handoff.service';
import { SupplierSheetApplyService } from '../supplier-shipment/supplier-sheet-apply.service';
import { SupplierShipmentQueueReader } from '../supplier-shipment/supplier-shipment-queue.reader';
import { SupplierHandoffListReader } from '../supplier-shipment/supplier-handoff-list.reader';
import { DirectShipService } from '../services/direct-ship.service';
import { DirectShipCancelNoticeService } from '../direct-ship-cancel-notice/direct-ship-cancel-notice.service';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('POST /direct-ship/suppliers/:supplierId/handoffs — 사유는 쓰기 전에 (K3 PR7, N4)', () => {
  jest.setTimeout(60_000);
  const { sql: client, db } = makeDb(DATABASE_URL as string);
  let controller: DirectShipController;
  let handoffs: SupplierHandoffService;
  let handOffSpy: jest.SpyInstance;

  beforeAll(async () => {
    handoffs = new SupplierHandoffService(makeDbService(db));
    const module = await Test.createTestingModule({
      controllers: [DirectShipController],
      providers: [
        { provide: DirectShipService, useValue: {} },
        { provide: SupplierShipmentQueueReader, useValue: {} },
        { provide: SupplierHandoffListReader, useValue: {} },
        { provide: SupplierHandoffService, useValue: handoffs },
        { provide: SupplierSheetApplyService, useValue: {} },
        { provide: DirectShipCancelNoticeService, useValue: {} },
      ],
    }).compile();
    controller = module.get(DirectShipController);
  });
  beforeEach(() => {
    handOffSpy = jest.spyOn(handoffs, 'handOff');
  });
  afterEach(() => handOffSpy.mockRestore());
  afterAll(async () => {
    await client.end();
  });

  const user = { id: 'op-1' };

  it.each([undefined, '', encodeURIComponent('1234')])(
    '사유 %p 면 400 이고 묶음도 상자의 넘김도 남지 않는다',
    async (reason) => {
      await inRollbackTx(db, async (tx) => {
        const w = await f.seedWorld(tx);
        const a = await f.seedDirectSupplier(tx);
        const order = await f.seedOrder(tx);
        const fo = await f.seedFo(tx, w, order);
        const box = await f.seedBox(tx, w, [fo.foItemId], { status: 'draft', supplierId: a });

        await expect(controller.handOffToSupplier(a, user, reason)).rejects.toBeInstanceOf(BadRequestException);

        expect(handOffSpy).not.toHaveBeenCalled();
        expect(
          await tx.select().from(wmsTables.supplierHandoffs).where(eq(wmsTables.supplierHandoffs.supplierId, a)),
        ).toEqual([]);
        const [s] = await tx
          .select({ h: wmsTables.shipments.supplierHandoffId })
          .from(wmsTables.shipments)
          .where(eq(wmsTables.shipments.id, box.shipmentId));
        expect(s.h).toBeNull();
      });
    },
  );

  it('사유가 맞으면 넘김까지 간다', async () => {
    const supplierId = '33333333-3333-4333-8333-333333333333';
    handOffSpy.mockResolvedValue({ handoffId: 'h' } as never);
    await controller.handOffToSupplier(supplierId, user, encodeURIComponent('입점사 발송 요청'));
    expect(handOffSpy).toHaveBeenCalledWith(supplierId, 'op-1');
  });
});

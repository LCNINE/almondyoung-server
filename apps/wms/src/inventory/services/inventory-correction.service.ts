import { Injectable, BadRequestException } from '@nestjs/common';
import { DbService } from '@app/db';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables } from '../../../database/schemas/wms-schema';
import { StockEventStore } from '../repositories/stock-event.store';

/**
 * 단순화된 이벤트 타입을 사용한 재고 정정 서비스 예시
 */
@Injectable()
export class InventoryCorrectionService {
  constructor(
    @InjectTypedDb<typeof wmsTables>() private readonly dbService: DbService<typeof wmsTables>,
    private readonly stockEventStore: StockEventStore,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  /**
   * 입고 정정 - 기존 복잡한 RECEIPT_CORRECTION_* 대신 ADJUST 사용
   */
  async correctReceipt(
    receiptId: string,
    corrections: Array<{
      skuId: string;
      warehouseId: string;
      locationId?: string;
      quantityDelta: number; // +면 증가, -면 감소
      reason?: string;
    }>
  ) {
    return this.db.transaction(async (tx) => {
      // Journal 생성 (원본 입고와 연결)
      const [journal] = await tx.insert(wmsTables.stockJournals).values({
        sourceType: 'inbound_correction',
        sourceId: receiptId,
      }).returning();

      // 단순화된 ADJUST 이벤트들 생성
      for (const correction of corrections) {
        const isIncrease = correction.quantityDelta > 0;

        await this.stockEventStore.createEvent({
          journalId: journal.id,
          transitionType: isIncrease ? 'ADJUST_UP' : 'ADJUST_DOWN',
          skuId: correction.skuId,
          toWarehouseId: correction.warehouseId,
          toLocationId: correction.locationId,
          quantity: Math.abs(correction.quantityDelta),
          reason: correction.reason || `RECEIPT_CORRECTION: ${receiptId} 수량 정정 ${correction.quantityDelta > 0 ? '+' : ''}${correction.quantityDelta}`,
          occurredAt: new Date(),
        }, tx);
      }

      return { journalId: journal.id, correctionCount: corrections.length };
    });
  }

  /**
   * 운송 중 분실/파손 - 기존 TRANSFER_LOSS/TRANSFER_DAMAGE 대신 ADJUST_DOWN 사용
   */
  async reportTransportLoss(
    transferJournalId: string,
    lossItems: Array<{
      skuId: string;
      warehouseId: string;
      quantity: number;
      lossType: 'loss' | 'damage';
      carrierName?: string;
      trackingNumber?: string;
    }>
  ) {
    return this.db.transaction(async (tx) => {
      const [journal] = await tx.insert(wmsTables.stockJournals).values({
        sourceType: 'transport_loss',
        sourceId: transferJournalId,
      }).returning();

      for (const item of lossItems) {
        await this.stockEventStore.createEvent({
          journalId: journal.id,
          transitionType: 'ADJUST_DOWN',
          skuId: item.skuId,
          fromWarehouseId: item.warehouseId,
          quantity: item.quantity,
          reason: `TRANSPORT_${item.lossType.toUpperCase()}: ${item.carrierName || '택배'} ${item.trackingNumber || ''} 운송 중 ${item.lossType === 'loss' ? '분실' : '파손'}`,
          occurredAt: new Date(),
        }, tx);
      }

      return { journalId: journal.id, lossCount: lossItems.length };
    });
  }

  /**
   * 불량품 처리 - 새로운 단순화된 플로우
   */
  async processDefectiveItems(
    warehouseId: string,
    items: Array<{
      skuId: string;
      locationId?: string;
      quantity: number;
      defectReason: string;
      action: 'rework' | 'scrap';
    }>
  ) {
    return this.db.transaction(async (tx) => {
      const [journal] = await tx.insert(wmsTables.stockJournals).values({
        sourceType: 'defect_processing',
      }).returning();

      for (const item of items) {
        // 1. 불량 지정 (MARK_DEFECT)
        await this.stockEventStore.createEvent({
          journalId: journal.id,
          transitionType: 'MARK_DEFECT',
          skuId: item.skuId,
          fromWarehouseId: warehouseId,
          fromLocationId: item.locationId,
          quantity: item.quantity,
          reason: `DEFECT_FOUND: ${item.defectReason}`,
          occurredAt: new Date(),
        }, tx);

        // 2. 처리 액션
        if (item.action === 'rework') {
          await this.stockEventStore.createEvent({
            journalId: journal.id,
            transitionType: 'REWORK_GOOD',
            skuId: item.skuId,
            toWarehouseId: warehouseId,
            toLocationId: item.locationId,
            quantity: item.quantity,
            reason: `REWORK_COMPLETED: ${item.defectReason} 수리 완료`,
            occurredAt: new Date(),
          }, tx);
        } else {
          await this.stockEventStore.createEvent({
            journalId: journal.id,
            transitionType: 'SCRAP',
            skuId: item.skuId,
            fromWarehouseId: warehouseId,
            fromLocationId: item.locationId,
            quantity: item.quantity,
            reason: `DEFECT_SCRAPPED: ${item.defectReason} 폐기 처리`,
            occurredAt: new Date(),
          }, tx);
        }
      }

      return { journalId: journal.id, processedCount: items.length };
    });
  }
}
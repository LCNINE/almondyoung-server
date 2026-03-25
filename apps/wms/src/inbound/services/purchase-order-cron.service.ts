import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PurchaseOrderService } from './purchase-order.service';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema } from '../../../database/schemas/wms-schema';
import { eq, and, sql } from 'drizzle-orm';
import { nowSeoul } from '../../shared/services/time.util';
import { PurchaseOrderStatus } from '../dto/purchase-order.dto';

@Injectable()
export class PurchaseOrderCronService {
  private readonly logger = new Logger(PurchaseOrderCronService.name);

  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
    private readonly purchaseOrderService: PurchaseOrderService,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  /**
   * 입고예정일 당일 0시에 created 상태 발주를 자동으로 confirmed로 전환
   */
  @Cron('0 0 * * *', {
    name: 'auto-confirm-purchase-orders',
    timeZone: 'Asia/Seoul',
  })
  async autoConfirmPurchaseOrders() {
    this.logger.log('Starting auto-confirm purchase orders job...');

    const today = nowSeoul();
    const todayDateOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    try {
      // 입고예정일이 오늘인 created 상태 발주 조회
      const ordersToConfirm = await this.db
        .select()
        .from(wmsTables.purchaseOrders)
        .where(
          and(
            eq(wmsTables.purchaseOrders.status, 'created'),
            sql`DATE(${wmsTables.purchaseOrders.expectedArrival}) = ${todayDateOnly}`,
          ),
        );

      if (ordersToConfirm.length === 0) {
        this.logger.log('No purchase orders to confirm today');
        return;
      }

      let successCount = 0;
      let failCount = 0;

      for (const po of ordersToConfirm) {
        try {
          await this.purchaseOrderService.updatePurchaseOrderStatus(po.id, {
            status: PurchaseOrderStatus.CONFIRMED,
          });
          successCount++;
        } catch (error) {
          this.logger.error(`Failed to confirm PO ${po.id}: ${error.message}`, error.stack);
          failCount++;
        }
      }

      this.logger.log(`Auto-confirm completed: ${successCount} succeeded, ${failCount} failed`);
    } catch (error) {
      this.logger.error(`Auto-confirm job failed: ${error.message}`, error.stack);
    }
  }
}

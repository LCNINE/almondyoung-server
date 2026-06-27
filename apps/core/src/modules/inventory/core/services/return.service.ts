import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx, Return, ReturnItem } from '../../schema/inventory.schema';
import { eq, and, desc, SQL } from 'drizzle-orm';
import { InventoryCommandService } from './inventory-command.service';
import { StockEventStore } from '../repositories/stock-event.store';
import { ReturnStatusEnum } from '../../schema/enum-values';

/**
 * 반품 처리 서비스
 *
 * 워크플로우:
 * 1. REQUESTED - 반품 요청 생성
 * 2. RECEIVED - 반품 상품 입고
 * 3. QC_IN_PROGRESS - 품질 검사 중
 * 4. QC_PASSED / QC_FAILED - 검사 완료
 * 5. DISPOSED - 최종 처리 완료 (재입고 또는 폐기)
 */
@Injectable()
export class ReturnService {
  private readonly logger = new Logger(ReturnService.name);

  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly commandService: InventoryCommandService,
    private readonly stockEventStore: StockEventStore,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  /**
   * 1. 반품 요청 생성
   */
  async createReturnRequest(
    params: {
      orderId?: string;
      shipmentId?: string;
      warehouseId: string;
      returnReason: string;
      items: Array<{
        skuId: string;
        requestedQuantity: number;
      }>;
    },
    tx?: DbTx,
  ): Promise<{ returnId: string; items: ReturnItem[] }> {
    return this.dbService.run(async (trx) => {
      this.logger.log(`Creating return request for warehouse ${params.warehouseId}`);

      if (!params.orderId && !params.shipmentId) {
        throw new BadRequestException('Either orderId or shipmentId is required');
      }

      if (params.items.length === 0) {
        throw new BadRequestException('At least one return item is required');
      }

      // 반품 헤더 생성
      const [returnHeader] = await trx
        .insert(wmsTables.returns)
        .values({
          orderId: params.orderId || null,
          shipmentId: params.shipmentId || null,
          warehouseId: params.warehouseId,
          status: 'requested',
          returnReason: params.returnReason,
        })
        .returning();

      // 반품 아이템 생성
      const returnItemsData = params.items.map((item) => ({
        returnId: returnHeader.id,
        skuId: item.skuId,
        requestedQuantity: item.requestedQuantity,
        qcStatus: 'pending',
      }));

      const returnItems = await trx.insert(wmsTables.returnItems).values(returnItemsData).returning();

      this.logger.log(`Return request created: ${returnHeader.id} with ${returnItems.length} items`);

      return {
        returnId: returnHeader.id,
        items: returnItems,
      };
    }, tx);
  }

  /**
   * 2. 반품 상품 입고 처리
   */
  async receiveReturn(
    params: {
      returnId: string;
      items: Array<{
        returnItemId: string;
        receivedQuantity: number;
        locationId?: string; // 지정 안하면 return_default 위치로
      }>;
    },
    tx?: DbTx,
  ) {
    return this.dbService.run(async (trx) => {
      this.logger.log(`Receiving return ${params.returnId}`);

      // 반품 조회
      const returnHeader = await trx.query.returns.findFirst({
        where: eq(wmsTables.returns.id, params.returnId),
      });

      if (!returnHeader) {
        throw new NotFoundException(`Return ${params.returnId} not found`);
      }

      if (returnHeader.status !== 'requested') {
        throw new BadRequestException(
          `Return ${params.returnId} cannot be received. Current status: ${returnHeader.status}`,
        );
      }

      // 반품 위치 결정
      const defaultReturnLocation = await trx.query.locations.findFirst({
        where: and(
          eq(wmsTables.locations.warehouseId, returnHeader.warehouseId),
          eq(wmsTables.locations.systemRole, 'return_default'),
        ),
      });

      // Journal 생성
      const [journal] = await trx
        .insert(wmsTables.stockJournals)
        .values({
          sourceType: 'return_receive',
          sourceId: params.returnId,
        })
        .returning();

      // 각 아이템 처리
      for (const item of params.items) {
        const returnItem = await trx.query.returnItems.findFirst({
          where: eq(wmsTables.returnItems.id, item.returnItemId),
        });

        if (!returnItem) {
          throw new NotFoundException(`Return item ${item.returnItemId} not found`);
        }

        if (item.receivedQuantity > returnItem.requestedQuantity) {
          throw new BadRequestException(
            `Received quantity (${item.receivedQuantity}) exceeds requested quantity (${returnItem.requestedQuantity})`,
          );
        }

        // 입고 위치 결정
        const locationId = item.locationId || defaultReturnLocation?.id;

        if (!locationId) {
          throw new BadRequestException(
            `No return location specified and no default return location found for warehouse ${returnHeader.warehouseId}`,
          );
        }

        // 재고 입고 이벤트 생성 (RECEIVE)
        await this.commandService.receive(
          {
            skuId: returnItem.skuId,
            toWarehouseId: returnHeader.warehouseId,
            toLocationId: locationId,
            quantity: item.receivedQuantity,
            reason: `RETURN_RECEIVE: Return ${params.returnId}`,
            journalId: journal.id,
          },
          trx,
        );

        // returnItem 업데이트
        await trx
          .update(wmsTables.returnItems)
          .set({
            receivedQuantity: item.receivedQuantity,
            locationId: locationId,
            updatedAt: new Date(),
          })
          .where(eq(wmsTables.returnItems.id, item.returnItemId));

        this.logger.log(
          `Received ${item.receivedQuantity} units of SKU ${returnItem.skuId} for return item ${item.returnItemId}`,
        );
      }

      // 반품 상태 업데이트
      await trx
        .update(wmsTables.returns)
        .set({
          status: 'received',
          updatedAt: new Date(),
        })
        .where(eq(wmsTables.returns.id, params.returnId));

      this.logger.log(`Return ${params.returnId} marked as received`);

      return { returnId: params.returnId, journalId: journal.id };
    }, tx);
  }

  /**
   * 3. 품질 검사 (QC) 수행
   */
  async inspectReturn(
    params: {
      returnId: string;
      inspectedBy: string;
      items: Array<{
        returnItemId: string;
        qcStatus: 'passed' | 'failed';
        qcReason?: string;
        qcPassedQuantity?: number;
        qcFailedQuantity?: number;
      }>;
      qcNotes?: string;
    },
    tx?: DbTx,
  ) {
    return this.dbService.run(async (trx) => {
      this.logger.log(`Inspecting return ${params.returnId}`);

      // 반품 조회
      const returnHeader = await trx.query.returns.findFirst({
        where: eq(wmsTables.returns.id, params.returnId),
      });

      if (!returnHeader) {
        throw new NotFoundException(`Return ${params.returnId} not found`);
      }

      if (returnHeader.status !== 'received') {
        throw new BadRequestException(
          `Return ${params.returnId} cannot be inspected. Current status: ${returnHeader.status}`,
        );
      }

      // 각 아이템 검사 처리
      for (const item of params.items) {
        const returnItem = await trx.query.returnItems.findFirst({
          where: eq(wmsTables.returnItems.id, item.returnItemId),
        });

        if (!returnItem) {
          throw new NotFoundException(`Return item ${item.returnItemId} not found`);
        }

        const passedQty = item.qcPassedQuantity || 0;
        const failedQty = item.qcFailedQuantity || 0;
        const totalInspected = passedQty + failedQty;

        if (returnItem.receivedQuantity === null) {
          throw new BadRequestException(`Return item ${item.returnItemId} has not been received yet`);
        }

        if (totalInspected > returnItem.receivedQuantity) {
          throw new BadRequestException(
            `Total inspected quantity (${totalInspected}) exceeds received quantity (${returnItem.receivedQuantity})`,
          );
        }

        // returnItem 업데이트
        await trx
          .update(wmsTables.returnItems)
          .set({
            qcStatus: item.qcStatus,
            qcReason: item.qcReason,
            qcPassedQuantity: passedQty,
            qcFailedQuantity: failedQty,
            updatedAt: new Date(),
          })
          .where(eq(wmsTables.returnItems.id, item.returnItemId));

        this.logger.log(
          `Inspected return item ${item.returnItemId}: ${item.qcStatus} (Passed: ${passedQty}, Failed: ${failedQty})`,
        );
      }

      // 반품 헤더 업데이트
      const allQcCompleted = params.items.every((item) => item.qcStatus === 'passed' || item.qcStatus === 'failed');

      const overallStatus = params.items.some((item) => item.qcStatus === 'passed') ? 'qc_passed' : 'qc_failed';

      await trx
        .update(wmsTables.returns)
        .set({
          status: allQcCompleted ? overallStatus : 'received',
          qcInspectedAt: new Date(),
          qcInspectedBy: params.inspectedBy,
          qcNotes: params.qcNotes,
          updatedAt: new Date(),
        })
        .where(eq(wmsTables.returns.id, params.returnId));

      this.logger.log(`Return ${params.returnId} inspection completed: ${overallStatus}`);

      return { returnId: params.returnId, status: overallStatus };
    }, tx);
  }

  /**
   * 4. 최종 처리 (재입고 또는 폐기)
   */
  async processReturn(
    params: {
      returnId: string;
      items: Array<{
        returnItemId: string;
        action: 'restock' | 'dispose';
        quantity: number;
        targetLocationId?: string; // restock 시 목표 위치
        reason?: string;
      }>;
    },
    tx?: DbTx,
  ) {
    return this.dbService.run(async (trx) => {
      this.logger.log(`Processing return ${params.returnId}`);

      // 반품 조회
      const returnHeader = await trx.query.returns.findFirst({
        where: eq(wmsTables.returns.id, params.returnId),
      });

      if (!returnHeader) {
        throw new NotFoundException(`Return ${params.returnId} not found`);
      }

      if (returnHeader.status !== 'qc_passed' && returnHeader.status !== 'qc_failed') {
        throw new BadRequestException(
          `Return ${params.returnId} cannot be processed. QC must be completed first. Current status: ${returnHeader.status}`,
        );
      }

      // Journal 생성
      const [journal] = await trx
        .insert(wmsTables.stockJournals)
        .values({
          sourceType: 'return_process',
          sourceId: params.returnId,
        })
        .returning();

      let totalRestocked = 0;
      let totalDisposed = 0;

      // 각 아이템 처리
      for (const item of params.items) {
        const returnItem = await trx.query.returnItems.findFirst({
          where: eq(wmsTables.returnItems.id, item.returnItemId),
        });

        if (!returnItem) {
          throw new NotFoundException(`Return item ${item.returnItemId} not found`);
        }

        if (item.action === 'restock') {
          if (!returnItem.locationId) {
            throw new BadRequestException(
              `Return item ${item.returnItemId} has no current location. Receive the return first.`,
            );
          }

          const toLocationId = item.targetLocationId ?? returnItem.locationId;

          // targetLocationId가 현재 위치와 다를 때만 이동 (return_default 현위치 유지도 유효)
          if (toLocationId !== returnItem.locationId) {
            await this.commandService.moveInternal(
              {
                skuId: returnItem.skuId,
                warehouseId: returnHeader.warehouseId,
                fromLocationId: returnItem.locationId,
                toLocationId,
                quantity: item.quantity,
                reason: `RESTOCK: ${item.reason || 'QC passed'}`,
              },
              trx,
            );
          }

          totalRestocked += item.quantity;

          // returnItem 업데이트
          await trx
            .update(wmsTables.returnItems)
            .set({
              restockedQuantity: (returnItem.restockedQuantity || 0) + item.quantity,
              updatedAt: new Date(),
            })
            .where(eq(wmsTables.returnItems.id, item.returnItemId));

          this.logger.log(
            `Restocked ${item.quantity} units of SKU ${returnItem.skuId} to location ${item.targetLocationId}`,
          );
        } else {
          // 폐기: SCRAP 이벤트
          await this.stockEventStore.createEvent(
            {
              journalId: journal.id,
              transitionType: 'SCRAP',
              skuId: returnItem.skuId,
              fromWarehouseId: returnHeader.warehouseId,
              fromLocationId: returnItem.locationId || undefined,
              fromState: 'ON_HAND',
              quantity: item.quantity,
              reason: `DISPOSE: ${item.reason || 'QC failed'}`,
              occurredAt: new Date(),
            },
            trx,
          );

          totalDisposed += item.quantity;

          // returnItem 업데이트
          await trx
            .update(wmsTables.returnItems)
            .set({
              disposedQuantity: (returnItem.disposedQuantity || 0) + item.quantity,
              updatedAt: new Date(),
            })
            .where(eq(wmsTables.returnItems.id, item.returnItemId));

          this.logger.log(`Disposed ${item.quantity} units of SKU ${returnItem.skuId}`);
        }
      }

      // 반품 헤더 업데이트
      await trx
        .update(wmsTables.returns)
        .set({
          status: 'disposed',
          restockQuantity: totalRestocked,
          disposeQuantity: totalDisposed,
          updatedAt: new Date(),
        })
        .where(eq(wmsTables.returns.id, params.returnId));

      this.logger.log(
        `Return ${params.returnId} processing completed. Restocked: ${totalRestocked}, Disposed: ${totalDisposed}`,
      );

      return {
        returnId: params.returnId,
        journalId: journal.id,
        restocked: totalRestocked,
        disposed: totalDisposed,
      };
    }, tx);
  }

  /**
   * 반품 조회
   */
  async getReturn(returnId: string, tx?: DbTx) {
    const db = tx ?? this.db;

    const returnHeader = await db.query.returns.findFirst({
      where: eq(wmsTables.returns.id, returnId),
    });

    if (!returnHeader) {
      throw new NotFoundException(`Return ${returnId} not found`);
    }

    const returnItems = await db.query.returnItems.findMany({
      where: eq(wmsTables.returnItems.returnId, returnId),
    });

    return {
      ...returnHeader,
      items: returnItems,
    };
  }

  /**
   * 반품 목록 조회
   */
  async listReturns(
    filters: {
      warehouseId?: string;
      status?: ReturnStatusEnum;
      orderId?: string;
      limit?: number;
      offset?: number;
    },
    tx?: DbTx,
  ): Promise<Return[]> {
    const db = tx ?? this.db;

    const conditions: SQL[] = [];

    if (filters.warehouseId) {
      conditions.push(eq(wmsTables.returns.warehouseId, filters.warehouseId));
    }

    if (filters.status) {
      conditions.push(eq(wmsTables.returns.status, filters.status));
    }

    if (filters.orderId) {
      conditions.push(eq(wmsTables.returns.orderId, filters.orderId));
    }

    const returns = await db.query.returns.findMany({
      where: conditions.length > 0 ? and(...conditions) : undefined,
      limit: filters.limit || 50,
      offset: filters.offset || 0,
      orderBy: desc(wmsTables.returns.createdAt),
    });

    return returns;
  }
}

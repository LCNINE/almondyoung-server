import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { eq, and, inArray, sql, asc, desc, SQL } from 'drizzle-orm';
import {
  CreatePurchaseOrderDto,
  UpdatePurchaseOrderStatusDto,
  UpdatePurchaseOrderLinesDto,
  UpdatePurchaseOrderLineDto,
  AddToCartDto,
  UpdateCartItemDto,
  CreatePurchaseOrderFromCartDto,
  PurchaseOrderResponse,
  CartItemResponse,
  StockReorderSuggestion,
  PurchaseOrderStatus,
  PurchaseOrderType,
} from '../dto/purchase-order.dto';
import { SubmitForAuditDto, ApprovePoDto, RejectPoDto } from '../dto/purchase-order/audit-po.dto';
import { TransactionService } from '../../shared/services/transaction.service';
import { SupplierResponseDto } from '../../suppliers/dto/supplier-response.dto';

@Injectable()
export class PurchaseOrderService {
  private readonly logger = new Logger(PurchaseOrderService.name);

  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly transactionService: TransactionService,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx) {
    return tx ? fn(tx) : this.db.transaction(fn);
  }

  /**
   * 발주 생성
   */
  async createPurchaseOrder(createDto: CreatePurchaseOrderDto, tx?: DbTx): Promise<PurchaseOrderResponse> {
    return this.inTx(async (trx) => {
      // 임시: 창고 라우팅 로직 (나중에 DTO로 받도록 개선)
      const destinationWarehouseId = createDto.destinationWarehouseId;
      const sourceWarehouseId = await this.getSupplierDefaultWarehouseId(createDto.supplierId, trx);
      const requiresTransfer = sourceWarehouseId !== destinationWarehouseId;

      // 발주 헤더 생성
      const [purchaseOrder] = await trx
        .insert(wmsTables.purchaseOrders)
        .values({
          type: createDto.type,
          supplierId: createDto.supplierId,
          expectedArrival: createDto.expectedArrival ? new Date(createDto.expectedArrival) : null,
          status: 'created',
          sourceWarehouseId: sourceWarehouseId,
          destinationWarehouseId: destinationWarehouseId,
          requiresTransfer: requiresTransfer,
        })
        .returning();

      // 발주 라인 생성
      const purchaseOrderLines = await trx
        .insert(wmsTables.purchaseOrderLines)
        .values(
          createDto.lines.map((line) => ({
            poId: purchaseOrder.id,
            skuId: line.skuId,
            quantity: line.quantity,
            unitPrice: line.unitPrice || null,
          })),
        )
        .returning();

      this.logger.log(`Created purchase order ${purchaseOrder.id} with ${purchaseOrderLines.length} lines`);

      return this.getPurchaseOrderById(purchaseOrder.id, trx);
    }, tx);
  }

  /**
   * 장바구니에서 발주 생성
   */
  async createPurchaseOrderFromCart(
    createDto: CreatePurchaseOrderFromCartDto,
    userId: string,
    tx?: DbTx,
  ): Promise<PurchaseOrderResponse> {
    return this.inTx(async (trx) => {
      const cartItems = await trx
        .select({
          id: wmsTables.purchaseOrderCart.id,
          skuId: wmsTables.purchaseOrderCart.skuId,
          quantity: wmsTables.purchaseOrderCart.quantity,
          type: wmsTables.purchaseOrderCart.type,
        })
        .from(wmsTables.purchaseOrderCart)
        .where(
          and(
            inArray(wmsTables.purchaseOrderCart.id, createDto.cartItemIds),
            eq(wmsTables.purchaseOrderCart.createdBy, userId),
          ),
        );

      if (cartItems.length !== createDto.cartItemIds.length) {
        throw new BadRequestException("Some cart items not found or you don't have permission to access them");
      }

      const types = [...new Set(cartItems.map((item) => item.type))];
      if (types.length > 1) {
        throw new BadRequestException('All cart items must have the same purchase order type');
      }

      const destinationWarehouseId = createDto.destinationWarehouseId;
      const sourceWarehouseId = await this.getSupplierDefaultWarehouseId(createDto.supplierId, trx);
      const requiresTransfer = sourceWarehouseId !== destinationWarehouseId;

      const [purchaseOrder] = await trx
        .insert(wmsTables.purchaseOrders)
        .values({
          type: types[0],
          supplierId: createDto.supplierId,
          expectedArrival: createDto.expectedArrival ? new Date(createDto.expectedArrival) : null,
          status: 'created',
          sourceWarehouseId,
          destinationWarehouseId,
          requiresTransfer,
        })
        .returning();

      await trx.insert(wmsTables.purchaseOrderLines).values(
        cartItems.map((item) => ({
          poId: purchaseOrder.id,
          skuId: item.skuId,
          quantity: item.quantity,
          unitPrice: null,
        })),
      );

      await trx
        .delete(wmsTables.purchaseOrderCart)
        .where(inArray(wmsTables.purchaseOrderCart.id, createDto.cartItemIds));

      this.logger.log(
        `Created purchase order ${purchaseOrder.id} from ${cartItems.length} cart items for user ${userId}`,
      );

      return this.getPurchaseOrderById(purchaseOrder.id, trx);
    }, tx);
  }

  /**
   * 발주 상태 업데이트
   */
  async updatePurchaseOrderStatus(
    poId: string,
    updateDto: UpdatePurchaseOrderStatusDto,
    tx?: DbTx,
  ): Promise<PurchaseOrderResponse> {
    return this.inTx(async (trx) => {
      const [existingPO] = await trx
        .select()
        .from(wmsTables.purchaseOrders)
        .where(eq(wmsTables.purchaseOrders.id, poId))
        .limit(1);

      if (!existingPO) {
        throw new NotFoundException(`Purchase order with ID ${poId} not found`);
      }

      if (updateDto.status === PurchaseOrderStatus.CONFIRMED && existingPO.auditStatus !== 'approved') {
        throw new BadRequestException(`Cannot confirm PO with auditStatus: ${existingPO.auditStatus}`);
      }

      await trx
        .update(wmsTables.purchaseOrders)
        .set({
          status: updateDto.status,
          expectedArrival: updateDto.expectedArrival ? new Date(updateDto.expectedArrival) : undefined,
          updatedAt: new Date(),
        })
        .where(eq(wmsTables.purchaseOrders.id, poId));

      // 상태가 confirmed로 변경되면 inbound plans 생성
      if (updateDto.status === PurchaseOrderStatus.CONFIRMED) {
        await this.createInboundPlanFromPO(trx, poId);
      }

      this.logger.log(`Updated purchase order ${poId} status to ${updateDto.status}`);

      return this.getPurchaseOrderById(poId, trx);
    }, tx);
  }

  /**
   * 발주 라인 수정 (created/confirmed 모두 가능)
   * - created: 자유롭게 수정 가능
   * - confirmed: PO lines만 수정 (inbound_plan_items는 이미 입고 시작되었을 수 있음)
   */
  async updatePurchaseOrderLines(
    poId: string,
    updateDto: UpdatePurchaseOrderLinesDto,
    tx?: DbTx,
  ): Promise<PurchaseOrderResponse> {
    return this.inTx(async (trx) => {
      // 1. PO 존재 및 상태 확인
      const [po] = await trx
        .select()
        .from(wmsTables.purchaseOrders)
        .where(eq(wmsTables.purchaseOrders.id, poId))
        .limit(1);

      if (!po) {
        throw new NotFoundException(`Purchase order ${poId} not found`);
      }

      // 2. received 상태는 수정 불가
      if (po.status === 'received') {
        throw new BadRequestException('Cannot modify purchase order lines after fully received');
      }

      // 3. 기존 라인 삭제
      await trx.delete(wmsTables.purchaseOrderLines).where(eq(wmsTables.purchaseOrderLines.poId, poId));

      // 4. 새 라인 삽입
      await trx.insert(wmsTables.purchaseOrderLines).values(
        updateDto.lines.map((line) => ({
          poId,
          skuId: line.skuId,
          quantity: line.quantity,
          unitPrice: line.unitPrice ?? null,
        })),
      );

      // 5. confirmed 상태면 inbound_plan_items도 업데이트 시도
      if (po.status === 'confirmed') {
        await this.syncInboundPlanItems(trx, poId, updateDto.lines);
      }

      this.logger.log(`Updated ${updateDto.lines.length} lines for PO ${poId}`);

      return this.getPurchaseOrderById(poId, trx);
    }, tx);
  }

  /**
   * confirmed 상태 PO의 inbound_plan_items 동기화
   * - pending 상태 items만 업데이트 (이미 입고 시작된 건은 건드리지 않음)
   */
  private async syncInboundPlanItems(tx: DbTx, poId: string, newLines: UpdatePurchaseOrderLineDto[]): Promise<void> {
    // 1. 해당 PO의 모든 plan 조회
    const plans = await tx
      .select()
      .from(wmsTables.inboundPlans)
      .where(eq(wmsTables.inboundPlans.linkedPurchaseOrderId, poId));

    for (const plan of plans) {
      // 2. pending 상태 items만 삭제
      await tx
        .delete(wmsTables.inboundPlanItems)
        .where(and(eq(wmsTables.inboundPlanItems.planId, plan.id), eq(wmsTables.inboundPlanItems.status, 'pending')));

      // 3. 새 items 삽입
      await tx.insert(wmsTables.inboundPlanItems).values(
        newLines.map((line) => ({
          planId: plan.id,
          skuId: line.skuId,
          expectedQty: line.quantity,
          receivedQty: 0,
          status: 'pending' as const,
        })),
      );
    }

    this.logger.log(`Synced inbound plan items for ${plans.length} plans`);
  }

  /**
   * 발주에서 입고 계획 생성 (이중 입고 계획 지원)
   */
  private async createInboundPlanFromPO(tx: DbTx, poId: string): Promise<void> {
    const [purchaseOrder] = await tx
      .select()
      .from(wmsTables.purchaseOrders)
      .where(eq(wmsTables.purchaseOrders.id, poId))
      .limit(1);

    if (!purchaseOrder) {
      throw new NotFoundException(`Purchase order ${poId} not found`);
    }

    const sourceWarehouseId = purchaseOrder.sourceWarehouseId;
    const destinationWarehouseId = purchaseOrder.destinationWarehouseId;
    const requiresTransfer = sourceWarehouseId !== destinationWarehouseId;

    if (requiresTransfer) {
      // 🔥 핵심: 이중 계획 생성 (해외 발주)

      // 1. Source Plan 생성 (중국 창고)
      const [sourcePlan] = await tx
        .insert(wmsTables.inboundPlans)
        .values({
          warehouseId: sourceWarehouseId,
          planType: 'source',
          linkedPurchaseOrderId: poId,
          destinationWarehouseId: destinationWarehouseId, // 하위 호환성
          requiresTransfer: true, // 하위 호환성
          expectedDate: purchaseOrder.expectedArrival,
          status: 'pending',
        })
        .returning();

      // 2. Destination Plan 생성 (부천 창고)
      const [destinationPlan] = await tx
        .insert(wmsTables.inboundPlans)
        .values({
          warehouseId: destinationWarehouseId,
          planType: 'destination',
          parentPlanId: sourcePlan.id,
          linkedPurchaseOrderId: poId,
          destinationWarehouseId: destinationWarehouseId, // 하위 호환성
          requiresTransfer: false, // destination은 이동 불필요
          expectedDate: null, // 이동 완료 후 설정
          status: 'pending',
        })
        .returning();

      // 3. 동일한 아이템을 양쪽 계획에 추가
      const poLines = await tx
        .select({
          skuId: wmsTables.purchaseOrderLines.skuId,
          quantity: wmsTables.purchaseOrderLines.quantity,
        })
        .from(wmsTables.purchaseOrderLines)
        .where(eq(wmsTables.purchaseOrderLines.poId, poId));

      const sourceItems = poLines.map((line) => ({
        planId: sourcePlan.id,
        skuId: line.skuId,
        expectedQty: line.quantity,
        receivedQty: 0,
        status: 'pending' as const,
      }));

      const destinationItems = poLines.map((line) => ({
        planId: destinationPlan.id,
        skuId: line.skuId,
        expectedQty: line.quantity,
        receivedQty: 0,
        status: 'pending' as const,
      }));

      await tx.insert(wmsTables.inboundPlanItems).values([...sourceItems, ...destinationItems]);

      this.logger.log(
        `Created dual inbound plans: source=${sourcePlan.id}, destination=${destinationPlan.id} for PO ${poId}`,
      );
    } else {
      // 국내 발주는 기존 로직 유지 (destination plan만 생성)
      const [plan] = await tx
        .insert(wmsTables.inboundPlans)
        .values({
          warehouseId: destinationWarehouseId,
          planType: 'destination',
          linkedPurchaseOrderId: poId,
          destinationWarehouseId: destinationWarehouseId,
          requiresTransfer: false,
          expectedDate: purchaseOrder.expectedArrival,
          status: 'pending',
        })
        .returning();

      // 기존 아이템 생성 로직
      const poLines = await tx
        .select({
          skuId: wmsTables.purchaseOrderLines.skuId,
          quantity: wmsTables.purchaseOrderLines.quantity,
        })
        .from(wmsTables.purchaseOrderLines)
        .where(eq(wmsTables.purchaseOrderLines.poId, poId));

      await tx.insert(wmsTables.inboundPlanItems).values(
        poLines.map((line) => ({
          planId: plan.id,
          skuId: line.skuId,
          expectedQty: line.quantity,
          receivedQty: 0,
          status: 'pending' as const,
        })),
      );

      this.logger.log(`Created single inbound plan ${plan.id} for domestic PO ${poId}`);
    }
  }

  /**
   * 발주 유형에 따른 입고 창고 ID 반환 (source)
   */
  private async getSupplierDefaultWarehouseId(supplierId: string, tx: DbTx): Promise<string> {
    const [supplier] = await tx
      .select({ defaultWarehouseId: wmsTables.suppliers.defaultWarehouseId })
      .from(wmsTables.suppliers)
      .where(eq(wmsTables.suppliers.id, supplierId))
      .limit(1);
    if (!supplier) {
      throw new BadRequestException(`Supplier with ID ${supplierId} not found`);
    }
    if (!supplier.defaultWarehouseId) {
      throw new BadRequestException(
        `Supplier ${supplierId} does not have a default warehouse configured. Please set a default warehouse for this supplier.`,
      );
    }
    return supplier.defaultWarehouseId;
  }

  /**
   * 발주 조회
   */
  async getPurchaseOrderById(poId: string, tx?: DbTx): Promise<PurchaseOrderResponse> {
    return this.inTx(async (trx: DbTx) => {
      const [po] = await trx
        .select()
        .from(wmsTables.purchaseOrders)
        .where(eq(wmsTables.purchaseOrders.id, poId))
        .limit(1);

      if (!po) {
        throw new NotFoundException(`Purchase order with ID ${poId} not found`);
      }

      const lines = await trx
        .select({
          skuId: wmsTables.purchaseOrderLines.skuId,
          quantity: wmsTables.purchaseOrderLines.quantity,
          unitPrice: wmsTables.purchaseOrderLines.unitPrice,
          skuName: wmsTables.skus.name,
          skuBarcode: sql<string>`(
                      SELECT barcode FROM sku_barcodes 
                      WHERE sku_id = ${wmsTables.skus.id} AND is_primary = true 
                      LIMIT 1
                    )`,
        })
        .from(wmsTables.purchaseOrderLines)
        .leftJoin(wmsTables.skus, eq(wmsTables.purchaseOrderLines.skuId, wmsTables.skus.id))
        .where(eq(wmsTables.purchaseOrderLines.poId, poId));

      const supplier = po.supplierId
        ? (() =>
            trx
              .select()
              .from(wmsTables.suppliers)
              .where(eq(wmsTables.suppliers.id, po.supplierId))
              .limit(1)
              .then((rows) => rows[0]))()
        : undefined;

      const supplierRow = await supplier;

      return {
        id: po.id,
        type: po.type as PurchaseOrderType,
        supplierId: po.supplierId,
        expectedArrival: po.expectedArrival,
        status: po.status as PurchaseOrderStatus,
        createdAt: po.createdAt,
        updatedAt: po.updatedAt,
        lines: lines.map((line) => ({
          skuId: line.skuId,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          sku: {
            name: line.skuName ?? '삭제된 상품',
            barcode: line.skuBarcode ?? '',
          },
        })),
        supplier: supplierRow ? SupplierResponseDto.fromDbRow(supplierRow) : undefined,
      };
    }, tx);
  }

  /**
   * 발주 목록 조회
   */
  async getPurchaseOrders(
    status?: PurchaseOrderStatus,
    type?: PurchaseOrderType,
    limit = 50,
    offset = 0,
    tx?: DbTx,
  ): Promise<PurchaseOrderResponse[]> {
    const conditions: SQL[] = [];

    if (status) {
      conditions.push(eq(wmsTables.purchaseOrders.status, status));
    }

    if (type) {
      conditions.push(eq(wmsTables.purchaseOrders.type, type));
    }

    const purchaseOrders = await this.inTx(
      async (trx) =>
        trx
          .select()
          .from(wmsTables.purchaseOrders)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(desc(wmsTables.purchaseOrders.createdAt))
          .limit(limit)
          .offset(offset),
      tx,
    );
    const results = [] as PurchaseOrderResponse[];
    for (const po of purchaseOrders) {
      const lines = await this.inTx(
        async (trx) =>
          trx
            .select({
              skuId: wmsTables.purchaseOrderLines.skuId,
              quantity: wmsTables.purchaseOrderLines.quantity,
              unitPrice: wmsTables.purchaseOrderLines.unitPrice,
              skuName: wmsTables.skus.name,
              skuBarcode: sql<string>`(
                      SELECT barcode FROM sku_barcodes 
                      WHERE sku_id = ${wmsTables.skus.id} AND is_primary = true 
                      LIMIT 1
                    )`,
            })
            .from(wmsTables.purchaseOrderLines)
            .leftJoin(wmsTables.skus, eq(wmsTables.purchaseOrderLines.skuId, wmsTables.skus.id))
            .where(eq(wmsTables.purchaseOrderLines.poId, po.id)),
        tx,
      );

      const supplier = po.supplierId
        ? await this.inTx(async (trx) => {
            const [row] = await trx
              .select()
              .from(wmsTables.suppliers)
              .where(eq(wmsTables.suppliers.id, po.supplierId!))
              .limit(1);
            return row;
          }, tx)
        : undefined;

      results.push({
        id: po.id,
        type: po.type as PurchaseOrderType,
        supplierId: po.supplierId,
        expectedArrival: po.expectedArrival,
        status: po.status as PurchaseOrderStatus,
        createdAt: po.createdAt,
        updatedAt: po.updatedAt,
        lines: lines.map((line) => ({
          skuId: line.skuId,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          sku: {
            name: line.skuName ?? '',
            barcode: line.skuBarcode ?? '',
          },
        })),
        supplier: supplier ? SupplierResponseDto.fromDbRow(supplier) : undefined,
      });
    }
    return results;
  }

  // ========== 발주대기리스트 (Cart) 관리 ==========

  /**
   * 장바구니에 아이템 추가
   */
  async addToCart(addDto: AddToCartDto, userId: string, tx?: DbTx): Promise<CartItemResponse> {
    const existingItem = await this.inTx(async (trx) => {
      const [row] = await trx
        .select()
        .from(wmsTables.purchaseOrderCart)
        .where(
          and(
            eq(wmsTables.purchaseOrderCart.skuId, addDto.skuId),
            eq(wmsTables.purchaseOrderCart.type, addDto.type),
            eq(wmsTables.purchaseOrderCart.createdBy, userId),
          ),
        )
        .limit(1);
      return row;
    }, tx);

    if (existingItem) {
      await this.inTx(
        async (trx) =>
          trx
            .update(wmsTables.purchaseOrderCart)
            .set({
              quantity: existingItem.quantity + addDto.quantity,
              supplierId: addDto.supplierId || existingItem.supplierId,
              updatedAt: new Date(),
            })
            .where(eq(wmsTables.purchaseOrderCart.id, existingItem.id)),
        tx,
      );
      return this.getCartItemById(existingItem.id, userId, tx);
    } else {
      const [cartItem] = await this.inTx(
        async (trx) =>
          trx
            .insert(wmsTables.purchaseOrderCart)
            .values({
              skuId: addDto.skuId,
              quantity: addDto.quantity,
              type: addDto.type,
              supplierId: addDto.supplierId,
              createdBy: userId,
            })
            .returning(),
        tx,
      );

      return this.getCartItemById(cartItem.id, userId, tx);
    }
  }

  /**
   * 장바구니 아이템 수정
   */
  async updateCartItem(
    itemId: string,
    userId: string,
    updateDto: UpdateCartItemDto,
    tx?: DbTx,
  ): Promise<CartItemResponse> {
    const existingItem = await this.inTx(async (trx) => {
      const [row] = await trx
        .select()
        .from(wmsTables.purchaseOrderCart)
        .where(and(eq(wmsTables.purchaseOrderCart.id, itemId), eq(wmsTables.purchaseOrderCart.createdBy, userId)))
        .limit(1);
      return row;
    }, tx);

    if (!existingItem) {
      throw new NotFoundException(`Cart item with ID ${itemId} not found or you don't have permission to modify it`);
    }

    await this.inTx(
      async (trx) =>
        trx
          .update(wmsTables.purchaseOrderCart)
          .set({
            quantity: updateDto.quantity,
            supplierId: updateDto.supplierId ?? existingItem.supplierId,
            updatedAt: new Date(),
          })
          .where(eq(wmsTables.purchaseOrderCart.id, itemId)),
      tx,
    );
    return this.getCartItemById(itemId, userId, tx);
  }

  /**
   * 장바구니에서 아이템 제거
   */
  async removeFromCart(itemId: string, userId: string, tx?: DbTx): Promise<void> {
    const result = await this.inTx(
      async (trx) =>
        trx
          .delete(wmsTables.purchaseOrderCart)
          .where(and(eq(wmsTables.purchaseOrderCart.id, itemId), eq(wmsTables.purchaseOrderCart.createdBy, userId)))
          .returning(),
      tx,
    );

    if (result.length === 0) {
      throw new NotFoundException(`Cart item with ID ${itemId} not found or you don't have permission to delete it`);
    }

    this.logger.log(`Removed cart item ${itemId}`);
  }

  /**
   * 장바구니 조회
   */
  async getCartItems(type: PurchaseOrderType | undefined, userId: string, tx?: DbTx): Promise<CartItemResponse[]> {
    const conditions: SQL[] = [eq(wmsTables.purchaseOrderCart.createdBy, userId)];
    if (type) {
      conditions.push(eq(wmsTables.purchaseOrderCart.type, type));
    }

    const cartItems = await this.inTx(
      async (trx) =>
        trx
          .select({
            id: wmsTables.purchaseOrderCart.id,
            skuId: wmsTables.purchaseOrderCart.skuId,
            quantity: wmsTables.purchaseOrderCart.quantity,
            type: wmsTables.purchaseOrderCart.type,
            supplierId: wmsTables.purchaseOrderCart.supplierId,
            supplierName: wmsTables.suppliers.name,
            createdAt: wmsTables.purchaseOrderCart.createdAt,
            updatedAt: wmsTables.purchaseOrderCart.updatedAt,
            skuName: wmsTables.skus.name,
            skuBarcode: sql<string>`(
                  SELECT barcode FROM sku_barcodes 
                  WHERE sku_id = ${wmsTables.skus.id} AND is_primary = true 
                  LIMIT 1
                )`,
          })
          .from(wmsTables.purchaseOrderCart)
          .leftJoin(wmsTables.skus, eq(wmsTables.purchaseOrderCart.skuId, wmsTables.skus.id))
          .leftJoin(wmsTables.suppliers, eq(wmsTables.purchaseOrderCart.supplierId, wmsTables.suppliers.id))
          .where(and(...conditions))
          .orderBy(desc(wmsTables.purchaseOrderCart.createdAt)),
      tx,
    );

    return cartItems.map((item) => ({
      id: item.id,
      skuId: item.skuId,
      quantity: item.quantity,
      type: item.type as PurchaseOrderType,
      supplier:
        item.supplierId && item.supplierName
          ? {
              id: item.supplierId,
              name: item.supplierName,
            }
          : null,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      sku: {
        name: item.skuName ?? '',
        barcode: item.skuBarcode ?? '',
      },
    }));
  }

  /**
   * 장바구니 아이템 조회
   */
  private async getCartItemById(itemId: string, userId: string, tx?: DbTx): Promise<CartItemResponse> {
    const item = await this.inTx(async (trx) => {
      const [row] = await trx
        .select({
          id: wmsTables.purchaseOrderCart.id,
          skuId: wmsTables.purchaseOrderCart.skuId,
          quantity: wmsTables.purchaseOrderCart.quantity,
          type: wmsTables.purchaseOrderCart.type,
          supplierId: wmsTables.purchaseOrderCart.supplierId,
          supplierName: wmsTables.suppliers.name,
          createdAt: wmsTables.purchaseOrderCart.createdAt,
          updatedAt: wmsTables.purchaseOrderCart.updatedAt,
          skuName: wmsTables.skus.name,
          skuBarcode: sql<string>`(
                      SELECT barcode FROM sku_barcodes 
                      WHERE sku_id = ${wmsTables.skus.id} AND is_primary = true 
                      LIMIT 1
                    )`,
        })
        .from(wmsTables.purchaseOrderCart)
        .leftJoin(wmsTables.skus, eq(wmsTables.purchaseOrderCart.skuId, wmsTables.skus.id))
        .leftJoin(wmsTables.suppliers, eq(wmsTables.purchaseOrderCart.supplierId, wmsTables.suppliers.id))
        .where(and(eq(wmsTables.purchaseOrderCart.id, itemId), eq(wmsTables.purchaseOrderCart.createdBy, userId)))
        .limit(1);
      return row;
    }, tx);

    if (!item) {
      throw new NotFoundException(`Cart item with ID ${itemId} not found`);
    }

    return {
      id: item.id,
      skuId: item.skuId,
      quantity: item.quantity,
      type: item.type as PurchaseOrderType,
      supplier:
        item.supplierId && item.supplierName
          ? {
              id: item.supplierId,
              name: item.supplierName,
            }
          : null,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      sku: {
        name: item.skuName ?? '',
        barcode: item.skuBarcode ?? '',
      },
    };
  }

  /**
   * 장바구니 비우기
   */
  async clearCart(type: PurchaseOrderType | undefined, userId: string, tx?: DbTx): Promise<void> {
    const conditions: SQL[] = [eq(wmsTables.purchaseOrderCart.createdBy, userId)];
    if (type) {
      conditions.push(eq(wmsTables.purchaseOrderCart.type, type));
    }

    await this.inTx(async (trx) => trx.delete(wmsTables.purchaseOrderCart).where(and(...conditions)), tx);

    this.logger.log(`Cleared cart${type ? ` for type ${type}` : ''} for user ${userId}`);
  }

  // ========== 재주문 제안 ==========

  /**
   * 재주문 제안 조회
   * 안전재고 미만으로 떨어진 상품 목록
   */
  async getReorderSuggestions(warehouseId?: string, tx?: DbTx): Promise<StockReorderSuggestion[]> {
    // stockSummary view에서 안전재고 미만 상품 조회
    // 현재는 단순히 availableQty < 10인 상품을 반환 (향후 안전재고 설정 기능 추가 시 개선)

    const query = sql`
            SELECT
                s.id as sku_id,
                s.name as sku_name,
                COALESCE(ss.available_qty, 0) as current_stock,
                10 as safety_stock,  -- 임시 값
                (10 - COALESCE(ss.available_qty, 0)) as shortfall,
                GREATEST(20 - COALESCE(ss.available_qty, 0), 0) as suggested_order,
                COALESCE(ss.on_order_qty, 0) as on_order_qty,
                COALESCE(ss.in_transfer_qty, 0) as in_transfer_qty
            FROM skus s
            LEFT JOIN stock_summary_view ss ON s.id = ss.sku_id
            WHERE COALESCE(ss.available_qty, 0) < 10
            ${warehouseId ? sql`AND ss.warehouse_id = ${warehouseId}` : sql``}
            ORDER BY shortfall DESC
            LIMIT 100
        `;

    interface ReorderSuggestionRow {
      sku_id: string;
      sku_name: string;
      current_stock: number;
      safety_stock: number;
      shortfall: number;
      suggested_order: number;
      on_order_qty: number;
      in_transfer_qty: number;
    }

    const results = await this.inTx(async (trx) => trx.execute(query), tx);
    const rows = results as unknown as ReorderSuggestionRow[];

    return rows.map((row) => ({
      skuId: row.sku_id,
      skuName: row.sku_name,
      currentStock: row.current_stock,
      safetyStock: row.safety_stock,
      shortfall: row.shortfall,
      suggestedOrder: row.suggested_order,
      onOrderQty: row.on_order_qty,
      inTransferQty: row.in_transfer_qty,
    }));
  }

  // ========== Audit Workflow ==========

  /**
   * Submit PO for audit
   */
  async submitForAudit(
    poId: string,
    dto: SubmitForAuditDto,
    userId?: string,
    tx?: DbTx,
  ): Promise<{
    id: string;
    auditStatus: string;
    submittedAt: Date;
    message: string;
  }> {
    return this.inTx(async (trx) => {
      // Get PO
      const [po] = await trx
        .select()
        .from(wmsTables.purchaseOrders)
        .where(eq(wmsTables.purchaseOrders.id, poId))
        .limit(1);

      if (!po) {
        throw new NotFoundException(`Purchase order ${poId} not found`);
      }

      // Validate current status
      if (po.auditStatus !== 'draft') {
        throw new BadRequestException(`Cannot submit: current audit status is ${po.auditStatus}, expected 'draft'`);
      }

      // Update status
      await trx
        .update(wmsTables.purchaseOrders)
        .set({
          auditStatus: 'pending_audit',
          submittedForAuditAt: new Date(),
          submittedForAuditBy: userId ?? null,
          auditNotes: dto.notes ?? null,
          updatedAt: new Date(),
        })
        .where(eq(wmsTables.purchaseOrders.id, poId));

      return {
        id: poId,
        auditStatus: 'pending_audit',
        submittedAt: new Date(),
        message: '검토 요청이 제출되었습니다. (Submitted for audit)',
      };
    }, tx);
  }

  /**
   * Approve PO
   */
  async approvePo(
    poId: string,
    dto: ApprovePoDto,
    userId?: string,
    tx?: DbTx,
  ): Promise<{
    id: string;
    auditStatus: string;
    approvedAt: Date;
    message: string;
  }> {
    return this.inTx(async (trx) => {
      // Get PO
      const [po] = await trx
        .select()
        .from(wmsTables.purchaseOrders)
        .where(eq(wmsTables.purchaseOrders.id, poId))
        .limit(1);

      if (!po) {
        throw new NotFoundException(`Purchase order ${poId} not found`);
      }

      // Validate current status
      if (po.auditStatus !== 'pending_audit') {
        throw new BadRequestException(
          `Cannot approve: current audit status is ${po.auditStatus}, expected 'pending_audit'`,
        );
      }

      // Update status
      await trx
        .update(wmsTables.purchaseOrders)
        .set({
          auditStatus: 'approved',
          auditedAt: new Date(),
          auditedBy: userId ?? null,
          auditNotes: dto.approvalNotes ?? null,
          updatedAt: new Date(),
        })
        .where(eq(wmsTables.purchaseOrders.id, poId));

      return {
        id: poId,
        auditStatus: 'approved',
        approvedAt: new Date(),
        message: '발주가 승인되었습니다. (Purchase order approved)',
      };
    }, tx);
  }

  /**
   * Reject PO
   */
  async rejectPo(
    poId: string,
    dto: RejectPoDto,
    userId?: string,
    tx?: DbTx,
  ): Promise<{
    id: string;
    auditStatus: string;
    rejectedAt: Date;
    reason: string;
    message: string;
  }> {
    return this.inTx(async (trx) => {
      // Get PO
      const [po] = await trx
        .select()
        .from(wmsTables.purchaseOrders)
        .where(eq(wmsTables.purchaseOrders.id, poId))
        .limit(1);

      if (!po) {
        throw new NotFoundException(`Purchase order ${poId} not found`);
      }

      // Validate current status
      if (po.auditStatus !== 'pending_audit') {
        throw new BadRequestException(
          `Cannot reject: current audit status is ${po.auditStatus}, expected 'pending_audit'`,
        );
      }

      // Update status (back to draft so it can be revised)
      await trx
        .update(wmsTables.purchaseOrders)
        .set({
          auditStatus: 'draft', // Reset to draft for revision
          auditedAt: new Date(),
          auditedBy: userId ?? null,
          auditNotes: `REJECTED: ${dto.rejectionReason}`,
          updatedAt: new Date(),
        })
        .where(eq(wmsTables.purchaseOrders.id, poId));

      return {
        id: poId,
        auditStatus: 'draft',
        rejectedAt: new Date(),
        reason: dto.rejectionReason,
        message: '발주가 거부되었습니다. 수정 후 재제출하세요. (Purchase order rejected, please revise and resubmit)',
      };
    }, tx);
  }
}

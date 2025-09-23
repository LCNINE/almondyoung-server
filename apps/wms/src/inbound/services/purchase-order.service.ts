import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema } from '../../../database/schemas/wms-schema';
import { eq, and, inArray, sql } from 'drizzle-orm';
import {
    CreatePurchaseOrderDto,
    UpdatePurchaseOrderStatusDto,
    AddToCartDto,
    UpdateCartItemDto,
    CreatePurchaseOrderFromCartDto,
    PurchaseOrderResponse,
    CartItemResponse,
    StockReorderSuggestion,
    PurchaseOrderStatus,
    PurchaseOrderType
} from '../dto/purchase-order.dto';
import { TransactionService } from '../../shared/services/transaction.service';

@Injectable()
export class PurchaseOrderService {
    private readonly logger = new Logger(PurchaseOrderService.name);

    constructor(
        @InjectTypedDb<typeof wmsTables>() private readonly dbService: DbService<typeof wmsTables>,
        private readonly transactionService: TransactionService,
    ) {}

    private get db() {
        return this.dbService.db;
    }

    /**
     * 발주 생성
     */
    async createPurchaseOrder(createDto: CreatePurchaseOrderDto): Promise<PurchaseOrderResponse> {
        return this.transactionService.runInTransaction(async (tx) => {
            // 임시: 창고 라우팅 로직 (나중에 DTO로 받도록 개선)
            const sourceWarehouseId = await this.getSourceWarehouseId(createDto.type);
            const destinationWarehouseId = await this.getDestinationWarehouseId(createDto.type);
            const requiresTransfer = sourceWarehouseId !== destinationWarehouseId;

            // 발주 헤더 생성
            const [purchaseOrder] = await tx
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
            const purchaseOrderLines = await tx
                .insert(wmsTables.purchaseOrderLines)
                .values(
                    createDto.lines.map(line => ({
                        poId: purchaseOrder.id,
                        skuId: line.skuId,
                        quantity: line.quantity,
                        unitPrice: line.unitPrice || null,
                    }))
                )
                .returning();

            this.logger.log(`Created purchase order ${purchaseOrder.id} with ${purchaseOrderLines.length} lines`);

            return this.getPurchaseOrderById(purchaseOrder.id);
        });
    }

    /**
     * 장바구니에서 발주 생성
     */
    async createPurchaseOrderFromCart(createDto: CreatePurchaseOrderFromCartDto): Promise<PurchaseOrderResponse> {
        return this.transactionService.runInTransaction(async (tx) => {
            // 장바구니 아이템 조회
            const cartItems = await tx.query.purchaseOrderCart.findMany({
                where: inArray(wmsTables.purchaseOrderCart.id, createDto.cartItemIds),
                with: {
                    sku: true,
                },
            });

            if (cartItems.length !== createDto.cartItemIds.length) {
                throw new BadRequestException('Some cart items not found');
            }

            // 발주 유형이 동일한지 확인
            const types = [...new Set(cartItems.map(item => item.type))];
            if (types.length > 1) {
                throw new BadRequestException('All cart items must have the same purchase order type');
            }

            // 발주 생성
            const [purchaseOrder] = await tx
                .insert(wmsTables.purchaseOrders)
                .values({
                    type: types[0],
                    supplierId: createDto.supplierId,
                    expectedArrival: createDto.expectedArrival ? new Date(createDto.expectedArrival) : null,
                    status: 'created',
                })
                .returning();

            // 발주 라인 생성
            await tx
                .insert(wmsTables.purchaseOrderLines)
                .values(
                    cartItems.map(item => ({
                        poId: purchaseOrder.id,
                        skuId: item.skuId,
                        quantity: item.quantity,
                        unitPrice: null,
                    }))
                );

            // 장바구니에서 아이템 제거
            await tx
                .delete(wmsTables.purchaseOrderCart)
                .where(inArray(wmsTables.purchaseOrderCart.id, createDto.cartItemIds));

            this.logger.log(`Created purchase order ${purchaseOrder.id} from ${cartItems.length} cart items`);

            return this.getPurchaseOrderById(purchaseOrder.id);
        });
    }

    /**
     * 발주 상태 업데이트
     */
    async updatePurchaseOrderStatus(
        poId: string,
        updateDto: UpdatePurchaseOrderStatusDto
    ): Promise<PurchaseOrderResponse> {
        return this.transactionService.runInTransaction(async (tx) => {
            const existingPO = await tx.query.purchaseOrders.findFirst({
                where: eq(wmsTables.purchaseOrders.id, poId),
            });

            if (!existingPO) {
                throw new NotFoundException(`Purchase order with ID ${poId} not found`);
            }

            await tx
                .update(wmsTables.purchaseOrders)
                .set({
                    status: updateDto.status,
                    expectedArrival: updateDto.expectedArrival ? new Date(updateDto.expectedArrival) : undefined,
                    updatedAt: new Date(),
                })
                .where(eq(wmsTables.purchaseOrders.id, poId));

            // 상태가 confirmed로 변경되면 inbound plans 생성
            if (updateDto.status === PurchaseOrderStatus.CONFIRMED) {
                await this.createInboundPlanFromPO(tx, poId);
            }

            this.logger.log(`Updated purchase order ${poId} status to ${updateDto.status}`);

            return this.getPurchaseOrderById(poId);
        });
    }

    /**
     * 발주에서 입고 계획 생성 (이중 입고 계획 지원)
     */
    private async createInboundPlanFromPO(tx: any, poId: string): Promise<void> {
        const purchaseOrder = await tx.query.purchaseOrders.findFirst({
            where: eq(wmsTables.purchaseOrders.id, poId),
            with: {
                lines: {
                    with: {
                        sku: true,
                    },
                },
            },
        });

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
            const sourceItems = purchaseOrder.lines.map(line => ({
                planId: sourcePlan.id,
                skuId: line.skuId,
                expectedQty: line.quantity,
                receivedQty: 0,
                status: 'pending' as const,
            }));

            const destinationItems = purchaseOrder.lines.map(line => ({
                planId: destinationPlan.id,
                skuId: line.skuId,
                expectedQty: line.quantity,
                receivedQty: 0,
                status: 'pending' as const,
            }));

            await tx.insert(wmsTables.inboundPlanItems).values([
                ...sourceItems,
                ...destinationItems
            ]);

            this.logger.log(`Created dual inbound plans: source=${sourcePlan.id}, destination=${destinationPlan.id} for PO ${poId}`);

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
            await tx
                .insert(wmsTables.inboundPlanItems)
                .values(
                    purchaseOrder.lines.map(line => ({
                        planId: plan.id,
                        skuId: line.skuId,
                        expectedQty: line.quantity,
                        receivedQty: 0,
                        status: 'pending',
                    }))
                );

            this.logger.log(`Created single inbound plan ${plan.id} for domestic PO ${poId}`);
        }
    }

    /**
     * 발주 유형에 따른 입고 창고 ID 반환 (source)
     */
    private async getSourceWarehouseId(type: PurchaseOrderType): Promise<string> {
        const warehouses = await this.db.query.warehouses.findMany();
        if (warehouses.length === 0) {
            throw new BadRequestException('No warehouse found');
        }

        // 임시 라우팅 로직 (향후 설정 테이블로 관리)
        if (type === 'domestic') {
            // 국내 → 부천 창고 직송
            const domestic = warehouses.find(w => w.type === 'domestic');
            return domestic?.id || warehouses[0].id;
        } else {
            // 해외 → 중국 창고 경유
            const overseas = warehouses.find(w => w.type === 'overseas');
            return overseas?.id || warehouses[0].id;
        }
    }

    /**
     * 발주 유형에 따른 최종 목적지 창고 ID 반환 (destination)
     */
    private async getDestinationWarehouseId(type: PurchaseOrderType): Promise<string> {
        const warehouses = await this.db.query.warehouses.findMany();
        if (warehouses.length === 0) {
            throw new BadRequestException('No warehouse found');
        }

        // 현재는 모든 물건이 부천 창고가 최종 목적지
        const domestic = warehouses.find(w => w.type === 'domestic');
        return domestic?.id || warehouses[0].id;
    }

    /**
     * 기존 호환성을 위한 메서드 (deprecated)
     */
    private async getDefaultWarehouseId(type: PurchaseOrderType): Promise<string> {
        return this.getSourceWarehouseId(type);
    }

    /**
     * 발주 조회
     */
    async getPurchaseOrderById(poId: string): Promise<PurchaseOrderResponse> {
        const purchaseOrder = await this.db.query.purchaseOrders.findFirst({
            where: eq(wmsTables.purchaseOrders.id, poId),
            with: {
                lines: {
                    with: {
                        sku: true,
                    },
                },
                supplier: true,
            },
        });

        if (!purchaseOrder) {
            throw new NotFoundException(`Purchase order with ID ${poId} not found`);
        }

        return {
            id: purchaseOrder.id,
            type: purchaseOrder.type as PurchaseOrderType,
            supplierId: purchaseOrder.supplierId,
            expectedArrival: purchaseOrder.expectedArrival,
            status: purchaseOrder.status as PurchaseOrderStatus,
            createdAt: purchaseOrder.createdAt!,
            updatedAt: purchaseOrder.updatedAt!,
            lines: purchaseOrder.lines?.map(line => ({
                skuId: line.skuId,
                quantity: line.quantity,
                unitPrice: line.unitPrice,
                sku: {
                    name: line.sku?.name || '',
                    barcode: line.sku?.barcode || '',
                },
            })) || [],
            supplier: purchaseOrder.supplier ? {
                name: purchaseOrder.supplier.name || '',
                contactInfo: purchaseOrder.supplier.contactInfo || '',
            } : undefined,
        };
    }

    /**
     * 발주 목록 조회
     */
    async getPurchaseOrders(
        status?: PurchaseOrderStatus,
        type?: PurchaseOrderType,
        limit = 50,
        offset = 0
    ): Promise<PurchaseOrderResponse[]> {
        const conditions: any[] = [];

        if (status) {
            conditions.push(eq(wmsTables.purchaseOrders.status, status));
        }

        if (type) {
            conditions.push(eq(wmsTables.purchaseOrders.type, type));
        }

        const purchaseOrders = await this.db.query.purchaseOrders.findMany({
            where: conditions.length > 0 ? and(...conditions) : undefined,
            with: {
                lines: {
                    with: {
                        sku: true,
                    },
                },
                supplier: true,
            },
            limit,
            offset,
            orderBy: (po, { desc }) => [desc(po.createdAt)],
        });

        return purchaseOrders.map(po => ({
            id: po.id,
            type: po.type as PurchaseOrderType,
            supplierId: po.supplierId,
            expectedArrival: po.expectedArrival,
            status: po.status as PurchaseOrderStatus,
            createdAt: po.createdAt!,
            updatedAt: po.updatedAt!,
            lines: po.lines?.map(line => ({
                skuId: line.skuId,
                quantity: line.quantity,
                unitPrice: line.unitPrice,
                sku: {
                    name: line.sku?.name || '',
                    barcode: line.sku?.barcode || '',
                },
            })) || [],
            supplier: po.supplier ? {
                name: po.supplier.name || '',
                contactInfo: po.supplier.contactInfo || '',
            } : undefined,
        }));
    }

    // ========== 발주대기리스트 (Cart) 관리 ==========

    /**
     * 장바구니에 아이템 추가
     */
    async addToCart(addDto: AddToCartDto): Promise<CartItemResponse> {
        // 이미 장바구니에 있는지 확인
        const existingItem = await this.db.query.purchaseOrderCart.findFirst({
            where: and(
                eq(wmsTables.purchaseOrderCart.skuId, addDto.skuId),
                eq(wmsTables.purchaseOrderCart.type, addDto.type)
            ),
        });

        if (existingItem) {
            // 기존 아이템 수량 업데이트
            await this.db
                .update(wmsTables.purchaseOrderCart)
                .set({
                    quantity: existingItem.quantity + addDto.quantity,
                    supplierInfo: addDto.supplierInfo || existingItem.supplierInfo,
                    updatedAt: new Date(),
                })
                .where(eq(wmsTables.purchaseOrderCart.id, existingItem.id));

            return this.getCartItemById(existingItem.id);
        } else {
            // 새 아이템 추가
            const [cartItem] = await this.db
                .insert(wmsTables.purchaseOrderCart)
                .values({
                    skuId: addDto.skuId,
                    quantity: addDto.quantity,
                    type: addDto.type,
                    supplierInfo: addDto.supplierInfo,
                })
                .returning();

            return this.getCartItemById(cartItem.id);
        }
    }

    /**
     * 장바구니 아이템 수정
     */
    async updateCartItem(itemId: string, updateDto: UpdateCartItemDto): Promise<CartItemResponse> {
        const existingItem = await this.db.query.purchaseOrderCart.findFirst({
            where: eq(wmsTables.purchaseOrderCart.id, itemId),
        });

        if (!existingItem) {
            throw new NotFoundException(`Cart item with ID ${itemId} not found`);
        }

        await this.db
            .update(wmsTables.purchaseOrderCart)
            .set({
                quantity: updateDto.quantity,
                supplierInfo: updateDto.supplierInfo ?? existingItem.supplierInfo,
                updatedAt: new Date(),
            })
            .where(eq(wmsTables.purchaseOrderCart.id, itemId));

        return this.getCartItemById(itemId);
    }

    /**
     * 장바구니에서 아이템 제거
     */
    async removeFromCart(itemId: string): Promise<void> {
        const result = await this.db
            .delete(wmsTables.purchaseOrderCart)
            .where(eq(wmsTables.purchaseOrderCart.id, itemId))
            .returning();

        if (result.length === 0) {
            throw new NotFoundException(`Cart item with ID ${itemId} not found`);
        }

        this.logger.log(`Removed cart item ${itemId}`);
    }

    /**
     * 장바구니 조회
     */
    async getCartItems(type?: PurchaseOrderType): Promise<CartItemResponse[]> {
        const cartItems = await this.db.query.purchaseOrderCart.findMany({
            where: type ? eq(wmsTables.purchaseOrderCart.type, type) : undefined,
            with: {
                sku: true,
            },
            orderBy: (cart, { desc }) => [desc(cart.createdAt)],
        });

        return cartItems.map(item => ({
            id: item.id,
            skuId: item.skuId,
            quantity: item.quantity,
            type: item.type as PurchaseOrderType,
            supplierInfo: item.supplierInfo,
            createdAt: item.createdAt!,
            updatedAt: item.updatedAt!,
            sku: {
                name: item.sku?.name || '',
                barcode: item.sku?.barcode || '',
            },
        }));
    }

    /**
     * 장바구니 아이템 조회
     */
    private async getCartItemById(itemId: string): Promise<CartItemResponse> {
        const item = await this.db.query.purchaseOrderCart.findFirst({
            where: eq(wmsTables.purchaseOrderCart.id, itemId),
            with: {
                sku: true,
            },
        });

        if (!item) {
            throw new NotFoundException(`Cart item with ID ${itemId} not found`);
        }

        return {
            id: item.id,
            skuId: item.skuId,
            quantity: item.quantity,
            type: item.type as PurchaseOrderType,
            supplierInfo: item.supplierInfo,
            createdAt: item.createdAt!,
            updatedAt: item.updatedAt!,
            sku: {
                name: item.sku.name,
                barcode: item.sku.barcode,
            },
        };
    }

    /**
     * 장바구니 비우기
     */
    async clearCart(type?: PurchaseOrderType): Promise<void> {
        await this.db
            .delete(wmsTables.purchaseOrderCart)
            .where(type ? eq(wmsTables.purchaseOrderCart.type, type) : undefined);

        this.logger.log(`Cleared cart${type ? ` for type ${type}` : ''}`);
    }

    // ========== 재주문 제안 ==========

    /**
     * 재주문 제안 조회
     * 안전재고 미만으로 떨어진 상품 목록
     */
    async getReorderSuggestions(warehouseId?: string): Promise<StockReorderSuggestion[]> {
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

        const results = await this.db.execute(query);

        return (results as any[]).map(row => ({
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
}
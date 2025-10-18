import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../../database/schemas/wms-schema';
import { eq, and, gte, lte, like, sql, SQL } from 'drizzle-orm';
import { InboundListFiltersDto } from '../dto/inbound-list/inbound-list-filters.dto';
import { ApplyInboundDto } from '../dto/inbound-list/apply-inbound.dto';
import { ImmediateReceiveDto } from '../dto/inbound-list/immediate-receive.dto';
import { InboundListResponseDto, InboundListItemDto } from '../dto/inbound-list/inbound-list-response.dto';
import { InboundService } from './inbound.service';

@Injectable()
export class InboundListService {
    constructor(
        @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
        private readonly inboundService: InboundService,
    ) {}

    private get db() {
        return this.dbService.db;
    }

    /**
     * List inbound list items with comprehensive filtering
     */
    async listInboundLists(filters: InboundListFiltersDto, tx?: DbTx): Promise<InboundListResponseDto> {
        return this.inTx(async (tx) => {
            const { inboundLists, purchaseOrders, skus, suppliers } = wmsTables;

            // Build where conditions
            const conditions: SQL[] = [];

            if (filters.status) {
                conditions.push(eq(inboundLists.status, filters.status));
            }

            if (filters.purchaseOrderId) {
                conditions.push(eq(inboundLists.poId, filters.purchaseOrderId));
            }

            if (filters.barcodeSearch) {
                conditions.push(like(inboundLists.barcode, `%${filters.barcodeSearch}%`));
            }

            if (filters.startDate) {
                conditions.push(gte(inboundLists.createdAt, new Date(filters.startDate)));
            }

            if (filters.endDate) {
                conditions.push(lte(inboundLists.createdAt, new Date(filters.endDate)));
            }

            // Query with joins
            const query = tx
                .select({
                    id: inboundLists.id,
                    poId: inboundLists.poId,
                    skuId: inboundLists.skuId,
                    quantity: inboundLists.quantity,
                    barcode: inboundLists.barcode,
                    status: inboundLists.status,
                    createdAt: inboundLists.createdAt,
                    updatedAt: inboundLists.updatedAt,
                    po: {
                        id: purchaseOrders.id,
                        type: purchaseOrders.type,
                        expectedArrival: purchaseOrders.expectedArrival,
                        supplierId: purchaseOrders.supplierId,
                    },
                    sku: {
                        id: skus.id,
                        name: skus.name,
                        code: skus.code,
                        defaultBarcode: skus.defaultBarcode,
                    },
                    supplier: {
                        id: suppliers.id,
                        name: suppliers.name,
                    },
                })
                .from(inboundLists)
                .innerJoin(purchaseOrders, eq(inboundLists.poId, purchaseOrders.id))
                .innerJoin(skus, eq(inboundLists.skuId, skus.id))
                .leftJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
                .where(conditions.length > 0 ? and(...conditions) : undefined)
                .limit(filters.limit ?? 50)
                .offset(filters.offset ?? 0);

            // Execute query
            const results = await query;

            // Count total
            const countQuery = await tx
                .select({ count: sql<number>`count(*)` })
                .from(inboundLists)
                .where(conditions.length > 0 ? and(...conditions) : undefined);

            const total = Number(countQuery[0]?.count ?? 0);

            // Map to DTOs
            const items: InboundListItemDto[] = results.map(row => ({
                id: row.id,
                poId: row.poId,
                skuId: row.skuId,
                quantity: row.quantity,
                barcode: row.barcode,
                status: row.status,
                createdAt: row.createdAt,
                updatedAt: row.updatedAt,
                purchaseOrder: {
                    id: row.po.id,
                    type: row.po.type,
                    expectedArrival: row.po.expectedArrival?.toISOString() ?? null,
                    supplier: row.supplier ? {
                        id: row.supplier.id,
                        name: row.supplier.name,
                    } : null,
                },
                sku: {
                    id: row.sku.id,
                    name: row.sku.name,
                    code: row.sku.code,
                    defaultBarcode: row.sku.defaultBarcode,
                },
            }));

            return {
                items,
                total,
                limit: filters.limit ?? 50,
                offset: filters.offset ?? 0,
            };
        }, tx);
    }

    /**
     * Get inbound list item detail by ID
     */
    async getInboundListDetail(id: string, tx?: DbTx): Promise<InboundListItemDto> {
        return this.inTx(async (tx) => {
            const { inboundLists, purchaseOrders, skus, suppliers } = wmsTables;

            const result = await tx
                .select({
                    id: inboundLists.id,
                    poId: inboundLists.poId,
                    skuId: inboundLists.skuId,
                    quantity: inboundLists.quantity,
                    barcode: inboundLists.barcode,
                    status: inboundLists.status,
                    createdAt: inboundLists.createdAt,
                    updatedAt: inboundLists.updatedAt,
                    po: {
                        id: purchaseOrders.id,
                        type: purchaseOrders.type,
                        expectedArrival: purchaseOrders.expectedArrival,
                    },
                    sku: {
                        id: skus.id,
                        name: skus.name,
                        code: skus.code,
                        defaultBarcode: skus.defaultBarcode,
                    },
                    supplier: {
                        id: suppliers.id,
                        name: suppliers.name,
                    },
                })
                .from(inboundLists)
                .innerJoin(purchaseOrders, eq(inboundLists.poId, purchaseOrders.id))
                .innerJoin(skus, eq(inboundLists.skuId, skus.id))
                .leftJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
                .where(eq(inboundLists.id, id))
                .limit(1);

            if (!result[0]) {
                throw new NotFoundException(`Inbound list item with ID ${id} not found`);
            }

            const row = result[0];

            return {
                id: row.id,
                poId: row.poId,
                skuId: row.skuId,
                quantity: row.quantity,
                barcode: row.barcode,
                status: row.status,
                createdAt: row.createdAt,
                updatedAt: row.updatedAt,
                purchaseOrder: {
                    id: row.po.id,
                    type: row.po.type,
                    expectedArrival: row.po.expectedArrival?.toISOString() ?? null,
                    supplier: row.supplier ? {
                        id: row.supplier.id,
                        name: row.supplier.name,
                    } : null,
                },
                sku: {
                    id: row.sku.id,
                    name: row.sku.name,
                    code: row.sku.code,
                    defaultBarcode: row.sku.defaultBarcode,
                },
            };
        }, tx);
    }

    /**
     * Apply for inbound (status: pending → applied)
     */
    async applyInbound(id: string, dto: ApplyInboundDto, tx?: DbTx): Promise<{
        id: string;
        status: string;
        appliedAt: Date;
        message: string
    }> {
        return this.inTx(async (tx) => {
            const { inboundLists } = wmsTables;

            // Get current item
            const item = await tx
                .select()
                .from(inboundLists)
                .where(eq(inboundLists.id, id))
                .limit(1);

            if (!item[0]) {
                throw new NotFoundException(`Inbound list item with ID ${id} not found`);
            }

            // Validate status transition
            if (item[0].status !== 'pending') {
                throw new BadRequestException(
                    `Cannot apply inbound: current status is ${item[0].status}, expected 'pending'`
                );
            }

            // Update status to 'applied'
            await tx
                .update(inboundLists)
                .set({
                    status: 'applied',
                    updatedAt: new Date()
                })
                .where(eq(inboundLists.id, id));

            return {
                id,
                status: 'applied',
                appliedAt: new Date(),
                message: '입고신청이 완료되었습니다. (Inbound application completed)',
            };
        }, tx);
    }

    /**
     * Execute immediate receive (bypasses planning, directly creates receipt)
     */
    async immediateReceive(id: string, dto: ImmediateReceiveDto, tx?: DbTx): Promise<{
        id: string;
        receiptId: string;
        status: string;
        message: string;
    }> {
        return this.inTx(async (tx) => {
            const { inboundLists } = wmsTables;

            // Get inbound list item
            const item = await tx
                .select()
                .from(inboundLists)
                .where(eq(inboundLists.id, id))
                .limit(1);

            if (!item[0]) {
                throw new NotFoundException(`Inbound list item with ID ${id} not found`);
            }

            // Validate status (can receive from pending, applied, or receiving)
            if (!['pending', 'applied', 'receiving'].includes(item[0].status)) {
                throw new BadRequestException(
                    `Cannot receive: current status is ${item[0].status}`
                );
            }

            // Create inbound receipt using existing service
            // Note: simpleInbound automatically uses inbound_default location
            const receipt = await this.inboundService.simpleInbound({
                warehouseId: dto.warehouseId,
                items: [{
                    skuId: item[0].skuId,
                    quantity: dto.actualQuantity ?? item[0].quantity,
                }],
            }, tx);

            // Update inbound list status to 'confirmed'
            await tx
                .update(inboundLists)
                .set({
                    status: 'confirmed',
                    updatedAt: new Date()
                })
                .where(eq(inboundLists.id, id));

            return {
                id,
                receiptId: receipt.receiptId,
                status: 'confirmed',
                message: '입고가 완료되었습니다. (Inbound completed)',
            };
        }, tx);
    }

    /**
     * Generate barcode for inbound list item
     */
    async generateBarcode(id: string, tx?: DbTx): Promise<{
        barcodeValue: string;
        format: string;
        message: string;
    }> {
        return this.inTx(async (tx) => {
            const { inboundLists, skus } = wmsTables;

            // Get item with SKU details
            const result = await tx
                .select({
                    inboundList: inboundLists,
                    sku: skus,
                })
                .from(inboundLists)
                .innerJoin(skus, eq(inboundLists.skuId, skus.id))
                .where(eq(inboundLists.id, id))
                .limit(1);

            if (!result[0]) {
                throw new NotFoundException(`Inbound list item with ID ${id} not found`);
            }

            const { inboundList, sku } = result[0];

            // Use existing barcode or SKU default barcode
            const barcodeValue = inboundList.barcode ?? sku.defaultBarcode ?? `IL-${id.substring(0, 8)}`;

            // If no barcode exists, update inbound list with generated barcode
            if (!inboundList.barcode) {
                await tx
                    .update(inboundLists)
                    .set({
                        barcode: barcodeValue,
                        updatedAt: new Date()
                    })
                    .where(eq(inboundLists.id, id));
            }

            return {
                barcodeValue,
                format: 'CODE128',
                message: '바코드가 생성되었습니다. (Barcode generated)',
            };
        }, tx);
    }

    /**
     * Standard transaction helper
     */
    private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx): Promise<T> {
        return tx ? fn(tx) : this.db.transaction(fn);
    }
}




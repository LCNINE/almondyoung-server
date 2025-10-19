import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../../database/schemas/wms-schema';
import { eq, and, gte, lte, desc, sql, SQL } from 'drizzle-orm';
import { CreateSkuLocationMovementDto } from '../dto/sku-location-movements/create-sku-location-movement.dto';
import { SkuLocationMovementResponseDto } from '../dto/sku-location-movements/sku-location-movement-response.dto';

export interface MovementStatistics {
    totalMovements: number;
    mostMovedSkus: Array<{
        skuId: string;
        skuName: string;
        movementCount: number;
    }>;
    mostActiveLocations: Array<{
        locationId: string;
        locationCode: string;
        movementCount: number;
        direction: 'from' | 'to';
    }>;
}

export interface MovementFilters {
    skuId?: string;
    fromLocationId?: string;
    toLocationId?: string;
    startDate?: Date;
    endDate?: Date;
    status?: string;
    limit?: number;
    offset?: number;
}

@Injectable()
export class SkuLocationMovementService {
    constructor(
        @InjectTypedDb<typeof wmsSchema>()
        private readonly dbService: DbService<typeof wmsSchema>,
    ) {}

    private get db() {
        return this.dbService.db;
    }

    /**
     * Record a SKU location movement
     */
    async recordMovement(
        dto: CreateSkuLocationMovementDto,
        tx?: DbTx
    ): Promise<SkuLocationMovementResponseDto> {
        return this.inTx(async (tx) => {
            const { skuLocationMovements, skus, locations } = wmsTables;

            // Validate: from and to locations must be different
            if (dto.fromLocationId === dto.toLocationId) {
                throw new BadRequestException(
                    'From and To locations must be different'
                );
            }

            // Validate SKU exists
            const sku = await tx
                .select()
                .from(skus)
                .where(eq(skus.id, dto.skuId))
                .limit(1);

            if (!sku[0]) {
                throw new NotFoundException(`SKU with ID ${dto.skuId} not found`);
            }

            // Validate from location exists
            const fromLocation = await tx
                .select()
                .from(locations)
                .where(eq(locations.id, dto.fromLocationId))
                .limit(1);

            if (!fromLocation[0]) {
                throw new NotFoundException(
                    `From location with ID ${dto.fromLocationId} not found`
                );
            }

            // Validate to location exists
            const toLocation = await tx
                .select()
                .from(locations)
                .where(eq(locations.id, dto.toLocationId))
                .limit(1);

            if (!toLocation[0]) {
                throw new NotFoundException(
                    `To location with ID ${dto.toLocationId} not found`
                );
            }

            // Validate quantity if provided
            if (dto.quantity !== undefined && dto.quantity <= 0) {
                throw new BadRequestException('Quantity must be greater than 0');
            }

            // Create movement record
            const created = await tx
                .insert(skuLocationMovements)
                .values({
                    skuId: dto.skuId,
                    barcode: dto.barcode,
                    fromLocationId: dto.fromLocationId,
                    toLocationId: dto.toLocationId,
                    quantity: dto.quantity,
                    reason: dto.reason,
                    status: 'completed',
                    movedBy: dto.movedBy,
                    movementTimestamp: new Date(),
                })
                .returning();

            return this.mapToResponseDto(created[0]);
        }, tx);
    }

    /**
     * Get movement history for a specific SKU
     */
    async getMovementHistory(
        skuId: string,
        limit: number = 50,
        offset: number = 0,
        tx?: DbTx
    ): Promise<{
        movements: SkuLocationMovementResponseDto[];
        total: number;
    }> {
        return this.inTx(async (tx) => {
            const { skuLocationMovements } = wmsTables;

            // Get movements
            const movements = await tx
                .select()
                .from(skuLocationMovements)
                .where(eq(skuLocationMovements.skuId, skuId))
                .orderBy(desc(skuLocationMovements.movementTimestamp))
                .limit(limit)
                .offset(offset);

            // Get total count
            const countResult = await tx
                .select({ count: sql<number>`count(*)` })
                .from(skuLocationMovements)
                .where(eq(skuLocationMovements.skuId, skuId));

            return {
                movements: movements.map(m => this.mapToResponseDto(m)),
                total: Number(countResult[0]?.count ?? 0),
            };
        }, tx);
    }

    /**
     * Get movements by location (either from or to)
     */
    async getMovementsByLocation(
        locationId: string,
        direction: 'from' | 'to' | 'both' = 'both',
        limit: number = 50,
        offset: number = 0,
        tx?: DbTx
    ): Promise<{
        movements: SkuLocationMovementResponseDto[];
        total: number;
    }> {
        return this.inTx(async (tx) => {
            const { skuLocationMovements } = wmsTables;

            // Build where clause based on direction
            let whereClause;
            if (direction === 'from') {
                whereClause = eq(skuLocationMovements.fromLocationId, locationId);
            } else if (direction === 'to') {
                whereClause = eq(skuLocationMovements.toLocationId, locationId);
            } else {
                // both
                whereClause = sql`${skuLocationMovements.fromLocationId} = ${locationId} OR ${skuLocationMovements.toLocationId} = ${locationId}`;
            }

            // Get movements
            const movements = await tx
                .select()
                .from(skuLocationMovements)
                .where(whereClause)
                .orderBy(desc(skuLocationMovements.movementTimestamp))
                .limit(limit)
                .offset(offset);

            // Get total count
            const countResult = await tx
                .select({ count: sql<number>`count(*)` })
                .from(skuLocationMovements)
                .where(whereClause);

            return {
                movements: movements.map(m => this.mapToResponseDto(m)),
                total: Number(countResult[0]?.count ?? 0),
            };
        }, tx);
    }

    /**
     * Get movements by date range with various filters
     */
    async getMovementsByFilters(
        filters: MovementFilters,
        tx?: DbTx
    ): Promise<{
        movements: SkuLocationMovementResponseDto[];
        total: number;
    }> {
        return this.inTx(async (tx) => {
            const { skuLocationMovements } = wmsTables;

            // Build where conditions
            const conditions: SQL[] = [];

            if (filters.skuId) {
                conditions.push(eq(skuLocationMovements.skuId, filters.skuId));
            }

            if (filters.fromLocationId) {
                conditions.push(eq(skuLocationMovements.fromLocationId, filters.fromLocationId));
            }

            if (filters.toLocationId) {
                conditions.push(eq(skuLocationMovements.toLocationId, filters.toLocationId));
            }

            if (filters.startDate) {
                conditions.push(gte(skuLocationMovements.movementTimestamp, filters.startDate));
            }

            if (filters.endDate) {
                conditions.push(lte(skuLocationMovements.movementTimestamp, filters.endDate));
            }

            if (filters.status) {
                conditions.push(eq(skuLocationMovements.status, filters.status));
            }

            const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

            // Get movements
            const movements = await tx
                .select()
                .from(skuLocationMovements)
                .where(whereClause)
                .orderBy(desc(skuLocationMovements.movementTimestamp))
                .limit(filters.limit ?? 50)
                .offset(filters.offset ?? 0);

            // Get total count
            const countResult = await tx
                .select({ count: sql<number>`count(*)` })
                .from(skuLocationMovements)
                .where(whereClause);

            return {
                movements: movements.map(m => this.mapToResponseDto(m)),
                total: Number(countResult[0]?.count ?? 0),
            };
        }, tx);
    }

    /**
     * Get movement statistics
     */
    async getMovementStatistics(
        startDate?: Date,
        endDate?: Date,
        tx?: DbTx
    ): Promise<MovementStatistics> {
        return this.inTx(async (tx) => {
            const { skuLocationMovements, skus, locations } = wmsTables;

            // Build date filter
            const dateConditions: SQL[] = [];
            if (startDate) {
                dateConditions.push(gte(skuLocationMovements.movementTimestamp, startDate));
            }
            if (endDate) {
                dateConditions.push(lte(skuLocationMovements.movementTimestamp, endDate));
            }
            const dateFilter = dateConditions.length > 0 ? and(...dateConditions) : undefined;

            // Total movements
            const totalResult = await tx
                .select({ count: sql<number>`count(*)` })
                .from(skuLocationMovements)
                .where(dateFilter);

            const totalMovements = Number(totalResult[0]?.count ?? 0);

            // Most moved SKUs
            const mostMovedSkusRaw = await tx
                .select({
                    skuId: skuLocationMovements.skuId,
                    skuName: skus.name,
                    movementCount: sql<number>`count(*)`,
                })
                .from(skuLocationMovements)
                .innerJoin(skus, eq(skuLocationMovements.skuId, skus.id))
                .where(dateFilter)
                .groupBy(skuLocationMovements.skuId, skus.name)
                .orderBy(desc(sql<number>`count(*)`))
                .limit(10);

            const mostMovedSkus = mostMovedSkusRaw.map(row => ({
                skuId: row.skuId,
                skuName: row.skuName,
                movementCount: Number(row.movementCount),
            }));

            // Most active locations (from)
            const mostActiveFromRaw = await tx
                .select({
                    locationId: skuLocationMovements.fromLocationId,
                    locationCode: locations.code,
                    movementCount: sql<number>`count(*)`,
                })
                .from(skuLocationMovements)
                .innerJoin(locations, eq(skuLocationMovements.fromLocationId, locations.id))
                .where(dateFilter)
                .groupBy(skuLocationMovements.fromLocationId, locations.code)
                .orderBy(desc(sql<number>`count(*)`))
                .limit(5);

            // Most active locations (to)
            const mostActiveToRaw = await tx
                .select({
                    locationId: skuLocationMovements.toLocationId,
                    locationCode: locations.code,
                    movementCount: sql<number>`count(*)`,
                })
                .from(skuLocationMovements)
                .innerJoin(locations, eq(skuLocationMovements.toLocationId, locations.id))
                .where(dateFilter)
                .groupBy(skuLocationMovements.toLocationId, locations.code)
                .orderBy(desc(sql<number>`count(*)`))
                .limit(5);

            const mostActiveLocations = [
                ...mostActiveFromRaw.map(row => ({
                    locationId: row.locationId,
                    locationCode: row.locationCode,
                    movementCount: Number(row.movementCount),
                    direction: 'from' as const,
                })),
                ...mostActiveToRaw.map(row => ({
                    locationId: row.locationId,
                    locationCode: row.locationCode,
                    movementCount: Number(row.movementCount),
                    direction: 'to' as const,
                })),
            ];

            return {
                totalMovements,
                mostMovedSkus,
                mostActiveLocations,
            };
        }, tx);
    }

    /**
     * Get recent movements (last N movements)
     */
    async getRecentMovements(
        limit: number = 20,
        tx?: DbTx
    ): Promise<SkuLocationMovementResponseDto[]> {
        return this.inTx(async (tx) => {
            const { skuLocationMovements } = wmsTables;

            const movements = await tx
                .select()
                .from(skuLocationMovements)
                .orderBy(desc(skuLocationMovements.movementTimestamp))
                .limit(limit);

            return movements.map(m => this.mapToResponseDto(m));
        }, tx);
    }

    /**
     * Get single movement by ID
     */
    async getMovementById(id: string, tx?: DbTx): Promise<SkuLocationMovementResponseDto> {
        return this.inTx(async (tx) => {
            const { skuLocationMovements } = wmsTables;

            const result = await tx
                .select()
                .from(skuLocationMovements)
                .where(eq(skuLocationMovements.id, id))
                .limit(1);

            if (!result[0]) {
                throw new NotFoundException(`Movement with ID ${id} not found`);
            }

            return this.mapToResponseDto(result[0]);
        }, tx);
    }

    /**
     * Map database row to response DTO
     */
    private mapToResponseDto(row: any): SkuLocationMovementResponseDto {
        return {
            id: row.id,
            skuId: row.skuId,
            barcode: row.barcode,
            fromLocationId: row.fromLocationId,
            toLocationId: row.toLocationId,
            quantity: row.quantity,
            reason: row.reason,
            status: row.status,
            movedBy: row.movedBy,
            movementTimestamp: row.movementTimestamp,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
        };
    }

    private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx): Promise<T> {
        return tx ? fn(tx) : this.db.transaction(fn);
    }
}


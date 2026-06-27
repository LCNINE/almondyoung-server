import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables, wmsSchema, DbTx, LocationRack, LocationColumn, Location } from '../../schema/inventory.schema';
import { TypedDatabase, DbService } from '@app/db';
import { eq, and, like, desc, asc, count, sql } from 'drizzle-orm';
import {
  CreateColumnDto,
  CreateRackDto,
  CreateZoneLocationDto,
  AddCustomBinDto,
  LocationCreateResultDto,
} from '../dto/location-create.dto';
import { UpdateLocationDto, UpdateColumnDto, UpdateRackDto, ExtendRackBinsDto } from '../dto/location-update.dto';
import { LocationQueryDto } from '../dto/location-query.dto';
import { SystemLocationRole } from '../types';
import { SYSTEM_LOCATION_DEFAULTS } from '../constants/warehouse.constants';
import { StandardLocationResponseDto, ZoneLocationResponseDto } from '../dto';

@Injectable()
export class LocationService {
  private readonly logger = new Logger(LocationService.name);

  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  private get db() {
    return this.dbService.db;
  }

  // 시스템 로케이션 존재 보장 (멱등)
  async ensureSystemLocations(warehouseId: string, tx?: DbTx) {
    const roles = Object.keys(SYSTEM_LOCATION_DEFAULTS) as SystemLocationRole[];

    await this.dbService.run(async (trx) => {
      for (const role of roles) {
        const [exists] = await trx
          .select()
          .from(wmsTables.locations)
          .where(and(eq(wmsTables.locations.warehouseId, warehouseId), eq(wmsTables.locations.systemRole, role)))
          .limit(1);

        if (!exists) {
          const def = SYSTEM_LOCATION_DEFAULTS[role];
          await trx.insert(wmsTables.locations).values({
            warehouseId,
            code: def.code,
            displayName: def.displayName,
            locationType: 'zone',
            rackId: null,
            binIdentifier: null,
            isSystem: true,
            systemRole: role,
            isActive: true,
          });
          this.logger.log(`System location created for ${warehouseId}: ${role}`);
        }
      }
    }, tx);
  }

  async getSystemLocationByRole(warehouseId: string, role: SystemLocationRole, tx?: DbTx) {
    const db = tx ?? this.db;
    const loc = await db.query.locations.findFirst({
      where: and(eq(wmsTables.locations.warehouseId, warehouseId), eq(wmsTables.locations.systemRole, role)),
    });
    if (!loc) {
      throw new NotFoundException(`System location not found for role ${role} in warehouse ${warehouseId}`);
    }
    return loc;
  }

  async createColumn(warehouseId: string, dto: CreateColumnDto) {
    this.logger.log(`Creating column ${dto.columnName} for warehouse ${warehouseId}`);

    const existing = await this.db
      .select()
      .from(wmsTables.locationColumns)
      .where(
        and(
          eq(wmsTables.locationColumns.warehouseId, warehouseId),
          eq(wmsTables.locationColumns.columnName, dto.columnName),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      throw new BadRequestException(`Column ${dto.columnName} already exists in this warehouse`);
    }

    const [column] = await this.db
      .insert(wmsTables.locationColumns)
      .values({
        warehouseId,
        columnName: dto.columnName,
        displayOrder: dto.displayOrder,
      })
      .returning();

    return column;
  }

  async getColumns(warehouseId: string, isActive?: boolean) {
    const conditions = [eq(wmsTables.locationColumns.warehouseId, warehouseId)];

    if (isActive !== undefined) {
      conditions.push(eq(wmsTables.locationColumns.isActive, isActive));
    }

    return this.db
      .select()
      .from(wmsTables.locationColumns)
      .where(and(...conditions))
      .orderBy(asc(wmsTables.locationColumns.displayOrder), asc(wmsTables.locationColumns.columnName));
  }

  async updateColumn(columnId: string, dto: UpdateColumnDto) {
    const [updated] = await this.db
      .update(wmsTables.locationColumns)
      .set({
        ...dto,
        updatedAt: new Date(),
      })
      .where(eq(wmsTables.locationColumns.id, columnId))
      .returning();

    if (!updated) {
      throw new NotFoundException(`Column with id ${columnId} not found`);
    }

    return updated;
  }

  async createRack(warehouseId: string, dto: CreateRackDto): Promise<LocationCreateResultDto> {
    this.logger.log(`Creating rack ${dto.columnName}-${dto.rackNumber} for warehouse ${warehouseId}`);

    return await this.db.transaction(async (tx) => {
      const [column] = await tx
        .select()
        .from(wmsTables.locationColumns)
        .where(
          and(
            eq(wmsTables.locationColumns.warehouseId, warehouseId),
            eq(wmsTables.locationColumns.columnName, dto.columnName),
          ),
        )
        .limit(1);

      if (!column) {
        throw new BadRequestException(`Column ${dto.columnName} not found in warehouse`);
      }

      const existing = await tx
        .select()
        .from(wmsTables.locationRacks)
        .where(
          and(eq(wmsTables.locationRacks.columnId, column.id), eq(wmsTables.locationRacks.rackNumber, dto.rackNumber)),
        )
        .limit(1);

      if (existing.length > 0) {
        throw new BadRequestException(`Rack ${dto.columnName}-${dto.rackNumber} already exists`);
      }

      const binStart = dto.binSettings.standardBins?.start || 1;
      const binEnd = dto.binSettings.standardBins?.end || 20;

      const [rack] = await tx
        .insert(wmsTables.locationRacks)
        .values({
          columnId: column.id,
          rackNumber: dto.rackNumber,
          defaultBinStart: binStart,
          defaultBinEnd: binEnd,
          autoGenerateBins: dto.binSettings.autoGenerate,
          physicalWidth: dto.physicalWidth,
          physicalHeight: dto.physicalHeight,
          notes: dto.notes,
        })
        .returning();

      const createdLocationCodes: string[] = [];

      if (dto.binSettings.autoGenerate && dto.binSettings.standardBins) {
        const locations: Array<typeof wmsTables.locations.$inferInsert> = [];
        for (let binNum = binStart; binNum <= binEnd; binNum++) {
          const binIdentifier = binNum.toString().padStart(2, '0');
          const locationCode = `${dto.columnName}-${dto.rackNumber.toString().padStart(2, '0')}-${binIdentifier}`;

          locations.push({
            warehouseId,
            code: locationCode,
            locationType: 'standard',
            rackId: rack.id,
            binIdentifier,
            displayName: locationCode,
            isActive: true,
          });

          createdLocationCodes.push(locationCode);
        }

        if (locations.length > 0) {
          await tx.insert(wmsTables.locations).values(locations);
        }
      }

      if (dto.binSettings.customBins && dto.binSettings.customBins.length > 0) {
        const customLocations: Array<typeof wmsTables.locations.$inferInsert> = dto.binSettings.customBins.map(
          (customBinName) => {
            const locationCode = `${dto.columnName}-${dto.rackNumber.toString().padStart(2, '0')}-${customBinName}`;
            createdLocationCodes.push(locationCode);

            return {
              warehouseId,
              code: locationCode,
              locationType: 'standard',
              rackId: rack.id,
              binIdentifier: customBinName,
              displayName: locationCode,
              isActive: true,
            };
          },
        );

        await tx.insert(wmsTables.locations).values(customLocations);
      }

      this.logger.log(`Created rack ${dto.columnName}-${dto.rackNumber} with ${createdLocationCodes.length} bins`);

      return {
        success: true,
        createdCount: createdLocationCodes.length,
        createdLocationCodes,
      };
    });
  }

  async createZoneLocation(warehouseId: string, dto: CreateZoneLocationDto) {
    this.logger.log(`Creating zone location ${dto.code} for warehouse ${warehouseId}`);

    return await this.db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(wmsTables.locations)
        .where(
          and(
            eq(wmsTables.locations.warehouseId, warehouseId),
            eq(wmsTables.locations.displayName, dto.displayName || dto.code),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        throw new BadRequestException(
          `Zone location "${dto.displayName || dto.code}" already exists in this warehouse`,
        );
      }

      let locationCode = dto.code;

      if (/[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/.test(dto.code)) {
        const [countResult] = await tx
          .select({ count: count() })
          .from(wmsTables.locations)
          .where(
            and(
              eq(wmsTables.locations.warehouseId, warehouseId),
              eq(wmsTables.locations.locationType, 'zone'),
              like(wmsTables.locations.code, 'zone-%'),
            ),
          );

        const zoneNumber = (countResult?.count || 0) + 1;
        locationCode = `zone-${zoneNumber}`;

        this.logger.log(`Korean characters detected in "${dto.code}", generated code: ${locationCode}`);
      }

      const [location] = await tx
        .insert(wmsTables.locations)
        .values({
          ...dto,
          warehouseId,
          code: locationCode,
          locationType: 'zone',
          rackId: null,
          binIdentifier: null,
          displayName: dto.displayName || dto.code,
          isActive: true,
        })
        .returning();

      this.logger.log(`Created zone location: ${location.displayName} (code: ${location.code})`);
      return location;
    });
  }

  async getLocations(warehouseId: string, query: LocationQueryDto) {
    const { page = 1, limit = 20, sortBy = 'code', sortOrder = 'asc' } = query;
    const offset = (page - 1) * limit;

    const baseQuery = this.db
      .select({
        location: wmsTables.locations,
        rack: wmsTables.locationRacks,
        column: wmsTables.locationColumns,
      })
      .from(wmsTables.locations)
      .leftJoin(wmsTables.locationRacks, eq(wmsTables.locations.rackId, wmsTables.locationRacks.id))
      .leftJoin(wmsTables.locationColumns, eq(wmsTables.locationRacks.columnId, wmsTables.locationColumns.id));

    const conditions = [eq(wmsTables.locations.warehouseId, warehouseId)];

    if (query.type) {
      conditions.push(eq(wmsTables.locations.locationType, query.type));
    }
    if (query.columnName) {
      conditions.push(eq(wmsTables.locationColumns.columnName, query.columnName));
    }
    if (query.rackNumber) {
      conditions.push(eq(wmsTables.locationRacks.rackNumber, query.rackNumber));
    }
    if (query.isActive !== undefined) {
      conditions.push(eq(wmsTables.locations.isActive, query.isActive));
    }
    if (query.search) {
      conditions.push(
        sql`(${wmsTables.locations.code} ILIKE ${'%' + query.search + '%'} OR ${wmsTables.locations.displayName} ILIKE ${'%' + query.search + '%'})`,
      );
    }

    const orderByColumn =
      sortBy === 'columnName'
        ? wmsTables.locationColumns.columnName
        : sortBy === 'rackNumber'
          ? wmsTables.locationRacks.rackNumber
          : sortBy === 'createdAt'
            ? wmsTables.locations.createdAt
            : wmsTables.locations.code;

    const orderDirection = sortOrder === 'desc' ? desc : asc;

    const items = await baseQuery
      .where(and(...conditions))
      .orderBy(orderDirection(orderByColumn))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await this.db
      .select({ total: count() })
      .from(wmsTables.locations)
      .leftJoin(wmsTables.locationRacks, eq(wmsTables.locations.rackId, wmsTables.locationRacks.id))
      .leftJoin(wmsTables.locationColumns, eq(wmsTables.locationRacks.columnId, wmsTables.locationColumns.id))
      .where(and(...conditions));

    const totalPages = Math.ceil(total / limit);

    return {
      items: items.map((item) => ({
        ...item.location,
        columnName: item.column?.columnName,
        rackNumber: item.rack?.rackNumber,
      })),
      total,
      page,
      limit,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    };
  }

  async getLocationById(locationId: string, tx?: DbTx): Promise<Location> {
    return await this.dbService.run(async (tx) => {
      const [result] = await this.db
        .select()
        .from(wmsTables.locations)
        .where(eq(wmsTables.locations.id, locationId))
        .limit(1);

      if (!result) {
        throw new NotFoundException(`Location with id ${locationId} not found`);
      }

      return result;
    }, tx);
  }

  async updateLocation(locationId: string, dto: UpdateLocationDto) {
    // 시스템 로케이션 보호: 허용 필드만 수정
    const [existing] = await this.db
      .select()
      .from(wmsTables.locations)
      .where(eq(wmsTables.locations.id, locationId))
      .limit(1);

    if (!existing) {
      throw new NotFoundException(`Location with id ${locationId} not found`);
    }

    let payload: Partial<typeof wmsTables.locations.$inferInsert> = {
      ...dto,
      updatedAt: new Date(),
    };

    if (existing.isSystem) {
      payload = {
        displayName: dto.displayName,
        notes: dto.notes,
        isActive: dto.isActive,
        capacityLimit: dto.capacityLimit,
        fifoRank: dto.fifoRank,
        isExpirySeparated: dto.isExpirySeparated,
        updatedAt: new Date(),
      };
    }

    const [updated] = await this.db
      .update(wmsTables.locations)
      .set(payload)
      .where(eq(wmsTables.locations.id, locationId))
      .returning();

    if (!updated) {
      throw new NotFoundException(`Location with id ${locationId} not found`);
    }

    return updated;
  }

  async updateRack(rackId: string, dto: UpdateRackDto) {
    const [updated] = await this.db
      .update(wmsTables.locationRacks)
      .set({
        ...dto,
        updatedAt: new Date(),
      })
      .where(eq(wmsTables.locationRacks.id, rackId))
      .returning();

    if (!updated) {
      throw new NotFoundException(`Rack with id ${rackId} not found`);
    }

    return updated;
  }

  async addCustomBin(warehouseId: string, dto: AddCustomBinDto) {
    this.logger.log(`Adding custom bin ${dto.customBinName} to rack ${dto.columnName}-${dto.rackNumber}`);

    return await this.db.transaction(async (tx) => {
      // 시스템 로케이션 보호: 커스텀 빈 생성은 일반 랙/로케이션만 해당 (정책적으로 주석)
      // 랙 찾기
      const [rackResult] = await tx
        .select({
          rack: wmsTables.locationRacks,
          column: wmsTables.locationColumns,
        })
        .from(wmsTables.locationRacks)
        .innerJoin(wmsTables.locationColumns, eq(wmsTables.locationRacks.columnId, wmsTables.locationColumns.id))
        .where(
          and(
            eq(wmsTables.locationColumns.warehouseId, warehouseId),
            eq(wmsTables.locationColumns.columnName, dto.columnName),
            eq(wmsTables.locationRacks.rackNumber, dto.rackNumber),
          ),
        )
        .limit(1);

      if (!rackResult) {
        throw new BadRequestException(`Rack ${dto.columnName}-${dto.rackNumber} not found`);
      }

      const locationCode = `${dto.columnName}-${dto.rackNumber.toString().padStart(2, '0')}-${dto.customBinName}`;

      const existing = await tx
        .select()
        .from(wmsTables.locations)
        .where(and(eq(wmsTables.locations.warehouseId, warehouseId), eq(wmsTables.locations.code, locationCode)))
        .limit(1);

      if (existing.length > 0) {
        throw new BadRequestException(`Location ${locationCode} already exists`);
      }

      const [location] = await tx
        .insert(wmsTables.locations)
        .values({
          warehouseId,
          code: locationCode,
          locationType: 'standard',
          rackId: rackResult.rack.id,
          binIdentifier: dto.customBinName,
          displayName: dto.displayName || locationCode,
          capacityLimit: dto.capacityLimit,
          isActive: true,
          notes: dto.notes,
        })
        .returning();

      return location;
    });
  }

  async getRacks(
    warehouseId: string,
    columnName?: string,
    isActive?: boolean,
    tx?: DbTx,
  ): Promise<(LocationRack & { column: LocationColumn })[]> {
    const conditions = [eq(wmsTables.locationColumns.warehouseId, warehouseId)];

    if (columnName) {
      conditions.push(eq(wmsTables.locationColumns.columnName, columnName));
    }
    if (isActive !== undefined) {
      conditions.push(eq(wmsTables.locationRacks.isActive, isActive));
    }

    return this.dbService.run(async (tx) => {
      const result = await tx
        .select()
        .from(wmsTables.locationRacks)
        .innerJoin(wmsTables.locationColumns, eq(wmsTables.locationRacks.columnId, wmsTables.locationColumns.id))
        .where(and(...conditions));

      return result.map((row) => ({
        ...row.location_racks,
        column: row.location_columns,
      }));
    }, tx);
  }

  // 삭제 보호: 시스템 로케이션은 삭제 금지
  async deleteLocation(locationId: string) {
    const [existing] = await this.db
      .select()
      .from(wmsTables.locations)
      .where(eq(wmsTables.locations.id, locationId))
      .limit(1);

    if (!existing) {
      throw new NotFoundException(`Location with id ${locationId} not found`);
    }

    if (existing.isSystem) {
      throw new BadRequestException('System location cannot be deleted');
    }

    await this.db.delete(wmsTables.locations).where(eq(wmsTables.locations.id, locationId));
    return { success: true };
  }
}

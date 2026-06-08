import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '@app/db';
import { and, asc, eq } from 'drizzle-orm';
import { WalletSchema, paymentMethodCatalog, regionPaymentMethods, regions } from '../schema';
import { PaymentMethodCatalog, Region } from '../types';
import {
  AvailablePaymentMethodDto,
  CreateRegionDto,
  PutRegionMethodsDto,
  RegionMethodMatrixResponseDto,
  UpdateCatalogDto,
  UpdateRegionDto,
} from './dto';

/**
 * 결제수단 카탈로그(글로벌) + 리전 + 리전별 매핑을 관리한다.
 * 최종 노출 = 카탈로그 isEnabled(글로벌) AND 리전 isActive AND 매핑 isEnabled.
 */
@Injectable()
export class PaymentConfigService {
  constructor(private readonly dbService: DbService<WalletSchema>) {}

  private get db() {
    return this.dbService.db;
  }

  private normalizeRegionCode(code: string): string {
    const normalized = code.trim().toLowerCase();
    if (!/^[a-z]{2}$/.test(normalized)) {
      throw new BadRequestException({
        error: 'INVALID_REGION_CODE',
        message: `Region code must be a lowercase alpha-2 code: ${code}`,
      });
    }
    return normalized;
  }

  // ─── Catalog ───────────────────────────────────────────────────────────────

  async listCatalog(): Promise<PaymentMethodCatalog[]> {
    return this.db
      .select()
      .from(paymentMethodCatalog)
      .orderBy(asc(paymentMethodCatalog.sortOrder), asc(paymentMethodCatalog.code));
  }

  async updateCatalog(code: string, dto: UpdateCatalogDto): Promise<PaymentMethodCatalog> {
    const normalizedCode = code.trim().toUpperCase();
    const patch: Partial<typeof paymentMethodCatalog.$inferInsert> = { updatedAt: new Date() };
    if (dto.isEnabled !== undefined) patch.isEnabled = dto.isEnabled;
    if (dto.displayName !== undefined) patch.displayName = dto.displayName;
    if (dto.sortOrder !== undefined) patch.sortOrder = dto.sortOrder;

    const rows = await this.db
      .update(paymentMethodCatalog)
      .set(patch)
      .where(eq(paymentMethodCatalog.code, normalizedCode))
      .returning();

    const row = rows[0];
    if (!row) {
      throw new NotFoundException({
        error: 'PAYMENT_METHOD_NOT_FOUND',
        message: `Payment method not found in catalog: ${normalizedCode}`,
      });
    }
    return row;
  }

  // ─── Region ────────────────────────────────────────────────────────────────

  async listRegions(): Promise<Region[]> {
    return this.db.select().from(regions).orderBy(asc(regions.sortOrder), asc(regions.code));
  }

  async createRegion(dto: CreateRegionDto): Promise<Region> {
    const code = this.normalizeRegionCode(dto.code);

    const existing = await this.db.select({ id: regions.id }).from(regions).where(eq(regions.code, code)).limit(1);
    if (existing[0]) {
      throw new ConflictException({ error: 'REGION_ALREADY_EXISTS', message: `Region already exists: ${code}` });
    }

    const rows = await this.db
      .insert(regions)
      .values({
        code,
        name: dto.name,
        isActive: dto.isActive ?? true,
        sortOrder: dto.sortOrder ?? 0,
      })
      .returning();

    const row = rows[0];
    if (!row) throw new Error('REGION_INSERT_FAILED');
    return row;
  }

  async updateRegion(code: string, dto: UpdateRegionDto): Promise<Region> {
    const normalizedCode = this.normalizeRegionCode(code);
    const patch: Partial<typeof regions.$inferInsert> = { updatedAt: new Date() };
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.isActive !== undefined) patch.isActive = dto.isActive;
    if (dto.sortOrder !== undefined) patch.sortOrder = dto.sortOrder;

    const rows = await this.db.update(regions).set(patch).where(eq(regions.code, normalizedCode)).returning();

    const row = rows[0];
    if (!row) {
      throw new NotFoundException({ error: 'REGION_NOT_FOUND', message: `Region not found: ${normalizedCode}` });
    }
    return row;
  }

  private async getRegionOrThrow(code: string): Promise<Region> {
    const normalizedCode = this.normalizeRegionCode(code);
    const rows = await this.db.select().from(regions).where(eq(regions.code, normalizedCode)).limit(1);
    const region = rows[0];
    if (!region) {
      throw new NotFoundException({ error: 'REGION_NOT_FOUND', message: `Region not found: ${normalizedCode}` });
    }
    return region;
  }

  // ─── Region ↔ Catalog mapping ──────────────────────────────────────────────

  /** 어드민 매트릭스: 카탈로그 전체 + 해당 리전에서의 설정 상태 (매핑 없으면 regionEnabled=false) */
  async getRegionMethods(code: string): Promise<RegionMethodMatrixResponseDto> {
    const region = await this.getRegionOrThrow(code);

    const rows = await this.db
      .select({
        code: paymentMethodCatalog.code,
        displayName: paymentMethodCatalog.displayName,
        description: paymentMethodCatalog.description,
        globalEnabled: paymentMethodCatalog.isEnabled,
        catalogSort: paymentMethodCatalog.sortOrder,
        mappingEnabled: regionPaymentMethods.isEnabled,
        mappingSort: regionPaymentMethods.sortOrder,
      })
      .from(paymentMethodCatalog)
      .leftJoin(
        regionPaymentMethods,
        and(eq(regionPaymentMethods.catalogId, paymentMethodCatalog.id), eq(regionPaymentMethods.regionId, region.id)),
      )
      .orderBy(asc(paymentMethodCatalog.sortOrder), asc(paymentMethodCatalog.code));

    const items = rows.map((r) => {
      const regionEnabled = r.mappingEnabled ?? false;
      return {
        code: r.code,
        displayName: r.displayName,
        description: r.description,
        globalEnabled: r.globalEnabled,
        regionEnabled,
        available: region.isActive && r.globalEnabled && regionEnabled,
        sortOrder: r.mappingSort ?? r.catalogSort,
      };
    });

    return {
      region: {
        id: region.id,
        code: region.code,
        name: region.name,
        isActive: region.isActive,
        sortOrder: region.sortOrder,
      },
      items,
    };
  }

  /** 리전별 결제수단 설정 일괄 저장 (upsert). 알 수 없는 code 는 거부. */
  async putRegionMethods(code: string, dto: PutRegionMethodsDto): Promise<RegionMethodMatrixResponseDto> {
    const region = await this.getRegionOrThrow(code);

    await this.db.transaction(async (tx) => {
      const catalog = await tx
        .select({ id: paymentMethodCatalog.id, code: paymentMethodCatalog.code })
        .from(paymentMethodCatalog);
      const codeToId = new Map(catalog.map((c) => [c.code, c.id]));

      for (const item of dto.items) {
        const itemCode = item.code.trim().toUpperCase();
        const catalogId = codeToId.get(itemCode);
        if (!catalogId) {
          throw new BadRequestException({
            error: 'PAYMENT_METHOD_NOT_FOUND',
            message: `Unknown payment method code: ${item.code}`,
          });
        }

        await tx
          .insert(regionPaymentMethods)
          .values({
            regionId: region.id,
            catalogId,
            isEnabled: item.isEnabled,
            sortOrder: item.sortOrder ?? 0,
          })
          .onConflictDoUpdate({
            target: [regionPaymentMethods.regionId, regionPaymentMethods.catalogId],
            set: {
              isEnabled: item.isEnabled,
              sortOrder: item.sortOrder ?? 0,
              updatedAt: new Date(),
            },
          });
      }
    });

    return this.getRegionMethods(region.code);
  }

  // ─── Public: available payment methods ───────────────────────────────────────

  /** 해당 리전에서 실제 노출 가능한 결제수단 (글로벌 on AND 리전 active AND 매핑 on) */
  async getAvailablePaymentMethods(code: string): Promise<AvailablePaymentMethodDto[]> {
    const normalizedCode = this.normalizeRegionCode(code);

    const rows = await this.db
      .select({
        code: paymentMethodCatalog.code,
        displayName: paymentMethodCatalog.displayName,
        description: paymentMethodCatalog.description,
        mappingSort: regionPaymentMethods.sortOrder,
        catalogSort: paymentMethodCatalog.sortOrder,
      })
      .from(regionPaymentMethods)
      .innerJoin(regions, eq(regions.id, regionPaymentMethods.regionId))
      .innerJoin(paymentMethodCatalog, eq(paymentMethodCatalog.id, regionPaymentMethods.catalogId))
      .where(
        and(
          eq(regions.code, normalizedCode),
          eq(regions.isActive, true),
          eq(regionPaymentMethods.isEnabled, true),
          eq(paymentMethodCatalog.isEnabled, true),
        ),
      )
      .orderBy(asc(regionPaymentMethods.sortOrder), asc(paymentMethodCatalog.sortOrder));

    return rows.map((r) => ({
      code: r.code,
      displayName: r.displayName,
      description: r.description,
      sortOrder: r.mappingSort,
    }));
  }
}

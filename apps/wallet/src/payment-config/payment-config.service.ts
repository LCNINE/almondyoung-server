import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '@app/db';
import { asc, eq } from 'drizzle-orm';
import { WalletSchema, paymentMethodCatalog, regionPaymentMethods, regions } from '../schema';
import { Region } from '../types';
import { ProviderRegistry } from '../providers/provider.registry';
import { PaymentProviderDescriptor } from '../providers/provider-descriptors';
import {
  AvailablePaymentMethodDto,
  CatalogResponseDto,
  CreateRegionDto,
  PutRegionMethodsDto,
  RegionMethodMatrixItemDto,
  RegionMethodMatrixResponseDto,
  UpdateCatalogDto,
  UpdateRegionDto,
} from './dto';

/**
 * 결제수단 지원 여부의 SoT는 ProviderRegistry descriptor다.
 * DB는 글로벌/리전별 운영 policy override만 저장한다.
 */
@Injectable()
export class PaymentConfigService {
  constructor(
    private readonly dbService: DbService<WalletSchema>,
    private readonly providerRegistry: ProviderRegistry,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  private normalizeProviderCode(code: string): string {
    return code.trim().toUpperCase();
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

  private async loadCatalogRows() {
    return this.db
      .select()
      .from(paymentMethodCatalog)
      .orderBy(asc(paymentMethodCatalog.sortOrder), asc(paymentMethodCatalog.code));
  }

  private async loadRegionMappingRows(regionId: string) {
    return this.db
      .select({
        code: paymentMethodCatalog.code,
        isEnabled: regionPaymentMethods.isEnabled,
        sortOrder: regionPaymentMethods.sortOrder,
      })
      .from(regionPaymentMethods)
      .innerJoin(paymentMethodCatalog, eq(paymentMethodCatalog.id, regionPaymentMethods.catalogId))
      .where(eq(regionPaymentMethods.regionId, regionId))
      .orderBy(asc(regionPaymentMethods.sortOrder), asc(paymentMethodCatalog.code));
  }

  private catalogRowsByCode(rows: Array<typeof paymentMethodCatalog.$inferSelect>) {
    return new Map(rows.map((row) => [this.normalizeProviderCode(row.code), row]));
  }

  private toSupportedCatalogItem(
    descriptor: PaymentProviderDescriptor,
    row?: typeof paymentMethodCatalog.$inferSelect,
  ): CatalogResponseDto {
    return {
      id: row?.id ?? descriptor.code,
      policyId: row?.id ?? null,
      code: descriptor.code,
      displayName: descriptor.displayName,
      description: descriptor.description,
      isEnabled: row?.isEnabled ?? descriptor.defaultEnabled,
      sortOrder: row?.sortOrder ?? descriptor.defaultSortOrder,
      supportStatus: 'supported',
      isRetired: false,
      kind: descriptor.kind,
      publicExposure: descriptor.publicExposure,
      capabilities: descriptor.capabilities,
    };
  }

  private toRetiredCatalogItem(row: typeof paymentMethodCatalog.$inferSelect): CatalogResponseDto {
    return {
      id: row.id,
      policyId: row.id,
      code: this.normalizeProviderCode(row.code),
      displayName: row.displayName,
      description: row.description,
      isEnabled: false,
      sortOrder: row.sortOrder,
      supportStatus: 'retired',
      isRetired: true,
      kind: null,
      publicExposure: null,
      capabilities: [],
    };
  }

  private sortCatalogItems<T extends { code: string; sortOrder: number; isRetired?: boolean }>(items: T[]): T[] {
    return items.sort((a, b) => {
      if (a.isRetired !== b.isRetired) return a.isRetired ? 1 : -1;
      return a.sortOrder - b.sortOrder || a.code.localeCompare(b.code);
    });
  }

  private mergeCatalog(rows: Array<typeof paymentMethodCatalog.$inferSelect>): CatalogResponseDto[] {
    const rowsByCode = this.catalogRowsByCode(rows);
    const supported = this.providerRegistry
      .listDescriptors()
      .map((descriptor) => this.toSupportedCatalogItem(descriptor, rowsByCode.get(descriptor.code)));

    const retired = rows
      .filter((row) => !this.providerRegistry.hasProvider(row.code))
      .map((row) => this.toRetiredCatalogItem(row));

    return this.sortCatalogItems([...supported, ...retired]);
  }

  async listCatalog(): Promise<CatalogResponseDto[]> {
    return this.mergeCatalog(await this.loadCatalogRows());
  }

  private ensureSupportedDescriptor(code: string): PaymentProviderDescriptor {
    const normalizedCode = this.normalizeProviderCode(code);
    if (!this.providerRegistry.hasProvider(normalizedCode)) {
      throw new BadRequestException({
        error: 'PROVIDER_NOT_SUPPORTED',
        message: `Payment provider not supported: ${normalizedCode}`,
      });
    }
    return this.providerRegistry.getDescriptorOrThrow(normalizedCode);
  }

  private buildPolicyInsert(
    descriptor: PaymentProviderDescriptor,
    override?: Pick<UpdateCatalogDto, 'isEnabled' | 'sortOrder'>,
  ): typeof paymentMethodCatalog.$inferInsert {
    return {
      code: descriptor.code,
      displayName: descriptor.displayName,
      description: descriptor.description,
      isEnabled: override?.isEnabled ?? descriptor.defaultEnabled,
      sortOrder: override?.sortOrder ?? descriptor.defaultSortOrder,
    };
  }

  async updateCatalog(code: string, dto: UpdateCatalogDto): Promise<CatalogResponseDto> {
    const descriptor = this.ensureSupportedDescriptor(code);
    const patch: Partial<typeof paymentMethodCatalog.$inferInsert> = {
      displayName: descriptor.displayName,
      description: descriptor.description,
      updatedAt: new Date(),
    };
    if (dto.isEnabled !== undefined) patch.isEnabled = dto.isEnabled;
    if (dto.sortOrder !== undefined) patch.sortOrder = dto.sortOrder;

    const rows = await this.db
      .insert(paymentMethodCatalog)
      .values(this.buildPolicyInsert(descriptor, dto))
      .onConflictDoUpdate({
        target: paymentMethodCatalog.code,
        set: patch,
      })
      .returning();

    const row = rows[0];
    if (!row) throw new Error('PAYMENT_METHOD_POLICY_UPSERT_FAILED');
    return this.toSupportedCatalogItem(descriptor, row);
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
    const catalogRows = await this.loadCatalogRows();
    const rowsByCode = this.catalogRowsByCode(catalogRows);
    const mappingRows = await this.loadRegionMappingRows(region.id);
    const mappingsByCode = new Map(mappingRows.map((row) => [this.normalizeProviderCode(row.code), row]));

    const supportedItems: RegionMethodMatrixItemDto[] = this.providerRegistry.listDescriptors().map((descriptor) => {
      const catalogRow = rowsByCode.get(descriptor.code);
      const mapping = mappingsByCode.get(descriptor.code);
      const globalEnabled = catalogRow?.isEnabled ?? descriptor.defaultEnabled;
      const regionEnabled = mapping?.isEnabled ?? false;
      return {
        code: descriptor.code,
        displayName: descriptor.displayName,
        description: descriptor.description,
        globalEnabled,
        regionEnabled,
        available: region.isActive && globalEnabled && regionEnabled,
        sortOrder: mapping?.sortOrder ?? catalogRow?.sortOrder ?? descriptor.defaultSortOrder,
        supportStatus: 'supported',
        isRetired: false,
        kind: descriptor.kind,
        publicExposure: descriptor.publicExposure,
        capabilities: descriptor.capabilities,
      };
    });

    const retiredItems: RegionMethodMatrixItemDto[] = catalogRows
      .filter((row) => !this.providerRegistry.hasProvider(row.code))
      .map((row) => {
        const normalizedCode = this.normalizeProviderCode(row.code);
        const mapping = mappingsByCode.get(normalizedCode);
        return {
          code: normalizedCode,
          displayName: row.displayName,
          description: row.description,
          globalEnabled: false,
          regionEnabled: mapping?.isEnabled ?? false,
          available: false,
          sortOrder: mapping?.sortOrder ?? row.sortOrder,
          supportStatus: 'retired',
          isRetired: true,
          kind: null,
          publicExposure: null,
          capabilities: [],
        };
      });

    const items = this.sortCatalogItems([...supportedItems, ...retiredItems]);

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
      for (const item of dto.items) {
        const descriptor = this.ensureSupportedDescriptor(item.code);
        const catalogRows = await tx
          .insert(paymentMethodCatalog)
          .values(this.buildPolicyInsert(descriptor))
          .onConflictDoUpdate({
            target: paymentMethodCatalog.code,
            set: {
              displayName: descriptor.displayName,
              description: descriptor.description,
              updatedAt: new Date(),
            },
          })
          .returning({ id: paymentMethodCatalog.id });
        const catalogId = catalogRows[0]?.id;
        if (!catalogId) throw new Error('PAYMENT_METHOD_POLICY_UPSERT_FAILED');

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
    const region = await this.getRegionOrThrow(code);
    if (!region.isActive) return [];

    const catalogRows = await this.loadCatalogRows();
    const rowsByCode = this.catalogRowsByCode(catalogRows);
    const mappingRows = await this.loadRegionMappingRows(region.id);
    const mappingsByCode = new Map(mappingRows.map((row) => [this.normalizeProviderCode(row.code), row]));

    return this.providerRegistry
      .listDescriptors()
      .filter((descriptor) => descriptor.publicExposure === 'checkout')
      .map((descriptor) => {
        const catalogRow = rowsByCode.get(descriptor.code);
        const mapping = mappingsByCode.get(descriptor.code);
        return {
          descriptor,
          globalEnabled: catalogRow?.isEnabled ?? descriptor.defaultEnabled,
          regionEnabled: mapping?.isEnabled ?? false,
          sortOrder: mapping?.sortOrder ?? catalogRow?.sortOrder ?? descriptor.defaultSortOrder,
        };
      })
      .filter((item) => item.globalEnabled && item.regionEnabled)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.descriptor.code.localeCompare(b.descriptor.code))
      .map((item) => ({
        code: item.descriptor.code,
        displayName: item.descriptor.displayName,
        description: item.descriptor.description,
        sortOrder: item.sortOrder,
      }));
  }
}

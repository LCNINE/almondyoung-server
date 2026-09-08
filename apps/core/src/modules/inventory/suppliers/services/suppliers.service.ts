import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectTypedDb, DbService } from '@app/db';
import { ConflictError } from '@app/shared';
import { wmsTables, wmsSchema, DbTx, Supplier } from '../../schema/inventory.schema';
import { eq, and, or, like, inArray, sql, SQL } from 'drizzle-orm';
import {
  CreateSupplierDto,
  UpdateSupplierDto,
  SupplierFiltersDto,
  SupplierResponseDto,
  SupplierListResponseDto,
  SupplierFilterOptionsResponseDto,
  SupplierContactDto,
  SupplierAddressDto,
  SupplierBusinessInfoDto,
  SupplierPurchaseSettingsDto,
  SupplierPaymentInfoDto,
  SupplierCategoryInfoDto,
} from '../dto';

@Injectable()
export class SuppliersService {
  private readonly logger = new Logger(SuppliersService.name);

  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
  ) {}

  async createSupplier(dto: CreateSupplierDto, tx?: DbTx): Promise<SupplierResponseDto> {
    return this.dbService.run(async (trx) => {
      const { suppliers, supplierCategoryMappings } = wmsTables;

      const [supplier] = await trx
        .insert(suppliers)
        .values({
          name: dto.name,
          phone: dto.phone || null,
          fax: dto.fax || null,
          email: dto.email || null,
          zipcode: dto.zipcode || null,
          address1: dto.address1 || null,
          address2: dto.address2 || null,
          businessRegNo: dto.businessRegNo || null,
          businessType: dto.businessType || null,
          ceoName: dto.ceoName || null,
          isDirectDelivery: dto.isDirectDelivery ?? false,
          orderCutoffTime: dto.orderCutoffTime || null,
          bankName: dto.bankName || null,
          bankAccountNo: dto.bankAccountNo || null,
          bankAccountHolder: dto.bankAccountHolder || null,
          paymentMethod: dto.paymentMethod || null,
          description: dto.description || null,
          memo: dto.memo || null,
          purchaseManagerId: dto.purchaseManagerId || null,
          defaultWarehouseId: dto.defaultWarehouseId || null,
        })
        .returning();

      if (dto.categoryIds && dto.categoryIds.length > 0) {
        await trx.insert(supplierCategoryMappings).values(
          dto.categoryIds.map((categoryId) => ({
            supplierId: supplier.id,
            categoryId,
          })),
        );
      }

      this.logger.log(`Created supplier ${supplier.id} with name "${supplier.name}"`);

      return this.getSupplierById(supplier.id, trx);
    }, tx);
  }

  async updateSupplier(id: string, dto: UpdateSupplierDto, tx?: DbTx): Promise<SupplierResponseDto> {
    return this.dbService.run(async (trx) => {
      const { suppliers, supplierCategoryMappings } = wmsTables;

      const [existing] = await trx.select().from(suppliers).where(eq(suppliers.id, id)).limit(1);

      if (!existing) {
        throw new NotFoundException(`Supplier with ID ${id} not found`);
      }

      await trx
        .update(suppliers)
        .set({
          name: dto.name ?? existing.name,
          phone: dto.phone !== undefined ? dto.phone : existing.phone,
          fax: dto.fax !== undefined ? dto.fax : existing.fax,
          email: dto.email !== undefined ? dto.email : existing.email,
          zipcode: dto.zipcode !== undefined ? dto.zipcode : existing.zipcode,
          address1: dto.address1 !== undefined ? dto.address1 : existing.address1,
          address2: dto.address2 !== undefined ? dto.address2 : existing.address2,
          businessRegNo: dto.businessRegNo !== undefined ? dto.businessRegNo : existing.businessRegNo,
          businessType: dto.businessType !== undefined ? dto.businessType : existing.businessType,
          ceoName: dto.ceoName !== undefined ? dto.ceoName : existing.ceoName,
          isDirectDelivery: dto.isDirectDelivery !== undefined ? dto.isDirectDelivery : existing.isDirectDelivery,
          orderCutoffTime: dto.orderCutoffTime !== undefined ? dto.orderCutoffTime : existing.orderCutoffTime,
          bankName: dto.bankName !== undefined ? dto.bankName : existing.bankName,
          bankAccountNo: dto.bankAccountNo !== undefined ? dto.bankAccountNo : existing.bankAccountNo,
          bankAccountHolder: dto.bankAccountHolder !== undefined ? dto.bankAccountHolder : existing.bankAccountHolder,
          paymentMethod: dto.paymentMethod !== undefined ? dto.paymentMethod : existing.paymentMethod,
          description: dto.description !== undefined ? dto.description : existing.description,
          memo: dto.memo !== undefined ? dto.memo : existing.memo,
          purchaseManagerId: dto.purchaseManagerId !== undefined ? dto.purchaseManagerId : existing.purchaseManagerId,
          defaultWarehouseId:
            dto.defaultWarehouseId !== undefined ? dto.defaultWarehouseId : existing.defaultWarehouseId,
          updatedAt: new Date(),
        })
        .where(eq(suppliers.id, id));

      if (dto.categoryIds !== undefined) {
        await trx.delete(supplierCategoryMappings).where(eq(supplierCategoryMappings.supplierId, id));

        if (dto.categoryIds.length > 0) {
          await trx.insert(supplierCategoryMappings).values(
            dto.categoryIds.map((categoryId) => ({
              supplierId: id,
              categoryId,
            })),
          );
        }
      }

      this.logger.log(`Updated supplier ${id}`);

      return this.getSupplierById(id, trx);
    }, tx);
  }

  /**
   * 하드 삭제. `replenishment_supplier_rules.supplier_id` 의 FK 는 **restrict** 다(#743 B, 스펙 §8.1
   * 「규칙 = restrict」) — 사람이 넣은 리드타임 · 커버 설정을 공급사 삭제가 조용히 같이 지우지 않게
   * 일부러 고른 것이다. 그래서 규칙 행을 지우는 대신 **세어서 409** 로 돌려준다. 세지 않으면 DELETE
   * 가 postgres 23503 으로 죽고, 그건 `ApplicationException` 이 아니라 설명 없는 500 이 된다.
   * 스펙 §9.2 1단계가 활성 공급사 전부에 규칙을 넣으라고 하므로 그 500 은 평상시가 된다.
   */
  async deleteSupplier(id: string, tx?: DbTx): Promise<void> {
    return this.dbService.run(async (trx) => {
      const { suppliers, replenishmentSupplierRules } = wmsTables;

      // 판정과 DELETE 는 한 트랜잭션이어야 한다 — 따로 읽으면 "규칙 없음" 을 본 뒤 규칙이 들어와도
      // 삭제가 진행되어 막으려던 23503 이 그대로 새어 나온다.
      const [ruleCount] = await trx
        .select({ count: sql<number>`count(*)::int` })
        .from(replenishmentSupplierRules)
        .where(eq(replenishmentSupplierRules.supplierId, id));

      if ((ruleCount?.count ?? 0) > 0) {
        throw new ConflictError('보충 규칙이 있어 삭제할 수 없습니다. 재고 보충 규칙 화면에서 먼저 삭제하세요.');
      }

      const result = await trx.delete(suppliers).where(eq(suppliers.id, id)).returning();

      if (result.length === 0) {
        throw new NotFoundException(`Supplier with ID ${id} not found`);
      }

      this.logger.log(`Deleted supplier ${id}`);
    }, tx);
  }

  async getSupplierById(id: string, tx?: DbTx): Promise<SupplierResponseDto> {
    return this.dbService.run(async (trx) => {
      const { suppliers, supplierCategoryMappings, supplierCategories } = wmsTables;

      const [supplier] = await trx.select().from(suppliers).where(eq(suppliers.id, id)).limit(1);

      if (!supplier) {
        throw new NotFoundException(`Supplier with ID ${id} not found`);
      }

      const categories = await trx
        .select({
          id: supplierCategories.id,
          name: supplierCategories.name,
          description: supplierCategories.description,
        })
        .from(supplierCategoryMappings)
        .innerJoin(supplierCategories, eq(supplierCategoryMappings.categoryId, supplierCategories.id))
        .where(eq(supplierCategoryMappings.supplierId, id));

      return this.mapToResponseDto(supplier, categories);
    }, tx);
  }

  async getSuppliers(filters: SupplierFiltersDto, tx?: DbTx): Promise<SupplierListResponseDto> {
    return this.dbService.run(async (trx) => {
      const { suppliers, supplierCategoryMappings, supplierCategories } = wmsTables;

      const conditions: SQL[] = [];

      if (filters.search) {
        const searchPattern = `%${filters.search}%`;
        conditions.push(
          or(
            like(suppliers.name, searchPattern),
            like(suppliers.phone, searchPattern),
            like(suppliers.email, searchPattern),
            like(suppliers.businessRegNo, searchPattern),
          )!,
        );
      }

      if (filters.categoryId) {
        const suppliersWithCategory = await trx
          .select({ supplierId: supplierCategoryMappings.supplierId })
          .from(supplierCategoryMappings)
          .where(eq(supplierCategoryMappings.categoryId, filters.categoryId));

        if (suppliersWithCategory.length > 0) {
          conditions.push(
            inArray(
              suppliers.id,
              suppliersWithCategory.map((s) => s.supplierId),
            ),
          );
        } else {
          return {
            data: [],
            total: 0,
            page: filters.page || 1,
            limit: filters.limit || 50,
          };
        }
      }

      if (filters.purchaseManagerId) {
        conditions.push(eq(suppliers.purchaseManagerId, filters.purchaseManagerId));
      }

      const limit = filters.limit || 50;
      const offset = filters.offset !== undefined ? filters.offset : filters.page ? (filters.page - 1) * limit : 0;

      const [supplierList, countResult] = await Promise.all([
        trx
          .select()
          .from(suppliers)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(suppliers.name)
          .limit(limit)
          .offset(offset),
        trx
          .select({ count: sql<number>`count(*)::int` })
          .from(suppliers)
          .where(conditions.length > 0 ? and(...conditions) : undefined),
      ]);

      const total = countResult[0]?.count || 0;

      const supplierIds = supplierList.map((s) => s.id);
      let categoriesBySupplier: Record<string, { id: string; name: string; description: string | null }[]> = {};

      if (supplierIds.length > 0) {
        const allCategories = await trx
          .select({
            supplierId: supplierCategoryMappings.supplierId,
            categoryId: supplierCategories.id,
            categoryName: supplierCategories.name,
            categoryDescription: supplierCategories.description,
          })
          .from(supplierCategoryMappings)
          .innerJoin(supplierCategories, eq(supplierCategoryMappings.categoryId, supplierCategories.id))
          .where(inArray(supplierCategoryMappings.supplierId, supplierIds));

        categoriesBySupplier = allCategories.reduce(
          (acc, cat) => {
            if (!acc[cat.supplierId]) {
              acc[cat.supplierId] = [];
            }
            acc[cat.supplierId].push({
              id: cat.categoryId,
              name: cat.categoryName,
              description: cat.categoryDescription,
            });
            return acc;
          },
          {} as Record<string, { id: string; name: string; description: string | null }[]>,
        );
      }

      const data = supplierList.map((supplier) =>
        this.mapToResponseDto(supplier, categoriesBySupplier[supplier.id] || []),
      );

      return {
        data,
        total,
        page: filters.page || 1,
        limit,
      };
    }, tx);
  }

  async getFilterOptions(tx?: DbTx): Promise<SupplierFilterOptionsResponseDto> {
    return this.dbService.run(async (trx) => {
      const { supplierCategories } = wmsTables;

      const categories = await trx.select().from(supplierCategories).orderBy(supplierCategories.name);

      return {
        categories: categories.map((cat) => ({
          value: cat.id,
          label: cat.name,
        })),
        managers: [],
        searchTypes: [
          { value: 'name', label: '공급처명' },
          { value: 'phone', label: '전화번호' },
          { value: 'email', label: '이메일' },
          { value: 'businessRegNo', label: '사업자등록번호' },
        ],
      };
    }, tx);
  }

  private mapToResponseDto(
    supplier: Supplier,
    categories: { id: string; name: string; description: string | null }[],
  ): SupplierResponseDto {
    return SupplierResponseDto.fromDbRow(supplier, categories);
  }
}

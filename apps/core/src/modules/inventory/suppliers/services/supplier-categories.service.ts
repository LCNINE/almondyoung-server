import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx, SupplierCategory } from '../../schema/inventory.schema';
import { eq } from 'drizzle-orm';
import { CreateSupplierCategoryDto, UpdateSupplierCategoryDto, SupplierCategoryResponseDto } from '../dto';

@Injectable()
export class SupplierCategoriesService {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
  ) {}

  async createCategory(dto: CreateSupplierCategoryDto, tx?: DbTx): Promise<SupplierCategoryResponseDto> {
    return this.dbService.run(async (trx) => {
      const { supplierCategories } = wmsTables;

      const [category] = await trx
        .insert(supplierCategories)
        .values({
          name: dto.name,
          description: dto.description || null,
        })
        .returning();

      return this.mapToResponseDto(category);
    }, tx);
  }

  async updateCategory(id: string, dto: UpdateSupplierCategoryDto, tx?: DbTx): Promise<SupplierCategoryResponseDto> {
    return this.dbService.run(async (trx) => {
      const { supplierCategories } = wmsTables;

      const [existing] = await trx.select().from(supplierCategories).where(eq(supplierCategories.id, id)).limit(1);

      if (!existing) {
        throw new NotFoundException(`Supplier category with ID ${id} not found`);
      }

      const [updated] = await trx
        .update(supplierCategories)
        .set({
          name: dto.name ?? existing.name,
          description: dto.description !== undefined ? dto.description : existing.description,
          updatedAt: new Date(),
        })
        .where(eq(supplierCategories.id, id))
        .returning();

      return this.mapToResponseDto(updated);
    }, tx);
  }

  async deleteCategory(id: string, tx?: DbTx): Promise<void> {
    return this.dbService.run(async (trx) => {
      const { supplierCategories } = wmsTables;

      const result = await trx.delete(supplierCategories).where(eq(supplierCategories.id, id)).returning();

      if (result.length === 0) {
        throw new NotFoundException(`Supplier category with ID ${id} not found`);
      }
    }, tx);
  }

  async getCategoryById(id: string, tx?: DbTx): Promise<SupplierCategoryResponseDto> {
    return this.dbService.run(async (trx) => {
      const { supplierCategories } = wmsTables;

      const [category] = await trx.select().from(supplierCategories).where(eq(supplierCategories.id, id)).limit(1);

      if (!category) {
        throw new NotFoundException(`Supplier category with ID ${id} not found`);
      }

      return this.mapToResponseDto(category);
    }, tx);
  }

  async getCategories(tx?: DbTx): Promise<SupplierCategoryResponseDto[]> {
    return this.dbService.run(async (trx) => {
      const { supplierCategories } = wmsTables;

      const categories = await trx.select().from(supplierCategories).orderBy(supplierCategories.name);

      return categories.map((cat) => this.mapToResponseDto(cat));
    }, tx);
  }

  private mapToResponseDto(category: SupplierCategory): SupplierCategoryResponseDto {
    return {
      id: category.id,
      name: category.name,
      description: category.description,
      createdAt: category.createdAt.toISOString(),
      updatedAt: category.updatedAt.toISOString(),
    };
  }
}

import { Injectable, Logger, BadRequestException, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectTypedDb, DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { HOLDER_CONSTANTS } from '../constants/holder.constants';
import { eq, and, like, count, asc, SQL } from 'drizzle-orm';
import { HolderQueryDto } from '../dto/holder/holder-query.dto';
import { CreateHolderDto } from '../dto/holder/holder-create.dto';
import { UpdateHolderDto } from '../dto/holder/holder-update.dto';
import { HolderDto, HolderListResponseDto } from '../dto/holder/holder-response.dto';

@Injectable()
export class HolderService implements OnModuleInit {
  private readonly logger = new Logger(HolderService.name);

  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  private get db() {
    return this.dbService.db;
  }

  async onModuleInit() {
    await this.ensureDefaultsExist();
  }

  private async ensureDefaultsExist(): Promise<void> {
    try {
      const defaultHolder = HOLDER_CONSTANTS.DEFAULT_HOLDER;

      const [existing] = await this.db
        .select()
        .from(wmsTables.holders)
        .where(eq(wmsTables.holders.id, defaultHolder.id))
        .limit(1);

      if (!existing) {
        await this.db.insert(wmsTables.holders).values({
          id: defaultHolder.id,
          name: defaultHolder.name,
          isOurAsset: defaultHolder.isOurAsset,
        });
        this.logger.log(`기본 Holder 생성: ${defaultHolder.name}`);
      }
    } catch (error) {
      this.logger.error('기본 Holder 생성 중 오류 발생:', error);
    }
  }

  async listHolders(query: HolderQueryDto, tx?: DbTx): Promise<HolderListResponseDto> {
    return this.dbService.run(async (trx) => {
      const { holders } = wmsTables;
      const { page = 1, limit = 20, search, isOurAsset } = query;
      const offset = (page - 1) * limit;

      const conditions: SQL[] = [];

      if (search) {
        conditions.push(like(holders.name, `%${search}%`));
      }

      if (isOurAsset !== undefined) {
        conditions.push(eq(holders.isOurAsset, isOurAsset));
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const items = await trx
        .select()
        .from(holders)
        .where(whereClause)
        .orderBy(asc(holders.name))
        .limit(limit)
        .offset(offset);

      const [{ total }] = await trx.select({ total: count() }).from(holders).where(whereClause);

      return {
        data: items.map((item) => ({
          id: item.id,
          name: item.name,
          isOurAsset: item.isOurAsset,
          createdAt: item.createdAt.toISOString(),
          updatedAt: item.updatedAt.toISOString(),
        })),
        total,
        page,
        limit,
      };
    }, tx);
  }

  async getHolderById(id: string, tx?: DbTx): Promise<HolderDto> {
    return this.dbService.run(async (trx) => {
      const { holders } = wmsTables;

      const [holder] = await trx.select().from(holders).where(eq(holders.id, id)).limit(1);

      if (!holder) {
        throw new NotFoundException(`Holder with id ${id} not found`);
      }

      return {
        id: holder.id,
        name: holder.name,
        isOurAsset: holder.isOurAsset,
        createdAt: holder.createdAt.toISOString(),
        updatedAt: holder.updatedAt.toISOString(),
      };
    }, tx);
  }

  async createHolder(dto: CreateHolderDto, tx?: DbTx): Promise<HolderDto> {
    return this.dbService.run(async (trx) => {
      const { holders } = wmsTables;

      const [existing] = await trx.select().from(holders).where(eq(holders.name, dto.name)).limit(1);

      if (existing) {
        throw new BadRequestException(`Holder with name "${dto.name}" already exists`);
      }

      const [created] = await trx
        .insert(holders)
        .values({
          name: dto.name,
          isOurAsset: dto.isOurAsset,
        })
        .returning();

      this.logger.log(`Created holder: ${created.name} (id: ${created.id}, isOurAsset: ${created.isOurAsset})`);

      return {
        id: created.id,
        name: created.name,
        isOurAsset: created.isOurAsset,
        createdAt: created.createdAt.toISOString(),
        updatedAt: created.updatedAt.toISOString(),
      };
    }, tx);
  }

  async updateHolder(id: string, dto: UpdateHolderDto, tx?: DbTx): Promise<HolderDto> {
    return this.dbService.run(async (trx) => {
      const { holders } = wmsTables;

      const [existing] = await trx.select().from(holders).where(eq(holders.id, id)).limit(1);

      if (!existing) {
        throw new NotFoundException(`Holder with id ${id} not found`);
      }

      if (dto.name && dto.name !== existing.name) {
        const [nameConflict] = await trx.select().from(holders).where(eq(holders.name, dto.name)).limit(1);

        if (nameConflict) {
          throw new BadRequestException(`Holder with name "${dto.name}" already exists`);
        }
      }

      const [updated] = await trx
        .update(holders)
        .set({
          ...dto,
          updatedAt: new Date(),
        })
        .where(eq(holders.id, id))
        .returning();

      this.logger.log(`Updated holder: ${updated.name} (id: ${updated.id})`);

      return {
        id: updated.id,
        name: updated.name,
        isOurAsset: updated.isOurAsset,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      };
    }, tx);
  }

  async deleteHolder(id: string, tx?: DbTx): Promise<{ success: boolean }> {
    return this.dbService.run(async (trx) => {
      const { holders, skus, fulfillmentOrders } = wmsTables;

      const [existing] = await trx.select().from(holders).where(eq(holders.id, id)).limit(1);

      if (!existing) {
        throw new NotFoundException(`Holder with id ${id} not found`);
      }

      const [skuCount] = await trx.select({ count: count() }).from(skus).where(eq(skus.holderId, id));

      if (skuCount.count > 0) {
        throw new BadRequestException(
          `Cannot delete holder "${existing.name}" because ${skuCount.count} SKU(s) are associated with it`,
        );
      }

      const [fulfillmentCount] = await trx
        .select({ count: count() })
        .from(fulfillmentOrders)
        .where(eq(fulfillmentOrders.ownerId, id));

      if (fulfillmentCount.count > 0) {
        throw new BadRequestException(
          `Cannot delete holder "${existing.name}" because ${fulfillmentCount.count} fulfillment order(s) are associated with it`,
        );
      }

      await trx.delete(holders).where(eq(holders.id, id));

      this.logger.log(`Deleted holder: ${existing.name} (id: ${id})`);

      return { success: true };
    }, tx);
  }
}

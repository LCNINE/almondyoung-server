import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { BadRequestError, ConflictError, NotFoundError } from '@app/shared';
import { InjectTypedDb, DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { CreateDeliveryProfileDto } from '../dto/create-delivery-profile.dto';
import { UpdateDeliveryProfileDto } from '../dto/update-delivery-profile.dto';
import type { DeliveryProfileDto } from '../dto/delivery-profile.dto';
import { DeliveryProfileMapper } from '../mappers/delivery-profile.mapper';

@Injectable()
export class DeliveryProfileManager {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  async create(dto: CreateDeliveryProfileDto, tx?: DbTx): Promise<DeliveryProfileDto> {
    return this.dbService.run(async (trx) => {
      await this.assertHolderExists(trx, dto.holderId);
      const columns = DeliveryProfileMapper.toColumns(dto);
      const [row] = await trx
        .insert(wmsTables.deliveryProfiles)
        .values({ ...columns, name: dto.name.trim(), sourceType: dto.sourceType })
        .returning();
      if (!row) throw new Error('delivery_profiles insert returned no row');
      return DeliveryProfileMapper.toDto(row);
    }, tx);
  }

  async update(id: string, dto: UpdateDeliveryProfileDto, tx?: DbTx): Promise<DeliveryProfileDto> {
    return this.dbService.run(async (trx) => {
      await this.assertHolderExists(trx, dto.holderId);
      const columns = DeliveryProfileMapper.toColumns(dto);
      const [row] = await trx
        .update(wmsTables.deliveryProfiles)
        .set({ ...columns, updatedAt: sql`now()` })
        .where(eq(wmsTables.deliveryProfiles.id, id))
        .returning();
      if (!row) throw new NotFoundError(`배송 프로필을 찾을 수 없습니다: ${id}`);
      return DeliveryProfileMapper.toDto(row);
    }, tx);
  }

  /** 쓰는 SKU 나 출고 상자가 있으면 지우지 않는다. 상자는 FK 가 restrict 라 그대로 두면 500 이 난다. */
  async remove(id: string, tx?: DbTx): Promise<void> {
    return this.dbService.run(async (trx) => {
      const { skus, shipments, deliveryProfiles } = wmsTables;
      const [skuUse] = await trx
        .select({ n: sql<number>`count(*)::int` })
        .from(skus)
        .where(and(eq(skus.deliveryProfileId, id), eq(skus.isDeleted, false)));
      if ((skuUse?.n ?? 0) > 0) {
        throw new ConflictError(`SKU ${skuUse?.n}개가 이 배송 프로필을 쓰고 있어 지울 수 없습니다`);
      }

      const [boxUse] = await trx
        .select({ n: sql<number>`count(*)::int` })
        .from(shipments)
        .where(eq(shipments.shippingProfileId, id));
      if ((boxUse?.n ?? 0) > 0) {
        throw new ConflictError('이 배송 프로필로 나간 출고 상자가 있어 지울 수 없습니다');
      }

      // 삭제된 SKU 는 FK 가 set null 로 풀어 준다
      const deleted = await trx
        .delete(deliveryProfiles)
        .where(eq(deliveryProfiles.id, id))
        .returning({ id: deliveryProfiles.id });
      if (deleted.length === 0) throw new NotFoundError(`배송 프로필을 찾을 수 없습니다: ${id}`);
    }, tx);
  }

  private async assertHolderExists(trx: DbTx, holderId: string | null | undefined): Promise<void> {
    if (!holderId) return;

    const [holder] = await trx
      .select({ id: wmsTables.holders.id })
      .from(wmsTables.holders)
      .where(eq(wmsTables.holders.id, holderId))
      .limit(1);
    if (!holder) throw new BadRequestError(`화주를 찾을 수 없습니다: ${holderId}`);
  }
}

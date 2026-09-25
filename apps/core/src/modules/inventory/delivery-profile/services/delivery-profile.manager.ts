import { Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { NotFoundError } from '@app/shared';
import { InjectTypedDb, DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { CreateDeliveryProfileDto } from '../dto/create-delivery-profile.dto';
import { UpdateDeliveryProfileDto } from '../dto/update-delivery-profile.dto';
import type { DeliveryProfileDto } from '../dto/delivery-profile.dto';
import { DeliveryProfileMapper } from '../mappers/delivery-profile.mapper';
import { DeliveryProfileReader } from './delivery-profile.reader';

@Injectable()
export class DeliveryProfileManager {
  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly reader: DeliveryProfileReader,
  ) {}

  async create(dto: CreateDeliveryProfileDto, tx?: DbTx): Promise<DeliveryProfileDto> {
    return this.dbService.run(async (trx) => {
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
}

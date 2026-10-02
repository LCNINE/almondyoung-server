import { Injectable } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { NotFoundError } from '@app/shared';
import { InjectTypedDb, DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import type { DeliveryProfileDto } from '../dto/delivery-profile.dto';
import { DeliveryProfileMapper } from '../mappers/delivery-profile.mapper';

@Injectable()
export class DeliveryProfileReader {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  async findAll(tx?: DbTx): Promise<DeliveryProfileDto[]> {
    const p = wmsTables.deliveryProfiles;
    const s = wmsTables.skus;
    const rows = await this.dbService.run(
      (trx) =>
        trx
          .select({ profile: p, skuCount: sql<number>`count(${s.id})::int` })
          .from(p)
          .leftJoin(s, and(eq(s.deliveryProfileId, p.id), eq(s.isDeleted, false)))
          .groupBy(p.id)
          .orderBy(asc(p.name)),
      tx,
    );
    return rows.map((r) => DeliveryProfileMapper.toDto(r.profile, r.skuCount));
  }

  async findOne(id: string, tx?: DbTx): Promise<DeliveryProfileDto> {
    const [row] = await this.dbService.run(
      (trx) => trx.select().from(wmsTables.deliveryProfiles).where(eq(wmsTables.deliveryProfiles.id, id)).limit(1),
      tx,
    );
    if (!row) throw new NotFoundError(`배송 프로필을 찾을 수 없습니다: ${id}`);
    return DeliveryProfileMapper.toDto(row);
  }
}

import { Injectable } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { and, count, eq, ne } from 'drizzle-orm';
import {
  pimSchema,
  productMasterQuantityDiscounts,
  productQuantityDiscounts,
} from '../../schema/catalog.schema';
import { DbTransaction, QuantityDiscountTier } from '../../catalog.types';

export interface QuantityDiscountReadModel {
  id: string;
  enabled: boolean;
  startsOn: string | null;
  endsOn: string | null;
  tiers: QuantityDiscountTier[];
}

export interface QuantityDiscountMapping {
  mappingId: string;
  quantityDiscountId: string;
}

@Injectable()
export class QuantityDiscountReader {
  constructor(
    @InjectTypedDb<typeof pimSchema>()
    private readonly dbService: DbService<typeof pimSchema>,
  ) {}

  async findForVersion(masterId: string, versionId: string, tx?: DbTransaction): Promise<QuantityDiscountReadModel | null> {
    return this.dbService.run(async (trx) => {
      const [row] = await trx
        .select({
          id: productQuantityDiscounts.id,
          enabled: productQuantityDiscounts.enabled,
          startsOn: productQuantityDiscounts.startsOn,
          endsOn: productQuantityDiscounts.endsOn,
          tiers: productQuantityDiscounts.tiers,
        })
        .from(productMasterQuantityDiscounts)
        .innerJoin(productQuantityDiscounts, eq(productMasterQuantityDiscounts.quantityDiscountId, productQuantityDiscounts.id))
        .where(
          and(eq(productMasterQuantityDiscounts.masterId, masterId), eq(productMasterQuantityDiscounts.versionId, versionId)),
        )
        .limit(1);
      return row ?? null;
    }, tx);
  }

  async findMapping(masterId: string, versionId: string, tx: DbTransaction): Promise<QuantityDiscountMapping | null> {
    const [row] = await tx
      .select({
        mappingId: productMasterQuantityDiscounts.id,
        quantityDiscountId: productMasterQuantityDiscounts.quantityDiscountId,
      })
      .from(productMasterQuantityDiscounts)
      .where(
        and(eq(productMasterQuantityDiscounts.masterId, masterId), eq(productMasterQuantityDiscounts.versionId, versionId)),
      )
      .limit(1);
    return row ?? null;
  }

  async isSharedWithOtherVersion(quantityDiscountId: string, versionId: string, tx: DbTransaction): Promise<boolean> {
    const [{ value }] = await tx
      .select({ value: count() })
      .from(productMasterQuantityDiscounts)
      .where(
        and(
          eq(productMasterQuantityDiscounts.quantityDiscountId, quantityDiscountId),
          ne(productMasterQuantityDiscounts.versionId, versionId),
        ),
      );
    return Number(value) > 0;
  }
}

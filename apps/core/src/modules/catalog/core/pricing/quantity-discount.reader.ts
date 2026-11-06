import { Injectable } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { and, count, eq, inArray, ne } from 'drizzle-orm';
import {
  pimSchema,
  productMasterQuantityDiscounts,
  productOptionValueDisplays,
  productQuantityDiscounts,
} from '../../schema/catalog.schema';
import { DbTransaction, QuantityDiscountOverride, QuantityDiscountTier } from '../../catalog.types';

/** 위반 문장에 붙일 옵션 이름의 언어. 관리자·일괄 양식이 쓰는 표시명과 같다. */
const OPTION_NAME_LOCALE = 'ko-KR';

export interface QuantityDiscountReadModel {
  id: string;
  enabled: boolean;
  startsOn: string | null;
  endsOn: string | null;
  tiers: QuantityDiscountTier[];
  variantOverrides: QuantityDiscountOverride[];
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
          variantOverrides: productQuantityDiscounts.variantOverrides,
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

  /** 조합 키 → 그 버전의 옵션값 표시명을 « / »로 이은 이름(예: «빨강 / L»). 이름을 못 찾은 조합은 결과에 없다. */
  async optionNames(
    masterId: string,
    versionId: string,
    combinations: string[],
    tx: DbTransaction,
  ): Promise<Map<string, string>> {
    const ids = [...new Set(combinations.flatMap((c) => c.split('+')).filter((id) => id !== ''))];
    if (ids.length === 0) return new Map();
    const rows = await tx
      .select({ optionValueId: productOptionValueDisplays.optionValueId, displayName: productOptionValueDisplays.displayName })
      .from(productOptionValueDisplays)
      .where(
        and(
          eq(productOptionValueDisplays.masterId, masterId),
          eq(productOptionValueDisplays.versionId, versionId),
          eq(productOptionValueDisplays.locale, OPTION_NAME_LOCALE),
          inArray(productOptionValueDisplays.optionValueId, ids),
        ),
      );
    const nameById = new Map(rows.map((r) => [r.optionValueId, r.displayName]));
    const out = new Map<string, string>();
    for (const combination of combinations) {
      const names = combination.split('+').map((id) => nameById.get(id));
      if (names.every((n): n is string => n !== undefined)) out.set(combination, names.join(' / '));
    }
    return out;
  }
}

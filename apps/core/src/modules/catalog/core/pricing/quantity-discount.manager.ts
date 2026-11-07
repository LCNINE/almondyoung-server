import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { BadRequestError, NotFoundError } from '@app/shared';
import { eq } from 'drizzle-orm';
import {
  pimSchema,
  productMasterQuantityDiscounts,
  productMasterVersions,
  productQuantityDiscounts,
} from '../../schema/catalog.schema';
import { DbTransaction, QuantityDiscountOverride, QuantityDiscountTier } from '../../catalog.types';
import { deleteEntitiesIfUnmapped } from '../version-isolation/delete-if-unmapped';
import { lockProductMasters } from '../products/services/product-master-lock';
import { PricingCalculatorService } from './pricing-calculator.service';
import { QuantityDiscountReader, QuantityDiscountReadModel } from './quantity-discount.reader';
import {
  isEmptyQuantityDiscount,
  QuantityDiscountTable,
  QuantityDiscountViolation,
  quantityDiscountErrorMessage,
  sortTiers,
  validateQuantityDiscount,
} from './quantity-discount.math';

export interface QuantityDiscountInput {
  enabled: boolean;
  startsOn: string | null;
  endsOn: string | null;
  tiers: QuantityDiscountTier[];
  /** 옵션별 예외. 버전에 없는 조합은 저장할 때 빠진다. */
  variantOverrides: QuantityDiscountOverride[];
}

@Injectable()
export class QuantityDiscountManager {
  constructor(
    @InjectTypedDb<typeof pimSchema>()
    private readonly dbService: DbService<typeof pimSchema>,
    private readonly reader: QuantityDiscountReader,
    private readonly calculator: PricingCalculatorService,
  ) {}

  async upsertForDraft(
    masterId: string,
    versionId: string,
    input: QuantityDiscountInput,
    tx?: DbTransaction,
  ): Promise<QuantityDiscountReadModel | null> {
    return this.dbService.run(async (trx) => {
      // 발행과 같은 잠금을 먼저 잡고 상태를 읽는다 — 아니면 draft 확인과 저장 사이에 발행이 끼어 active 버전의 표가 바뀐다.
      await lockProductMasters(trx, [masterId]);
      await this.assertDraftVersion(masterId, versionId, trx);

      const basis = await this.calculator.calculatePriceBasis(versionId, trx);
      const live = new Set(basis.map((b) => b.combination));
      const table = {
        ...input,
        variantOverrides: input.variantOverrides.filter((o) => live.has(o.combination)),
      };

      if (isEmptyQuantityDiscount(table)) {
        await this.deleteForVersion(masterId, versionId, trx);
        await this.touchVersion(versionId, trx);
        return null;
      }

      await this.throwIfInvalid(masterId, versionId, validateQuantityDiscount(table, basis), table, trx);

      const values = {
        enabled: table.enabled,
        startsOn: table.startsOn,
        endsOn: table.endsOn,
        tiers: sortTiers(table.tiers),
        variantOverrides: table.variantOverrides.map((o) => ({ combination: o.combination, tiers: sortTiers(o.tiers) })),
        updatedAt: new Date(),
      };
      const mapping = await this.reader.findMapping(masterId, versionId, trx);

      if (mapping && !(await this.reader.isSharedWithOtherVersion(mapping.quantityDiscountId, versionId, trx))) {
        await trx
          .update(productQuantityDiscounts)
          .set(values)
          .where(eq(productQuantityDiscounts.id, mapping.quantityDiscountId));
      } else {
        const [created] = await trx
          .insert(productQuantityDiscounts)
          .values(values)
          .returning({ id: productQuantityDiscounts.id });

        if (mapping) {
          await trx
            .update(productMasterQuantityDiscounts)
            .set({ quantityDiscountId: created.id })
            .where(eq(productMasterQuantityDiscounts.id, mapping.mappingId));
        } else {
          await trx.insert(productMasterQuantityDiscounts).values({ masterId, versionId, quantityDiscountId: created.id });
        }
      }

      await this.touchVersion(versionId, trx);
      return this.reader.findForVersion(masterId, versionId, trx);
    }, tx);
  }

  async deleteForVersion(masterId: string, versionId: string, tx?: DbTransaction): Promise<void> {
    await this.dbService.run(async (trx) => {
      const mapping = await this.reader.findMapping(masterId, versionId, trx);
      if (!mapping) return;

      await trx.delete(productMasterQuantityDiscounts).where(eq(productMasterQuantityDiscounts.id, mapping.mappingId));
      await this.deleteIfOrphan([mapping.quantityDiscountId], trx);
    }, tx);
  }

  async copyMapping(masterId: string, fromVersionId: string, toVersionId: string, tx: DbTransaction): Promise<void> {
    const mapping = await this.reader.findMapping(masterId, fromVersionId, tx);
    if (!mapping) return;

    await tx
      .insert(productMasterQuantityDiscounts)
      .values({ masterId, versionId: toVersionId, quantityDiscountId: mapping.quantityDiscountId });
  }

  /** 정가·멤버십가 규칙이 바뀐 뒤, 이미 저장된 구간표가 여전히 «회원가 ≤ 일반가» 인지 다시 본다. */
  async assertCompatibleWithPrices(masterId: string, versionId: string, tx?: DbTransaction): Promise<void> {
    await this.dbService.run(async (trx) => {
      const saved = await this.reader.findForVersion(masterId, versionId, trx);
      if (!saved) return;

      const basis = await this.calculator.calculatePriceBasis(versionId, trx);
      await this.throwIfInvalid(masterId, versionId, validateQuantityDiscount(saved, basis), saved, trx);
    }, tx);
  }

  /** 상품·버전을 지울 때 매핑이 사라진 구간표 행을 정리한다. */
  async deleteIfOrphan(quantityDiscountIds: string[], tx: DbTransaction): Promise<void> {
    await deleteEntitiesIfUnmapped(
      tx,
      {
        entityTable: productQuantityDiscounts,
        entityIdColumn: productQuantityDiscounts.id,
        junctionTable: productMasterQuantityDiscounts,
        junctionFkColumn: productMasterQuantityDiscounts.quantityDiscountId,
      },
      quantityDiscountIds,
    );
  }

  /** 위반이 옵션 예외에서 났으면 그 버전의 옵션 이름을 붙인다(위반이 있을 때만 조회). */
  private async throwIfInvalid(
    masterId: string,
    versionId: string,
    violations: QuantityDiscountViolation[],
    table: QuantityDiscountTable,
    tx: DbTransaction,
  ): Promise<void> {
    if (violations.length === 0) return;
    const combinations = violations.flatMap((v) => (v.combination === undefined ? [] : [v.combination]));
    const names = await this.reader.optionNames(masterId, versionId, combinations, tx);
    const message = quantityDiscountErrorMessage(violations, table, (c) => names.get(c) ?? '옵션 예외');
    throw new BadRequestException({ message, errors: violations });
  }

  private async assertDraftVersion(masterId: string, versionId: string, tx: DbTransaction): Promise<void> {
    const [version] = await tx
      .select({ masterId: productMasterVersions.masterId, status: productMasterVersions.status })
      .from(productMasterVersions)
      .where(eq(productMasterVersions.id, versionId))
      .limit(1);

    if (!version || version.masterId !== masterId) {
      throw new NotFoundError(`Version ${versionId} of master ${masterId} not found`);
    }
    if (version.status !== 'draft') {
      throw new BadRequestError('Quantity discounts can only be modified on draft versions');
    }
  }

  private async touchVersion(versionId: string, tx: DbTransaction): Promise<void> {
    await tx.update(productMasterVersions).set({ updatedAt: new Date() }).where(eq(productMasterVersions.id, versionId));
  }
}

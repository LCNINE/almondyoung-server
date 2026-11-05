import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { BadRequestError, NotFoundError } from '@app/shared';
import { and, eq, inArray } from 'drizzle-orm';
import {
  pimSchema,
  pricingRules,
  productMasterPricingRules,
  productMasterQuantityDiscounts,
  productMasterVersions,
  productQuantityDiscounts,
} from '../../schema/catalog.schema';
import { DbTransaction, QuantityDiscountTier } from '../../catalog.types';
import { deleteEntitiesIfUnmapped } from '../version-isolation/delete-if-unmapped';
import { lockProductMasters } from '../products/services/product-master-lock';
import { PricingCalculatorService } from './pricing-calculator.service';
import { QuantityDiscountReader, QuantityDiscountReadModel } from './quantity-discount.reader';
import { QuantityDiscountViolation, sortTiers, validateQuantityDiscount } from './quantity-discount.math';

export interface QuantityDiscountInput {
  enabled: boolean;
  startsOn: string | null;
  endsOn: string | null;
  tiers: QuantityDiscountTier[];
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

      if (input.tiers.length === 0) {
        await this.deleteForVersion(masterId, versionId, trx);
        await this.touchVersion(versionId, trx);
        return null;
      }

      const basis = await this.calculator.calculatePriceBasis(versionId, trx);
      this.throwIfInvalid(validateQuantityDiscount(input, basis));

      const values = {
        enabled: input.enabled,
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        tiers: sortTiers(input.tiers),
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

      await this.removeTieredRules(versionId, trx);
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
      this.throwIfInvalid(validateQuantityDiscount(saved, basis));
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

  /** 표가 생기면 계산기는 이 버전의 수량별 규칙(tiered_price)을 더 보지 않으므로 함께 지운다. */
  private async removeTieredRules(versionId: string, tx: DbTransaction): Promise<void> {
    const tiered = await tx
      .select({ mappingId: productMasterPricingRules.id, ruleId: productMasterPricingRules.pricingRuleId })
      .from(productMasterPricingRules)
      .innerJoin(pricingRules, eq(pricingRules.id, productMasterPricingRules.pricingRuleId))
      .where(and(eq(productMasterPricingRules.versionId, versionId), eq(pricingRules.layer, 'tiered_price')));
    if (tiered.length === 0) return;

    await tx.delete(productMasterPricingRules).where(
      inArray(
        productMasterPricingRules.id,
        tiered.map((t) => t.mappingId),
      ),
    );
    await deleteEntitiesIfUnmapped(
      tx,
      {
        entityTable: pricingRules,
        entityIdColumn: pricingRules.id,
        junctionTable: productMasterPricingRules,
        junctionFkColumn: productMasterPricingRules.pricingRuleId,
      },
      tiered.map((t) => t.ruleId),
    );
  }

  private throwIfInvalid(violations: QuantityDiscountViolation[]): void {
    if (violations.length === 0) return;
    throw new BadRequestException({ message: 'Invalid quantity discount table', errors: violations });
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

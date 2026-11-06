import { Injectable } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { and, asc, desc, eq, inArray, isNull, max } from 'drizzle-orm';
import {
  pimSchema,
  productBundleOffers,
  productMasterPurchaseConstraints,
  productMasters,
  productMasterVersions,
  productPurchaseConstraints,
} from '../../schema/catalog.schema';
import { DbTransaction } from '../../catalog.types';
import { PricingCalculatorService } from './pricing-calculator.service';
import type { ProductBundleOfferSnapshot } from '@packages/event-contracts/streams/product.stream';
import { AddonFacts, AddonNotSellableReason, BundleOfferInput } from './bundle-offer.math';

export interface BundleOfferReadModel extends BundleOfferInput {
  sort: number;
  /** 구성품의 활성 버전 이름. 판매 중이 아니면 마지막 버전 이름 */
  addonName: string;
}

export function toBundleOfferSnapshots(offers: BundleOfferReadModel[]): ProductBundleOfferSnapshot[] {
  return offers.map((o) => ({
    addonMasterId: o.addonMasterId,
    sort: o.sort,
    allowedVariantIds: o.allowedVariantIds,
    regularRateBp: o.regularRateBp,
    membershipRateBp: o.membershipRateBp,
    enabled: o.enabled,
    startsOn: o.startsOn,
    endsOn: o.endsOn,
    label: o.label,
  }));
}

@Injectable()
export class BundleOfferReader {
  constructor(
    @InjectTypedDb<typeof pimSchema>()
    private readonly dbService: DbService<typeof pimSchema>,
    private readonly calculator: PricingCalculatorService,
  ) {}

  async findForMaster(masterId: string, tx?: DbTransaction): Promise<BundleOfferReadModel[]> {
    return this.dbService.run(async (trx) => {
      const rows = await trx
        .select()
        .from(productBundleOffers)
        .where(eq(productBundleOffers.masterId, masterId))
        .orderBy(asc(productBundleOffers.sort));
      const names = await this.latestNames(
        rows.map((r) => r.addonMasterId),
        trx,
      );
      return rows.map((r) => ({
        addonMasterId: r.addonMasterId,
        addonName: names.get(r.addonMasterId) ?? '',
        sort: r.sort,
        allowedVariantIds: r.allowedVariantIds ?? null,
        regularRateBp: r.regularRateBp,
        membershipRateBp: r.membershipRateBp,
        enabled: r.enabled,
        startsOn: r.startsOn ?? null,
        endsOn: r.endsOn ?? null,
        label: r.label ?? null,
      }));
    }, tx);
  }

  /** 구성품 목록을 마지막으로 바꾼 시각(그때 나간 이벤트의 changedAt). 구성품이 없으면 null */
  async revisionFor(masterId: string, tx?: DbTransaction): Promise<Date | null> {
    return this.dbService.run(async (trx) => {
      const [row] = await trx
        .select({ at: max(productBundleOffers.updatedAt) })
        .from(productBundleOffers)
        .where(eq(productBundleOffers.masterId, masterId));
      return row?.at ?? null;
    }, tx);
  }

  /** 검증에 필요한 구성품 사실. 지워졌거나 없는 마스터는 결과에 없다. */
  async addonFacts(addonMasterIds: string[], trx: DbTransaction): Promise<Map<string, AddonFacts>> {
    const facts = new Map<string, AddonFacts>();
    if (addonMasterIds.length === 0) return facts;

    const versions = await trx
      .select({
        masterId: productMasterVersions.masterId,
        versionId: productMasterVersions.id,
        status: productMasterVersions.status,
        name: productMasterVersions.name,
        isVisibleToMembersOnly: productMasterVersions.isVisibleToMembersOnly,
        fulfillmentKind: productMasterVersions.fulfillmentKind,
      })
      .from(productMasterVersions)
      .innerJoin(productMasters, eq(productMasters.id, productMasterVersions.masterId))
      .where(and(inArray(productMasterVersions.masterId, addonMasterIds), isNull(productMasters.deletedAt)))
      .orderBy(desc(productMasterVersions.version));

    for (const masterId of new Set(versions.map((v) => v.masterId))) {
      const own = versions.filter((v) => v.masterId === masterId);
      const active = own.find((v) => v.status === 'active');
      if (!active) {
        facts.set(masterId, { masterId, name: own[0].name, notSellableReason: 'inactive', variants: [] });
        continue;
      }
      facts.set(masterId, {
        masterId,
        name: active.name,
        notSellableReason: await this.notSellableReason(active, trx),
        variants: await this.calculator.calculatePriceBasis(active.versionId, trx),
      });
    }
    return facts;
  }

  private async notSellableReason(
    version: { versionId: string; isVisibleToMembersOnly: boolean; fulfillmentKind: string | null },
    trx: DbTransaction,
  ): Promise<AddonNotSellableReason | null> {
    if (version.fulfillmentKind === 'digital') return 'digital';
    if (version.isVisibleToMembersOnly) return 'members_only';
    const [constraint] = await trx
      .select({
        requiresMembership: productPurchaseConstraints.requiresMembership,
        lifetimeQuantityLimit: productPurchaseConstraints.lifetimeQuantityLimit,
      })
      .from(productMasterPurchaseConstraints)
      .innerJoin(productPurchaseConstraints, eq(productPurchaseConstraints.id, productMasterPurchaseConstraints.purchaseConstraintId))
      .where(eq(productMasterPurchaseConstraints.versionId, version.versionId))
      .limit(1);
    if (constraint && (constraint.requiresMembership || constraint.lifetimeQuantityLimit !== null)) return 'purchase_constraint';
    return null;
  }

  private async latestNames(masterIds: string[], trx: DbTransaction): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    if (masterIds.length === 0) return names;
    const rows = await trx
      .select({ masterId: productMasterVersions.masterId, name: productMasterVersions.name, status: productMasterVersions.status })
      .from(productMasterVersions)
      .where(inArray(productMasterVersions.masterId, masterIds))
      .orderBy(desc(productMasterVersions.version));
    for (const r of rows) {
      const current = names.get(r.masterId);
      if (r.status === 'active' || current === undefined) names.set(r.masterId, r.name);
    }
    return names;
  }
}

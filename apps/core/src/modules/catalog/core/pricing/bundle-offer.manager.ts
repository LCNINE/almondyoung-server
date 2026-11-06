import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { InjectPublisher, type PublisherFor } from '@app/events';
import { NotFoundError } from '@app/shared';
import { and, eq, isNull, or } from 'drizzle-orm';
import { PRODUCT_STREAM } from '@packages/event-contracts/streams/product.stream';
import { pimSchema, productBundleOffers, productMasters } from '../../schema/catalog.schema';
import { DbTransaction } from '../../catalog.types';
import { lockProductMasters } from '../products/services/product-master-lock';
import { BundleOfferReader, BundleOfferReadModel, toBundleOfferSnapshots } from './bundle-offer.reader';
import { BundleOfferInput, bundleOfferErrorMessage, validateBundleOffers } from './bundle-offer.math';

@Injectable()
export class BundleOfferManager {
  constructor(
    @InjectTypedDb<typeof pimSchema>()
    private readonly dbService: DbService<typeof pimSchema>,
    private readonly reader: BundleOfferReader,
    @InjectPublisher(PRODUCT_STREAM)
    private readonly productPublisher: PublisherFor<typeof PRODUCT_STREAM>,
  ) {}

  /** 상품의 구성품 전체를 바꾼다. 빈 목록은 모두 해제. 쇼핑몰 반영 이벤트는 같은 트랜잭션의 outbox 로 나간다. */
  async replaceForMaster(masterId: string, offers: BundleOfferInput[], tx?: DbTransaction): Promise<BundleOfferReadModel[]> {
    return this.dbService.run(async (trx) => {
      await lockProductMasters(trx, [masterId]);
      await this.assertMasterExists(masterId, trx);

      const normalized = offers.map((o) => ({
        ...o,
        allowedVariantIds: o.allowedVariantIds && o.allowedVariantIds.length > 0 ? [...new Set(o.allowedVariantIds)] : null,
        label: o.label?.trim() ? o.label.trim() : null,
      }));
      const facts = await this.reader.addonFacts(
        normalized.map((o) => o.addonMasterId),
        trx,
      );
      const violations = validateBundleOffers(masterId, normalized, facts);
      if (violations.length > 0) {
        throw new BadRequestException({ message: bundleOfferErrorMessage(violations, normalized, facts), errors: violations });
      }

      // 행의 updated_at = 이벤트 changedAt. 발행 스냅샷도 이 값을 리비전으로 싣는다.
      const changedAt = new Date();
      await trx.delete(productBundleOffers).where(eq(productBundleOffers.masterId, masterId));
      if (normalized.length > 0) {
        await trx.insert(productBundleOffers).values(normalized.map((o, sort) => ({ masterId, sort, ...o, updatedAt: changedAt })));
      }

      const saved = await this.reader.findForMaster(masterId, trx);
      await this.enqueueChanged(masterId, saved, changedAt, trx);
      return saved;
    }, tx);
  }

  /**
   * 상품을 지울 때 부른다(삭제는 soft delete 라 FK cascade 가 돌지 않는다).
   * 그 상품을 구성품으로 둔 상품마다 줄을 빼고 바뀐 목록을 알린다. 그 상품 자신의 구성품 행도 지운다.
   * 그 상품의 행을 바꾸기 «전»에 부른다 — 자기 자신과 부모를 한 번에 정렬해 잠가야, 서로를 구성품으로 둔 두 상품을
   * 동시에 지울 때 잠금 순서가 엇갈리지 않는다.
   */
  async detachMaster(masterId: string, tx: DbTransaction): Promise<void> {
    const parents = await tx
      .selectDistinct({ masterId: productBundleOffers.masterId })
      .from(productBundleOffers)
      .where(eq(productBundleOffers.addonMasterId, masterId));
    const parentIds = parents.map((p) => p.masterId).filter((id) => id !== masterId).sort();
    // 구성품 저장(replaceForMaster)과 같은 순서 — 상품 잠금 먼저, 행 변경은 그 뒤
    await lockProductMasters(tx, [masterId, ...parentIds]);
    const changedAt = new Date();
    await tx
      .delete(productBundleOffers)
      .where(or(eq(productBundleOffers.addonMasterId, masterId), eq(productBundleOffers.masterId, masterId)));

    for (const parentId of parentIds) {
      const remaining = await this.reader.findForMaster(parentId, tx);
      await this.resequence(parentId, remaining, changedAt, tx);
      await this.enqueueChanged(parentId, await this.reader.findForMaster(parentId, tx), changedAt, tx);
    }
  }

  private async resequence(masterId: string, offers: BundleOfferReadModel[], changedAt: Date, tx: DbTransaction): Promise<void> {
    for (const [sort, o] of offers.entries()) {
      await tx
        .update(productBundleOffers)
        .set({ sort, updatedAt: changedAt })
        .where(and(eq(productBundleOffers.masterId, masterId), eq(productBundleOffers.addonMasterId, o.addonMasterId)));
    }
  }

  private async enqueueChanged(masterId: string, offers: BundleOfferReadModel[], changedAt: Date, tx: DbTransaction): Promise<void> {
    await this.productPublisher.enqueue(
      {
        eventType: 'ProductBundleOffersChanged',
        aggregateId: masterId,
        payload: { masterId, offers: toBundleOfferSnapshots(offers), changedAt: changedAt.toISOString() },
      },
      tx,
    );
  }

  private async assertMasterExists(masterId: string, trx: DbTransaction): Promise<void> {
    const [row] = await trx
      .select({ id: productMasters.id })
      .from(productMasters)
      .where(and(eq(productMasters.id, masterId), isNull(productMasters.deletedAt)))
      .limit(1);
    if (!row) throw new NotFoundError(`Product master not found: ${masterId}`);
  }
}

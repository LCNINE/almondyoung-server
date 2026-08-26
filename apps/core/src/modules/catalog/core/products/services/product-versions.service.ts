import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { NotFoundError, ConflictError } from '@app/shared';
import { InjectPublisher, PublisherFor } from '@app/events';
import { PRODUCT_STREAM } from '@packages/event-contracts';
import type { ProductPublishOrigin } from '@packages/event-contracts/streams/product.stream';
import { PricingValidatorService } from '../../pricing/pricing-validator.service';
import { VariantPriceCacheService } from '../../pricing/variant-price-cache.service';
import { ProductReadAssembler } from '../assemblers/product-read.assembler';
import { ProjectionSnapshotAssembler } from '../assemblers/projection-snapshot.assembler';
import { VariantAssetLinkService } from '../../../../library/services/variant-asset-link.service';
import {
  ProductMasterVersion,
  DbTransaction,
  VersionTreeNode,
  VersionDiffDto,
  VersionStatus,
  ProductDetailDto,
} from '../../../catalog.types';
import {
  type PimSchema,
  productMasters,
  productMasterCategories,
  productMasterVersions,
  productMasterOptionGroups,
  channelVariantListings,
  salesChannels,
  productMasterVariants,
  productMasterPricingRules,
  productOptionGroupDisplays,
  productOptionValueDisplays,
  productVariants,
  variantOptionValues,
  pricingRules,
  productMasterPurchaseConstraints,
  productPurchaseConstraints,
  productTagValues,
  tagValues,
  productImages,
} from '../../../schema/catalog.schema';
import {
  productMatchings,
  productVariantSkuLinks,
  salesVariantPolicies,
} from '../../../../inventory/schema/inventory.schema';
import { productVariantDigitalAssetLinks } from '../../../../library/schema/library.schema';
import { ProductSellableQuantityService } from '../../../../inventory/product-sellable-quantity/services/product-sellable-quantity.service';
import { ProductPurchaseConstraintsService } from './product-purchase-constraints.service';
import { eq, and, sql, max as drizzleMax, isNull, inArray, asc, desc, count } from 'drizzle-orm';
import { isExternalMarketplaceSite } from '../../channels/marketplace-site';
import {
  comboKey,
  planChannelListingReconciliation,
  type VariantOptionCombo,
} from './channel-listing-reconciliation';
import { keywordMatch } from '../../../common/keyword-match';
import { v7 as uuidv7 } from 'uuid';
import { deleteEntitiesIfUnmapped } from '../../version-isolation/delete-if-unmapped';

/**
 * publish 를 유발한 작업의 성격. 임포트 워커와 단건 UI 가 같은 `publishVersion` 을
 * 부르므로 출처는 호출부가 넘겨야 한다 — 넘기지 않으면 payload 에 키가 생기지 않는다.
 */
export interface PublishVersionOptions {
  origin?: ProductPublishOrigin;
  importSessionId?: string;
}

@Injectable()
export class ProductVersionsService {
  private readonly logger = new Logger(ProductVersionsService.name);

  constructor(
    @InjectDb() private readonly db: DbService<PimSchema>,
    @InjectPublisher(PRODUCT_STREAM)
    private readonly productPublisher: PublisherFor<typeof PRODUCT_STREAM>,
    private readonly pricingValidator: PricingValidatorService,
    private readonly productReadAssembler: ProductReadAssembler,
    private readonly projectionSnapshotAssembler: ProjectionSnapshotAssembler,
    private readonly priceCacheService: VariantPriceCacheService,
    private readonly variantAssetLinkService: VariantAssetLinkService,
    private readonly productSellableQuantity: ProductSellableQuantityService,
    private readonly purchaseConstraints: ProductPurchaseConstraintsService,
  ) {}

  async getVersionTree(masterId: string, tx?: DbTransaction): Promise<VersionTreeNode[]> {
    return this.db.run(async (tx) => {
      const versions = await tx
        .select()
        .from(productMasterVersions)
        .where(eq(productMasterVersions.masterId, masterId))
        .orderBy(productMasterVersions.version);

      if (versions.length === 0) {
        throw new NotFoundException(`No versions found for master ${masterId}`);
      }

      const versionMap = new Map<string, VersionTreeNode>();
      const rootNodes: VersionTreeNode[] = [];

      for (const version of versions) {
        const node: VersionTreeNode = {
          id: version.id,
          masterId: version.masterId,
          version: version.version,
          status: version.status as VersionStatus,
          name: version.name,
          parentVersionId: version.parentVersionId,
          children: [],
          createdAt: version.createdAt,
          updatedAt: version.updatedAt,
          draftOwnerId: version.draftOwnerId,
        };
        versionMap.set(version.id, node);
      }

      for (const node of versionMap.values()) {
        if (node.parentVersionId) {
          const parent = versionMap.get(node.parentVersionId);
          if (parent) {
            parent.children.push(node);
          } else {
            rootNodes.push(node);
          }
        } else {
          rootNodes.push(node);
        }
      }

      return rootNodes;
    }, tx);
  }

  async getActiveVersion(masterId: string, tx?: DbTransaction): Promise<ProductMasterVersion> {
    return this.db.run(async (tx) => {
      const result = await tx
        .select()
        .from(productMasterVersions)
        .innerJoin(productMasters, eq(productMasterVersions.masterId, productMasters.id))
        .where(
          and(
            eq(productMasterVersions.masterId, masterId),
            eq(productMasterVersions.status, 'active'),
            isNull(productMasters.deletedAt),
          ),
        )
        .limit(1);

      if (result.length === 0) {
        throw new NotFoundException(`No active version found for master ${masterId}`);
      }

      return result[0].product_master_versions;
    }, tx);
  }

  async getVersionById(versionId: string, tx?: DbTransaction): Promise<ProductMasterVersion> {
    return this.db.run(async (tx) => {
      const [version] = await tx
        .select()
        .from(productMasterVersions)
        .where(eq(productMasterVersions.id, versionId))
        .limit(1);

      if (!version) {
        throw new NotFoundException(`Version ${versionId} not found`);
      }

      return version;
    }, tx);
  }

  async getVersionDetail(versionId: string, tx?: DbTransaction): Promise<ProductDetailDto> {
    return this.productReadAssembler.getVersionDetail(versionId, undefined, tx);
  }

  async createInitialDraftVersion(masterId: string, userId: string, tx?: DbTransaction): Promise<ProductMasterVersion> {
    return this.db.run(async (tx) => {
      const [master] = await tx
        .select({ id: productMasters.id })
        .from(productMasters)
        .where(eq(productMasters.id, masterId));

      if (!master) {
        throw new NotFoundException(`Master ${masterId} not found`);
      }

      const maxVersionResult = await tx
        .select({ max: drizzleMax(productMasterVersions.version) })
        .from(productMasterVersions)
        .where(eq(productMasterVersions.masterId, masterId));

      const nextVersion = (maxVersionResult[0]?.max || 0) + 1;

      const [newVersion] = await tx
        .insert(productMasterVersions)
        .values({
          id: uuidv7(),
          masterId,
          version: nextVersion,
          parentVersionId: null,
          status: 'draft',
          draftOwnerId: userId,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      this.logger.log(`Created initial draft version ${newVersion.id} for master ${masterId}`);

      return newVersion;
    }, tx);
  }

  async createDraftVersion(
    parentVersionId: string,
    userId: string,
    copyMappings: boolean = true,
    tx?: DbTransaction,
  ): Promise<ProductMasterVersion> {
    return this.db.run(async (tx) => {
      const parent = await this.getVersionById(parentVersionId, tx);

      const maxVersionResult = await tx
        .select({ max: drizzleMax(productMasterVersions.version) })
        .from(productMasterVersions)
        .where(eq(productMasterVersions.masterId, parent.masterId));

      const nextVersion = (maxVersionResult[0]?.max || 0) + 1;

      const {
        id,
        masterId,
        version,
        parentVersionId: _,
        status,
        draftOwnerId,
        createdAt,
        updatedAt,
        ...parentData
      } = parent;

      const [newVersion] = await tx
        .insert(productMasterVersions)
        .values({
          ...parentData,
          id: uuidv7(),
          masterId: parent.masterId,
          version: nextVersion,
          parentVersionId: parentVersionId,
          status: 'draft',
          draftOwnerId: userId,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      if (copyMappings) {
        await this._copyMappings(tx, parent.masterId, parent.id, newVersion.id);
      }

      this.logger.log(`Created draft version ${newVersion.id} for master ${parent.masterId} from version ${parent.id}`);

      return newVersion;
    }, tx);
  }

  /**
   * Draft 버전을 Active로 Publish
   * 기존 Active 버전이 있으면 자동으로 Inactive로 전환됨
   *
   * 부수 효과:
   * - 새 active 의 variant 중 matching 없는 것을 이전 active 의 같은 옵션 조합 variant 로부터 인계 (docs/adr/0004)
   * - 새 active variant 들끼리의 variantCode 충돌 검증 (DB 강제 없음 — 런타임 검증)
   * - 다른 master 의 active 버전과 productCode 충돌 검증 (DB partial unique index와 이중 방어)
   */
  async publishVersion(versionId: string, tx?: DbTransaction, options?: PublishVersionOptions): Promise<void> {
    return this.db.run(async (tx) => {
      const version = await this.getVersionById(versionId, tx);

      // 일괄 세션이 소유한 draft 는 세션이 일괄로 발행한다 — 여기서 한 건씩 나가면 세션의
      // 진행 상태와 실제 카탈로그가 갈린다(스펙 §3.3). 세션 취소가 이 값을 NULL 로 되돌린다.
      if (version.bulkSessionId) {
        throw new ConflictError('일괄 등록 세션이 관리하는 상품입니다. 세션 화면에서 일괄 발행해 주세요.');
      }

      if (version.status !== 'draft' && version.status !== 'inactive') {
        throw new BadRequestException('Only draft or inactive versions can be published');
      }
      const changeReason = version.status === 'inactive' ? 'rollback' : 'published';

      let previousActiveVersion: ProductMasterVersion | null = null;

      // 기존 active 버전 조회
      try {
        previousActiveVersion = await this.getActiveVersion(version.masterId, tx);
      } catch (e) {
        this.logger.debug(`No previous active version for ${version.masterId}`);
      }

      // 품번코드가 비어 있으면 발번한다 — 검증보다 먼저 채워야 중복 검사가 새 코드까지 본다.
      if (!version.productCode) {
        version.productCode = await this.issueProductCode(tx);
        await tx
          .update(productMasterVersions)
          .set({ productCode: version.productCode })
          .where(eq(productMasterVersions.id, versionId));
        this.logger.log(`Issued productCode ${version.productCode} for version ${versionId}`);
      }

      // 새 active 가 될 버전의 variantCode 충돌 검증
      await this._validateVariantCodeUniqueness(versionId, tx);
      await this.validateProductCodeUniqueness(version, tx);

      // 가격 검증 및 캐시 생성은 active 상태 변경 전에 완료되어야 한다.
      await this.pricingValidator.validateCalculatedPrices(versionId, tx);
      await this.priceCacheService.cachePricesForVersion(versionId, tx);

      // 기존 active를 inactive로
      await tx
        .update(productMasterVersions)
        .set({ status: 'inactive' })
        .where(and(eq(productMasterVersions.masterId, version.masterId), eq(productMasterVersions.status, 'active')));

      // draft를 active로 publish
      await tx
        .update(productMasterVersions)
        .set({ status: 'active', draftOwnerId: null, updatedAt: new Date() })
        .where(eq(productMasterVersions.id, versionId));

      // 새 active 의 매칭되지 않은 variant 에 대해 이전 active 의 같은 옵션 조합 variant 로부터
      // matching+links 를 인계 (inventory 모듈 직접 접근 — docs/adr/0004 참조)
      await this._reconcileMatchingsAfterPublish(version.id, previousActiveVersion?.id ?? null, tx);

      // Library 의 variant↔asset 매칭도 같은 패턴으로 인계 (옵션 조합 일치 시)
      await this._reconcileAssetLinksAfterPublish(version.id, previousActiveVersion?.id ?? null, tx);

      // 채널 리스팅은 옛 variant 를 *가리키는* 쪽이라 방향만 반대다 — twin 으로 재지정한다.
      // 가용재고 재계산은 부르지 않는다: ProductSellableQuantityService 는 활성 버전과 매칭만
      // 보고 channel_variant_listings 를 읽지 않으므로 리스팅 변경은 투영에 영향이 없다.
      // (createListing 등이 recalc 를 부르는 건 방어적 관습이지 이 투영의 요구가 아니다.)
      await this._reconcileChannelListingsAfterPublish(
        version.masterId,
        version.id,
        version.fulfillmentKind === 'digital',
        tx,
      );

      // 디지털 publish 가드 — reconcile 로 인계된 링크까지 반영하도록 그 뒤에 검증(throw 시 tx 롤백).
      await this._validateDigitalAssetLinks(version, tx);

      // 이벤트 발행: 추가/삭제된 variant
      await this._publishVariantChangeEvents(version, previousActiveVersion, tx);

      await this._emitActiveVersionChangedEvent(version, previousActiveVersion, changeReason, tx, options);

      const variantIdsToRecalculate = [
        ...(await this.getVersionVariants(version.masterId, version.id, tx)),
        ...(previousActiveVersion
          ? await this.getVersionVariants(previousActiveVersion.masterId, previousActiveVersion.id, tx)
          : []),
      ];
      await this.productSellableQuantity.recalculateAndPublishForVariants(variantIdsToRecalculate, tx);

      this.logger.log(`Published version ${version.id} of master ${version.masterId} as active`);
    }, tx);
  }

  /**
   * 같은 active 버전에 매달린 variant 들끼리 variantCode 충돌이 없는지 publish 직전에 검증.
   * variant.status='active' 기준 partial unique 는 도메인 의미와 어긋나기 때문에 DB 강제는 없고
   * 여기서 런타임 검증. docs/adr/0004.
   */
  private async _validateVariantCodeUniqueness(versionId: string, tx: DbTransaction): Promise<void> {
    const rows = await tx
      .select({ variantCode: productVariants.variantCode })
      .from(productMasterVariants)
      .innerJoin(productVariants, eq(productMasterVariants.variantId, productVariants.id))
      .where(eq(productMasterVariants.versionId, versionId));

    const seen = new Set<string>();
    const dups = new Set<string>();
    for (const row of rows) {
      const code = row.variantCode;
      if (!code) continue;
      if (seen.has(code)) {
        dups.add(code);
      } else {
        seen.add(code);
      }
    }

    if (dups.size > 0) {
      throw new BadRequestException(`Duplicate variantCode in version ${versionId}: ${Array.from(dups).join(', ')}`);
    }
  }

  /**
   * 품번코드를 발번한다 (`AY-10001` 순번). 사람이 적어둔 값이 있으면 그대로 두고, 비어 있을 때만 채운다.
   *
   * 비워두면 어드민 목록이 masterId(UUID) 를 대신 보여줘 사람이 부를 수 없는 번호가 된다.
   * cafe24-{N} 은 이관 이력이라 신규 채번에 쓰지 않는다.
   *
   * advisory lock 으로 발번 구간을 직렬화한다 — 동시 발행 시 같은 번호가 두 번 나가는 걸 막는다.
   * 시퀀스 대신 max+1 을 쓰는 이유는 마이그레이션 없이 끝나고, 발행 동시성이 낮기 때문이다.
   */
  private async issueProductCode(tx: DbTransaction): Promise<string> {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('product_code_issue'))`);
    const rows = await tx.execute(sql`
      SELECT COALESCE(MAX(SUBSTRING(product_code FROM '^AY-([0-9]+)$')::int), 10000) + 1 AS next
      FROM product_master_versions
      WHERE product_code ~ '^AY-[0-9]+$'`);
    const next = Number((rows as unknown as Array<{ next: number }>)[0]?.next ?? 10001);
    return `AY-${next}`;
  }

  async validateProductCodeUniqueness(
    version: Pick<ProductMasterVersion, 'masterId' | 'productCode'>,
    tx: DbTransaction,
  ): Promise<void> {
    if (!version.productCode) {
      return;
    }

    const activeVersions = await tx
      .select({
        masterId: productMasterVersions.masterId,
      })
      .from(productMasterVersions)
      .where(
        and(eq(productMasterVersions.status, 'active'), eq(productMasterVersions.productCode, version.productCode)),
      );

    const conflict = activeVersions.find((activeVersion) => activeVersion.masterId !== version.masterId);
    if (conflict) {
      throw new BadRequestException(`productCode ${version.productCode} is already used by another active product`);
    }
  }

  /**
   * 새 active 버전의 variant 중 inventory.productMatchings 가 없는 것에 대해, 이전 active 의
   * 같은 옵션 조합 variant 의 matching+productVariantSkuLinks 를 clone 한다 (variantId 만 새 ID).
   * 옵션 조합이 일치하지 않으면 정체성이 달라진 신규 variant — unmatched 유지.
   *
   * Inventory 모듈 테이블을 직접 접근한다. core 가 PIM+WMS 통합 앱이라는 사실 위에서 정당화됨.
   * 자세한 결정은 docs/adr/0004.
   */
  private async _reconcileMatchingsAfterPublish(
    newVersionId: string,
    previousActiveVersionId: string | null,
    tx: DbTransaction,
  ): Promise<void> {
    if (!previousActiveVersionId) {
      this.logger.debug(`No previous active version — skipping matching reconciliation for ${newVersionId}`);
      return;
    }

    const newVariants = await this._getVersionVariantsWithOptionValues(newVersionId, tx);
    if (newVariants.length === 0) return;

    const newVariantIds = newVariants.map((v) => v.variantId);

    // 이미 matching 있는 variant 제외
    const existingMatchings = await tx
      .select({ variantId: productMatchings.variantId })
      .from(productMatchings)
      .where(inArray(productMatchings.variantId, newVariantIds));
    const matched = new Set(existingMatchings.map((m) => m.variantId));
    const unmatched = newVariants.filter((v) => !matched.has(v.variantId));

    const prevVariants = await this._getVersionVariantsWithOptionValues(previousActiveVersionId, tx);
    if (prevVariants.length === 0) {
      this.logger.debug(
        `Previous active ${previousActiveVersionId} has no variants — leaving ${unmatched.length} new variants unmatched`,
      );
      return;
    }

    const prevByComboKey = new Map<string, { variantId: string }>();
    for (const pv of prevVariants) {
      prevByComboKey.set(comboKey(pv.optionValueIds), { variantId: pv.variantId });
    }

    // 판매정책은 버전에 담기지 않지만(설계 의도), CoW 로 variantId 가 갈리면 "같은 상품의
    // 같은 품목"인데 정책이 끊긴다. 매칭 인계와 **조건이 독립**이어야 한다 — 매칭이 이미
    // 있는 품목도 정책 행은 없을 수 있으므로 위 `unmatched` 를 재사용하면 안 된다.
    const existingPolicies = await tx
      .select({ variantId: salesVariantPolicies.variantId })
      .from(salesVariantPolicies)
      .where(inArray(salesVariantPolicies.variantId, newVariantIds));
    const hasPolicy = new Set(existingPolicies.map((p) => p.variantId));

    // 인계할 twin 정책은 **한 번에** 읽는다 — 아래 `prevMatchingsByVariantId` 블록과 같은
    // 모양이다. 품목마다 select 를 돌리면 정책 행이 없는 흔한 경우에도 품목 수만큼 빈 쿼리가
    // 나가고, `publishVersion` 은 판매상품 상세의 단건 발행도 쓰는 공용 경로라 그 N+1 이
    // 모든 발행에 상시로 붙는다.
    const prevPoliciesByVariantId = new Map<string, typeof salesVariantPolicies.$inferSelect>();
    {
      const prevVariantIds = prevVariants.map((p) => p.variantId);
      if (prevVariantIds.length > 0) {
        const rows = await tx
          .select()
          .from(salesVariantPolicies)
          .where(inArray(salesVariantPolicies.variantId, prevVariantIds));
        for (const row of rows) {
          prevPoliciesByVariantId.set(row.variantId, row);
        }
      }
    }

    let inheritedPolicyCount = 0;
    for (const nv of newVariants) {
      if (hasPolicy.has(nv.variantId)) continue;
      const twin = prevByComboKey.get(comboKey(nv.optionValueIds));
      if (!twin) continue;

      const prevPolicy = prevPoliciesByVariantId.get(twin.variantId);
      if (!prevPolicy) continue;

      await tx.insert(salesVariantPolicies).values({
        variantId: nv.variantId,
        inventoryManagement: prevPolicy.inventoryManagement,
        preStockSellable: prevPolicy.preStockSellable,
        alwaysSellableZeroStock: prevPolicy.alwaysSellableZeroStock,
        availabilityOverride: prevPolicy.availabilityOverride,
        comingSoonDate: prevPolicy.comingSoonDate,
        effectiveFrom: prevPolicy.effectiveFrom,
        effectiveTo: prevPolicy.effectiveTo,
        updatedBy: prevPolicy.updatedBy,
      });
      inheritedPolicyCount++;
    }

    if (inheritedPolicyCount > 0) {
      this.logger.log(
        `Policy reconciliation: inherited ${inheritedPolicyCount} variant sales policies from version ${previousActiveVersionId} to ${newVersionId}`,
      );
    }

    const prevMatchingsByVariantId = new Map<
      string,
      {
        id: string;
        skuGroupId: string | null;
        status: typeof productMatchings.$inferSelect.status;
        priority: typeof productMatchings.$inferSelect.priority;
        strategy: typeof productMatchings.$inferSelect.strategy;
        isResolved: boolean;
        preStockSellable: boolean;
        alwaysSellableZeroStock: boolean;
      }
    >();
    {
      const prevVariantIds = prevVariants.map((p) => p.variantId);
      if (prevVariantIds.length > 0) {
        const rows = await tx
          .select({
            id: productMatchings.id,
            variantId: productMatchings.variantId,
            skuGroupId: productMatchings.skuGroupId,
            status: productMatchings.status,
            priority: productMatchings.priority,
            strategy: productMatchings.strategy,
            isResolved: productMatchings.isResolved,
            preStockSellable: productMatchings.preStockSellable,
            alwaysSellableZeroStock: productMatchings.alwaysSellableZeroStock,
          })
          .from(productMatchings)
          .where(inArray(productMatchings.variantId, prevVariantIds));
        for (const row of rows) {
          prevMatchingsByVariantId.set(row.variantId, row);
        }
      }
    }

    let inheritedCount = 0;
    for (const nv of unmatched) {
      const twin = prevByComboKey.get(comboKey(nv.optionValueIds));
      if (!twin) continue;

      const prevMatching = prevMatchingsByVariantId.get(twin.variantId);
      if (!prevMatching) continue;

      const inheritedMatchingState =
        prevMatching.status === 'ignored'
          ? {
              status: 'pending' as const,
              strategy: null,
              isResolved: false,
            }
          : {
              status: prevMatching.status,
              strategy: prevMatching.strategy,
              isResolved: prevMatching.isResolved,
            };

      const newMatchingId = uuidv7();
      await tx.insert(productMatchings).values({
        id: newMatchingId,
        variantId: nv.variantId,
        masterId: null,
        skuGroupId: prevMatching.skuGroupId,
        status: inheritedMatchingState.status,
        priority: prevMatching.priority,
        strategy: inheritedMatchingState.strategy,
        isResolved: inheritedMatchingState.isResolved,
        preStockSellable: prevMatching.preStockSellable,
        alwaysSellableZeroStock: prevMatching.alwaysSellableZeroStock,
      });

      const prevLinks = await tx
        .select({
          skuId: productVariantSkuLinks.skuId,
          quantity: productVariantSkuLinks.quantity,
        })
        .from(productVariantSkuLinks)
        .where(eq(productVariantSkuLinks.productMatchingId, prevMatching.id));

      if (prevMatching.status !== 'ignored' && prevLinks.length > 0) {
        await tx.insert(productVariantSkuLinks).values(
          prevLinks.map((l) => ({
            productMatchingId: newMatchingId,
            skuId: l.skuId,
            quantity: l.quantity,
          })),
        );
      }

      inheritedCount++;
    }

    if (inheritedCount > 0) {
      this.logger.log(
        `Matching reconciliation: inherited ${inheritedCount}/${unmatched.length} variant matchings from version ${previousActiveVersionId} to ${newVersionId}`,
      );
    }
  }

  /**
   * 디지털 상품(fulfillmentKind='digital') publish 가드: 모든 변종에 "다운로드 가능한" 자산이 있어야 한다.
   * - 변종마다 library asset link 가 1개 이상
   * - 그 자산 중 최소 1개는 currentFileVersionId 보유(실제 다운로드 파일이 존재)
   * 둘 중 하나라도 불충족이면 "구매했는데 받을 파일이 없는" 상태가 되므로 publish 를 막는다.
   */
  private async _validateDigitalAssetLinks(version: ProductMasterVersion, tx: DbTransaction): Promise<void> {
    if (version.fulfillmentKind !== 'digital') {
      return;
    }
    const variantIds = await this.getVersionVariants(version.masterId, version.id, tx);
    const missingLink: string[] = [];
    const missingFileVersion: string[] = [];
    for (const variantId of variantIds) {
      const assets = await this.variantAssetLinkService.listAssetsForVariant(variantId, tx);
      if (!assets || assets.length === 0) {
        missingLink.push(variantId);
      } else if (!assets.some((a) => a.currentFileVersionId)) {
        // 링크는 있으나 모든 자산이 파일 버전 없음 → 다운로드 불가.
        missingFileVersion.push(variantId);
      }
    }
    if (missingLink.length > 0 || missingFileVersion.length > 0) {
      const parts: string[] = [];
      if (missingLink.length > 0) {
        parts.push(`asset link 없는 변종: ${missingLink.join(', ')}`);
      }
      if (missingFileVersion.length > 0) {
        parts.push(`파일 버전이 없어 다운로드 불가한 변종: ${missingFileVersion.join(', ')}`);
      }
      throw new BadRequestException(
        `디지털 상품은 모든 변종에 다운로드 가능한 자산이 필요합니다. ${parts.join(' / ')}`,
      );
    }
  }

  /**
   * 새 active 버전의 variant 중 library.productVariantDigitalAssetLinks 가 없는 것에 대해,
   * 이전 active 의 같은 옵션 조합 variant 의 asset 매칭을 clone. SKU 매칭 인계와 대칭 패턴.
   * 자세한 결정은 docs/adr/0004 와 CONTEXT.md "라이브러리".
   */
  private async _reconcileAssetLinksAfterPublish(
    newVersionId: string,
    previousActiveVersionId: string | null,
    tx: DbTransaction,
  ): Promise<void> {
    if (!previousActiveVersionId) {
      return;
    }

    const newVariants = await this._getVersionVariantsWithOptionValues(newVersionId, tx);
    if (newVariants.length === 0) return;

    const newVariantIds = newVariants.map((v) => v.variantId);

    // 이미 asset 매칭 있는 variant 제외
    const existingLinks = await tx
      .selectDistinct({ variantId: productVariantDigitalAssetLinks.variantId })
      .from(productVariantDigitalAssetLinks)
      .where(inArray(productVariantDigitalAssetLinks.variantId, newVariantIds));
    const alreadyLinked = new Set<string>(existingLinks.map((r) => r.variantId));
    const unmatched = newVariants.filter((v) => !alreadyLinked.has(v.variantId));
    if (unmatched.length === 0) return;

    const prevVariants = await this._getVersionVariantsWithOptionValues(previousActiveVersionId, tx);
    if (prevVariants.length === 0) return;

    const prevByComboKey = new Map<string, string>();
    for (const pv of prevVariants) {
      prevByComboKey.set(comboKey(pv.optionValueIds), pv.variantId);
    }

    const plan: Array<{ newVariantId: string; previousVariantId: string }> = [];
    for (const nv of unmatched) {
      const twinVariantId = prevByComboKey.get(comboKey(nv.optionValueIds));
      if (!twinVariantId) continue;
      plan.push({ newVariantId: nv.variantId, previousVariantId: twinVariantId });
    }

    if (plan.length === 0) return;

    const inheritedCount = await this.variantAssetLinkService.inheritLinksFromTwins(plan, tx);
    if (inheritedCount > 0) {
      this.logger.log(
        `Asset link reconciliation: inherited ${inheritedCount}/${unmatched.length} variant asset matchings from version ${previousActiveVersionId} to ${newVersionId}`,
      );
    }
  }

  /**
   * publish 후 채널 리스팅을 새 버전의 twin variant 로 재지정한다 (#652, ADR-0031 결정 4).
   *
   * 앞의 두 reconciler 와 방향이 반대다. 매칭·에셋은 "새 variant 가 비었으면 옛 twin 에서
   * 상속"이지만, 리스팅은 행이 옛 variant 를 **가리키고** 있으므로 그 포인터를 옮긴다.
   * `uq_channel_variant_listing` 이 `(sales_channel_id, channel_item_id)` 에 걸린 unique 라
   * "새 행 INSERT + 옛 행 비활성" 은 제약 위반이다 — 기존 행 UPDATE 만 가능하다.
   *
   * 축이 "이전 활성 버전" 이 아니라 **이 master 의 모든 버전** 인 것도 앞의 둘과 다르다.
   * `unpublishMaster` 로 판매중지한 뒤 드래프트를 고쳐 다시 publish 하는 경로에는 이전 활성
   * 버전이 아예 없지만(CoW 는 "다른 어떤 버전과 공유" 면 발동한다) 리스팅은 그대로 낡는다.
   *
   * 꺼진 리스팅도 조회 대상이다 — 되살리지는 않지만 포인터는 옮겨 둔다. 죽은 variant 를
   * 가리킨 채 꺼져 있으면 재활성도 재등록도 막혀 삭제 말고는 복구 경로가 없다.
   */
  private async _reconcileChannelListingsAfterPublish(
    masterId: string,
    newVersionId: string,
    newVersionIsDigital: boolean,
    tx: DbTransaction,
  ): Promise<void> {
    // 리스팅 존재 확인을 맨 앞에 둔다 — 대부분의 publish 는 채널 매핑이 없어 여기서 끝난다
    // (일괄 세션은 한 트랜잭션에서 수백 건을 publish 한다).
    const candidateVariantIds = await this._getMasterVariantIds(masterId, tx);
    if (candidateVariantIds.length === 0) return;

    const listings = await tx
      .select({
        id: channelVariantListings.id,
        variantId: channelVariantListings.variantId,
        isActive: channelVariantListings.isActive,
        site: salesChannels.site,
      })
      .from(channelVariantListings)
      .innerJoin(salesChannels, eq(salesChannels.id, channelVariantListings.salesChannelId))
      .where(inArray(channelVariantListings.variantId, candidateVariantIds));
    if (listings.length === 0) return;

    const newVariants = await this._getVersionVariantsWithOptionValues(newVersionId, tx);
    // 형제 reconciler 와 같은 가드. 없으면 품목 0개짜리 버전을 publish 하는 순간
    // 그 master 의 채널 매핑이 "짝 없음" 으로 전량 꺼진다.
    if (newVariants.length === 0) return;

    const candidateVariants = await this._attachOptionValues(candidateVariantIds, tx);

    const { updates } = planChannelListingReconciliation(
      candidateVariants,
      newVariants,
      listings.map((l) => ({
        id: l.id,
        variantId: l.variantId,
        isActive: l.isActive,
        isExternalMarketplace: isExternalMarketplaceSite(l.site),
      })),
      newVersionIsDigital,
    );
    if (updates.length === 0) return;

    // 같은 (목적지, 비활성여부) 끼리 묶어 UPDATE 수를 조합 수로 줄인다.
    const grouped = new Map<string, { newVariantId: string | null; deactivate: boolean; listingIds: string[] }>();
    for (const u of updates) {
      const key = `${u.newVariantId ?? ''}|${u.deactivate}`;
      const bucket = grouped.get(key);
      if (bucket) bucket.listingIds.push(u.listingId);
      else grouped.set(key, { newVariantId: u.newVariantId, deactivate: u.deactivate, listingIds: [u.listingId] });
    }

    for (const g of grouped.values()) {
      await tx
        .update(channelVariantListings)
        .set({
          ...(g.newVariantId ? { variantId: g.newVariantId } : {}),
          ...(g.deactivate ? { isActive: false } : {}),
          updatedAt: new Date(),
        })
        .where(inArray(channelVariantListings.id, g.listingIds));
    }

    const deactivated = updates.filter((u) => u.deactivate).map((u) => u.listingId);
    const repointed = updates.filter((u) => u.newVariantId).length;
    if (deactivated.length > 0) {
      // 비활성은 사실상 비가역이다(재활성·재등록 모두 막힘) — 어느 행이었는지 남겨야 복구가 가능하다.
      this.logger.warn(
        `Channel listing reconciliation deactivated ${deactivated.length} listing(s) on master ${masterId} ` +
          `at version ${newVersionId}: ${deactivated.join(', ')}`,
      );
    }
    if (repointed > 0) {
      this.logger.log(
        `Channel listing reconciliation: repointed ${repointed} listing(s) on master ${masterId} to version ${newVersionId}`,
      );
    }
  }

  private async _getVersionVariantsWithOptionValues(
    versionId: string,
    tx: DbTransaction,
  ): Promise<VariantOptionCombo[]> {
    // DISTINCT 필수 — unique 는 (masterId, variantId, versionId) 라 같은 (variantId, versionId)
    // 가 두 masterId 로 매달릴 수 있다. 중복이 들어오면 조합 맵이 "모호" 로 오판한다.
    const rows = await tx
      .selectDistinct({ variantId: productMasterVariants.variantId })
      .from(productMasterVariants)
      .where(eq(productMasterVariants.versionId, versionId));

    return this._attachOptionValues(
      rows.map((r) => r.variantId),
      tx,
    );
  }

  /**
   * master 에 매달린 **모든 버전**의 variant id. 리스팅 승계(#652)가 쓰는 축이다 —
   * 활성 버전이 없는 master 도 있어서 버전 단위로는 옛 variant 를 못 찾는다.
   */
  private async _getMasterVariantIds(masterId: string, tx: DbTransaction): Promise<string[]> {
    const rows = await tx
      .selectDistinct({ variantId: productMasterVariants.variantId })
      .from(productMasterVariants)
      .where(eq(productMasterVariants.masterId, masterId));

    return rows.map((r) => r.variantId);
  }

  private async _attachOptionValues(variantIds: string[], tx: DbTransaction): Promise<VariantOptionCombo[]> {
    if (variantIds.length === 0) return [];

    const optionRows = await tx
      .select({
        variantId: variantOptionValues.variantId,
        optionValueId: variantOptionValues.optionValueId,
      })
      .from(variantOptionValues)
      .where(inArray(variantOptionValues.variantId, variantIds));

    const byVariant = new Map<string, string[]>();
    for (const id of variantIds) byVariant.set(id, []);
    for (const r of optionRows) {
      byVariant.get(r.variantId)?.push(r.optionValueId);
    }
    return variantIds.map((id) => ({ variantId: id, optionValueIds: byVariant.get(id) ?? [] }));
  }


  /**
   * 멤버십가 공개 제한 변경 — draft 없이 active 버전을 직접 수정하고 채널에 재싱크.
   */
  async updateMembershipPriceVisibility(
    masterId: string,
    hideMembershipPriceForNonMembers: boolean,
    tx?: DbTransaction,
  ): Promise<void> {
    return this.db.run(async (tx) => {
      const activeVersion = await this.getActiveVersion(masterId, tx);

      await tx
        .update(productMasterVersions)
        .set({
          hideMembershipPriceForNonMembers,
          isMembershipOnly: hideMembershipPriceForNonMembers,
          updatedAt: new Date(),
        })
        .where(eq(productMasterVersions.id, activeVersion.id));

      await this._emitActiveVersionChangedEvent(activeVersion, null, 'published', tx);

      this.logger.log(
        `updateMembershipPriceVisibility: master=${masterId} hideMembershipPriceForNonMembers=${hideMembershipPriceForNonMembers}`,
      );
    }, tx);
  }

  /**
   * 멤버십 회원 전용 노출 변경 — draft 없이 active 버전을 직접 수정하고 채널에 재싱크.
   */
  async updateMembersOnlyVisibility(
    masterId: string,
    isVisibleToMembersOnly: boolean,
    tx?: DbTransaction,
  ): Promise<void> {
    return this.db.run(async (tx) => {
      const activeVersion = await this.getActiveVersion(masterId, tx);

      await tx
        .update(productMasterVersions)
        .set({ isVisibleToMembersOnly, updatedAt: new Date() })
        .where(eq(productMasterVersions.id, activeVersion.id));

      await this._emitActiveVersionChangedEvent(activeVersion, null, 'published', tx);

      this.logger.log(
        `updateMembersOnlyVisibility: master=${masterId} isVisibleToMembersOnly=${isVisibleToMembersOnly}`,
      );
    }, tx);
  }

  /**
   * 멤버십 전용 구매 여부 변경 — draft 없이 active 버전을 직접 수정하고 채널에 재싱크.
   * 값이 별도 테이블이라 updateExposurePolicy 의 단일 UPDATE 에는 얹지 못한다.
   * lifetimeQuantityLimit 은 보존 — 이 토글이 구매수량 제한을 지우면 안 된다.
   */
  async updateRequiresMembership(masterId: string, requiresMembership: boolean, tx?: DbTransaction): Promise<void> {
    return this.db.run(async (tx) => {
      const activeVersion = await this.getActiveVersion(masterId, tx);
      const current = await this.purchaseConstraints.getForVersion(masterId, activeVersion.id, tx);

      await this.purchaseConstraints.upsertForVersion(
        masterId,
        activeVersion.id,
        { requiresMembership, lifetimeQuantityLimit: current?.lifetimeQuantityLimit ?? null },
        tx,
      );

      await this._emitActiveVersionChangedEvent(activeVersion, null, 'published', tx);

      this.logger.log(`updateRequiresMembership: master=${masterId} requiresMembership=${requiresMembership}`);
    }, tx);
  }

  /**
   * 해외직구 여부 변경 — draft 없이 active 버전을 직접 수정하고 채널에 재싱크.
   */
  async updateOverseas(masterId: string, isOverseas: boolean, tx?: DbTransaction): Promise<void> {
    return this.db.run(async (tx) => {
      const activeVersion = await this.getActiveVersion(masterId, tx);

      await tx
        .update(productMasterVersions)
        .set({ isOverseas, updatedAt: new Date() })
        .where(eq(productMasterVersions.id, activeVersion.id));

      const patchedVersion = { ...activeVersion, isOverseas };
      await this._emitActiveVersionChangedEvent(patchedVersion, null, 'published', tx);

      this.logger.log(`updateOverseas: master=${masterId} isOverseas=${isOverseas}`);
    }, tx);
  }

  /**
   * 운영 노출 정책(멤버십가 비공개/회원 전용 노출/해외직구/배송비 그룹)을 한 번의 UPDATE + 한 번의
   * 이벤트로 반영한다. undefined 아닌 필드만 변경. draft 없이 active 버전 직접 수정 후 채널 재싱크.
   */
  async updateExposurePolicy(
    masterId: string,
    patch: {
      hideMembershipPriceForNonMembers?: boolean;
      isVisibleToMembersOnly?: boolean;
      isOverseas?: boolean;
      shippingGroupCode?: string | null;
    },
    tx?: DbTransaction,
  ): Promise<void> {
    return this.db.run(async (tx) => {
      const activeVersion = await this.getActiveVersion(masterId, tx);

      const set: Partial<typeof productMasterVersions.$inferInsert> = { updatedAt: new Date() };
      if (patch.hideMembershipPriceForNonMembers !== undefined) {
        set.hideMembershipPriceForNonMembers = patch.hideMembershipPriceForNonMembers;
        set.isMembershipOnly = patch.hideMembershipPriceForNonMembers; // deprecated 컬럼 미러 (단건 경로와 동일)
      }
      if (patch.isVisibleToMembersOnly !== undefined) {
        set.isVisibleToMembersOnly = patch.isVisibleToMembersOnly;
      }
      if (patch.isOverseas !== undefined) {
        set.isOverseas = patch.isOverseas;
      }
      if (patch.shippingGroupCode !== undefined) {
        // 빈 문자열은 "기본 그룹" 을 뜻하는 null 로 정규화한다.
        set.shippingGroupCode = patch.shippingGroupCode?.trim() ? patch.shippingGroupCode.trim() : null;
      }

      await tx.update(productMasterVersions).set(set).where(eq(productMasterVersions.id, activeVersion.id));

      // 스냅샷은 _emit 내부에서 같은 tx로 UPDATE 이후의 DB 상태를 다시 조회해 조립하므로,
      // 갱신 전 activeVersion 객체를 그대로 넘겨도 새 값이 반영된다 (단건 경로와 동일).
      await this._emitActiveVersionChangedEvent(activeVersion, null, 'published', tx);

      this.logger.log(`updateExposurePolicy: master=${masterId} patch=${JSON.stringify(patch)}`);
    }, tx);
  }

  /**
   * Master의 Active 버전을 Inactive로 전환 (상품 비공개)
   */
  async unpublishMaster(masterId: string, tx?: DbTransaction): Promise<void> {
    return this.db.run(async (tx) => {
      const activeVersion = await this.getActiveVersion(masterId, tx);

      // active를 inactive로 전환
      await tx
        .update(productMasterVersions)
        .set({ status: 'inactive', updatedAt: new Date() })
        .where(eq(productMasterVersions.id, activeVersion.id));

      await this._emitActiveVersionChangedEvent(activeVersion, activeVersion, 'unpublished', tx);

      const variantIds = await this.getVersionVariants(activeVersion.masterId, activeVersion.id, tx);
      await this.productSellableQuantity.recalculateAndPublishForVariants(variantIds, tx);

      this.logger.log(`Unpublished master ${masterId} (version ${activeVersion.version} → inactive)`);
    }, tx);
  }

  async getDraftVersions(
    filters?: {
      page?: number;
      limit?: number;
    },
    tx?: DbTransaction,
  ): Promise<{
    data: ProductMasterVersion[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = filters?.page ?? 1;
    const limit = filters?.limit ?? 15;
    const offset = (page - 1) * limit;

    return this.db.run(async (tx) => {
      const versions = await tx
        .select()
        .from(productMasterVersions)
        .where(eq(productMasterVersions.status, 'draft'))
        .limit(limit)
        .offset(offset);
      return {
        data: versions,
        total: versions.length,
        page,
        limit,
      };
    }, tx);
  }

  async getMyDraftVersions(
    userId: string,
    filters?: {
      page?: number;
      limit?: number;
      q?: string;
      sort?: 'updatedAt' | 'createdAt';
      order?: 'asc' | 'desc';
    },
    tx?: DbTransaction,
  ): Promise<{
    data: Array<{
      masterId: string;
      versionId: string;
      name: string;
      thumbnail: string | null;
      brand: string | null;
      productType: string;
      createdAt: Date;
      updatedAt: Date;
    }>;
    total: number;
    page: number;
    limit: number;
  }> {
    const page = filters?.page ?? 1;
    const limit = filters?.limit ?? 20;
    const offset = (page - 1) * limit;

    const sortColumn =
      filters?.sort === 'createdAt' ? productMasterVersions.createdAt : productMasterVersions.updatedAt;
    const orderFn = filters?.order === 'asc' ? asc : desc;

    // and() 는 undefined 조건을 자동으로 무시한다.
    const whereClause = and(
      eq(productMasterVersions.status, 'draft'),
      eq(productMasterVersions.draftOwnerId, userId),
      // 일괄 세션 draft 는 수백 건이라 이 화면에 쏟아지면 작업자가 따로 편집하던 draft 가
      // 묻혀 화면의 용도 자체가 없어진다(스펙 §3.3). 세션 화면에서 본다.
      isNull(productMasterVersions.bulkSessionId),
      isNull(productMasterVersions.deletedAt),
      isNull(productMasters.deletedAt),
      filters?.q ? keywordMatch(filters.q, [productMasterVersions.name]) : undefined,
    );

    return this.db.run(async (tx) => {
      const rows = await tx
        .select({
          masterId: productMasterVersions.masterId,
          versionId: productMasterVersions.id,
          name: productMasterVersions.name,
          thumbnail: productImages.fileId,
          brand: productMasterVersions.brand,
          productType: productMasterVersions.productType,
          createdAt: productMasterVersions.createdAt,
          updatedAt: productMasterVersions.updatedAt,
        })
        .from(productMasterVersions)
        .innerJoin(productMasters, eq(productMasters.id, productMasterVersions.masterId))
        .leftJoin(
          productImages,
          and(eq(productImages.versionId, productMasterVersions.id), eq(productImages.isPrimary, true)),
        )
        .where(whereClause)
        .orderBy(orderFn(sortColumn))
        .limit(limit)
        .offset(offset);

      const [{ value: total }] = await tx
        .select({ value: count() })
        .from(productMasterVersions)
        .innerJoin(productMasters, eq(productMasters.id, productMasterVersions.masterId))
        .where(whereClause);

      return { data: rows, total: Number(total), page, limit };
    }, tx);
  }

  /**
   * Active version 변경 이벤트 발행
   */
  private async _emitActiveVersionChangedEvent(
    newVersion: ProductMasterVersion,
    previousActiveVersion: ProductMasterVersion | null,
    changeReason: 'published' | 'unpublished' | 'rollback',
    tx: DbTransaction,
    options?: PublishVersionOptions,
  ): Promise<void> {
    const assembly =
      changeReason === 'unpublished'
        ? null
        : await this.projectionSnapshotAssembler.assembleActiveVersionSnapshot(newVersion.masterId, newVersion.id, tx);
    const snapshot = assembly?.snapshot ?? null;
    const categoryIds = assembly?.categoryIds ?? [];
    const primaryCategoryId = assembly?.primaryCategoryId ?? null;

    await this.productPublisher.enqueue(
      {
        eventType: 'ProductMasterActiveVersionChanged',
        aggregateId: newVersion.masterId,
        payload: {
          masterId: newVersion.masterId,
          versionId: changeReason === 'unpublished' ? null : newVersion.id,
          name: changeReason === 'unpublished' ? null : (snapshot?.name ?? newVersion.name),
          previousActiveVersionId: previousActiveVersion?.id || null,
          categoryIds,
          primaryCategoryId,
          changeReason,
          changedAt: new Date().toISOString(),
          // 원가 미상(null 저장)과 키 부재(미게시)를 구분해 소비 측이 기존 값을 안 지우게 한다
          ...(changeReason === 'unpublished' ? {} : { supplyPrice: newVersion.supplyPrice ?? null }),
          snapshot,
          // 출처가 없으면 키를 만들지 않는다 — 단건 게시의 payload 를 그대로 두기 위해서다.
          ...(options?.origin ? { origin: options.origin } : {}),
          ...(options?.importSessionId ? { importSessionId: options.importSessionId } : {}),
        },
      },
      tx,
    );

    this.logger.log(
      `📦 Enqueued ProductMasterActiveVersionChanged: ${newVersion.masterId} (${changeReason}) with ${snapshot ? 'full snapshot' : 'no snapshot'}`,
    );
  }

  /**
   * publish 시 variant 변경 이벤트 발행
   */
  private async _publishVariantChangeEvents(
    newVersion: ProductMasterVersion,
    oldVersion: ProductMasterVersion | null,
    tx: DbTransaction,
  ): Promise<void> {
    const newVariantIds = await this.getVersionVariants(newVersion.masterId, newVersion.id, tx);

    const oldVariantIds = oldVersion ? await this.getVersionVariants(oldVersion.masterId, oldVersion.id, tx) : [];

    const addedVariantIds = newVariantIds.filter((id) => !oldVariantIds.includes(id));
    const deletedVariantIds = oldVariantIds.filter((id) => !newVariantIds.includes(id));

    if (deletedVariantIds.length > 0) {
      this.logger.log(
        `VARIANT_DELETED event: ${deletedVariantIds.length} variants deleted from master ${newVersion.masterId}`,
      );
    }

    if (addedVariantIds.length > 0) {
      this.logger.log(`VARIANT_ADDED event: ${addedVariantIds.length} variants added to master ${newVersion.masterId}`);
    }

    if (addedVariantIds.length === 0 && deletedVariantIds.length === 0) {
      this.logger.log(`No variant changes for master ${newVersion.masterId}`);
    }
  }

  async compareVersions(versionId1: string, versionId2: string, tx?: DbTransaction): Promise<VersionDiffDto[]> {
    return this.db.run(async (tx) => {
      const [version1, version2] = await Promise.all([
        this.getVersionById(versionId1, tx),
        this.getVersionById(versionId2, tx),
      ]);

      if (version1.masterId !== version2.masterId) {
        throw new BadRequestException('Cannot compare versions from different masters');
      }

      const diffs: VersionDiffDto[] = [];
      const fieldsToCompare = [
        'name',
        'description',
        'brand',
        'thumbnail',
        'basePrice',
        'tags',
        'images',
        'attributes',
        'seoTitle',
        'seoDescription',
        'seoKeywords',
        'descriptionHtml',
        'status',
        'isWholesaleOnly',
        'hideMembershipPriceForNonMembers',
        'isVisibleToMembersOnly',
        'isOverseas',
        'isMembershipOnly',
        'productType',
        'fulfillmentKind',
        'productCode',
        'alternativeName',
        'material',
        'salesClassification',
        'purchaseClassification',
        'shippingMethodId',
        'shippingGroupCode',
        'marketPrice',
        'supplyPrice',
        'supplierId',
        'ageRestriction',
        'minQuantity',
        'maxQuantity',
        'salesStartDate',
        'salesEndDate',
      ];

      for (const field of fieldsToCompare) {
        const val1 = (version1 as any)[field];
        const val2 = (version2 as any)[field];

        if (JSON.stringify(val1) !== JSON.stringify(val2)) {
          diffs.push({
            field,
            oldValue: val1,
            newValue: val2,
          });
        }
      }

      return diffs;
    }, tx);
  }

  async canUserModifyVersion(versionId: string, userId: string, tx?: DbTransaction): Promise<boolean> {
    return this.db.run(async (tx) => {
      const version = await this.getVersionById(versionId, tx);

      if (version.status !== 'draft') {
        return false;
      }

      if (!version.draftOwnerId) {
        return true;
      }

      return version.draftOwnerId === userId;
    }, tx);
  }

  async getVersionVariants(masterId: string, versionId: string, tx?: DbTransaction): Promise<string[]> {
    return this.db.run(async (tx) => {
      const mappings = await tx
        .select()
        .from(productMasterVariants)
        .where(and(eq(productMasterVariants.masterId, masterId), eq(productMasterVariants.versionId, versionId)));

      return mappings.map((m) => m.variantId);
    }, tx);
  }

  private async _copyMappings(
    tx: DbTransaction,
    masterId: string,
    fromVersionId: string,
    toVersionId: string,
  ): Promise<void> {
    const optionGroups = await tx
      .select()
      .from(productMasterOptionGroups)
      .where(
        and(eq(productMasterOptionGroups.masterId, masterId), eq(productMasterOptionGroups.versionId, fromVersionId)),
      );

    if (optionGroups.length > 0) {
      await tx.insert(productMasterOptionGroups).values(
        optionGroups.map((og) => ({
          id: uuidv7(),
          masterId,
          optionGroupId: og.optionGroupId,
          versionId: toVersionId,
          createdAt: new Date(),
        })),
      );

      // 1-1. 옵션 그룹 display 정보 복사
      const groupDisplays = await tx
        .select()
        .from(productOptionGroupDisplays)
        .where(
          and(
            eq(productOptionGroupDisplays.masterId, masterId),
            eq(productOptionGroupDisplays.versionId, fromVersionId),
          ),
        );

      if (groupDisplays.length > 0) {
        await tx.insert(productOptionGroupDisplays).values(
          groupDisplays.map((gd) => ({
            id: uuidv7(),
            optionGroupId: gd.optionGroupId,
            masterId,
            versionId: toVersionId,
            locale: gd.locale,
            displayName: gd.displayName,
            description: gd.description,
            sortOrder: gd.sortOrder,
            createdAt: new Date(),
          })),
        );
      }

      // 1-2. 옵션값 display 정보 복사
      const valueDisplays = await tx
        .select()
        .from(productOptionValueDisplays)
        .where(
          and(
            eq(productOptionValueDisplays.masterId, masterId),
            eq(productOptionValueDisplays.versionId, fromVersionId),
          ),
        );

      if (valueDisplays.length > 0) {
        await tx.insert(productOptionValueDisplays).values(
          valueDisplays.map((vd) => ({
            id: uuidv7(),
            optionValueId: vd.optionValueId,
            masterId,
            versionId: toVersionId,
            locale: vd.locale,
            displayName: vd.displayName,
            colorCode: vd.colorCode,
            imageUrl: vd.imageUrl,
            sortOrder: vd.sortOrder,
            createdAt: new Date(),
          })),
        );
      }
    }

    const variants = await tx
      .select()
      .from(productMasterVariants)
      .where(and(eq(productMasterVariants.masterId, masterId), eq(productMasterVariants.versionId, fromVersionId)));

    if (variants.length > 0) {
      await tx.insert(productMasterVariants).values(
        variants.map((v) => ({
          id: uuidv7(),
          masterId,
          variantId: v.variantId,
          versionId: toVersionId,
          createdAt: new Date(),
        })),
      );
    }

    const pricingRules = await tx
      .select()
      .from(productMasterPricingRules)
      .where(
        and(eq(productMasterPricingRules.masterId, masterId), eq(productMasterPricingRules.versionId, fromVersionId)),
      );

    if (pricingRules.length > 0) {
      await tx.insert(productMasterPricingRules).values(
        pricingRules.map((pr) => ({
          id: uuidv7(),
          masterId,
          pricingRuleId: pr.pricingRuleId,
          versionId: toVersionId,
        })),
      );
    }

    const purchaseConstraintMappings = await tx
      .select()
      .from(productMasterPurchaseConstraints)
      .where(
        and(
          eq(productMasterPurchaseConstraints.masterId, masterId),
          eq(productMasterPurchaseConstraints.versionId, fromVersionId),
        ),
      );

    if (purchaseConstraintMappings.length > 0) {
      await tx.insert(productMasterPurchaseConstraints).values(
        purchaseConstraintMappings.map((mapping) => ({
          id: uuidv7(),
          masterId,
          versionId: toVersionId,
          purchaseConstraintId: mapping.purchaseConstraintId,
          createdAt: new Date(),
        })),
      );
    }

    const tagValueMappings = await tx
      .select({
        tagValueId: productTagValues.tagValueId,
      })
      .from(productTagValues)
      .innerJoin(tagValues, eq(productTagValues.tagValueId, tagValues.id))
      .where(
        and(
          eq(productTagValues.masterId, masterId),
          eq(productTagValues.versionId, fromVersionId),
          eq(tagValues.isActive, true),
        ),
      );

    if (tagValueMappings.length > 0) {
      await tx.insert(productTagValues).values(
        tagValueMappings.map((tv) => ({
          masterId,
          versionId: toVersionId,
          tagValueId: tv.tagValueId,
        })),
      );
    }

    // 카테고리 복사
    const categories = await tx
      .select()
      .from(productMasterCategories)
      .where(and(eq(productMasterCategories.masterId, masterId), eq(productMasterCategories.versionId, fromVersionId)));

    if (categories.length > 0) {
      await tx.insert(productMasterCategories).values(
        categories.map((c) => ({
          id: uuidv7(),
          masterId,
          categoryId: c.categoryId,
          versionId: toVersionId,
          isPrimary: c.isPrimary,
          createdAt: new Date(),
        })),
      );
    }

    // 이미지 복사
    const images = await tx
      .select()
      .from(productImages)
      .where(eq(productImages.versionId, fromVersionId))
      .orderBy(desc(productImages.isPrimary), asc(productImages.sortOrder));

    if (images.length > 0) {
      await tx.insert(productImages).values(
        images.map((img) => ({
          id: uuidv7(),
          versionId: toVersionId,
          fileId: img.fileId,
          isPrimary: img.isPrimary,
          sortOrder: img.sortOrder,
          createdAt: new Date(),
        })),
      );
    }

    this.logger.log(
      `Copied mappings and displays from version ${fromVersionId} to ${toVersionId} for master ${masterId}: ` +
        `${categories.length} categories, ${optionGroups.length} option groups, ${variants.length} variants, ${pricingRules.length} pricing rules, ${purchaseConstraintMappings.length} purchase constraints, ${tagValueMappings.length} active tag values, ${images.length} images`,
    );
  }

  /**
   * Draft 버전 삭제 (고아 variant도 정리)
   */
  async deleteDraftVersion(versionId: string, tx?: DbTransaction): Promise<void> {
    return this.db.run(async (tx) => {
      const version = await this.getVersionById(versionId, tx);

      if (version.status !== 'draft') {
        throw new BadRequestException('Only draft versions can be deleted');
      }

      // 1. 이 버전이 참조하는 variant 목록 조회
      const variantMappings = await tx
        .select({ variantId: productMasterVariants.variantId })
        .from(productMasterVariants)
        .where(
          and(eq(productMasterVariants.masterId, version.masterId), eq(productMasterVariants.versionId, version.id)),
        );

      const variantIds = variantMappings.map((m) => m.variantId);

      // 2. Display 정보 삭제
      await tx
        .delete(productOptionGroupDisplays)
        .where(
          and(
            eq(productOptionGroupDisplays.masterId, version.masterId),
            eq(productOptionGroupDisplays.versionId, version.id),
          ),
        );

      await tx
        .delete(productOptionValueDisplays)
        .where(
          and(
            eq(productOptionValueDisplays.masterId, version.masterId),
            eq(productOptionValueDisplays.versionId, version.id),
          ),
        );

      // 3. 매핑 테이블 삭제
      await tx
        .delete(productMasterOptionGroups)
        .where(
          and(
            eq(productMasterOptionGroups.masterId, version.masterId),
            eq(productMasterOptionGroups.versionId, version.id),
          ),
        );

      await tx
        .delete(productMasterVariants)
        .where(
          and(eq(productMasterVariants.masterId, version.masterId), eq(productMasterVariants.versionId, version.id)),
        );

      await tx
        .delete(productTagValues)
        .where(and(eq(productTagValues.masterId, version.masterId), eq(productTagValues.versionId, version.id)));

      // 3. 가격 규칙 매핑 삭제 (고아 정리 포함)
      const pricingRuleMappings = await tx
        .select({ pricingRuleId: productMasterPricingRules.pricingRuleId })
        .from(productMasterPricingRules)
        .where(
          and(
            eq(productMasterPricingRules.masterId, version.masterId),
            eq(productMasterPricingRules.versionId, version.id),
          ),
        );

      await tx
        .delete(productMasterPricingRules)
        .where(
          and(
            eq(productMasterPricingRules.masterId, version.masterId),
            eq(productMasterPricingRules.versionId, version.id),
          ),
        );

      const purchaseConstraintMappings = await tx
        .select({ purchaseConstraintId: productMasterPurchaseConstraints.purchaseConstraintId })
        .from(productMasterPurchaseConstraints)
        .where(
          and(
            eq(productMasterPurchaseConstraints.masterId, version.masterId),
            eq(productMasterPurchaseConstraints.versionId, version.id),
          ),
        );

      await tx
        .delete(productMasterPurchaseConstraints)
        .where(
          and(
            eq(productMasterPurchaseConstraints.masterId, version.masterId),
            eq(productMasterPurchaseConstraints.versionId, version.id),
          ),
        );

      // 4. 버전 자체 삭제
      await tx.delete(productMasterVersions).where(eq(productMasterVersions.id, versionId));

      // 5. 고아 variant 정리
      if (variantIds.length > 0) {
        await this._cleanupOrphanedVariantsAfterDeletion(version.masterId, variantIds, tx);
      }

      // 6. 고아 pricing rules 정리
      if (pricingRuleMappings.length > 0) {
        await this._cleanupOrphanedPricingRules(
          pricingRuleMappings.map((m) => m.pricingRuleId),
          tx,
        );
      }

      // 7. 고아 purchase constraint 정리
      if (purchaseConstraintMappings.length > 0) {
        await this._cleanupOrphanedPurchaseConstraints(
          purchaseConstraintMappings.map((m) => m.purchaseConstraintId),
          tx,
        );
      }

      this.logger.log(`Deleted draft version ${version.id} of master ${version.masterId}`);
    }, tx);
  }

  /**
   * Draft 버전 삭제 후 고아 variant 정리
   */
  private async _cleanupOrphanedVariantsAfterDeletion(
    masterId: string,
    candidateVariantIds: string[],
    tx: DbTransaction,
  ): Promise<void> {
    const deletedCount = await deleteEntitiesIfUnmapped(
      tx,
      {
        entityTable: productVariants,
        entityIdColumn: productVariants.id,
        junctionTable: productMasterVariants,
        junctionFkColumn: productMasterVariants.variantId,
      },
      candidateVariantIds,
    );

    if (deletedCount > 0) {
      this.logger.log(`Cleaned up ${deletedCount} orphaned variant entities`);
    }
  }

  /**
   * 고아 pricing rule 정리 (deleteDraftVersion용)
   */
  private async _cleanupOrphanedPricingRules(candidateRuleIds: string[], tx: DbTransaction): Promise<void> {
    const deletedCount = await deleteEntitiesIfUnmapped(
      tx,
      {
        entityTable: pricingRules,
        entityIdColumn: pricingRules.id,
        junctionTable: productMasterPricingRules,
        junctionFkColumn: productMasterPricingRules.pricingRuleId,
      },
      candidateRuleIds,
    );

    if (deletedCount > 0) {
      this.logger.log(`Cleaned up ${deletedCount} orphaned pricing rules`);
    }
  }

  private async _cleanupOrphanedPurchaseConstraints(
    candidateConstraintIds: string[],
    tx: DbTransaction,
  ): Promise<void> {
    const deletedCount = await deleteEntitiesIfUnmapped(
      tx,
      {
        entityTable: productPurchaseConstraints,
        entityIdColumn: productPurchaseConstraints.id,
        junctionTable: productMasterPurchaseConstraints,
        junctionFkColumn: productMasterPurchaseConstraints.purchaseConstraintId,
      },
      candidateConstraintIds,
    );

    if (deletedCount > 0) {
      this.logger.log(`Cleaned up ${deletedCount} orphaned purchase constraints`);
    }
  }
}

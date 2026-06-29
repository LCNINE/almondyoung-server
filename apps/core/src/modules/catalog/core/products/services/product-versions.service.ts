import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { InjectStreamPublisher, OutboxPublisher, StreamPublisher } from '@app/events';
import { ProductEvents, PRODUCT_STREAM } from '@packages/event-contracts';
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
import { productMatchings, productVariantSkuLinks } from '../../../../inventory/schema/inventory.schema';
import { productVariantDigitalAssetLinks } from '../../../../library/schema/library.schema';
import { ProductSellableQuantityService } from '../../../../inventory/product-sellable-quantity/services/product-sellable-quantity.service';
import { eq, and, sql, max as drizzleMax, isNull, inArray, asc, desc } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { deleteEntitiesIfUnmapped } from '../../version-isolation/delete-if-unmapped';

@Injectable()
export class ProductVersionsService {
  private readonly logger = new Logger(ProductVersionsService.name);

  constructor(
    @InjectDb() private readonly db: DbService<PimSchema>,
    @InjectStreamPublisher(PRODUCT_STREAM.topic.topic)
    private readonly productPublisher: StreamPublisher<ProductEvents>,
    private readonly outboxPublisher: OutboxPublisher,
    private readonly pricingValidator: PricingValidatorService,
    private readonly productReadAssembler: ProductReadAssembler,
    private readonly projectionSnapshotAssembler: ProjectionSnapshotAssembler,
    private readonly priceCacheService: VariantPriceCacheService,
    private readonly variantAssetLinkService: VariantAssetLinkService,
    private readonly productSellableQuantity: ProductSellableQuantityService,
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
  async publishVersion(versionId: string, tx?: DbTransaction): Promise<void> {
    return this.db.run(async (tx) => {
      const version = await this.getVersionById(versionId, tx);

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

      // 디지털 publish 가드 — reconcile 로 인계된 링크까지 반영하도록 그 뒤에 검증(throw 시 tx 롤백).
      await this._validateDigitalAssetLinks(version, tx);

      // 이벤트 발행: 추가/삭제된 variant
      await this._publishVariantChangeEvents(version, previousActiveVersion, tx);

      await this._emitActiveVersionChangedEvent(version, previousActiveVersion, changeReason, tx);

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
    if (unmatched.length === 0) return;

    const prevVariants = await this._getVersionVariantsWithOptionValues(previousActiveVersionId, tx);
    if (prevVariants.length === 0) {
      this.logger.debug(
        `Previous active ${previousActiveVersionId} has no variants — leaving ${unmatched.length} new variants unmatched`,
      );
      return;
    }

    const prevByComboKey = new Map<string, { variantId: string }>();
    for (const pv of prevVariants) {
      prevByComboKey.set(this._comboKey(pv.optionValueIds), { variantId: pv.variantId });
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
      const twin = prevByComboKey.get(this._comboKey(nv.optionValueIds));
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
      prevByComboKey.set(this._comboKey(pv.optionValueIds), pv.variantId);
    }

    const plan: Array<{ newVariantId: string; previousVariantId: string }> = [];
    for (const nv of unmatched) {
      const twinVariantId = prevByComboKey.get(this._comboKey(nv.optionValueIds));
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

  private async _getVersionVariantsWithOptionValues(
    versionId: string,
    tx: DbTransaction,
  ): Promise<Array<{ variantId: string; optionValueIds: string[] }>> {
    const variantIds = await tx
      .select({ variantId: productMasterVariants.variantId })
      .from(productMasterVariants)
      .where(eq(productMasterVariants.versionId, versionId));

    if (variantIds.length === 0) return [];

    const ids = variantIds.map((r) => r.variantId);
    const optionRows = await tx
      .select({
        variantId: variantOptionValues.variantId,
        optionValueId: variantOptionValues.optionValueId,
      })
      .from(variantOptionValues)
      .where(inArray(variantOptionValues.variantId, ids));

    const byVariant = new Map<string, string[]>();
    for (const id of ids) byVariant.set(id, []);
    for (const r of optionRows) {
      byVariant.get(r.variantId)?.push(r.optionValueId);
    }
    return ids.map((id) => ({ variantId: id, optionValueIds: byVariant.get(id) ?? [] }));
  }

  private _comboKey(optionValueIds: string[]): string {
    return [...optionValueIds].sort().join('|');
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
   * @deprecated use updateMembershipPriceVisibility
   */
  async updateMembershipVisibility(masterId: string, isMembershipOnly: boolean, tx?: DbTransaction): Promise<void> {
    return this.updateMembershipPriceVisibility(masterId, isMembershipOnly, tx);
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
   * 해외직구 여부 변경 — draft 없이 active 버전을 직접 수정하고 채널에 재싱크.
   */
  async updateOverseas(masterId: string, isOverseas: boolean, tx?: DbTransaction): Promise<void> {
    return this.inTx(async (tx) => {
      const activeVersion = await this.getActiveVersion(masterId, tx);

      await tx
        .update(productMasterVersions)
        .set({ isOverseas, updatedAt: new Date() })
        .where(eq(productMasterVersions.id, activeVersion.id));

      const patchedVersion = { ...activeVersion, isOverseas };
      await this._emitActiveVersionChangedEvent(patchedVersion, null, 'active', tx);

      this.logger.log(`updateOverseas: master=${masterId} isOverseas=${isOverseas}`);
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

  /**
   * Active version 변경 이벤트 발행
   */
  private async _emitActiveVersionChangedEvent(
    newVersion: ProductMasterVersion,
    previousActiveVersion: ProductMasterVersion | null,
    changeReason: 'published' | 'unpublished' | 'rollback',
    tx: DbTransaction,
  ): Promise<void> {
    const assembly =
      changeReason === 'unpublished'
        ? null
        : await this.projectionSnapshotAssembler.assembleActiveVersionSnapshot(newVersion.masterId, newVersion.id, tx);
    const snapshot = assembly?.snapshot ?? null;
    const categoryIds = assembly?.categoryIds ?? [];
    const primaryCategoryId = assembly?.primaryCategoryId ?? null;

    await this.outboxPublisher.saveEvent(
      {
        topic: PRODUCT_STREAM.topic.topic,
        eventType: 'ProductMasterActiveVersionChanged',
        aggregateType: PRODUCT_STREAM.aggregateType,
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
          snapshot,
        },
      },
      tx,
    );

    this.logger.log(
      `📦 Enqueued ProductMasterActiveVersionChanged: ${newVersion.masterId} (${changeReason}) with ${snapshot ? 'full snapshot' : 'no snapshot'}`,
    );
  }

  private async getVersionCategoryIds(masterId: string, versionId: string, tx: DbTransaction): Promise<string[]> {
    const rows = await tx
      .select({ categoryId: productMasterCategories.categoryId })
      .from(productMasterCategories)
      .where(and(eq(productMasterCategories.masterId, masterId), eq(productMasterCategories.versionId, versionId)));

    return rows.map((row) => row.categoryId);
  }

  private async getPrimaryCategoryId(masterId: string, versionId: string, tx: DbTransaction): Promise<string | null> {
    const [row] = await tx
      .select({ categoryId: productMasterCategories.categoryId })
      .from(productMasterCategories)
      .where(
        and(
          eq(productMasterCategories.masterId, masterId),
          eq(productMasterCategories.versionId, versionId),
          eq(productMasterCategories.isPrimary, true),
        ),
      )
      .limit(1);

    return row?.categoryId ?? null;
  }

  /**
   * 전체 ProductSnapshot 빌드 (Phase 2)
   * 이벤트 페이로드에 포함할 모든 상품 데이터를 조회
   */
  private async _buildFullSnapshot(masterId: string, versionId: string, tx: DbTransaction): Promise<ProductSnapshot> {
    const version = await tx.query.productMasterVersions.findFirst({
      where: eq(productMasterVersions.id, versionId),
    });

    if (!version) {
      throw new NotFoundError(`Version ${versionId} not found`);
    }

    const categories = await this._buildCategoryTree(masterId, versionId, tx);
    const optionGroups = await this._getVersionOptionGroups(masterId, versionId, tx);
    const variants = await this._getVersionVariants(versionId, tx);
    const purchaseConstraint = await this._getVersionPurchaseConstraint(masterId, versionId, tx);

    const images = await tx
      .select()
      .from(productImages)
      .where(eq(productImages.versionId, versionId))
      .orderBy(asc(productImages.sortOrder));

    const tagRows = await tx
      .select({
        name: tagValues.name,
      })
      .from(productTagValues)
      .innerJoin(tagValues, eq(productTagValues.tagValueId, tagValues.id))
      .where(eq(productTagValues.versionId, versionId));

    const fileServiceUrl = process.env.FILE_SERVICE_URL || '';
    const primaryImage = images.find((img) => img.isPrimary);

    return {
      masterId,
      versionId,
      version: version.version,
      name: version.name,
      description: version.description || undefined,
      descriptionHtml: version.descriptionHtml || undefined,
      thumbnail: primaryImage ? `${fileServiceUrl}/files/${primaryImage.fileId}` : undefined,
      images: images.map((img) => ({
        fileId: img.fileId,
        url: `${fileServiceUrl}/files/${img.fileId}`,
        isPrimary: img.isPrimary,
        sortOrder: img.sortOrder,
      })),
      seoTitle: version.seoTitle || undefined,
      seoDescription: version.seoDescription || undefined,
      seoKeywords: version.seoKeywords?.join(', ') || undefined,
      categories,
      brand: version.brand || undefined,
      tags: tagRows.map((t) => t.name),
      productType: version.productType || undefined,
      fulfillmentKind: (version.fulfillmentKind || 'physical') as 'physical' | 'digital',
      optionGroups,
      variants,
      status: version.status === 'inactive' ? 'draft' : version.status,
      isWholesaleOnly: version.isWholesaleOnly || false,
      hideMembershipPriceForNonMembers: version.hideMembershipPriceForNonMembers ?? version.isMembershipOnly ?? false,
      isMembershipOnly: version.hideMembershipPriceForNonMembers ?? version.isMembershipOnly ?? false,
      isVisibleToMembersOnly: version.isVisibleToMembersOnly ?? false,
      isOverseas: version.isOverseas ?? false,
      isGiftcard: false,
      discountable: true,
      purchaseConstraint,
    };
  }

  private async _getVersionPurchaseConstraint(
    masterId: string,
    versionId: string,
    tx: DbTransaction,
  ): Promise<ProductSnapshot['purchaseConstraint']> {
    const [row] = await tx
      .select({
        requiresMembership: productPurchaseConstraints.requiresMembership,
        lifetimeQuantityLimit: productPurchaseConstraints.lifetimeQuantityLimit,
      })
      .from(productMasterPurchaseConstraints)
      .innerJoin(
        productPurchaseConstraints,
        eq(productMasterPurchaseConstraints.purchaseConstraintId, productPurchaseConstraints.id),
      )
      .where(
        and(
          eq(productMasterPurchaseConstraints.masterId, masterId),
          eq(productMasterPurchaseConstraints.versionId, versionId),
        ),
      )
      .limit(1);

    return row ?? undefined;
  }

  /**
   * 카테고리 트리 빌드 (부모 경로 포함)
   */
  private async _buildCategoryTree(
    masterId: string,
    versionId: string,
    tx: DbTransaction,
  ): Promise<
    Array<{
      id: string;
      name: string;
      slug: string;
      path: string;
      parentId: string | null;
      isActive: boolean;
      visibility: boolean;
      showOnMainCategory: boolean;
      thumbnail?: string;
    }>
  > {
    const categoryRows = await tx
      .select({
        categoryId: productMasterCategories.categoryId,
      })
      .from(productMasterCategories)
      .where(eq(productMasterCategories.masterId, masterId));

    if (categoryRows.length === 0) return [];

    const categoryIds = categoryRows.map((r) => r.categoryId);

    const categories = await tx.select().from(productCategories).where(inArray(productCategories.id, categoryIds));

    const fileServiceUrl = process.env.FILE_SERVICE_URL || '';

    const categoriesWithPath = await Promise.all(
      categories.map(async (cat) => {
        const path = await this._buildCategoryPath(cat.id, tx);
        return {
          id: cat.id,
          name: cat.name,
          slug: cat.slug,
          path,
          parentId: cat.parentId,
          isActive: cat.isActive,
          visibility: cat.visibility ?? true,
          showOnMainCategory: cat.displaySettings?.showOnMainCategory ?? false,
          thumbnail: cat.imageUrl ? `${fileServiceUrl}/files/${cat.imageUrl}` : undefined,
        };
      }),
    );

    return categoriesWithPath;
  }

  /**
   * 카테고리 경로 재귀적으로 구성
   */
  private async _buildCategoryPath(categoryId: string, tx: DbTransaction): Promise<string> {
    const pathParts: string[] = [];
    let currentId: string | null = categoryId;

    while (currentId) {
      const category = await tx.query.productCategories.findFirst({
        where: eq(productCategories.id, currentId),
      });

      if (!category) break;

      pathParts.unshift(category.slug);
      currentId = category.parentId;
    }

    return '/' + pathParts.join('/');
  }

  /**
   * 버전의 옵션 그룹 조회
   */
  private async _getVersionOptionGroups(
    masterId: string,
    versionId: string,
    tx: DbTransaction,
  ): Promise<
    Array<{
      id: string;
      name: string;
      values: Array<{
        id: string;
        name: string;
        colorCode?: string;
        imageUrl?: string;
      }>;
    }>
  > {
    const optionGroupRows = await tx
      .select({
        optionGroupId: productMasterOptionGroups.optionGroupId,
        displayName: productOptionGroupDisplays.displayName,
      })
      .from(productMasterOptionGroups)
      .leftJoin(
        productOptionGroupDisplays,
        and(
          eq(productMasterOptionGroups.optionGroupId, productOptionGroupDisplays.optionGroupId),
          eq(productOptionGroupDisplays.versionId, versionId),
        ),
      )
      .where(eq(productMasterOptionGroups.masterId, masterId));

    const fileServiceUrl = process.env.FILE_SERVICE_URL || '';

    const optionGroups = await Promise.all(
      optionGroupRows.map(async (row) => {
        const valueRows = await tx
          .select({
            id: productOptionValueDisplays.optionValueId,
            name: productOptionValueDisplays.displayName,
            colorCode: productOptionValueDisplays.colorCode,
            imageUrl: productOptionValueDisplays.imageUrl,
          })
          .from(productOptionValueDisplays)
          .where(and(eq(productOptionValueDisplays.versionId, versionId)));

        return {
          id: row.optionGroupId,
          name: row.displayName || row.optionGroupId,
          values: valueRows.map((v) => ({
            id: v.id,
            name: v.name,
            colorCode: v.colorCode || undefined,
            imageUrl: v.imageUrl ? `${fileServiceUrl}/files/${v.imageUrl}` : undefined,
          })),
        };
      }),
    );

    return optionGroups;
  }

  /**
   * 버전의 변형(Variants) 조회
   */
  private async _getVersionVariants(
    versionId: string,
    tx: DbTransaction,
  ): Promise<
    Array<{
      id: string;
      variantName: string;
      sku: string;
      variantCode?: string;
      isDefault: boolean;
      status: string;
      optionCombination?: Array<{
        name: string;
        value: string;
      }>;
      basePrice: number;
      membershipPrice?: number;
      tieredPrices?: Array<{
        minQuantity: number;
        price: number;
      }>;
      weight?: number;
      length?: number;
      width?: number;
      height?: number;
      originCountry?: string;
      midCode?: string;
      hsCode?: string;
      material?: string;
    }>
  > {
    const variantRows = await tx
      .select({
        id: productVariants.id,
        variantName: productVariants.variantName,
        variantCode: productVariants.variantCode,
        isDefault: productVariants.isDefault,
        status: productVariants.status,
      })
      .from(productMasterVariants)
      .innerJoin(productVariants, eq(productMasterVariants.variantId, productVariants.id))
      .where(eq(productMasterVariants.versionId, versionId));

    const cachedPrices = await this.priceCacheService.getCachedPriceSetsByVersion(versionId, tx);
    const priceMap = new Map(cachedPrices.map((p) => [p.variantId, p]));

    const variants = await Promise.all(
      variantRows.map(async (variant) => {
        const priceData = priceMap.get(variant.id);

        const optionValues = await tx
          .select({
            optionGroupName: productOptionGroupDisplays.displayName,
            optionValueName: productOptionValueDisplays.displayName,
          })
          .from(variantOptionValues)
          .innerJoin(productOptionValues, eq(variantOptionValues.optionValueId, productOptionValues.id))
          .innerJoin(
            productOptionValueDisplays,
            and(
              eq(productOptionValues.id, productOptionValueDisplays.optionValueId),
              eq(productOptionValueDisplays.versionId, versionId),
            ),
          )
          .innerJoin(productOptionGroups, eq(productOptionValues.optionGroupId, productOptionGroups.id))
          .innerJoin(
            productOptionGroupDisplays,
            and(
              eq(productOptionGroups.id, productOptionGroupDisplays.optionGroupId),
              eq(productOptionGroupDisplays.versionId, versionId),
            ),
          )
          .where(eq(variantOptionValues.variantId, variant.id));

        return {
          id: variant.id,
          variantName: variant.variantName || '',
          sku: variant.id,
          variantCode: variant.variantCode || undefined,
          isDefault: variant.isDefault,
          status: variant.status,
          optionCombination: optionValues.map((ov) => ({
            name: ov.optionGroupName || '',
            value: ov.optionValueName || '',
          })),
          basePrice: priceData?.basePrice ?? 0,
          membershipPrice: priceData?.membershipPrice || undefined,
          tieredPrices: priceData?.tieredPrices || undefined,
        };
      }),
    );

    return variants;
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

  async linkOptionGroupToVersion(
    masterId: string,
    versionId: string,
    optionGroupId: string,
    tx?: DbTransaction,
  ): Promise<void> {
    return this.db.run(async (tx) => {
      await tx.insert(productMasterOptionGroups).values({
        id: uuidv7(),
        masterId,
        optionGroupId,
        versionId,
        createdAt: new Date(),
      });
    }, tx);
  }

  async unlinkOptionGroupFromVersion(
    masterId: string,
    versionId: string,
    optionGroupId: string,
    tx?: DbTransaction,
  ): Promise<void> {
    return this.db.run(async (tx) => {
      await tx
        .delete(productMasterOptionGroups)
        .where(
          and(
            eq(productMasterOptionGroups.masterId, masterId),
            eq(productMasterOptionGroups.versionId, versionId),
            eq(productMasterOptionGroups.optionGroupId, optionGroupId),
          ),
        );
    }, tx);
  }

  async linkVariantToVersion(
    masterId: string,
    versionId: string,
    variantId: string,
    tx?: DbTransaction,
  ): Promise<void> {
    return this.db.run(async (tx) => {
      await tx.insert(productMasterVariants).values({
        id: uuidv7(),
        masterId,
        variantId,
        versionId,
        createdAt: new Date(),
      });
    }, tx);
  }

  async unlinkVariantFromVersion(
    masterId: string,
    versionId: string,
    variantId: string,
    tx?: DbTransaction,
  ): Promise<void> {
    return this.db.run(async (tx) => {
      await tx
        .delete(productMasterVariants)
        .where(
          and(
            eq(productMasterVariants.masterId, masterId),
            eq(productMasterVariants.versionId, versionId),
            eq(productMasterVariants.variantId, variantId),
          ),
        );
    }, tx);
  }

  async linkPricingRuleToVersion(
    masterId: string,
    versionId: string,
    pricingRuleId: string,
    tx?: DbTransaction,
  ): Promise<void> {
    return this.db.run(async (tx) => {
      await tx.insert(productMasterPricingRules).values({
        id: uuidv7(),
        masterId,
        pricingRuleId,
        versionId,
        createdAt: new Date(),
      });
    }, tx);
  }

  async unlinkPricingRuleFromVersion(
    masterId: string,
    versionId: string,
    pricingRuleId: string,
    tx?: DbTransaction,
  ): Promise<void> {
    return this.db.run(async (tx) => {
      await tx
        .delete(productMasterPricingRules)
        .where(
          and(
            eq(productMasterPricingRules.masterId, masterId),
            eq(productMasterPricingRules.versionId, versionId),
            eq(productMasterPricingRules.pricingRuleId, pricingRuleId),
          ),
        );
    }, tx);
  }

  async getVersionOptionGroups(masterId: string, versionId: string, tx?: DbTransaction): Promise<string[]> {
    return this.db.run(async (tx) => {
      const mappings = await tx
        .select()
        .from(productMasterOptionGroups)
        .where(
          and(eq(productMasterOptionGroups.masterId, masterId), eq(productMasterOptionGroups.versionId, versionId)),
        );

      return mappings.map((m) => m.optionGroupId);
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

  async getVersionPricingRules(masterId: string, versionId: string, tx?: DbTransaction): Promise<string[]> {
    return this.db.run(async (tx) => {
      const mappings = await tx
        .select()
        .from(productMasterPricingRules)
        .where(
          and(eq(productMasterPricingRules.masterId, masterId), eq(productMasterPricingRules.versionId, versionId)),
        );

      return mappings.map((m) => m.pricingRuleId);
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

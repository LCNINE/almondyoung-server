import { PimTestDatabase } from './pim-test-database';
import {
  productMasters,
  productCategories,
  productOptionGroups,
  productOptionValues,
  productOptionGroupDisplays,
  productOptionValueDisplays,
  productVariants,
  variantOptionValues,
  productMasterOptionGroups,
  productMasterVariants,
  productMasterPricingRules,
  pricingRules,
  salesChannels,
  channelProducts,
} from '../../src/schema';
import type {
  NewProductMaster,
  NewProductCategory,
  ProductMaster,
  ProductVariant,
  NewProductVariant,
  PricingRule,
  VersionStatus,
  DbTransaction,
} from '../../src/types';
import { v7 as uuidv7 } from 'uuid';
import { eq, and } from 'drizzle-orm';

/**
 * PIM Test Factory - Version Management Architecture
 * 
 * 새 버전 관리 시스템에 맞춘 테스트 데이터 생성 헬퍼
 */
export class PimTestFactory {
  private static getDb() {
    return PimTestDatabase.getDb();
  }

  // ===== 2.1 Master 생성 헬퍼 =====

  /**
   * 빈 draft master 생성 (모든 필드 선택사항)
   */
  static async createEmptyDraftMaster(tx?: DbTransaction) {
    const db = tx || this.getDb();
    const masterId = uuidv7();
    const versionId = uuidv7();

    const [master] = await db
      .insert(productMasters)
      .values({
        id: versionId,
        masterId: masterId,
        version: 1,
        versionStatus: 'draft',
        parentVersionId: null,
        draftOwnerId: null,
        name: '새 상품',
      })
      .returning();

    // 기본 variant 1개 생성
    const [variant] = await db
      .insert(productVariants)
      .values({
        variantName: null,
        isDefault: true,
        status: 'active',
      })
      .returning();

    // 매핑 테이블 연결
    await db.insert(productMasterVariants).values({
      masterId: master.masterId,
      variantId: variant.id,
      version: master.version,
    });

    return { master, defaultVariant: variant };
  }

  /**
   * 기본 정보 포함 draft master 생성
   */
  static async createDraftMasterWithBasicInfo(
    data: {
      name?: string;
      description?: string;
      brand?: string;
      status?: string;
      draftOwnerId?: string;
    } = {},
    tx?: DbTransaction,
  ) {
    const db = tx || this.getDb();
    const masterId = uuidv7();
    const versionId = uuidv7();

    const [master] = await db
      .insert(productMasters)
      .values({
        id: versionId,
        masterId: masterId,
        version: 1,
        versionStatus: 'draft',
        parentVersionId: null,
        name: data.name || '테스트 상품',
        description: data.description,
        brand: data.brand,
        status: data.status || 'active',
        draftOwnerId: data.draftOwnerId,
      })
      .returning();

    // 기본 variant 1개 생성
    const [variant] = await db
      .insert(productVariants)
      .values({
        variantName: null,
        isDefault: true,
        status: 'active',
      })
      .returning();

    await db.insert(productMasterVariants).values({
      masterId: master.masterId,
      variantId: variant.id,
      version: master.version,
    });

    return { master, defaultVariant: variant };
  }

  /**
   * Convenience alias for createDraftMasterWithBasicInfo
   * Used by e2e tests for simpler API
   */
  static async createMaster(
    data: {
      name?: string;
      description?: string;
      brand?: string;
      status?: string;
      draftOwnerId?: string;
    } = {},
    tx?: DbTransaction,
  ) {
    return this.createDraftMasterWithBasicInfo(data, tx);
  }

  /**
   * Master 기본 정보 업데이트
   */
  static async updateMasterBasicInfo(
    versionId: string,
    data: Partial<{
      name: string;
      description: string;
      brand: string;
      thumbnail: string;
      status: string;
    }>,
    tx?: DbTransaction,
  ) {
    const db = tx || this.getDb();

    const [updated] = await db
      .update(productMasters)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(productMasters.id, versionId))
      .returning();

    return updated;
  }

  /**
   * Master 조회 (by versionId)
   */
  static async getMasterById(versionId: string, tx?: DbTransaction) {
    const db = tx || this.getDb();

    const [master] = await db
      .select()
      .from(productMasters)
      .where(eq(productMasters.id, versionId))
      .limit(1);

    return master;
  }

  // ===== 2.2 버전 관리 헬퍼 =====

  /**
   * 새 draft 버전 생성 (부모 복사)
   */
  static async createDraftVersion(
    parentVersionId: string,
    userId?: string,
    copyMappings: boolean = true,
    tx?: DbTransaction,
  ) {
    const db = tx || this.getDb();

    // 부모 버전 조회
    const parent = await this.getMasterById(parentVersionId, db);
    if (!parent) {
      throw new Error(`Parent version ${parentVersionId} not found`);
    }

    // 다음 버전 번호 계산
    const versions = await db
      .select({ version: productMasters.version })
      .from(productMasters)
      .where(eq(productMasters.masterId, parent.masterId));

    const maxVersion = Math.max(...versions.map((v) => v.version));
    const nextVersion = maxVersion + 1;

    // 부모 데이터 복사 (버전 관련 필드 제외)
    const {
      id,
      masterId,
      version,
      parentVersionId: _,
      versionStatus,
      draftOwnerId,
      createdAt,
      updatedAt,
      ...parentData
    } = parent;

    const [newVersion] = await db
      .insert(productMasters)
      .values({
        ...parentData,
        id: uuidv7(),
        masterId: parent.masterId,
        version: nextVersion,
        parentVersionId: parentVersionId,
        versionStatus: 'draft',
        draftOwnerId: userId || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    // 매핑 복사
    if (copyMappings) {
      await this._copyMappings(
        db,
        parent.masterId,
        parent.version,
        newVersion.version,
      );
    }

    return newVersion;
  }

  private static async _copyMappings(
    db: DbTransaction | ReturnType<typeof PimTestDatabase.getDb>,
    masterId: string,
    fromVersion: number,
    toVersion: number,
  ) {
    // 1. 옵션 그룹 매핑 복사
    const optionGroups = await db
      .select()
      .from(productMasterOptionGroups)
      .where(
        and(
          eq(productMasterOptionGroups.masterId, masterId),
          eq(productMasterOptionGroups.version, fromVersion),
        ),
      );

    for (const og of optionGroups) {
      await db.insert(productMasterOptionGroups).values({
        id: uuidv7(),
        masterId: masterId,
        optionGroupId: og.optionGroupId,
        version: toVersion,
        createdAt: new Date(),
      });

      // Display 정보 복사
      const displays = await db
        .select()
        .from(productOptionGroupDisplays)
        .where(
          and(
            eq(productOptionGroupDisplays.optionGroupId, og.optionGroupId),
            eq(productOptionGroupDisplays.masterId, masterId),
            eq(productOptionGroupDisplays.version, fromVersion),
          ),
        );

      for (const display of displays) {
        await db.insert(productOptionGroupDisplays).values({
          id: uuidv7(),
          optionGroupId: display.optionGroupId,
          masterId: masterId,
          version: toVersion,
          locale: display.locale,
          displayName: display.displayName,
          description: display.description,
          sortOrder: display.sortOrder,
          createdAt: new Date(),
        });
      }

      // Option Value Display도 복사
      const optionValues = await db
        .select()
        .from(productOptionValues)
        .where(eq(productOptionValues.optionGroupId, og.optionGroupId));

      for (const ov of optionValues) {
        const valueDisplays = await db
          .select()
          .from(productOptionValueDisplays)
          .where(
            and(
              eq(productOptionValueDisplays.optionValueId, ov.id),
              eq(productOptionValueDisplays.masterId, masterId),
              eq(productOptionValueDisplays.version, fromVersion),
            ),
          );

        for (const vd of valueDisplays) {
          await db.insert(productOptionValueDisplays).values({
            id: uuidv7(),
            optionValueId: vd.optionValueId,
            masterId: masterId,
            version: toVersion,
            locale: vd.locale,
            displayName: vd.displayName,
            colorCode: vd.colorCode,
            imageUrl: vd.imageUrl,
            sortOrder: vd.sortOrder,
            createdAt: new Date(),
          });
        }
      }
    }

    // 2. Variant 매핑 복사
    const variants = await db
      .select()
      .from(productMasterVariants)
      .where(
        and(
          eq(productMasterVariants.masterId, masterId),
          eq(productMasterVariants.version, fromVersion),
        ),
      );

    for (const v of variants) {
      await db.insert(productMasterVariants).values({
        id: uuidv7(),
        masterId: masterId,
        variantId: v.variantId,
        version: toVersion,
        createdAt: new Date(),
      });
    }

    // 3. 가격 규칙 매핑 복사
    const pricingRuleMappings = await db
      .select()
      .from(productMasterPricingRules)
      .where(
        and(
          eq(productMasterPricingRules.masterId, masterId),
          eq(productMasterPricingRules.version, fromVersion),
        ),
      );

    for (const pr of pricingRuleMappings) {
      await db.insert(productMasterPricingRules).values({
        id: uuidv7(),
        masterId: masterId,
        pricingRuleId: pr.pricingRuleId,
        version: toVersion,
        createdAt: new Date(),
      });
    }
  }

  /**
   * 버전 Publish (draft → active/inactive)
   */
  static async publishVersion(
    versionId: string,
    targetStatus: 'active' | 'inactive',
    tx?: DbTransaction,
  ) {
    const db = tx || this.getDb();

    const version = await this.getMasterById(versionId, db);
    if (!version) {
      throw new Error(`Version ${versionId} not found`);
    }

    if (version.versionStatus !== 'draft') {
      throw new Error('Only draft versions can be published');
    }

    // active로 전환하는 경우 기존 active를 inactive로 변경
    if (targetStatus === 'active') {
      await db
        .update(productMasters)
        .set({ versionStatus: 'inactive' })
        .where(
          and(
            eq(productMasters.masterId, version.masterId),
            eq(productMasters.versionStatus, 'active'),
          ),
        );
    }

    // draft를 targetStatus로 변경
    const [published] = await db
      .update(productMasters)
      .set({
        versionStatus: targetStatus,
        draftOwnerId: null,
        updatedAt: new Date(),
      })
      .where(eq(productMasters.id, versionId))
      .returning();

    return published;
  }

  /**
   * Active 버전 조회
   */
  static async getActiveVersion(masterId: string, tx?: DbTransaction) {
    const db = tx || this.getDb();

    const [activeVersion] = await db
      .select()
      .from(productMasters)
      .where(
        and(
          eq(productMasters.masterId, masterId),
          eq(productMasters.versionStatus, 'active'),
        ),
      )
      .limit(1);

    return activeVersion;
  }

  /**
   * 버전 트리 조회
   */
  static async getVersionTree(masterId: string, tx?: DbTransaction) {
    const db = tx || this.getDb();

    const versions = await db
      .select()
      .from(productMasters)
      .where(eq(productMasters.masterId, masterId))
      .orderBy(productMasters.version);

    return versions;
  }

  // ===== 2.3 옵션 관리 헬퍼 =====

  /**
   * 옵션 그룹 생성 (새 구조 - ID만 저장)
   */
  static async createOptionGroup(tx?: DbTransaction) {
    const db = tx || this.getDb();

    const [group] = await db
      .insert(productOptionGroups)
      .values({
        id: uuidv7(),
        createdAt: new Date(),
      })
      .returning();

    return group;
  }

  /**
   * 옵션 값 생성
   */
  static async createOptionValue(optionGroupId: string, tx?: DbTransaction) {
    const db = tx || this.getDb();

    const [value] = await db
      .insert(productOptionValues)
      .values({
        id: uuidv7(),
        optionGroupId,
        createdAt: new Date(),
      })
      .returning();

    return value;
  }

  /**
   * 옵션 그룹 Display 정보 생성
   */
  static async createOptionGroupDisplay(
    optionGroupId: string,
    masterId: string,
    version: number,
    data: {
      displayName: string;
      description?: string;
      sortOrder?: number;
      locale?: string;
    },
    tx?: DbTransaction,
  ) {
    const db = tx || this.getDb();

    const [display] = await db
      .insert(productOptionGroupDisplays)
      .values({
        id: uuidv7(),
        optionGroupId,
        masterId,
        version,
        locale: data.locale || 'ko-KR',
        displayName: data.displayName,
        description: data.description,
        sortOrder: data.sortOrder || 0,
        createdAt: new Date(),
      })
      .returning();

    return display;
  }

  /**
   * 옵션 값 Display 정보 생성
   */
  static async createOptionValueDisplay(
    optionValueId: string,
    masterId: string,
    version: number,
    data: {
      displayName: string;
      colorCode?: string;
      imageUrl?: string;
      sortOrder?: number;
      locale?: string;
    },
    tx?: DbTransaction,
  ) {
    const db = tx || this.getDb();

    const [display] = await db
      .insert(productOptionValueDisplays)
      .values({
        id: uuidv7(),
        optionValueId,
        masterId,
        version,
        locale: data.locale || 'ko-KR',
        displayName: data.displayName,
        colorCode: data.colorCode,
        imageUrl: data.imageUrl,
        sortOrder: data.sortOrder || 0,
        createdAt: new Date(),
      })
      .returning();

    return display;
  }

  /**
   * 옵션 그룹을 Master에 매핑
   */
  static async linkOptionGroupToMaster(
    masterId: string,
    optionGroupId: string,
    version: number,
    tx?: DbTransaction,
  ) {
    const db = tx || this.getDb();

    const [mapping] = await db
      .insert(productMasterOptionGroups)
      .values({
        id: uuidv7(),
        masterId,
        optionGroupId,
        version,
        createdAt: new Date(),
      })
      .returning();

    return mapping;
  }

  // ===== 2.4 Variant 헬퍼 =====

  /**
   * Variant 생성
   */
  static async createVariant(
    data: Partial<NewProductVariant> = {},
    tx?: DbTransaction,
  ) {
    const db = tx || this.getDb();

    const [variant] = await db
      .insert(productVariants)
      .values({
        id: uuidv7(),
        variantName: data.variantName || null,
        isDefault: data.isDefault || false,
        status: data.status || 'active',
        displayOrder: data.displayOrder || 0,
        priceAdjustment: data.priceAdjustment || 0,
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return variant;
  }

  /**
   * Variant를 Master에 매핑
   */
  static async linkVariantToMaster(
    masterId: string,
    variantId: string,
    version: number,
    tx?: DbTransaction,
  ) {
    const db = tx || this.getDb();

    const [mapping] = await db
      .insert(productMasterVariants)
      .values({
        id: uuidv7(),
        masterId,
        variantId,
        version,
        createdAt: new Date(),
      })
      .returning();

    return mapping;
  }

  /**
   * Variant를 Option Value에 연결
   */
  static async linkVariantToOptionValue(
    variantId: string,
    optionValueId: string,
    tx?: DbTransaction,
  ) {
    const db = tx || this.getDb();

    const [link] = await db
      .insert(variantOptionValues)
      .values({
        id: uuidv7(),
        variantId,
        optionValueId,
      })
      .returning();

    return link;
  }

  /**
   * 옵션 조합으로 모든 variants 자동 생성
   * 
   * @example
   * await generateAllVariantCombinations(masterId, version, [
   *   { groupId: 'OG1', valueIds: ['OV1', 'OV2'] },  // 색상: 빨강, 파랑
   *   { groupId: 'OG2', valueIds: ['OV3', 'OV4'] }   // 사이즈: S, M
   * ])
   * // 결과: 4개 variant (빨강×S, 빨강×M, 파랑×S, 파랑×M)
   */
  static async generateAllVariantCombinations(
    masterId: string,
    version: number,
    optionGroups: Array<{ groupId: string; valueIds: string[] }>,
    tx?: DbTransaction,
  ) {
    const db = tx || this.getDb();

    // 모든 조합 생성 (재귀)
    const combinations = this._generateCombinations(
      optionGroups.map((og) => og.valueIds),
    );

    const createdVariants: ProductVariant[] = [];

    for (const combo of combinations) {
      // Variant 생성
      const variant = await this.createVariant({}, db);

      // Master에 매핑
      await this.linkVariantToMaster(masterId, variant.id, version, db);

      // 각 옵션 값과 연결
      for (const optionValueId of combo) {
        await this.linkVariantToOptionValue(variant.id, optionValueId, db);
      }

      createdVariants.push(variant);
    }

    return createdVariants;
  }

  private static _generateCombinations(arrays: string[][]): string[][] {
    if (arrays.length === 0) return [[]];
    if (arrays.length === 1) return arrays[0].map((item) => [item]);

    const [first, ...rest] = arrays;
    const restCombinations = this._generateCombinations(rest);

    const result: string[][] = [];
    for (const item of first) {
      for (const combo of restCombinations) {
        result.push([item, ...combo]);
      }
    }

    return result;
  }

  // ===== 2.5 가격 정책 헬퍼 =====

  /**
   * 단일 가격 규칙 생성
   */
  static async createPricingRule(
    data: {
      layer: 'base_price' | 'membership_price' | 'tiered_price';
      order: number;
      scopeType: 'all_variants' | 'with_option' | 'variants';
      scopeTargetIds?: string[];
      operationType: 'offset' | 'scale' | 'override';
      operationValue: number;
      minQuantity?: number;
    },
    tx?: DbTransaction,
  ) {
    const db = tx || this.getDb();

    const [rule] = await db
      .insert(pricingRules)
      .values({
        id: uuidv7(),
        layer: data.layer,
        order: data.order,
        scopeType: data.scopeType,
        scopeTargetIds: data.scopeTargetIds || [],
        operationType: data.operationType,
        operationValue: data.operationValue,
        minQuantity: data.minQuantity,
        createdAt: new Date(),
      })
      .returning();

    return rule;
  }

  /**
   * 가격 규칙을 Master에 매핑 (버전별)
   */
  static async linkPricingRuleToMaster(
    masterId: string,
    pricingRuleId: string,
    version: number,
    tx?: DbTransaction,
  ) {
    const db = tx || this.getDb();

    const [mapping] = await db
      .insert(productMasterPricingRules)
      .values({
        id: uuidv7(),
        masterId,
        pricingRuleId,
        version,
        createdAt: new Date(),
      })
      .returning();

    return mapping;
  }

  /**
   * base_price 레이어 규칙들 생성
   */
  static async createBasePriceRules(
    masterId: string,
    version: number,
    basePrice: number,
    tx?: DbTransaction,
  ) {
    const db = tx || this.getDb();

    const rule = await this.createPricingRule(
      {
        layer: 'base_price',
        order: 1,
        scopeType: 'all_variants',
        operationType: 'override',
        operationValue: basePrice,
      },
      db,
    );

    await this.linkPricingRuleToMaster(masterId, rule.id, version, db);

    return [rule];
  }

  /**
   * membership_price 레이어 규칙들 생성
   */
  static async createMembershipPriceRules(
    masterId: string,
    version: number,
    discountPercentage: number, // 예: 10 = 10% 할인
    tx?: DbTransaction,
  ) {
    const db = tx || this.getDb();

    const rule = await this.createPricingRule(
      {
        layer: 'membership_price',
        order: 1,
        scopeType: 'all_variants',
        operationType: 'scale',
        operationValue: -discountPercentage * 10, // scale은 1000배수
      },
      db,
    );

    await this.linkPricingRuleToMaster(masterId, rule.id, version, db);

    return [rule];
  }

  /**
   * tiered_price 레이어 규칙들 생성
   */
  static async createTieredPriceRules(
    masterId: string,
    version: number,
    tiers: Array<{ minQuantity: number; discountPercentage: number }>,
    tx?: DbTransaction,
  ) {
    const db = tx || this.getDb();

    const rules: PricingRule[] = [];

    for (let i = 0; i < tiers.length; i++) {
      const tier = tiers[i];
      const rule = await this.createPricingRule(
        {
          layer: 'tiered_price',
          order: i + 1,
          scopeType: 'all_variants',
          operationType: 'scale',
          operationValue: -tier.discountPercentage * 10,
          minQuantity: tier.minQuantity,
        },
        db,
      );

      await this.linkPricingRuleToMaster(masterId, rule.id, version, db);
      rules.push(rule);
    }

    return rules;
  }

  /**
   * 전체 가격 정책 세트 생성 (base + membership + tiered)
   */
  static async createCompletePricingPolicy(
    masterId: string,
    version: number,
    config: {
      basePrice: number;
      membershipDiscount?: number;
      tieredPricing?: Array<{ minQuantity: number; discountPercentage: number }>;
    },
    tx?: DbTransaction,
  ) {
    const db = tx || this.getDb();

    const allRules: PricingRule[] = [];

    // Base price
    const baseRules = await this.createBasePriceRules(
      masterId,
      version,
      config.basePrice,
      db,
    );
    allRules.push(...baseRules);

    // Membership price
    if (config.membershipDiscount) {
      const membershipRules = await this.createMembershipPriceRules(
        masterId,
        version,
        config.membershipDiscount,
        db,
      );
      allRules.push(...membershipRules);
    }

    // Tiered pricing
    if (config.tieredPricing && config.tieredPricing.length > 0) {
      const tieredRules = await this.createTieredPriceRules(
        masterId,
        version,
        config.tieredPricing,
        db,
      );
      allRules.push(...tieredRules);
    }

    return allRules;
  }

  // ===== 2.6 통합 시나리오 헬퍼 =====

  /**
   * 완전한 상품 생성 (옵션 + 가격 포함)
   * 
   * 예: 색상(빨강, 파랑) × 사이즈(S, M, L) = 6개 variants
   */
  static async createCompleteProductWithVersions(
    config: {
      name?: string;
      brand?: string;
      options?: Array<{
        displayName: string;
        values: Array<{ displayName: string; colorCode?: string }>;
      }>;
      basePrice?: number;
      membershipDiscount?: number;
    } = {},
    tx?: DbTransaction,
  ) {
    const db = tx || this.getDb();

    // 1. Master 생성
    const { master, defaultVariant } = await this.createDraftMasterWithBasicInfo(
      {
        name: config.name || '완전한 상품',
        brand: config.brand || '테스트 브랜드',
      },
      db,
    );

    // 2. 옵션이 있으면 처리
    if (config.options && config.options.length > 0) {
      // 기본 variant 제거
      await db
        .delete(productMasterVariants)
        .where(
          and(
            eq(productMasterVariants.masterId, master.masterId),
            eq(productMasterVariants.version, master.version),
          ),
        );

      const optionGroupsData: Array<{
        groupId: string;
        valueIds: string[];
      }> = [];

      for (const optionConfig of config.options) {
        // 옵션 그룹 생성
        const group = await this.createOptionGroup(db);
        await this.linkOptionGroupToMaster(
          master.masterId,
          group.id,
          master.version,
          db,
        );
        await this.createOptionGroupDisplay(
          group.id,
          master.masterId,
          master.version,
          { displayName: optionConfig.displayName },
          db,
        );

        const valueIds: string[] = [];

        // 옵션 값들 생성
        for (const valueConfig of optionConfig.values) {
          const value = await this.createOptionValue(group.id, db);
          await this.createOptionValueDisplay(
            value.id,
            master.masterId,
            master.version,
            {
              displayName: valueConfig.displayName,
              colorCode: valueConfig.colorCode,
            },
            db,
          );
          valueIds.push(value.id);
        }

        optionGroupsData.push({ groupId: group.id, valueIds });
      }

      // 모든 조합 variants 생성
      await this.generateAllVariantCombinations(
        master.masterId,
        master.version,
        optionGroupsData,
        db,
      );
    }

    // 3. 가격 정책 설정
    if (config.basePrice) {
      await this.createCompletePricingPolicy(
        master.masterId,
        master.version,
        {
          basePrice: config.basePrice,
          membershipDiscount: config.membershipDiscount,
        },
        db,
      );
    }

    return master;
  }

  /**
   * 간단한 가격 정책 상품 (옵션 없음)
   */
  static async createProductWithSimplePricing(
    basePrice: number = 10000,
    tx?: DbTransaction,
  ) {
    const db = tx || this.getDb();

    const { master } = await this.createDraftMasterWithBasicInfo(
      { name: '간단한 상품' },
      db,
    );

    await this.createBasePriceRules(master.masterId, master.version, basePrice, db);

    return master;
  }

  /**
   * 수량별 도매가 상품
   */
  static async createProductWithTieredPricing(
    config: {
      basePrice: number;
      tiers: Array<{ minQuantity: number; discountPercentage: number }>;
    },
    tx?: DbTransaction,
  ) {
    const db = tx || this.getDb();

    const { master } = await this.createDraftMasterWithBasicInfo(
      { name: '도매 상품', brand: '도매 브랜드' },
      db,
    );

    await this.createCompletePricingPolicy(
      master.masterId,
      master.version,
      {
        basePrice: config.basePrice,
        tieredPricing: config.tiers,
      },
      db,
    );

    return master;
  }

  // ===== 기타 헬퍼 =====

  /**
   * 카테고리 생성
   */
  static async createCategory(
    data: Partial<NewProductCategory> = {},
    tx?: DbTransaction,
  ) {
    const db = tx || this.getDb();

    const [category] = await db
      .insert(productCategories)
      .values({
        id: uuidv7(),
        name: data.name || '테스트 카테고리',
        slug: data.slug || `test-category-${Date.now()}`,
        level: data.level || 0,
        path: data.path || '',
        sortOrder: data.sortOrder || 0,
        isActive: data.isActive !== undefined ? data.isActive : true,
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return category;
  }

  /**
   * Sales Channel 생성
   */
  static async createSalesChannel(
    type: string = 'medusa',
    name: string = 'Medusa Store',
    tx?: DbTransaction,
  ) {
    const db = tx || this.getDb();

    const [channel] = await db
      .insert(salesChannels)
      .values({
        id: uuidv7(),
        type,
        name,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return channel;
  }

  /**
   * Channel Product 생성
   */
  static async createChannelProduct(
    masterId: string,
    channelId: string,
    overrides: any = {},
    tx?: DbTransaction,
  ) {
    const db = tx || this.getDb();

    const [channelProduct] = await db
      .insert(channelProducts)
      .values({
        id: uuidv7(),
        masterId,
        channelId,
        isActive: true,
        ...overrides,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return channelProduct;
  }
}




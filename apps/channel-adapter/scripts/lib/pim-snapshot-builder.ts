// apps/channel-adapter/scripts/lib/pim-snapshot-builder.ts
import * as postgres from 'postgres';
import type { PimProductSnapshot, PimPurchaseConstraint } from '../../src/types';

// Database row types
interface MasterRow {
  master_id: string;
  version_id: string;
  version: number;
  name: string;
  description?: string;
  description_html?: string;
  brand?: string;
  thumbnail?: string;
  seo_title?: string;
  seo_description?: string;
  seo_keywords?: string[];
  product_type?: string;
  status: string;
  is_wholesale_only: boolean;
  is_membership_only: boolean;
}

interface CategoryRow {
  master_id: string;
  version_id: string;
  category_id: string;
  name: string;
  slug: string;
  path: string;
  parent_id: string | null;
  is_active: boolean;
  visibility: boolean;
  display_settings: any;
  image_url?: string;
}

interface VariantRow {
  master_id: string;
  version_id: string;
  variant_id: string;
  variant_name?: string;
  variant_code?: string;
  is_default: boolean;
  status: string;
  display_order?: number;
  base_price?: string; // numeric from DB
  membership_price?: string;
  tiered_prices?: any;
  option_combination?: any;
}

interface OptionGroupRow {
  master_id: string;
  version_id: string;
  option_group_id: string;
  option_group_name?: string;
  option_value_id?: string;
  option_value_name?: string;
  color_code?: string;
  image_url?: string;
}

interface PurchaseConstraintRow {
  master_id: string;
  version_id: string;
  requires_membership: boolean;
  lifetime_quantity_limit: number | string | null;
}

/**
 * PimSnapshotBuilder - Fetches complete product snapshots from PIM database
 *
 * Uses batch queries to efficiently retrieve all product data:
 * - 1 query for masters
 * - 1 query for all categories (batch)
 * - 1 query for all variants (batch)
 * - 1 query for all option groups (batch)
 * - 1 query for all purchase constraints (batch)
 *
 * Total: 5 queries for 100 products (vs 100+ API calls)
 */
export class PimSnapshotBuilder {
  constructor(private readonly pimDb: postgres.Sql) {}

  /**
   * Fetch active product masters with full snapshots
   */
  async fetchActiveMasters(limit: number, offset: number): Promise<PimProductSnapshot[]> {
    console.log(`[PimSnapshotBuilder] Fetching ${limit} masters from offset ${offset}...`);

    // Step 1: Query active masters + versions
    const masters = await this.queryMasters(limit, offset);

    if (masters.length === 0) {
      console.log(`[PimSnapshotBuilder] No masters found`);
      return [];
    }

    console.log(`[PimSnapshotBuilder] Found ${masters.length} masters`);

    // Extract IDs for batch queries
    const masterIds = masters.map((m) => m.master_id);
    const versionIds = masters.map((m) => m.version_id);

    // Step 2-5: Batch query related data
    const [categories, variants, optionGroups, purchaseConstraints] = await Promise.all([
      this.queryCategories(masterIds, versionIds),
      this.queryVariants(masterIds, versionIds),
      this.queryOptionGroups(masterIds, versionIds),
      this.queryPurchaseConstraints(masterIds, versionIds),
    ]);

    console.log(
      `[PimSnapshotBuilder] Fetched: ${categories.length} categories, ${variants.length} variants, ${optionGroups.length} option values, ${purchaseConstraints.length} purchase constraints`,
    );

    // Step 6: Assemble snapshots
    return this.assembleSnapshots(masters, categories, variants, optionGroups, purchaseConstraints);
  }

  /**
   * Query active masters with version data
   */
  private async queryMasters(limit: number, offset: number): Promise<MasterRow[]> {
    return await this.pimDb<MasterRow[]>`
      SELECT
        pm.id AS master_id,
        pmv.id AS version_id,
        pmv.version,
        pmv.name,
        pmv.description,
        pmv.description_html,
        pmv.brand,
        pmv.thumbnail,
        pmv.seo_title,
        pmv.seo_description,
        pmv.seo_keywords,
        pmv.product_type,
        pmv.status,
        pmv.is_wholesale_only,
        pmv.is_membership_only
      FROM product_masters pm
      INNER JOIN product_master_versions pmv ON pm.id = pmv.master_id
      WHERE pmv.status = 'active'
        AND pmv.deleted_at IS NULL
        AND pm.deleted_at IS NULL
      ORDER BY pm.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
  }

  /**
   * Query categories for given masters (batch)
   */
  private async queryCategories(masterIds: string[], versionIds: string[]): Promise<CategoryRow[]> {
    if (masterIds.length === 0) return [];

    return await this.pimDb<CategoryRow[]>`
      SELECT
        pmc.master_id,
        pmc.version_id,
        pc.id AS category_id,
        pc.name,
        pc.slug,
        pc.path,
        pc.parent_id,
        pc.is_active,
        pc.visibility,
        pc.display_settings,
        pc.image_url
      FROM product_master_categories pmc
      INNER JOIN product_categories pc ON pmc.category_id = pc.id
      WHERE pmc.master_id = ANY(${masterIds})
        AND pmc.version_id = ANY(${versionIds})
    `;
  }

  /**
   * Query variants for given masters (batch)
   */
  private async queryVariants(masterIds: string[], versionIds: string[]): Promise<VariantRow[]> {
    if (masterIds.length === 0) return [];

    return await this.pimDb<VariantRow[]>`
      SELECT
        pmv.master_id,
        pmv.version_id,
        pv.id AS variant_id,
        pv.variant_name,
        pv.variant_code,
        pv.is_default,
        pv.status,
        pv.display_order,
        pvc.base_price,
        pvc.membership_price,
        pvc.tiered_prices,
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'name', pogd.display_name,
              'value', povd.display_name
            )
          ) FILTER (WHERE povd.option_value_id IS NOT NULL),
          '[]'::jsonb
        ) AS option_combination
      FROM product_master_variants pmv
      INNER JOIN product_variants pv ON pmv.variant_id = pv.id
      LEFT JOIN product_variant_price_cache pvc
        ON pvc.version_id = pmv.version_id
       AND pvc.variant_id = pv.id
      LEFT JOIN variant_option_values vov
        ON vov.variant_id = pv.id
      LEFT JOIN product_option_values pov
        ON vov.option_value_id = pov.id
      LEFT JOIN product_option_group_displays pogd
        ON pov.option_group_id = pogd.option_group_id
       AND pogd.version_id = pmv.version_id
       AND pogd.master_id = pmv.master_id
       AND pogd.locale = 'ko-KR'
      LEFT JOIN product_option_value_displays povd
        ON vov.option_value_id = povd.option_value_id
       AND povd.version_id = pmv.version_id
       AND povd.master_id = pmv.master_id
       AND povd.locale = 'ko-KR'
      WHERE pmv.master_id = ANY(${masterIds})
        AND pmv.version_id = ANY(${versionIds})
      GROUP BY
        pmv.master_id,
        pmv.version_id,
        pv.id,
        pv.variant_name,
        pv.variant_code,
        pv.is_default,
        pv.status,
        pv.display_order,
        pvc.base_price,
        pvc.membership_price,
        pvc.tiered_prices
      ORDER BY pmv.master_id, pv.is_default DESC, pv.display_order ASC
    `;
  }

  /**
   * Query option groups for given masters (batch)
   */
  private async queryOptionGroups(masterIds: string[], versionIds: string[]): Promise<OptionGroupRow[]> {
    if (masterIds.length === 0) return [];

    return await this.pimDb<OptionGroupRow[]>`
      SELECT
        pmog.master_id,
        pmog.version_id,
        pmog.option_group_id,
        pogd.display_name AS option_group_name,
        pov.id AS option_value_id,
        povd.display_name AS option_value_name,
        povd.color_code,
        povd.image_url
      FROM product_master_option_groups pmog
      LEFT JOIN product_option_group_displays pogd
        ON pmog.option_group_id = pogd.option_group_id
       AND pogd.version_id = pmog.version_id
       AND pogd.master_id = pmog.master_id
       AND pogd.locale = 'ko-KR'
      LEFT JOIN product_option_values pov
        ON pmog.option_group_id = pov.option_group_id
      LEFT JOIN product_option_value_displays povd
        ON pov.id = povd.option_value_id
       AND povd.version_id = pmog.version_id
       AND povd.master_id = pmog.master_id
       AND povd.locale = 'ko-KR'
      WHERE pmog.master_id = ANY(${masterIds})
        AND pmog.version_id = ANY(${versionIds})
      ORDER BY pmog.master_id, pmog.option_group_id, pov.id
    `;
  }

  /**
   * Query purchase constraints for given masters (batch)
   */
  private async queryPurchaseConstraints(
    masterIds: string[],
    versionIds: string[],
  ): Promise<PurchaseConstraintRow[]> {
    if (masterIds.length === 0) return [];

    return await this.pimDb<PurchaseConstraintRow[]>`
      SELECT
        pmpc.master_id,
        pmpc.version_id,
        ppc.requires_membership,
        ppc.lifetime_quantity_limit
      FROM product_master_purchase_constraints pmpc
      INNER JOIN product_purchase_constraints ppc ON pmpc.purchase_constraint_id = ppc.id
      WHERE pmpc.master_id = ANY(${masterIds})
        AND pmpc.version_id = ANY(${versionIds})
    `;
  }

  /**
   * Assemble database rows into PimProductSnapshot objects
   */
  private assembleSnapshots(
    masters: MasterRow[],
    categories: CategoryRow[],
    variants: VariantRow[],
    optionGroups: OptionGroupRow[],
    purchaseConstraints: PurchaseConstraintRow[],
  ): PimProductSnapshot[] {
    return masters.map((master) => {
      // Group categories by masterId
      const masterCategories = categories
        .filter((c) => c.master_id === master.master_id)
        .map((c) => ({
          id: c.category_id,
          name: c.name,
          slug: c.slug,
          path: c.path,
          parentId: c.parent_id,
          isActive: c.is_active,
          visibility: c.visibility,
          showOnMainCategory: c.display_settings?.showOnMainCategory ?? false,
          thumbnail: c.image_url,
        }));

      // Group variants by masterId
      const masterVariants = variants
        .filter((v) => v.master_id === master.master_id)
        .map((v) => ({
          id: v.variant_id,
          variantName: v.variant_name,
          variantCode: v.variant_code,
          isDefault: v.is_default,
          status: v.status,
          displayOrder: v.display_order ?? undefined,
          optionCombination: v.option_combination || [],
          basePrice: v.base_price !== undefined && v.base_price !== null ? Number(v.base_price) : undefined,
          membershipPrice: v.membership_price ? Number(v.membership_price) : undefined,
          tieredPrices: v.tiered_prices || [],
        }));

      // Group option groups by masterId
      const masterOptions = optionGroups.filter((o) => o.master_id === master.master_id);
      const groupedOptions = new Map<string, any>();

      masterOptions.forEach((opt) => {
        if (!groupedOptions.has(opt.option_group_id)) {
          groupedOptions.set(opt.option_group_id, {
            id: opt.option_group_id,
            name: opt.option_group_name || opt.option_group_id,
            values: [],
          });
        }

        if (opt.option_value_id) {
          groupedOptions.get(opt.option_group_id).values.push({
            id: opt.option_value_id,
            name: opt.option_value_name || opt.option_value_id,
            colorCode: opt.color_code,
            imageUrl: opt.image_url,
          });
        }
      });

      const purchaseConstraintRow = purchaseConstraints.find(
        (constraint) => constraint.master_id === master.master_id && constraint.version_id === master.version_id,
      );
      const purchaseConstraint: PimPurchaseConstraint | undefined = purchaseConstraintRow
        ? {
            requiresMembership: purchaseConstraintRow.requires_membership,
            lifetimeQuantityLimit:
              purchaseConstraintRow.lifetime_quantity_limit === null
                ? null
                : Number(purchaseConstraintRow.lifetime_quantity_limit),
          }
        : undefined;

      // Assemble final snapshot
      return {
        masterId: master.master_id,
        versionId: master.version_id,
        version: master.version,
        name: master.name,
        description: master.description,
        descriptionHtml: master.description_html,
        thumbnail: master.thumbnail,
        seoTitle: master.seo_title,
        seoDescription: master.seo_description,
        seoKeywords: master.seo_keywords || [],
        brand: master.brand,
        productType: master.product_type,
        categories: masterCategories,
        categoryIds: masterCategories.map((c) => c.id),
        variants: masterVariants,
        optionGroups: Array.from(groupedOptions.values()),
        status: master.status as any,
        isWholesaleOnly: master.is_wholesale_only,
        isMembershipOnly: master.is_membership_only,
        purchaseConstraint,
        isGiftcard: false, // PIM schema doesn't have this field
        discountable: true, // PIM schema doesn't have this field
      };
    });
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    await this.pimDb.end();
  }
}

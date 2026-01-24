// apps/channel-adapter/scripts/lib/pim-snapshot-builder.ts
import postgres from 'postgres';
import type { PimProductSnapshot } from '../../src/types';

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
  sku?: string;
  variant_code?: string;
  is_default: boolean;
  status: string;
  base_price: string; // numeric from DB
  membership_price?: string;
  tiered_prices?: any;
  option_combination?: any;
}

interface OptionGroupRow {
  master_id: string;
  version_id: string;
  option_group_id: string;
  option_group_name: string;
  option_value_id?: string;
  option_value_name?: string;
  color_code?: string;
  image_url?: string;
}

/**
 * PimSnapshotBuilder - Fetches complete product snapshots from PIM database
 *
 * Uses batch queries to efficiently retrieve all product data:
 * - 1 query for masters
 * - 1 query for all categories (batch)
 * - 1 query for all variants (batch)
 * - 1 query for all option groups (batch)
 *
 * Total: 4 queries for 100 products (vs 100+ API calls)
 */
export class PimSnapshotBuilder {
  constructor(private readonly pimDb: postgres.Sql) {}

  /**
   * Fetch active product masters with full snapshots
   */
  async fetchActiveMasters(
    limit: number,
    offset: number
  ): Promise<PimProductSnapshot[]> {
    console.log(`[PimSnapshotBuilder] Fetching ${limit} masters from offset ${offset}...`);

    // Step 1: Query active masters + versions
    const masters = await this.queryMasters(limit, offset);

    if (masters.length === 0) {
      console.log(`[PimSnapshotBuilder] No masters found`);
      return [];
    }

    console.log(`[PimSnapshotBuilder] Found ${masters.length} masters`);

    // Extract IDs for batch queries
    const masterIds = masters.map(m => m.master_id);
    const versionIds = masters.map(m => m.version_id);

    // Step 2-4: Batch query related data
    const [categories, variants, optionGroups] = await Promise.all([
      this.queryCategories(masterIds, versionIds),
      this.queryVariants(masterIds, versionIds),
      this.queryOptionGroups(masterIds, versionIds),
    ]);

    console.log(`[PimSnapshotBuilder] Fetched: ${categories.length} categories, ${variants.length} variants, ${optionGroups.length} option values`);

    // Step 5: Assemble snapshots
    return this.assembleSnapshots(masters, categories, variants, optionGroups);
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
  private async queryCategories(
    masterIds: string[],
    versionIds: string[]
  ): Promise<CategoryRow[]> {
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
  private async queryVariants(
    masterIds: string[],
    versionIds: string[]
  ): Promise<VariantRow[]> {
    if (masterIds.length === 0) return [];

    return await this.pimDb<VariantRow[]>`
      SELECT
        pmv.master_id,
        pmv.version_id,
        pv.id AS variant_id,
        pv.variant_name,
        pv.sku,
        pv.variant_code,
        pv.is_default,
        pv.status,
        pv.base_price,
        pv.membership_price,
        pv.tiered_prices,
        pv.option_combination
      FROM product_master_variants pmv
      INNER JOIN product_variants pv ON pmv.variant_id = pv.id
      WHERE pmv.master_id = ANY(${masterIds})
        AND pmv.version_id = ANY(${versionIds})
      ORDER BY pmv.master_id, pv.is_default DESC
    `;
  }

  /**
   * Query option groups for given masters (batch)
   */
  private async queryOptionGroups(
    masterIds: string[],
    versionIds: string[]
  ): Promise<OptionGroupRow[]> {
    if (masterIds.length === 0) return [];

    return await this.pimDb<OptionGroupRow[]>`
      SELECT
        pmog.master_id,
        pmog.version_id,
        pog.id AS option_group_id,
        pog.name AS option_group_name,
        pov.id AS option_value_id,
        pov.name AS option_value_name,
        pov.color_code,
        pov.image_url
      FROM product_master_option_groups pmog
      INNER JOIN product_option_groups pog ON pmog.option_group_id = pog.id
      LEFT JOIN product_option_values pov ON pov.option_group_id = pog.id
      WHERE pmog.master_id = ANY(${masterIds})
        AND pmog.version_id = ANY(${versionIds})
      ORDER BY pmog.master_id, pog.id, pov.id
    `;
  }

  /**
   * Assemble database rows into PimProductSnapshot objects
   */
  private assembleSnapshots(
    masters: MasterRow[],
    categories: CategoryRow[],
    variants: VariantRow[],
    optionGroups: OptionGroupRow[]
  ): PimProductSnapshot[] {
    return masters.map(master => {
      // Group categories by masterId
      const masterCategories = categories
        .filter(c => c.master_id === master.master_id)
        .map(c => ({
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
        .filter(v => v.master_id === master.master_id)
        .map(v => ({
          id: v.variant_id,
          variantName: v.variant_name,
          sku: v.sku ?? '',
          variantCode: v.variant_code,
          isDefault: v.is_default,
          status: v.status,
          optionCombination: v.option_combination || [],
          basePrice: Number(v.base_price),
          membershipPrice: v.membership_price ? Number(v.membership_price) : undefined,
          tieredPrices: v.tiered_prices || [],
        }));

      // Group option groups by masterId
      const masterOptions = optionGroups.filter(o => o.master_id === master.master_id);
      const groupedOptions = new Map<string, any>();

      masterOptions.forEach(opt => {
        if (!groupedOptions.has(opt.option_group_id)) {
          groupedOptions.set(opt.option_group_id, {
            id: opt.option_group_id,
            name: opt.option_group_name,
            values: []
          });
        }

        if (opt.option_value_id) {
          groupedOptions.get(opt.option_group_id).values.push({
            id: opt.option_value_id,
            name: opt.option_value_name!,
            colorCode: opt.color_code,
            imageUrl: opt.image_url,
          });
        }
      });

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
        categoryIds: masterCategories.map(c => c.id),
        variants: masterVariants,
        optionGroups: Array.from(groupedOptions.values()),
        status: master.status as any,
        isWholesaleOnly: master.is_wholesale_only,
        isMembershipOnly: master.is_membership_only,
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

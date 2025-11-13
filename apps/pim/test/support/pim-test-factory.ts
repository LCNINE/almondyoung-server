import { PimTestDatabase } from './pim-test-database';
import { 
  productMasters, 
  productCategories,
  productOptionGroups,
  productOptionValues,
  productVariants,
  variantOptionValues,
  optionValuePrices,
  variantPrices,
  salesChannels,
  channelProducts
} from '../../src/schema';
import type { 
  NewProductMaster, 
  NewProductCategory,
  NewProductOptionGroup,
  NewProductOptionValue,
  NewProductVariant
} from '../../src/types';

export class PimTestFactory {
  private static getDb() {
    return PimTestDatabase.getDb();
  }

  /**
   * 기본 Master 생성
   */
  static async createMaster(overrides: Partial<NewProductMaster> = {}) {
    const db = this.getDb();

    const defaultData: NewProductMaster = {
      name: 'Test Product',
      description: 'Test Description',
      brand: 'Test Brand',
      basePrice: 10000,
      pricingStrategy: 'option_based',
      status: 'active',
      ...overrides
    };

    const [master] = await db.insert(productMasters).values(defaultData).returning();
    return master;
  }

  /**
   * 카테고리 생성
   */
  static async createCategory(overrides: Partial<NewProductCategory> = {}) {
    const db = this.getDb();

    const defaultData: NewProductCategory = {
      name: 'Test Category',
      slug: `test-category-${Date.now()}`,
      level: 0,
      path: '',
      sortOrder: 0,
      isActive: true,
      ...overrides
    };

    const [category] = await db.insert(productCategories).values(defaultData).returning();
    return category;
  }

  /**
   * 옵션 그룹 생성
   */
  static async createOptionGroup(masterId: string, overrides: Partial<NewProductOptionGroup> = {}) {
    const db = this.getDb();

    const defaultData: NewProductOptionGroup = {
      masterId,
      name: 'test_option',
      displayName: 'Test Option',
      sortOrder: 0,
      isRequired: true,
      ...overrides
    };

    const [group] = await db.insert(productOptionGroups).values(defaultData).returning();
    return group;
  }

  /**
   * 옵션 값 생성
   */
  static async createOptionValue(optionGroupId: string, overrides: Partial<NewProductOptionValue> = {}) {
    const db = this.getDb();

    const defaultData: NewProductOptionValue = {
      optionGroupId,
      value: 'test_value',
      displayName: 'Test Value',
      sortOrder: 0,
      isActive: true,
      ...overrides
    };

    const [value] = await db.insert(productOptionValues).values(defaultData).returning();
    return value;
  }

  /**
   * Variant 생성
   */
  static async createVariant(masterId: string, overrides: Partial<NewProductVariant> = {}) {
    const db = this.getDb();

    const defaultData: NewProductVariant = {
      masterId,
      variantName: 'Test Variant',
      status: 'active',
      isDefault: false,
      displayOrder: 0,
      ...overrides
    };

    const [variant] = await db.insert(productVariants).values(defaultData).returning();
    return variant;
  }

  /**
   * Variant와 OptionValue 연결
   */
  static async linkVariantToOptionValue(variantId: string, optionValueId: string) {
    const db = this.getDb();

    const [link] = await db.insert(variantOptionValues).values({
      variantId,
      optionValueId
    }).returning();

    return link;
  }

  /**
   * 옵션별 가격 설정 (option_based 전략)
   */
  static async setOptionValuePrice(masterId: string, optionValueId: string, price: number) {
    const db = this.getDb();

    const [priceRecord] = await db.insert(optionValuePrices).values({
      masterId,
      optionValueId,
      price
    }).returning();

    return priceRecord;
  }

  /**
   * Variant별 가격 설정 (variant_based 전략)
   */
  static async setVariantPrice(variantId: string, price: number) {
    const db = this.getDb();

    const [priceRecord] = await db.insert(variantPrices).values({
      variantId,
      price
    }).returning();

    return priceRecord;
  }

  /**
   * Sales Channel 생성
   */
  static async createSalesChannel(type: string = 'medusa', name: string = 'Medusa Store') {
    const db = this.getDb();

    const [channel] = await db.insert(salesChannels).values({
      type,
      name,
      isActive: true
    }).returning();

    return channel;
  }

  /**
   * Channel Product 생성
   */
  static async createChannelProduct(masterId: string, channelId: string, overrides: any = {}) {
    const db = this.getDb();

    const [channelProduct] = await db.insert(channelProducts).values({
      masterId,
      channelId,
      isActive: true,
      ...overrides
    }).returning();

    return channelProduct;
  }

  /**
   * 완전한 상품 생성 (옵션 + variants 포함)
   * 
   * 예: 사이즈 옵션(S, M, L)과 색상 옵션(Red, Blue)이 있는 티셔츠
   */
  static async createCompleteProduct() {
    const db = this.getDb();

    // 1. Master 생성
    const master = await this.createMaster({
      name: 'Complete Test Product',
      description: 'Product with options and variants',
      basePrice: 25000,
      pricingStrategy: 'option_based'
    });

    // 2. 옵션 그룹 생성 (사이즈)
    const sizeGroup = await this.createOptionGroup(master.id, {
      name: 'size',
      displayName: '사이즈',
      sortOrder: 0
    });

    // 3. 옵션 값 생성
    const sizeS = await this.createOptionValue(sizeGroup.id, {
      value: 'S',
      displayName: 'Small',
      sortOrder: 0
    });

    const sizeM = await this.createOptionValue(sizeGroup.id, {
      value: 'M',
      displayName: 'Medium',
      sortOrder: 1
    });

    const sizeL = await this.createOptionValue(sizeGroup.id, {
      value: 'L',
      displayName: 'Large',
      sortOrder: 2
    });

    // 4. 옵션별 가격 설정
    await this.setOptionValuePrice(master.id, sizeS.id, 0);
    await this.setOptionValuePrice(master.id, sizeM.id, 0);
    await this.setOptionValuePrice(master.id, sizeL.id, 2000);

    // 5. Variants 생성
    const variantS = await this.createVariant(master.id, {
      variantName: 'Small',
      isDefault: false
    });

    const variantM = await this.createVariant(master.id, {
      variantName: 'Medium',
      isDefault: false
    });

    const variantL = await this.createVariant(master.id, {
      variantName: 'Large',
      isDefault: false
    });

    // 6. Variants와 옵션 값 연결
    await this.linkVariantToOptionValue(variantS.id, sizeS.id);
    await this.linkVariantToOptionValue(variantM.id, sizeM.id);
    await this.linkVariantToOptionValue(variantL.id, sizeL.id);

    return {
      master,
      optionGroups: [sizeGroup],
      optionValues: [sizeS, sizeM, sizeL],
      variants: [variantS, variantM, variantL]
    };
  }

  /**
   * 옵션 없는 간단한 상품 생성 (기본 variant만)
   */
  static async createSimpleProduct() {
    const master = await this.createMaster({
      name: 'Simple Product',
      description: 'Product without options',
      basePrice: 5000,
      pricingStrategy: 'option_based'
    });

    const variant = await this.createVariant(master.id, {
      variantName: null,
      isDefault: true,
      status: 'active'
    });

    return {
      master,
      variant
    };
  }
}


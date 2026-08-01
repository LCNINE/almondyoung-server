import { Injectable, NotFoundException } from '@nestjs/common';
import { DbTransaction } from '../../../catalog.types';
import type { CategoryTreeNodeDto } from '../../../core/categories/dto';
import { ProductCategoriesService } from '../../../core/categories/categories.service';
import { OptionReadLoader } from '../../../core/products/loaders/option-read.loader';
import { ProductVersionReadLoader } from '../../../core/products/loaders/product-version-read.loader';
import { PricingService } from '../../../core/pricing/pricing.service';
import { extractSimplePrices, isPricingEditable, SimplePrices } from './form-export.pricing-judge';
import { PRICING_SENTINEL } from './form-export.sheets';
import type { PrefillRow, PrefillWorkbookData } from './form-export.types';

const LOCALE = 'ko-KR';

export interface SnapshotItem {
  masterId: string;
  versionId: string;
  rowKey: string;
  pricingEditable: boolean;
}

/** 불리언 셀 표기. 2단계 파서(미착수, 스펙 §7 범위 밖)가 생기면 반드시 같은 규약을 써야 한다. */
const yn = (value: boolean | null | undefined): string => (value ? 'Y' : 'N');
const str = (value: string | number | null | undefined): string =>
  value === null || value === undefined ? '' : String(value);

interface FlatCategory {
  id: string;
  path: string;
  isActive: boolean;
}

/**
 * 카테고리 트리를 '조상>자식' **이름** 경로로 평탄화하고, id → 경로 인덱스를 같이 만든다.
 *
 * `getCategoryTree` 노드의 `path` 필드와 `ProductVersionReadLoader.getCategories()`가 돌려주는
 * `path` 는 둘 다 카테고리 **ID** 를 '/'로 이은 materialized path(`productCategories.path` 원본)
 * 다 — 사람이 읽는 문자열이 아니고, "카테고리 참조" 시트가 보여주는 이름 경로와 형식도 다르다.
 * 여기서 이름 기반 경로를 직접 만들어 레퍼런스 시트와 상품별 배정 양쪽에 **같은** 문자열을
 * 재사용한다. 두 시트가 다른 경로 문자열을 쓰면 워크북 내부에서 스스로 모순된다.
 */
function flattenCategoryTree(nodes: CategoryTreeNodeDto[]): FlatCategory[] {
  const out: FlatCategory[] = [];
  const walk = (node: CategoryTreeNodeDto, prefix: string): void => {
    const path = prefix ? `${prefix}>${node.name}` : node.name;
    out.push({ id: node.id, path, isActive: node.isActive });
    for (const child of node.children ?? []) walk(child, path);
  };
  for (const root of nodes) walk(root, '');
  return out;
}

/**
 * 판매기간을 KST 'YYYY-MM-DD HH:mm' 로 굳힌다. 파서가 받게 될 두 형식 중 하나다.
 * `toISOString()` 을 그대로 쓰면 UTC 가 되어 KST 경계 해석과 9시간 어긋난다.
 */
function formatKstDate(value: Date | null): string {
  if (!value) return '';
  const kst = new Date(value.getTime() + 9 * 60 * 60 * 1000);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${kst.getUTCFullYear()}-${pad(kst.getUTCMonth() + 1)}-${pad(kst.getUTCDate())} ` +
    `${pad(kst.getUTCHours())}:${pad(kst.getUTCMinutes())}`
  );
}

@Injectable()
export class FormExportSnapshotReader {
  constructor(
    private readonly versionLoader: ProductVersionReadLoader,
    private readonly optionLoader: OptionReadLoader,
    private readonly pricing: PricingService,
    private readonly categories: ProductCategoriesService,
  ) {}

  /**
   * masterId 목록의 현재 active 버전을 읽어 워크북 데이터와 스냅샷 항목을 만든다.
   *
   * active 버전을 못 찾는 상품(`NotFoundException`)은 **조용히 건너뛴다** — 잡 접수와
   * 조립 사이에 상품이 지워지거나 draft 만 남는 경우가 있고, 그 하나 때문에 수천 건
   * 잡이 실패하는 편이 나쁘다. 건너뛴 수는 productCount 와 요청 수의 차이로 드러난다.
   * 그 밖의 에러는 그대로 던진다 — `tx` 는 호출자가 준 하나의 트랜잭션이라, 관련 없는
   * DB 에러 하나를 여기서 삼키면 그 트랜잭션이 abort 된 채로 남고 이후 모든 masterId 가
   * 똑같이 "not found" 로 보여 잡 전체가 빈 결과로 조용히 "성공"해버린다.
   */
  async buildPrefill(
    tx: DbTransaction,
    masterIds: string[],
    exportId: string,
  ): Promise<{ data: PrefillWorkbookData; items: SnapshotItem[] }> {
    const products: PrefillRow[] = [];
    const options: PrefillRow[] = [];
    const variants: PrefillRow[] = [];
    const categories: PrefillRow[] = [];
    const constraints: PrefillRow[] = [];
    const images: PrefillRow[] = [];
    const items: SnapshotItem[] = [];

    // 카테고리 트리는 masterId 와 무관한 전역 참조 데이터라 잡당 한 번만 읽는다.
    // includeInactive=true 로 읽어 id→경로 인덱스는 완전하게 둔다(비활성화된 카테고리에
    // 이미 배정된 상품도 경로를 잃지 않도록). "카테고리 참조" 시트에 노출할 목록만
    // 활성 카테고리로 거른다 — 비활성 카테고리는 새로 고를 수 없어야 하니까.
    const tree = await this.categories.getCategoryTree(undefined, true, tx);
    const flatCategories = flattenCategoryTree(tree.categories);
    const categoryPathById = new Map(flatCategories.map((c) => [c.id, c.path]));
    const categoryPaths = flatCategories.filter((c) => c.isActive).map((c) => c.path);

    // 이미지 시트는 워크북 전체에서 하나다(rowKey 컬럼이 없다 — form-export.sheets.ts 의
    // IMAGE_COLUMNS 참조) — imageKey 는 상품별이 아니라 **워크북 전역**으로 유일해야
    // thumbnailImageKey/additionalImageKeys 참조가 자기 상품의 행을 정확히 가리킨다.
    // 루프 안에서 매번 새로 만들면 상품마다 IMG-1 부터 다시 시작해 뒤 상품이 앞 상품의
    // 키를 덮어써버린다. 여기서 한 번만 만들어 잡 전체가 공유하며, 부수효과로 여러
    // 상품이 같은 fileId 를 쓰면 같은 키 하나로 합쳐진다(의도한 동작).
    const imageKeyByFileId = new Map<string, string>();
    const imageKeyFor = (fileId: string): string => {
      const existing = imageKeyByFileId.get(fileId);
      if (existing) return existing;
      const key = `IMG-${imageKeyByFileId.size + 1}`;
      imageKeyByFileId.set(fileId, key);
      images.push({ imageKey: key, sourceValue: fileId });
      return key;
    };

    let seq = 0;
    for (const masterId of masterIds) {
      // NotFoundException(활성 버전 없음)만 건너뛴다 — 그 밖의 에러(DB 연결 끊김 등)를
      // 여기서 삼키면, tx 가 이미 aborted 인 채로 이어지는 나머지 masterId 전부가 같은
      // "not found" 로 보여 잡 전체가 조용히 빈 워크북을 내보내게 된다.
      const version = await this.versionLoader.getActiveVersion(tx, masterId).catch((err: unknown) => {
        if (err instanceof NotFoundException) return null;
        throw err;
      });
      if (!version) continue;

      seq += 1;
      const rowKey = `P-${String(seq).padStart(6, '0')}`;

      const rules = await this.pricing.getVersionRules(version.id, tx);
      const pricingEditable = isPricingEditable(rules);
      // 명시적으로 SimplePrices 를 박는다 — 안 그러면 fallback 가지의 `new Map()`이 타입
      // 파라미터 없이 추론되어 삼항 결과가 `Map<any, any>` 쪽으로 넓어지고, 아래
      // variantOverrides.get() 이 전부 `any` 로 새 eslint no-unsafe-* 에러가 난다.
      const prices: SimplePrices = pricingEditable
        ? extractSimplePrices(rules)
        : { basePrice: null, membershipPrice: null, variantOverrides: new Map() };

      // productMasterVersions.thumbnail 컬럼은 현재 쓰기 경로(ProductMastersService#updateVersion)가
      // 채우지 않는 죽은 컬럼이다 — 실제 대표이미지는 productImages 에서 isPrimary=true 행으로
      // 결정된다(ProductReadAssembler/ProductMapper 와 동일 규약). version.thumbnail 을 그대로
      // 썼다면 거의 모든 상품에서 대표이미지키가 비었을 것이다. isPrimary 로 대표/부가를
      // 나눠 부가이미지키에 대표이미지가 중복되는 것도 함께 막는다.
      const versionImages = await this.versionLoader.getImages(tx, version.id);
      const primaryImage = versionImages.find((img) => img.isPrimary) ?? null;
      const additionalImages = versionImages.filter((img) => !img.isPrimary);
      const thumbnailImageKey = primaryImage ? imageKeyFor(primaryImage.fileId) : '';
      const additionalImageKeys = additionalImages.map((img) => imageKeyFor(img.fileId)).join('|');

      products.push({
        rowKey,
        name: str(version.name),
        basePrice: pricingEditable ? str(prices.basePrice) : PRICING_SENTINEL,
        membershipPrice: pricingEditable ? str(prices.membershipPrice) : PRICING_SENTINEL,
        productCode: str(version.productCode),
        brand: str(version.brand),
        thumbnailImageKey,
        additionalImageKeys,
        description: str(version.description),
        alternativeName: str(version.alternativeName),
        material: str(version.material),
        marketPrice: str(version.marketPrice),
        supplyPrice: str(version.supplyPrice),
        productType: str(version.productType),
        fulfillmentKind: str(version.fulfillmentKind),
        salesClassification: str(version.salesClassification),
        purchaseClassification: str(version.purchaseClassification),
        ageRestriction: str(version.ageRestriction),
        minQuantity: str(version.minQuantity),
        maxQuantity: str(version.maxQuantity),
        // productMasterVersions.seller 는 실존 컬럼이다(브리프는 없을 수 있다고 봤으나 있다) — 채운다.
        seller: str(version.seller),
        isOverseas: yn(version.isOverseas),
        isVisibleToMembersOnly: yn(version.isVisibleToMembersOnly),
        hideMembershipPriceForNonMembers: yn(version.hideMembershipPriceForNonMembers),
        isWholesaleOnly: yn(version.isWholesaleOnly),
        seoTitle: str(version.seoTitle),
        seoDescription: str(version.seoDescription),
        seoKeywords: (version.seoKeywords ?? []).join('|'),
        salesStartDate: formatKstDate(version.salesStartDate),
        salesEndDate: formatKstDate(version.salesEndDate),
      });

      const groups = await this.optionLoader.getOptionGroups(tx, masterId, version.id, LOCALE);
      for (const group of groups) {
        for (const value of group.values) {
          options.push({
            rowKey,
            optionKey: group.id,
            optionName: str(group.displayName),
            optionSortOrder: str(group.sortOrder),
            optionValueKey: value.id,
            optionValueName: str(value.displayName),
            colorCode: str(value.colorCode),
            valueSortOrder: str(value.sortOrder),
          });
        }
      }

      const versionVariants = await this.versionLoader.getVariants(tx, masterId, version.id);
      for (const variant of versionVariants) {
        const optionValues = await this.optionLoader.getVariantOptionValues(tx, variant.id, version.id, LOCALE);
        const override = prices.variantOverrides.get(variant.id);
        variants.push({
          rowKey,
          // 조합 참조는 **이름이 아니라 optionValueId 결합**이다. 이름으로 쓰면 옵션값
          // displayName 을 바꾸는 순간 참조가 깨진다. 정렬해서 축 순서에 무관하게 만든다.
          //
          // 옵션이 없는 상품은 optionValues 가 빈 배열이라 combination 이 빈 문자열이
          // 된다 — VARIANT_COLUMNS 는 이 열을 required 로 표시하지만(form-export.sheets.ts),
          // 이 케이스는 예외가 아니라 계약이다: **빈 combination 은 "옵션 없는 상품의
          // 단일 기본 variant"를 뜻한다**(스펙 오너 확정). 그 상품은 애초에 옵션 축이
          // 없으니 조합을 식별할 게 없고, variantCode 하나로 행이 유일하게 식별된다.
          combination: optionValues
            .map((ov) => ov.id)
            .sort()
            .join('+'),
          combinationLabel: optionValues.map((ov) => `${ov.optionGroupName}=${ov.displayName}`).join(';'),
          basePrice: pricingEditable ? str(override?.basePrice) : PRICING_SENTINEL,
          membershipPrice: pricingEditable ? str(override?.membershipPrice) : PRICING_SENTINEL,
          variantCode: str(variant.variantCode),
        });
      }

      const versionCategories = await this.versionLoader.getCategories(tx, masterId, version.id);
      for (const category of versionCategories) {
        categories.push({
          rowKey,
          // getCategories() 의 `path` 는 카테고리 ID materialized path 다 — 위에서 만든
          // 이름 기반 인덱스로 바꾼다. 인덱스에 없으면(예: 비활성 카테고리) 빈 문자열.
          categoryPath: categoryPathById.get(category.id) ?? '',
          isPrimary: yn(category.isPrimary),
        });
      }

      const constraint = await this.versionLoader.getPurchaseConstraint(tx, masterId, version.id);
      if (constraint) {
        constraints.push({
          rowKey,
          requiresMembership: yn(constraint.requiresMembership),
          lifetimeQuantityLimit: str(constraint.lifetimeQuantityLimit),
        });
      }

      items.push({ masterId, versionId: version.id, rowKey, pricingEditable });
    }

    return {
      data: { exportId, products, options, variants, categories, constraints, images, categoryPaths },
      items,
    };
  }
}

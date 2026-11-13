import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { type AnyTx, DbService, InjectTypedDb, type TxFor } from '@app/db';
import { BadRequestError } from '@app/shared';
import type { MergedSchema } from '../../../platform/database/merged-schema';
import type { AddOptionDto, DbTransaction } from '../../catalog/catalog.types';
import type { ReplacePricingRulesDto } from '../../catalog/core/pricing/dto/pricing-rules-set.dto';
import type { ProductInfoDto } from '../../catalog/core/products/dto/masters/product-info.dto';
import { PricingService } from '../../catalog/core/pricing/pricing.service';
import { OptionReadLoader } from '../../catalog/core/products/loaders/option-read.loader';
import { ProductMastersService } from '../../catalog/core/products/services/product-masters.service';
import { ProductVariantsService } from '../../catalog/core/products/services/product-variants.service';
import { ProductVersionsService } from '../../catalog/core/products/services/product-versions.service';
import { BulkSessionComboResolver } from '../../catalog/operations/bulk-session/services/bulk-session.combos';
import { ProductMatchingService } from '../../product-matching/services/product-matching.service';
import { PrintProductSpecRepository } from '../repositories/print-product-spec.repository';
import type { JobcostVerdict } from '../wowpress/wowpress-body';
import type { WowpressLineSpec } from '../wowpress/wowpress.types';
import { PrintCatalogReader, type PrintCombo } from './print-catalog.reader';
import type { PrintKind } from './print-kind-products';

export interface PrintOptionLabels {
  paper: string;
  side: string;
  qty: string;
  // 부자재 옵션 축(거치대·큐방·명함케이스 추가). 모든 조합이 같은 축을 같은 순서로 가져야 한다
  extras?: { group: string; value: string }[];
}

export type PublishPrintCombo = PrintCombo & {
  price: number;
  memberPrice: number | null;
  optionLabels: PrintOptionLabels;
};

export interface PublishPrintProductInput {
  templateId: string;
  kind: PrintKind;
  width: number;
  height: number;
  name: string;
  description: string;
  thumbnailFileId: string;
  combos: PublishPrintCombo[];
}

export interface PublishPrintProductResult {
  masterId: string;
  created: boolean;
}

type MergedTx = TxFor<MergedSchema>;

const LOCALE = 'ko-KR';

const MAX_VARIANT_GRID = 200;

type OptionAxis = { group: string; label: (labels: PrintOptionLabels) => string };

const BASE_AXES: readonly OptionAxis[] = [
  { group: '용지', label: (labels) => labels.paper },
  { group: '면', label: (labels) => labels.side },
  { group: '수량', label: (labels) => labels.qty },
];

const extraGroups = (labels: PrintOptionLabels): string[] => (labels.extras ?? []).map((extra) => extra.group);

// 축 이름은 첫 조합에서 읽는다. 모든 조합이 같은 축을 가졌는지는 assertCombos 가 막는다
const optionAxes = (combos: PublishPrintCombo[]): OptionAxis[] => [
  ...BASE_AXES,
  ...extraGroups(combos[0].optionLabels).map((group, i) => ({
    group,
    label: (labels: PrintOptionLabels) => labels.extras?.[i]?.value ?? '',
  })),
];

const pairKey = (group: string, value: string): string => [group, value].join('\u0000');

const labelsKey = (axes: OptionAxis[], labels: PrintOptionLabels): string =>
  axes.map((axis) => axis.label(labels)).join('\u0000');

// 상품(catalog)과 발주 사양·연결표(print-order)를 한 트랜잭션에 쓰는 cross-BC seam
@Injectable()
export class PrintProductPublisher {
  constructor(
    @InjectTypedDb<MergedSchema>()
    private readonly dbService: DbService<MergedSchema>,
    private readonly reader: PrintCatalogReader,
    private readonly specs: PrintProductSpecRepository,
    private readonly masters: ProductMastersService,
    private readonly versions: ProductVersionsService,
    private readonly variants: ProductVariantsService,
    private readonly pricing: PricingService,
    private readonly optionLoader: OptionReadLoader,
    private readonly combos: BulkSessionComboResolver,
    private readonly matching: ProductMatchingService,
  ) {}

  async publish(input: PublishPrintProductInput, userId: string, tx?: AnyTx): Promise<PublishPrintProductResult> {
    // 게시 트랜잭션이 catalog 와 print-order 에 걸치므로 AnyTx 를 여기서 한 번만 좁힌다
    const mergedTx = tx as MergedTx | undefined;

    // 다시 게시하는 요청은 와우프레스를 부르기 전에 기존 상품을 돌려준다
    const existing = await this.specs.findClaimedMaster(input.templateId, mergedTx);
    if (existing) {
      return { masterId: existing, created: false };
    }

    this.assertCombos(input.combos);
    const verdicts = await this.assertPricesAboveCost(input);
    const lineSpecs = await this.buildSpecs(input);
    const productInfo = buildProductInfo(input, verdicts);

    return this.dbService.run(async (trx): Promise<PublishPrintProductResult> => {
      // 동시 게시가 PK 에서 기다리도록 상품보다 먼저 임시 masterId 로 자리를 잡고, 롤백되면 자리도 사라진다
      const claim = await this.specs.claimTemplate(input.templateId, randomUUID(), trx);
      if (!claim.claimed) {
        return { masterId: claim.masterId, created: false };
      }

      const version = await this.masters.createMaster(userId, trx);
      await this.specs.assignClaimedMaster(input.templateId, version.masterId, trx);

      // 옵션을 붙이면 기본 variant 가 지워지므로 그 매칭도 같은 트랜잭션에서 지운다
      const defaultVariants = await this.combos.resolveExisting(version.masterId, version.id, trx);
      for (const defaultVariantId of defaultVariants.values()) {
        await this.matching.handleVariantDeletion(defaultVariantId, trx);
      }

      await this.writeVersion(version.masterId, version.id, input, { lineSpecs, productInfo, removeGroupIds: [] }, userId, trx);

      await this.versions.publishVersion(version.id, userId, trx);

      return { masterId: version.masterId, created: true };
    }, mergedTx);
  }

  // 이미 게시한 템플릿을 같은 상품의 새 버전으로 다시 게시한다(부자재 옵션·상품정보 추가 등).
  // 옛 버전과 그 variant·발주 사양은 그대로 남아 이미 들어온 주문은 옛 사양으로 발주된다
  async republish(input: PublishPrintProductInput & { masterId: string }, userId: string, tx?: AnyTx): Promise<{ masterId: string; versionId: string }> {
    const mergedTx = tx as MergedTx | undefined;

    const claimed = await this.specs.findClaimedMaster(input.templateId, mergedTx);
    if (claimed && claimed !== input.masterId) {
      throw new BadRequestError('이 템플릿은 다른 상품에 연결되어 있습니다.');
    }

    this.assertCombos(input.combos);
    const verdicts = await this.assertPricesAboveCost(input);
    const lineSpecs = await this.buildSpecs(input);
    const productInfo = buildProductInfo(input, verdicts);

    return this.dbService.run(async (trx) => {
      // 자동 발주 연결 이전에 게시한 상품은 연결표에 없으므로 여기서 잇는다
      if (!claimed) {
        const claim = await this.specs.claimTemplate(input.templateId, input.masterId, trx);
        if (!claim.claimed && claim.masterId !== input.masterId) {
          throw new BadRequestError('이 템플릿은 다른 상품에 연결되어 있습니다.');
        }
      }

      const active = await this.versions.getActiveVersion(input.masterId, trx);
      const draft = await this.versions.createDraftVersion(active.id, userId, true, trx);
      const groups = await this.optionLoader.getOptionGroups(trx, input.masterId, draft.id, LOCALE);

      await this.writeVersion(
        input.masterId,
        draft.id,
        input,
        { lineSpecs, productInfo, removeGroupIds: groups.map((group) => group.id), keepIdentity: true },
        userId,
        trx,
      );
      await this.versions.publishVersion(draft.id, userId, trx);

      return { masterId: input.masterId, versionId: draft.id };
    }, mergedTx);
  }

  // 옵션을 통째로 바꾸고(옛 그룹 제거 + 새 그룹), 고른 조합의 가격과 발주 사양을 쓴다
  private async writeVersion(
    masterId: string,
    versionId: string,
    input: PublishPrintProductInput,
    // keepIdentity 면 이름·설명·대표 이미지는 지금 상품 그대로 둔다(어드민에서 고쳤을 수 있다)
    parts: { lineSpecs: WowpressLineSpec[]; productInfo: ProductInfoDto; removeGroupIds: string[]; keepIdentity?: boolean },
    userId: string,
    trx: MergedTx,
  ): Promise<void> {
    await this.masters.updateVersion(
      versionId,
      {
        ...(parts.keepIdentity
          ? {}
          : { name: input.name, description: input.description, thumbnailFileId: input.thumbnailFileId }),
        productInfo: parts.productInfo,
        optionDiff: {
          ...(parts.removeGroupIds.length > 0 ? { remove: parts.removeGroupIds } : {}),
          add: buildOptionGroups(input.combos),
        },
      },
      userId,
      trx,
    );

    const variantIds = await this.resolveVariants(masterId, versionId, input.combos, trx);
    await this.pricing.replaceVersionRules(versionId, buildPriceRules(input.combos, variantIds), trx);

    await this.specs.insertSpecs(
      variantIds.map((variantId, i) => ({
        variantId,
        spec: { ...parts.lineSpecs[i], design: { productId: masterId, widthMm: input.width, heightMm: input.height } },
      })),
      trx,
    );
  }

  private assertCombos(combos: PublishPrintCombo[]): void {
    if (combos.length === 0) {
      throw new BadRequestError('게시할 옵션 조합이 없습니다.');
    }

    const keys = new Set(combos.map((combo) => combo.key));
    if (keys.size !== combos.length) {
      throw new BadRequestError('같은 조합 키가 두 번 들어 있습니다.');
    }

    const groups = extraGroups(combos[0].optionLabels).join('\u0000');
    if (combos.some((combo) => extraGroups(combo.optionLabels).join('\u0000') !== groups)) {
      throw new BadRequestError('부자재 옵션 축이 조합마다 다릅니다.');
    }

    const axes = optionAxes(combos);
    const labels = new Set(combos.map((combo) => labelsKey(axes, combo.optionLabels)));
    if (labels.size !== combos.length) {
      throw new BadRequestError('옵션 표시가 같은 조합이 두 개 있습니다. 표시를 다르게 해 주세요.');
    }

    // variant 는 축마다 고른 값의 전체 격자로 생기므로 격자 크기를 막는다
    const gridSize = axes.reduce(
      (size, axis) => size * new Set(combos.map((combo) => axis.label(combo.optionLabels))).size,
      1,
    );
    if (gridSize > MAX_VARIANT_GRID) {
      throw new BadRequestError(`옵션 조합 격자가 ${MAX_VARIANT_GRID}개를 넘습니다(${gridSize}개).`);
    }
  }

  // 화면 검사만 믿지 않고 공급가(부가세 제외)와 다시 비교한다
  private async assertPricesAboveCost(input: PublishPrintProductInput): Promise<Map<string, JobcostVerdict>> {
    const quoted = await this.reader.quotes(input.kind, { width: input.width, height: input.height }, input.combos);
    const verdictByKey = new Map(quoted.map((q) => [q.key, q.verdict]));

    for (const combo of input.combos) {
      const verdict = verdictByKey.get(combo.key);
      if (!verdict || !verdict.ok) {
        throw new BadRequestError(`견적을 받지 못한 조합이 있습니다: ${combo.key}`);
      }

      if (combo.price <= verdict.supply) {
        throw new BadRequestError(`판매가가 원가(${verdict.supply}원) 이하인 조합이 있습니다: ${combo.key}`);
      }

      if (combo.memberPrice !== null && combo.memberPrice <= verdict.supply) {
        throw new BadRequestError(`멤버십가가 원가(${verdict.supply}원) 이하인 조합이 있습니다: ${combo.key}`);
      }
    }

    return verdictByKey;
  }

  private async buildSpecs(input: PublishPrintProductInput): Promise<WowpressLineSpec[]> {
    const specs: WowpressLineSpec[] = [];

    for (const combo of input.combos) {
      specs.push(await this.reader.specFor(input.kind, { width: input.width, height: input.height }, combo));
    }

    return specs;
  }

  // 옵션 축은 고른 값만 담지만 variant 는 전체 격자로 생기므로, 고르지 않은 조합은 판매하지 않게 끈다
  private async resolveVariants(
    masterId: string,
    versionId: string,
    combos: PublishPrintCombo[],
    tx: DbTransaction,
  ): Promise<string[]> {
    const groups = await this.optionLoader.getOptionGroups(tx, masterId, versionId, LOCALE);
    const valueIdByPair = new Map<string, string>();

    for (const group of groups) {
      for (const value of group.values) {
        valueIdByPair.set(pairKey(group.displayName, value.displayName), value.id);
      }
    }

    const variantByIdKey = await this.combos.resolveExisting(masterId, versionId, tx);

    const axes = optionAxes(combos);
    const variantIds = combos.map((combo) => {
      const valueIds = axes.map((axis) =>
        valueIdByPair.get(pairKey(axis.group, axis.label(combo.optionLabels))),
      );
      const resolved = valueIds.filter((id): id is string => id !== undefined);
      const variantId =
        resolved.length === axes.length ? variantByIdKey.get(resolved.sort().join('+')) : undefined;

      if (!variantId) {
        throw new Error(`print publish: no variant generated for combo ${combo.key}`);
      }

      return variantId;
    });

    const selected = new Set(variantIds);
    const unselected = [...variantByIdKey.values()].filter((id) => !selected.has(id));

    if (unselected.length > 0) {
      await this.variants.bulkUpdateVariantsInDraft(
        masterId,
        versionId,
        unselected.map((id) => ({ id, status: 'inactive' as const })),
        tx,
      );
    }

    return variantIds;
  }
}

function buildOptionGroups(combos: PublishPrintCombo[]): AddOptionDto[] {
  return optionAxes(combos).map((axis, groupIndex) => {
    const values = [...new Set(combos.map((combo) => axis.label(combo.optionLabels)))];

    return {
      displayName: axis.group,
      sortOrder: groupIndex,
      values: values.map((displayName, sortOrder) => ({ displayName, sortOrder })),
    };
  });
}

// 최저 판매가를 전체 기본값으로 두고 조합마다 덮어쓴다. 멤버십 전체 기본값은 모든 조합에 멤버십가가 있을 때만 둔다
function buildPriceRules(combos: PublishPrintCombo[], variantIds: string[]): ReplacePricingRulesDto {
  const basePriceRules: ReplacePricingRulesDto['basePriceRules'] = [
    {
      layer: 'base_price',
      order: 1,
      scopeType: 'all_variants',
      operationType: 'override',
      operationValue: Math.min(...combos.map((combo) => combo.price)),
    },
  ];

  combos.forEach((combo, i) => {
    basePriceRules.push({
      layer: 'base_price',
      order: i + 2,
      scopeType: 'variants',
      scopeTargetIds: [variantIds[i]],
      operationType: 'override',
      operationValue: combo.price,
    });
  });

  const memberPrices = combos.map((combo) => combo.memberPrice);
  const membershipPriceRules: ReplacePricingRulesDto['membershipPriceRules'] = [];

  if (memberPrices.every((price): price is number => price !== null)) {
    membershipPriceRules.push({
      layer: 'membership_price',
      order: 1,
      scopeType: 'all_variants',
      operationType: 'override',
      operationValue: Math.min(...memberPrices),
    });
  }

  combos.forEach((combo, i) => {
    if (combo.memberPrice === null) {
      return;
    }

    membershipPriceRules.push({
      layer: 'membership_price',
      order: membershipPriceRules.length + 1,
      scopeType: 'variants',
      scopeTargetIds: [variantIds[i]],
      operationType: 'override',
      operationValue: combo.memberPrice,
    });
  });

  return { basePriceRules, membershipPriceRules };
}

const PRODUCT_USAGE: Record<PrintKind, string> = {
  card: '시술 후 손님께 주의사항 카드로 건네요.',
  bizcard: '카운터나 지갑에 두고 손님께 건네요.',
  nail: '네일 팁을 붙여 진열하거나 손님께 보여 드려요.',
  mini: '탁상 거치대 고리를 네 모서리 구멍에 걸어 세워요.',
  pet: '거치대에 끼워 매장 앞이나 안에 세워요.',
  window: '유리창 안쪽에 붙여요.',
  menu: '세워 두거나 벽·유리에 붙여 써요.',
};

const unique = (values: string[]): string => [...new Set(values)].join(' / ');

// 상품 상세의 상품정보 표. 제조사·상품번호는 비워 둔다(사용자 결정 2026-11-13)
function buildProductInfo(input: PublishPrintProductInput, verdicts: Map<string, JobcostVerdict>): ProductInfoDto {
  const smallest = [...input.combos].sort((a, b) => a.qty - b.qty)[0];
  const verdict = verdicts.get(smallest.key);
  const weightKg = verdict?.ok ? verdict.weightKg : undefined;
  const grams = weightKg !== undefined && weightKg > 0 ? Math.max(1, Math.round(weightKg * 1000)) : undefined;

  return {
    dimensions: `${input.width}×${input.height}mm`,
    material: unique(input.combos.map((combo) => combo.optionLabels.paper)),
    capacity: unique(input.combos.map((combo) => combo.optionLabels.qty)),
    ...(grams !== undefined ? { weight: `약 ${grams.toLocaleString('ko-KR')}g (${smallest.optionLabels.qty} 기준)` } : {}),
    origin: '대한민국',
    expirationDate: '해당 없음',
    usage: PRODUCT_USAGE[input.kind],
  };
}

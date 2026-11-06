import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { type AnyTx, DbService, InjectTypedDb, type TxFor } from '@app/db';
import { BadRequestError } from '@app/shared';
import type { MergedSchema } from '../../../platform/database/merged-schema';
import type { AddOptionDto, DbTransaction } from '../../catalog/catalog.types';
import type { ReplacePricingRulesDto } from '../../catalog/core/pricing/dto/pricing-rules-set.dto';
import { PricingService } from '../../catalog/core/pricing/pricing.service';
import { OptionReadLoader } from '../../catalog/core/products/loaders/option-read.loader';
import { ProductMastersService } from '../../catalog/core/products/services/product-masters.service';
import { ProductVariantsService } from '../../catalog/core/products/services/product-variants.service';
import { ProductVersionsService } from '../../catalog/core/products/services/product-versions.service';
import { BulkSessionComboResolver } from '../../catalog/operations/bulk-session/services/bulk-session.combos';
import { PrintProductSpecRepository } from '../repositories/print-product-spec.repository';
import type { WowpressLineSpec } from '../wowpress/wowpress.types';
import { PrintCatalogReader, type PrintCombo } from './print-catalog.reader';
import type { PrintKind } from './print-kind-products';

export interface PrintOptionLabels {
  paper: string;
  side: string;
  qty: string;
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

const OPTION_AXES: readonly { group: string; label: (labels: PrintOptionLabels) => string }[] = [
  { group: '용지', label: (labels) => labels.paper },
  { group: '면', label: (labels) => labels.side },
  { group: '수량', label: (labels) => labels.qty },
];

const pairKey = (group: string, value: string): string => [group, value].join('\u0000');

const labelsKey = (labels: PrintOptionLabels): string => OPTION_AXES.map((axis) => axis.label(labels)).join('\u0000');

/**
 * 아몬드템플릿 인쇄 상품 게시. 상품(catalog)과 발주 매핑·연결표(print-order)를 한 트랜잭션에 쓰는 cross-BC seam 이라
 * DbService<MergedSchema> 를 선언한다. 가격 검증용 재견적과 사양 조회는 외부 호출이라 트랜잭션 밖에서 끝낸다.
 *
 * 템플릿 자리는 상품보다 먼저 임시 masterId 로 잡는다. 같은 템플릿의 동시 게시는 PK 에서 기다렸다가 먼저 커밋한 쪽의
 * 실제 masterId 를 보고, 먼저 잡은 쪽이 롤백되면 자리도 함께 사라져 아무것도 남지 않는다.
 */
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
  ) {}

  async publish(input: PublishPrintProductInput, userId: string, tx?: AnyTx): Promise<PublishPrintProductResult> {
    this.assertDistinctCombos(input.combos);
    await this.assertPricesAboveCost(input);
    const lineSpecs = await this.buildSpecs(input);

    // 게시 트랜잭션이 catalog 와 print-order 에 걸치므로 AnyTx 를 여기서 한 번만 좁힌다
    return this.dbService.run(
      async (trx): Promise<PublishPrintProductResult> => {
        const claim = await this.specs.claimTemplate(input.templateId, randomUUID(), trx);
        if (!claim.claimed) {
          return { masterId: claim.masterId, created: false };
        }

        const version = await this.masters.createMaster(userId, trx);
        await this.specs.assignClaimedMaster(input.templateId, version.masterId, trx);

        await this.masters.updateVersion(
          version.id,
          {
            name: input.name,
            description: input.description,
            thumbnailFileId: input.thumbnailFileId,
            optionDiff: { add: buildOptionGroups(input.combos) },
          },
          userId,
          trx,
        );

        const variantIds = await this.resolveVariants(version.masterId, version.id, input.combos, trx);
        await this.pricing.replaceVersionRules(version.id, buildPriceRules(input.combos, variantIds), trx);

        await this.specs.insertSpecs(
          variantIds.map((variantId, i) => ({
            variantId,
            spec: {
              ...lineSpecs[i],
              design: { productId: version.masterId, widthMm: input.width, heightMm: input.height },
            },
          })),
          trx,
        );

        await this.versions.publishVersion(version.id, userId, trx);

        return { masterId: version.masterId, created: true };
      },
      tx as MergedTx | undefined,
    );
  }

  private assertDistinctCombos(combos: PublishPrintCombo[]): void {
    if (combos.length === 0) {
      throw new BadRequestError('게시할 옵션 조합이 없습니다.');
    }

    const keys = new Set(combos.map((combo) => combo.key));
    if (keys.size !== combos.length) {
      throw new BadRequestError('같은 조합 키가 두 번 들어 있습니다.');
    }

    const labels = new Set(combos.map((combo) => labelsKey(combo.optionLabels)));
    if (labels.size !== combos.length) {
      throw new BadRequestError('용지·면·수량 표시가 같은 조합이 두 개 있습니다. 표시를 다르게 해 주세요.');
    }
  }

  // 화면 검사만 믿지 않고 공급가(부가세 제외)와 다시 비교한다
  private async assertPricesAboveCost(input: PublishPrintProductInput): Promise<void> {
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

    const variantIds = combos.map((combo) => {
      const valueIds = OPTION_AXES.map((axis) =>
        valueIdByPair.get(pairKey(axis.group, axis.label(combo.optionLabels))),
      );
      const resolved = valueIds.filter((id): id is string => id !== undefined);
      const variantId =
        resolved.length === OPTION_AXES.length ? variantByIdKey.get(resolved.sort().join('+')) : undefined;

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
  return OPTION_AXES.map((axis, groupIndex) => {
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

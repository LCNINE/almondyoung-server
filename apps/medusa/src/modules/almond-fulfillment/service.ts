import { AbstractFulfillmentProviderService, ContainerRegistrationKeys, MedusaError } from '@medusajs/framework/utils';
import type {
  CalculatedShippingOptionPrice,
  CreateFulfillmentResult,
  FulfillmentOption,
  Logger,
} from '@medusajs/framework/types';

import { calculateShippingFee, type ShippingFeeLine } from './calculate-shipping-fee';
import {
  DEFAULT_SHIPPING_GROUP_CODE,
  DEFAULT_SHIPPING_GROUP_DELIVERY,
  type ShippingGroupOptionData,
} from './types';

type QueryGraph = {
  graph: (config: {
    entity: string;
    fields: string[];
    filters?: Record<string, unknown>;
  }) => Promise<{ data: Array<Record<string, any>> }>;
};

type CalculateContext = {
  id?: string;
  shipping_address?: { postal_code?: string | null } | null;
  items?: Array<Record<string, any>> | null;
};

/**
 * 배송비 그룹 계산 provider.
 *
 * 이 provider 가 존재하는 이유는 하나다 — Medusa 가격규칙(flat price + price rule)은 카트 전체
 * `item_total` 만 볼 수 있어서 "이 그룹 소계가 N원 이상이면 무료" 를 표현하지 못한다.
 * calculated 옵션으로 넘어오면 카트 라인 전체를 받아 그룹별로 소계를 낼 수 있다.
 */
export class AlmondFulfillmentProviderService extends AbstractFulfillmentProviderService {
  static identifier = 'almond';

  private readonly query_?: QueryGraph;
  private readonly logger_: Logger;

  constructor(container: Record<string, unknown>) {
    super();
    // 모듈 컨테이너는 awilix cradle 프록시라 미등록 키 접근이 throw 한다.
    this.logger_ = readFromCradle<Logger>(container, ContainerRegistrationKeys.LOGGER) ?? (console as unknown as Logger);
    this.query_ = readFromCradle<QueryGraph>(container, ContainerRegistrationKeys.QUERY);

    if (!this.query_) {
      this.logger_.error(
        '[almond-fulfillment] query 가 주입되지 않았다. medusa-config.js 의 fulfillment 모듈 dependencies 를 확인할 것 — 배송비 그룹 판정이 불가능하다.',
      );
    }
  }

  async getFulfillmentOptions(): Promise<FulfillmentOption[]> {
    return [{ id: 'almond-shipping-group' }];
  }

  async validateFulfillmentData(
    _optionData: Record<string, unknown>,
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return data ?? {};
  }

  async validateOption(): Promise<boolean> {
    return true;
  }

  async canCalculate(): Promise<boolean> {
    return true;
  }

  async calculatePrice(
    optionData: Record<string, unknown>,
    _data: Record<string, unknown>,
    context: CalculateContext,
  ): Promise<CalculatedShippingOptionPrice> {
    const { policy, shippingProfileId, shippingGroupCode } = this.readOptionData(optionData);
    const lines = await this.selectGroupLines(context, shippingProfileId, shippingGroupCode);
    const amount = calculateShippingFee(policy, lines, context.shipping_address?.postal_code);

    return { calculated_amount: amount, is_calculated_price_tax_inclusive: false };
  }

  async createFulfillment(): Promise<CreateFulfillmentResult> {
    return { data: {}, labels: [] };
  }

  async cancelFulfillment(): Promise<any> {
    return {};
  }

  private readOptionData(optionData: Record<string, unknown>): ShippingGroupOptionData {
    const data = optionData as unknown as Partial<ShippingGroupOptionData>;
    if (!data?.policy || !data.shippingProfileId) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `[almond-fulfillment] shipping option 의 data 에 배송비 그룹 정책이 없다. data=${JSON.stringify(optionData)}`,
      );
    }
    return {
      policy: data.policy,
      shippingProfileId: data.shippingProfileId,
      shippingGroupCode: data.shippingGroupCode ?? DEFAULT_SHIPPING_GROUP_CODE,
      areaTemplateCode: data.areaTemplateCode,
      delivery: data.delivery ?? DEFAULT_SHIPPING_GROUP_DELIVERY,
    };
  }

  /**
   * 카트 라인 중 이 배송비 그룹에 속한 것만 고른다.
   *
   * `calculatePrice` 로 넘어오는 컨텍스트에는 라인별 shipping profile 이 없다
   * (core-flows 의 cartFieldsForCalculateShippingOptionsPrices 에 빠져 있다).
   * 상품 id 로 profile 을 한 번 조회해서 맞춘다.
   */
  private async selectGroupLines(
    context: CalculateContext,
    shippingProfileId: string,
    shippingGroupCode: string,
  ): Promise<ShippingFeeLine[]> {
    const items = (context.items ?? []).filter((item) => item?.requires_shipping !== false);
    if (items.length === 0) return [];

    const productIds = [...new Set(items.map((item) => item.product_id).filter(Boolean))] as string[];
    const profileByProductId = await this.loadShippingProfileByProductId(productIds);

    return items
      .filter((item) => profileByProductId.get(item.product_id) === shippingProfileId)
      .map((item) => ({
        subtotal: toAmount(item.subtotal ?? multiply(item.unit_price, item.quantity)),
        quantity: toAmount(item.quantity),
      }))
      .filter((line) => {
        if (Number.isFinite(line.subtotal) && Number.isFinite(line.quantity)) return true;
        this.logger_.warn(`[almond-fulfillment] 금액을 읽지 못한 라인을 건너뛴다. group=${shippingGroupCode}`);
        return false;
      });
  }

  private async loadShippingProfileByProductId(productIds: string[]): Promise<Map<string, string | undefined>> {
    const result = new Map<string, string | undefined>();
    if (productIds.length === 0) return result;

    if (!this.query_) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        '[almond-fulfillment] query 미주입으로 배송비 그룹을 판정할 수 없다.',
      );
    }

    const { data } = await this.query_.graph({
      entity: 'product',
      fields: ['id', 'shipping_profile.id'],
      filters: { id: productIds },
    });

    for (const product of data) {
      result.set(product.id, product.shipping_profile?.id);
    }
    return result;
  }
}

function readFromCradle<T>(container: Record<string, unknown>, key: string): T | undefined {
  try {
    return container[key] as T | undefined;
  } catch {
    return undefined;
  }
}

/** Medusa 금액은 number / string / BigNumber 로 섞여 온다. */
function toAmount(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value);
  if (value && typeof value === 'object') {
    const raw = (value as { numeric_?: unknown; value?: unknown }).numeric_ ?? (value as { value?: unknown }).value;
    if (raw !== undefined) return toAmount(raw);
  }
  return NaN;
}

function multiply(a: unknown, b: unknown): number {
  return toAmount(a) * toAmount(b);
}

import { Modules } from '@medusajs/framework/utils';
import { createWorkflow, transform, WorkflowResponse } from '@medusajs/framework/workflows-sdk';
import {
  acquireLockStep,
  createPriceListPricesWorkflow,
  createPriceListsWorkflow,
  createRemoteLinkStep,
  releaseLockStep,
  removePriceListPricesWorkflow,
  updatePriceListsWorkflow,
} from '@medusajs/medusa/core-flows';
import { QUANTITY_DISCOUNT_MODULE } from '../../modules/quantity-discount';
import type { QuantityDiscountSyncInput } from './rules';
import { createQuantityDiscountRowsStep, prepareQuantityDiscountSyncStep } from './steps';

/**
 * 수량 할인 쓰기 전체를 직렬화한다. 두 상품이 같은 새 기간을 동시에 발행하면 같은 리스트를 둘 다 만들려 하고,
 * 같은 상품의 동시 동기화는 같은 옛 가격 id 를 읽어 새 가격만 쌓는다(타임세일 잠금과 같은 이유). 발행은 드물다.
 */
const QUANTITY_DISCOUNT_WRITE_LOCK = { key: 'quantity-discount:write', timeout: 30, ttl: 60 };
const CURRENCY = 'krw';

const linkOf = (rowId: string, priceListId: string) => ({
  [QUANTITY_DISCOUNT_MODULE]: { quantity_discount_list_id: rowId },
  [Modules.PRICING]: { price_list_id: priceListId },
});

/**
 * 한 상품의 수량 할인 가격 교체. 필요한 리스트 보장(행 + price list + 링크) → 새 가격 만들기 → 옛 가격 지우기.
 * 지우기를 뒤에 두는 이유는 타임세일과 같다 — 중간에 가격 0행이 되는 순간이 없다. 어느 스텝이 실패해도 앞 스텝이
 * 보상으로 되감긴다.
 */
export const syncProductQuantityDiscountWorkflow = createWorkflow(
  'sync-product-quantity-discount',
  (input: { product_id: string } & QuantityDiscountSyncInput) => {
    acquireLockStep(QUANTITY_DISCOUNT_WRITE_LOCK);
    const syncInput = transform({ input }, ({ input }) => ({
      period: input.period,
      general: input.general,
      membership: input.membership,
    }));
    const { plan } = prepareQuantityDiscountSyncStep({ product_id: input.product_id, input: syncInput });

    const rows = createQuantityDiscountRowsStep(
      transform({ plan }, ({ plan }) => plan.listsToCreate.map(({ key, row }) => ({ key, row }))),
    );
    const createdLists = createPriceListsWorkflow.runAsStep({
      input: {
        price_lists_data: transform({ plan }, ({ plan }) => plan.listsToCreate.map(({ data }) => ({ ...data, prices: [] }))),
      },
    });

    const newListIdByKey = transform({ plan, createdLists, rows }, ({ plan, createdLists, rows }) => {
      const byKey: Record<string, string> = {};
      plan.listsToCreate.forEach(({ key }, i) => {
        byKey[key] = (createdLists as Array<{ id: string }>)[i].id;
      });
      const links = rows.map((row) => linkOf(row.id, byKey[row.key]));
      return { byKey, links };
    });
    createRemoteLinkStep(transform({ newListIdByKey }, ({ newListIdByKey }) => newListIdByKey.links));
    // 이번에 쓰는 기존 리스트를 기대하는 상태·기간·룰로 되돌린다(리전 추가 등). 맞으면 빈 배열이다.
    updatePriceListsWorkflow.runAsStep({
      input: { price_lists_data: transform({ plan }, ({ plan }) => plan.listUpdates) },
    });

    const resolved = transform({ plan, newListIdByKey }, ({ plan, newListIdByKey }) => {
      const listIdOf = (key: string, existing?: string) => existing ?? newListIdByKey.byKey[key];
      const existingByKey = plan.knownListIdByKey;
      const grouped = new Map<string, Array<{ variant_id: string; amount: number; min_quantity: number; currency_code: string }>>();
      for (const { key, ...price } of plan.pricesToCreate) {
        const listId = listIdOf(key, existingByKey[key]);
        const bucket = grouped.get(listId) ?? [];
        bucket.push({ ...price, currency_code: CURRENCY });
        grouped.set(listId, bucket);
      }
      return {
        pricesToCreate: [...grouped.entries()].map(([id, prices]) => ({ id, prices })),
        priceListIds: plan.resultKeys.map((key) => listIdOf(key, existingByKey[key])),
      };
    });

    createPriceListPricesWorkflow.runAsStep({
      input: { data: transform({ resolved }, ({ resolved }) => resolved.pricesToCreate) },
    });
    removePriceListPricesWorkflow.runAsStep({
      input: { ids: transform({ plan }, ({ plan }) => plan.priceIdsToDelete) },
    });

    releaseLockStep({ key: QUANTITY_DISCOUNT_WRITE_LOCK.key });
    return new WorkflowResponse(transform({ resolved }, ({ resolved }) => ({ price_list_ids: resolved.priceListIds })));
  },
);

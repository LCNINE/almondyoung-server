import type { MedusaContainer } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, MedusaError } from '@medusajs/framework/utils';
import { createStep, StepResponse } from '@medusajs/framework/workflows-sdk';
import { QUANTITY_DISCOUNT_MODULE } from '../../modules/quantity-discount';
import type QuantityDiscountModuleService from '../../modules/quantity-discount/service';
import {
  planQuantityDiscountSync,
  type PriceListState,
  type CurrentTierPrice,
  type NewListRow,
  type QuantityDiscountListRow,
  type QuantityDiscountSyncInput,
  type QuantityDiscountSyncPlan,
} from './rules';

type ListGraphRow = {
  id: string;
  audience: QuantityDiscountListRow['audience'];
  min_quantity: number;
  period_key: string;
  price_list?: { id: string } | null;
};

async function loadRows(container: MedusaContainer): Promise<QuantityDiscountListRow[]> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: 'quantity_discount_list',
    fields: ['id', 'audience', 'min_quantity', 'period_key', 'price_list.id'],
  });
  return (data as ListGraphRow[])
    .filter((row) => row.price_list?.id)
    .map((row) => ({
      audience: row.audience,
      min_quantity: row.min_quantity,
      period_key: row.period_key,
      price_list_id: row.price_list?.id ?? '',
    }));
}

/** 리스트별 상태·기간·룰. 계획이 «기대와 다른 리스트»를 고르는 재료다. */
async function loadListStates(container: MedusaContainer, listIds: string[]): Promise<Record<string, PriceListState>> {
  if (listIds.length === 0) return {};
  const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const placeholders = listIds.map(() => '?').join(',');
  const [{ rows: lists }, { rows: rules }] = await Promise.all([
    knex.raw(`select id, status, starts_at, ends_at from price_list where id in (${placeholders})`, listIds),
    knex.raw(
      `select price_list_id, attribute, value from price_list_rule where price_list_id in (${placeholders}) and deleted_at is null`,
      listIds,
    ),
  ]);
  const toIso = (v: Date | string | null) => (v === null ? null : new Date(v).toISOString());
  const states: Record<string, PriceListState> = {};
  for (const l of lists as Array<{ id: string; status: string; starts_at: Date | string | null; ends_at: Date | string | null }>) {
    states[l.id] = { status: l.status, starts_at: toIso(l.starts_at), ends_at: toIso(l.ends_at), rules: {} };
  }
  // price_list_rule.value 는 jsonb 배열이다(드라이버가 배열로 준다).
  for (const r of rules as Array<{ price_list_id: string; attribute: string; value: unknown }>) {
    const state = states[r.price_list_id];
    if (!state) continue;
    const values = Array.isArray(r.value) ? r.value.map(String) : [String(r.value)];
    state.rules[r.attribute] = [...(state.rules[r.attribute] ?? []), ...values];
  }
  return states;
}

export type QuantityDiscountSyncContext = { plan: QuantityDiscountSyncPlan };

/**
 * 쓰기 전에 현재 상태를 DB 에서 직접 읽고 계획을 세운다. 지울 가격 id 는 여기서 읽은 것뿐이라, 이번에
 * 만드는 가격이 지워질 일은 없다.
 */
export const prepareQuantityDiscountSyncStep = createStep(
  'prepare-quantity-discount-sync',
  async (data: { product_id: string; input: QuantityDiscountSyncInput }, { container }) => {
    const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
    const { rows: variantRows } = await knex.raw(
      `select pv.id as variant_id, pvps.price_set_id
         from product_variant pv
         join product_variant_price_set pvps on pvps.variant_id = pv.id and pvps.deleted_at is null
        where pv.product_id = ? and pv.deleted_at is null`,
      [data.product_id],
    );
    const variants = variantRows as Array<{ variant_id: string; price_set_id: string }>;
    if (variants.length === 0) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, `상품 ${data.product_id} 의 옵션이 없습니다.`);
    }
    const ownVariantIds = new Set(variants.map((v) => v.variant_id));
    const foreign = [...data.input.general, ...data.input.membership].filter((p) => !ownVariantIds.has(p.variant_id));
    if (foreign.length > 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `이 상품의 옵션이 아닌 가격이 있습니다: ${[...new Set(foreign.map((p) => p.variant_id))].join(', ')}`,
      );
    }

    const query = container.resolve(ContainerRegistrationKeys.QUERY);
    const [{ data: regions }, rows] = await Promise.all([
      query.graph({ entity: 'region', fields: ['id'] }),
      loadRows(container),
    ]);
    const regionIds = (regions as Array<{ id: string }>).map((r) => r.id);
    if (regionIds.length === 0 && data.input.general.length > 0) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, '리전이 없어 수량 할인 가격 규칙을 만들 수 없습니다.');
    }

    const listIds = [...new Set(rows.map((r) => r.price_list_id))];
    const listStates = await loadListStates(container, listIds);
    const priceSetIds = variants.map((v) => v.price_set_id);
    let current: CurrentTierPrice[] = [];
    if (listIds.length > 0) {
      const lists = listIds.map(() => '?').join(',');
      const sets = priceSetIds.map(() => '?').join(',');
      const { rows: priceRows } = await knex.raw(
        `select pr.id, pr.price_list_id, pvps.variant_id, pr.min_quantity, pr.amount
           from price pr
           join product_variant_price_set pvps on pvps.price_set_id = pr.price_set_id and pvps.deleted_at is null
          where pr.deleted_at is null and pr.price_list_id in (${lists}) and pr.price_set_id in (${sets})`,
        [...listIds, ...priceSetIds],
      );
      // numeric 컬럼은 pg 드라이버가 문자열로 준다.
      current = (priceRows as Array<Record<string, string | number | null>>).map((r) => ({
        id: String(r.id),
        price_list_id: String(r.price_list_id),
        variant_id: String(r.variant_id),
        min_quantity: Number(r.min_quantity ?? 0),
        amount: Number(r.amount),
      }));
    }

    try {
      const plan = planQuantityDiscountSync({
        input: data.input,
        rows,
        listStates,
        current,
        regionIds,
        membershipGroupId: process.env.MEDUSA_MEMBERSHIP_GROUP_ID?.trim() ?? '',
      });
      return new StepResponse<QuantityDiscountSyncContext>({ plan });
    } catch (error) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, error instanceof Error ? error.message : String(error));
    }
  },
);

export const createQuantityDiscountRowsStep = createStep(
  'create-quantity-discount-rows',
  async (rows: Array<{ key: string; row: NewListRow }>, { container }) => {
    if (rows.length === 0) return new StepResponse<Array<{ key: string; id: string }>, string[]>([], []);
    const service = container.resolve<QuantityDiscountModuleService>(QUANTITY_DISCOUNT_MODULE);
    const created = await service.createQuantityDiscountLists(
      rows.map(({ row }) => ({
        audience: row.audience,
        min_quantity: row.min_quantity,
        period_key: row.period_key,
        starts_at: row.starts_at ? new Date(row.starts_at) : null,
        ends_at: row.ends_at ? new Date(row.ends_at) : null,
      })),
    );
    const result = rows.map(({ key }, i) => ({ key, id: created[i].id }));
    return new StepResponse<Array<{ key: string; id: string }>, string[]>(
      result,
      result.map((r) => r.id),
    );
  },
  async (ids, { container }) => {
    if (!ids?.length) return;
    await container.resolve<QuantityDiscountModuleService>(QUANTITY_DISCOUNT_MODULE).deleteQuantityDiscountLists(ids);
  },
);

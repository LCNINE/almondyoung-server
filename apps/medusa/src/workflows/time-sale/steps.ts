import type { MedusaContainer } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, MedusaError } from '@medusajs/framework/utils';
import { createStep, StepResponse } from '@medusajs/framework/workflows-sdk';
import { TIME_SALE_MODULE } from '../../modules/time-sale';
import type TimeSaleModuleService from '../../modules/time-sale/service';
import type { TimeSaleRecord } from '../../modules/time-sale/service';
import {
  findConflictingSales,
  validateTimeSaleInput,
  type LinkedList,
  type SaleFootprint,
  type TimeSaleWriteInput,
} from './rules';

const toIso = (value: Date | string) => (value instanceof Date ? value.toISOString() : new Date(value).toISOString());

/**
 * 세일별 price list 와 그 리스트들에 걸린 variant. 겹침 검사의 재료다.
 *
 * price → variant 는 `product_variant_price_set` 링크 테이블로만 갈 수 있다 — pricing 모듈은 product 를
 * 모르고, Admin API 의 `*prices.price_set.variant` 확장은 그대로 터진다.
 */
export async function loadTimeSaleFootprints(container: MedusaContainer, excludeId?: string): Promise<SaleFootprint[]> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data: sales } = await query.graph({
    entity: 'time_sale',
    fields: ['id', 'title', 'starts_at', 'ends_at', 'status', 'price_lists.id'],
  });
  const candidates = (sales as Array<TimeSaleRecord & { price_lists: Array<{ id: string }> }>).filter(
    (sale) => sale.id !== excludeId,
  );
  const listIds = candidates.flatMap((sale) => sale.price_lists.map((p) => p.id));
  if (listIds.length === 0) return candidates.map((sale) => ({ ...toFootprint(sale), variantIds: [] }));

  const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const placeholders = listIds.map(() => '?').join(',');
  const { rows } = await knex.raw(
    `select distinct pr.price_list_id, pvps.variant_id
       from price pr
       join product_variant_price_set pvps on pvps.price_set_id = pr.price_set_id and pvps.deleted_at is null
      where pr.price_list_id in (${placeholders}) and pr.deleted_at is null`,
    listIds,
  );
  const variantsByList = new Map<string, string[]>();
  for (const row of rows as Array<{ price_list_id: string; variant_id: string }>) {
    const bucket = variantsByList.get(row.price_list_id) ?? [];
    bucket.push(row.variant_id);
    variantsByList.set(row.price_list_id, bucket);
  }

  return candidates.map((sale) => ({
    ...toFootprint(sale),
    variantIds: [...new Set(sale.price_lists.flatMap((p) => variantsByList.get(p.id) ?? []))],
  }));
}

const toFootprint = (sale: TimeSaleRecord): Omit<SaleFootprint, 'variantIds'> => ({
  id: sale.id,
  title: sale.title,
  starts_at: toIso(sale.starts_at),
  ends_at: toIso(sale.ends_at),
  status: sale.status,
});

/** 세일에 연결된 price list 와 각 리스트의 살아있는 가격 id. 멤버십 여부는 리스트 규칙으로 판정한다. */
export async function loadLinkedLists(container: MedusaContainer, timeSaleId: string): Promise<LinkedList[]> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: 'time_sale',
    fields: ['id', 'price_lists.id'],
    filters: { id: timeSaleId },
  });
  if (!data.length) throw new MedusaError(MedusaError.Types.NOT_FOUND, `타임세일 ${timeSaleId} 이 없습니다.`);
  const listIds = (data[0].price_lists as Array<{ id: string }>).map((p) => p.id);
  if (listIds.length === 0) return [];

  const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const placeholders = listIds.map(() => '?').join(',');
  const [{ rows: ruleRows }, { rows: priceRows }] = await Promise.all([
    knex.raw(
      `select distinct price_list_id from price_list_rule
        where price_list_id in (${placeholders}) and deleted_at is null and attribute = 'customer.groups.id'`,
      listIds,
    ),
    knex.raw(
      `select id, price_list_id from price where price_list_id in (${placeholders}) and deleted_at is null`,
      listIds,
    ),
  ]);
  const membership = new Set((ruleRows as Array<{ price_list_id: string }>).map((r) => r.price_list_id));
  return listIds.map((id) => ({
    id,
    isMembership: membership.has(id),
    priceIds: (priceRows as Array<{ id: string; price_list_id: string }>)
      .filter((p) => p.price_list_id === id)
      .map((p) => p.id),
  }));
}

export type TimeSaleContext = {
  regionIds: string[];
  membershipGroupId: string;
  lists: LinkedList[];
};

/**
 * 입력 검증 + 겹침 검사 + 수정에 필요한 현재 상태 로드. 쓰기 전에 한 번에 판정해, 막힐 저장이 반쯤
 * 실행되지 않게 한다.
 */
export const prepareTimeSaleStep = createStep(
  'prepare-time-sale',
  async (data: { input: TimeSaleWriteInput; id?: string }, { container }) => {
    const errors = validateTimeSaleInput(data.input);
    if (errors.length > 0) throw new MedusaError(MedusaError.Types.INVALID_DATA, errors.join(' '));

    const membershipGroupId = process.env.MEDUSA_MEMBERSHIP_GROUP_ID?.trim() ?? '';
    if (data.input.membership_prices.length > 0 && !membershipGroupId) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        '멤버십 고객그룹 id(MEDUSA_MEMBERSHIP_GROUP_ID)가 없어 멤버십 세일가를 저장할 수 없습니다.',
      );
    }

    const others = await loadTimeSaleFootprints(container, data.id);
    const conflicts = findConflictingSales(
      {
        id: data.id,
        starts_at: data.input.starts_at,
        ends_at: data.input.ends_at,
        status: data.input.status,
        variantIds: data.input.general_prices.map((p) => p.variant_id),
      },
      others,
    );
    if (conflicts.length > 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `같은 품목이 기간이 겹치는 다른 세일에 있습니다: ${conflicts
          .map((c) => `${c.title} (${c.variantIds.length}개 품목)`)
          .join(', ')}`,
      );
    }

    const query = container.resolve(ContainerRegistrationKeys.QUERY);
    const { data: regions } = await query.graph({ entity: 'region', fields: ['id'] });
    const regionIds = (regions as Array<{ id: string }>).map((r) => r.id);
    if (regionIds.length === 0) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, '리전이 없어 세일 가격 규칙을 만들 수 없습니다.');
    }

    const lists = data.id ? await loadLinkedLists(container, data.id) : [];
    // planTimeSaleUpdate 도 같은 상황에서 던지지만 평범한 Error 라 500 이 된다. rules.ts 는 Medusa 를
    // import 하지 않는 공용 모듈이라, 400 으로 바꾸는 판정은 이 경계에서 먼저 한다.
    if (data.id && !lists.some((list) => !list.isMembership)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `일반용 price list 가 연결되지 않은 타임세일입니다 (${data.id}). 복구 스크립트로 연결을 먼저 바로잡아야 합니다.`,
      );
    }
    return new StepResponse<TimeSaleContext>({ regionIds, membershipGroupId, lists });
  },
);

export const createTimeSaleRowStep = createStep(
  'create-time-sale-row',
  async (input: TimeSaleWriteInput, { container }) => {
    const service = container.resolve<TimeSaleModuleService>(TIME_SALE_MODULE);
    const row = await service.createTimeSales({
      title: input.title,
      starts_at: new Date(input.starts_at),
      ends_at: new Date(input.ends_at),
      status: input.status,
    });
    return new StepResponse({ id: row.id as string }, row.id as string);
  },
  async (id, { container }) => {
    if (!id) return;
    await container.resolve<TimeSaleModuleService>(TIME_SALE_MODULE).deleteTimeSales(id);
  },
);

export const updateTimeSaleRowStep = createStep(
  'update-time-sale-row',
  async (data: { id: string; input: TimeSaleWriteInput }, { container }) => {
    const service = container.resolve<TimeSaleModuleService>(TIME_SALE_MODULE);
    const before = (await service.retrieveTimeSale(data.id)) as TimeSaleRecord;
    await service.updateTimeSales({
      id: data.id,
      title: data.input.title,
      starts_at: new Date(data.input.starts_at),
      ends_at: new Date(data.input.ends_at),
      status: data.input.status,
    });
    return new StepResponse({ id: data.id }, before);
  },
  async (before, { container }) => {
    if (!before) return;
    // 보상 입력은 워크플로 저장소를 거치며 직렬화될 수 있다 — Date 가 ISO 문자열로 돌아온다.
    await container.resolve<TimeSaleModuleService>(TIME_SALE_MODULE).updateTimeSales({
      id: before.id,
      title: before.title,
      starts_at: new Date(before.starts_at),
      ends_at: new Date(before.ends_at),
      status: before.status,
    });
  },
);

export const softDeleteTimeSaleRowStep = createStep(
  'soft-delete-time-sale-row',
  async (id: string, { container }) => {
    await container.resolve<TimeSaleModuleService>(TIME_SALE_MODULE).softDeleteTimeSales(id);
    return new StepResponse({ id }, id);
  },
  async (id, { container }) => {
    if (!id) return;
    await container.resolve<TimeSaleModuleService>(TIME_SALE_MODULE).restoreTimeSales(id);
  },
);

export const loadLinkedListsStep = createStep(
  'load-time-sale-linked-lists',
  async (data: { id: string }, { container }) => new StepResponse(await loadLinkedLists(container, data.id)),
);

import { randomUUID } from 'node:crypto';
import type {
  CreatePriceListWorkflowInputDTO,
  MedusaContainer,
  UpdatePriceListWorkflowInputDTO,
} from '@medusajs/framework/types';
import { ContainerRegistrationKeys, MedusaError, Modules, PriceListStatus } from '@medusajs/framework/utils';
import {
  createStep,
  createWorkflow,
  StepResponse,
  transform,
  when,
  WorkflowResponse,
} from '@medusajs/framework/workflows-sdk';
import {
  acquireLockStep,
  createPriceListPricesWorkflow,
  createPriceListsWorkflow,
  deletePriceListsWorkflow,
  getExistingPriceListsPriceIdsStep,
  releaseLockStep,
  removePriceListPricesWorkflow,
  updatePriceListsStep,
  updatePriceListsWorkflow,
} from '@medusajs/medusa/core-flows';
import { isSaleId, type SaleDisplay, type SalePeriodMode } from '../../../../../packages/domain-types/time-sale';
import {
  findOverlappingTimeSales,
  listAllTimeSales,
  MEMBERSHIP_LIST_TITLE_SUFFIX,
  type TimeSaleDetail,
  type TimeSaleOverlap,
} from '../../utils/time-sale';
import {
  isPrivateTimeSale,
  loadTimeSaleSettings,
  readTimeSaleSettingsSnapshot,
  restoreTimeSaleSettings,
  saveTimeSaleSettings,
  TIME_SALE_WRITE_LOCK,
  TIME_SALE_WRITE_LOCK_TTL,
  type TimeSaleSettingsSnapshot,
} from '../../utils/time-sale-settings';

export type TimeSalePrice = {
  amount: number;
  currency_code: string;
  variant_id: string;
  rules?: Record<string, string>;
};

export type TimeSalePriceListPayload = {
  description: string;
  rules: Record<string, string[]>;
  prices: TimeSalePrice[];
};

export type TimeSaleGroup = {
  generalId: string | null;
  membershipId: string | null;
  productId: string | null;
  startsAt: string;
  endsAt: string;
};

export type SaveTimeSaleWorkflowInput = {
  saleId: string | null;
  periodMode: SalePeriodMode;
  groups: TimeSaleGroup[];
  title: string;
  general: TimeSalePriceListPayload | null;
  membership: TimeSalePriceListPayload | null;
  display: SaleDisplay;
  revision: string;
  status: 'active' | 'draft';
};

type SlotKind = 'general' | 'membership';

type SlotRef = { group: number; kind: SlotKind };

type SavePlan = {
  create: CreatePriceListWorkflowInputDTO[];
  createRefs: SlotRef[];
  update: UpdatePriceListWorkflowInputDTO[];
  replace: { id: string; prices: TimeSalePrice[] }[];
  remove: string[];
  checks: { productIds: string[]; startsAt: string; endsAt: string }[];
  excludeIds: string[];
  uncovered: boolean;
};

// 그룹들이 들고 있는 가격표 id(일반·멤버십) 전부.
const groupIds = (groups: TimeSaleGroup[]) =>
  groups.flatMap((group) => [group.generalId, group.membershipId]).filter((id): id is string => !!id);

// 겹친 세일을 이름별로 묶어 409 에 실을 안내 문구를 만든다.
const conflictMessage = (overlaps: TimeSaleOverlap[]) => {
  const byTitle = new Map<string, Set<string>>();
  for (const overlap of overlaps) {
    const bucket = byTitle.get(overlap.title) ?? new Set<string>();
    bucket.add(overlap.productId);
    byTitle.set(overlap.title, bucket);
  }

  const parts = [...byTitle].map(([title, ids]) => `${title} (상품 ${[...ids].join(', ')})`);

  return `같은 상품이 겹치는 기간에 이미 다른 세일에 걸려 있습니다: ${parts.join(', ')}`;
};

export type ResolvedTimeSaleGroups = {
  saleId: string | null;
  groups: TimeSaleGroup[];
  orphanIds: string[];
  // 저장 전 이 세일에 걸려 있던 상품(빠진 상품의 캐시도 비우려고).
  productIds: string[];
};

// 저장 요청을 기존 세일과 맞춘다: saleId·가격표 id 로 기존 세일을
// 찾고, 요청에서 빠진 가격표는 orphanIds(삭제 대상)로 돌려준다.
export function resolveTimeSaleGroups(
  input: Pick<SaveTimeSaleWorkflowInput, 'saleId' | 'groups'>,
  sales: TimeSaleDetail[],
): ResolvedTimeSaleGroups {
  const explicit = groupIds(input.groups);
  const existing = input.saleId === null ? undefined : sales.find((sale) => sale.saleId === input.saleId);
  if (input.saleId !== null && !existing)
    throw new MedusaError(MedusaError.Types.NOT_FOUND, '타임세일을 찾을 수 없습니다.');

  // 요청에 실린 가격표 id 는 고치는 세일 자기 것이어야 한다
  // (남의 가격표 기간·상태를 덮어쓰지 못하게).
  const foreign = explicit.filter((id) => !existing?.priceListIds.includes(id));
  if (foreign.length > 0)
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `이 세일의 가격표가 아닙니다: ${foreign.join(', ')}`);
  if (!existing) return { saleId: null, groups: input.groups, orphanIds: [], productIds: [] };

  const byProduct = new Map(existing.groups.map((group) => [group.productId ?? '', group]));
  const groups = input.groups.map((group) => {
    const previous = byProduct.get(group.productId ?? '');

    return {
      ...group,
      generalId: group.generalId ?? previous?.generalId ?? null,
      membershipId: group.membershipId ?? previous?.membershipId ?? null,
    };
  });

  const kept = new Set(groupIds(groups));

  return {
    saleId: existing.saleId,
    groups,
    orphanIds: existing.priceListIds.filter((id) => !kept.has(id)),
    productIds: existing.productIds,
  };
}

// 요청을 가격표 생성·수정·가격 교체·삭제 계획으로 바꾼다(DB 는
// 건드리지 않는 순수 함수). 기간 겹침 검사 대상도 여기서 모은다.
export function buildSavePlan(
  input: SaveTimeSaleWorkflowInput,
  variantProducts: Record<string, string>,
  orphanIds: string[] = [],
): SavePlan {
  const plan: SavePlan = {
    create: [],
    createRefs: [],
    update: [],
    replace: [],
    remove: [...orphanIds],
    checks: [],
    excludeIds: [...groupIds(input.groups), ...orphanIds],
    uncovered: false,
  };

  // 상품별 기간 모드: 어느 그룹에도 속하지 않는 상품의 세일가가 있으면 uncovered 로 표시한다.
  if (input.groups.every((group) => group.productId !== null)) {
    const covered = new Set(input.groups.map((group) => group.productId));
    const prices = [...(input.general?.prices ?? []), ...(input.membership?.prices ?? [])];
    plan.uncovered = prices.some((price) => !covered.has(variantProducts[price.variant_id] ?? null));
  }

  input.groups.forEach((group, index) => {
    const products = new Set<string>();
    const slots: [SlotKind, string | null, TimeSalePriceListPayload | null, string][] = [
      ['general', group.generalId, input.general, input.title],
      ['membership', group.membershipId, input.membership, `${input.title}${MEMBERSHIP_LIST_TITLE_SUFFIX}`],
    ];

    for (const [kind, id, payload, title] of slots) {
      const prices = (payload?.prices ?? [])
        .filter((price) => group.productId === null || variantProducts[price.variant_id] === group.productId)
        .map((price) => {
          const productId = variantProducts[price.variant_id];
          const disabled = input.display.productActions?.[productId]?.autoUpdate === false;

          // This rule is absent from storefront/cart pricing contexts, so OFF prices never match.
          // Medusa then resolves the existing regular or membership price without changing it.
          return disabled ? { ...price, rules: { time_sale_auto_update: 'disabled' } } : price;
        });
      for (const price of prices) {
        const productId = variantProducts[price.variant_id];
        if (productId) products.add(productId);
      }

      const period = { title, starts_at: group.startsAt, ends_at: group.endsAt, status: PriceListStatus.DRAFT };

      if (payload && prices.length > 0 && !id) {
        plan.create.push({ ...period, description: payload.description, rules: payload.rules, prices });
        plan.createRefs.push({ group: index, kind });
      } else if (payload && prices.length > 0 && id) {
        plan.update.push({ id, ...period, rules: payload.rules });
        plan.replace.push({ id, prices });
      } else if (id) {
        plan.remove.push(id);
      }
    }

    plan.checks.push({ productIds: [...products], startsAt: group.startsAt, endsAt: group.endsAt });
  });

  return plan;
}

// 쓰기 락 소유자 id. 스텝으로 분리해 워크플로 재실행 시에도 같은 값을 쓰게 한다.
export const timeSaleLockOwnerStep = createStep('time-sale-lock-owner', async () => {
  return new StepResponse(`time-sale-write:${randomUUID()}`);
});

// 스텝: 현재 저장된 세일 목록과 요청 그룹을 맞춘다.
const resolveTimeSaleGroupsStep = createStep(
  'time-sale-resolve-groups',
  async (input: Pick<SaveTimeSaleWorkflowInput, 'saleId' | 'groups'>, { container }) => {
    return new StepResponse(resolveTimeSaleGroups(input, await listAllTimeSales(container)));
  },
);

const PRIVATE_SALE_NEEDS_MEMBERSHIP = '가격 공개 제한 세일은 멤버십 세일가를 입력해야 합니다.';

const PRIVATE_SALE_NEEDS_GROUP = '멤버십 고객 그룹 설정이 없어 가격 공개 제한 세일을 저장할 수 없습니다.';

const PRIVATE_SALE_NEEDS_REGION = 'region 이 없어 가격 공개 제한 세일을 저장할 수 없습니다.';

export type TimeSalePrivacy = { isPrivate: boolean; membershipGroupId: string; regionIds: string[] };

// 스텝: 가격 공개 제한(멤버십 전용가) 세일이면 멤버십
// 그룹·region 을 확인하고, 설정이 모자라면 저장을 거절한다.
const resolveTimeSalePrivacyStep = createStep(
  'time-sale-resolve-privacy',
  async (input: Pick<SaveTimeSaleWorkflowInput, 'display' | 'membership'>, { container }) => {
    const { settings } = await loadTimeSaleSettings(container);
    const isPrivate = settings.environment.membershipPriceOnly || !!input.display.membershipPriceOnly;
    if (!isPrivate) return new StepResponse<TimeSalePrivacy>({ isPrivate, membershipGroupId: '', regionIds: [] });

    const invalid = (message: string) => new MedusaError(MedusaError.Types.INVALID_DATA, message);
    if (!input.membership?.prices.length) throw invalid(PRIVATE_SALE_NEEDS_MEMBERSHIP);

    const membershipGroupId = process.env.MEDUSA_MEMBERSHIP_GROUP_ID?.trim() ?? '';
    if (!membershipGroupId) throw invalid(PRIVATE_SALE_NEEDS_GROUP);

    const regions = await container.resolve(Modules.REGION).listRegions({}, { select: ['id'] });
    if (regions.length === 0) throw invalid(PRIVATE_SALE_NEEDS_REGION);

    return new StepResponse<TimeSalePrivacy>({
      isPrivate,
      membershipGroupId,
      regionIds: regions.map((region) => region.id),
    });
  },
);

// 공개 제한 세일은 일반 가격표를 없애고 멤버십 가격표에
// 그룹·region 규칙을 건다(비회원에겐 가격 자체가 안 나간다).
export function applyTimeSalePrivacy<T extends Pick<SaveTimeSaleWorkflowInput, 'general' | 'membership'>>(
  input: T,
  privacy: TimeSalePrivacy,
): T {
  if (!privacy.isPrivate || !input.membership) return input;

  const rules = { 'customer.groups.id': [privacy.membershipGroupId], region_id: privacy.regionIds };

  return { ...input, general: null, membership: { ...input.membership, rules } };
}

// 스텝: variant id → product id 매핑(가격표는 variant 단위, 겹침 검사는 상품 단위라서).
const mapVariantProductsStep = createStep(
  'time-sale-map-variant-products',
  async (input: { variantIds: string[] }, { container }) => {
    const empty: Record<string, string> = {};
    if (input.variantIds.length === 0) return new StepResponse(empty);

    const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
    const placeholders = input.variantIds.map(() => '?').join(',');
    const result = await knex.raw(
      `select id, product_id from product_variant where deleted_at is null and id in (${placeholders})`,
      input.variantIds,
    );
    const rows = (result.rows ?? []) as { id: string; product_id: string }[];

    return new StepResponse(Object.fromEntries(rows.map((row) => [row.id, row.product_id])));
  },
);

// 같은 상품이 겹치는 기간에 다른 세일에 있으면 409(CONFLICT)로 막는다.
const assertNoOverlap = async (
  container: MedusaContainer,
  checks: SavePlan['checks'],
  repeat: { repeatHours: number; repeatUntil: string | null },
  excludePriceListIds: string[],
) => {
  const overlaps: TimeSaleOverlap[] = [];
  for (const check of checks) {
    overlaps.push(...(await findOverlappingTimeSales(container, { ...check, ...repeat, excludePriceListIds })));
  }

  if (overlaps.length > 0) throw new MedusaError(MedusaError.Types.CONFLICT, conflictMessage(overlaps));
};

// 활성 요청이거나 OFF 로 중지돼 켤 때 되살아날 세일이면 겹침을 검사한다.
export function shouldCheckTimeSaleOverlap(
  status: SaveTimeSaleWorkflowInput['status'],
  suspended: string[],
  ownIds: string[],
) {
  return status === 'active' || suspended.some((id) => ownIds.includes(id));
}

// 스텝: 상품별 기간 누락을 막고, 활성·중지 세일만 겹침을 검사한다(초안은 겹쳐도 저장 가능).
const checkTimeSaleOverlapStep = createStep(
  'time-sale-check-overlap',
  async (
    input: { plan: SavePlan; display: SaleDisplay; status: SaveTimeSaleWorkflowInput['status'] },
    { container },
  ) => {
    if (input.plan.uncovered)
      throw new MedusaError(MedusaError.Types.INVALID_DATA, '상품별 기간이 없는 상품의 세일가가 있습니다.');
    const { settings } = await loadTimeSaleSettings(container);
    const suspended = settings.environment.suspendedPriceListIds;
    if (!shouldCheckTimeSaleOverlap(input.status, suspended, input.plan.excludeIds)) return new StepResponse(true);

    const repeat = { repeatHours: input.display.repeatHours ?? 0, repeatUntil: input.display.repeatUntil ?? null };
    await assertNoOverlap(container, input.plan.checks, repeat, input.plan.excludeIds);

    return new StepResponse(true);
  },
);

type SaveDisplayInput = {
  saleId: string | null;
  periodMode: SalePeriodMode;
  groups: TimeSaleGroup[];
  display: SaleDisplay;
  revision: string;
  status: SaveTimeSaleWorkflowInput['status'];
  replacedIds: string[];
};

// 서비스 OFF 중 저장: 이 세일의 옛 id 를 중지 목록에서 빼고, 활성 요청이거나
// 이미 중지된 세일이면 새 id 를 넣는다(켤 때 되살릴 대상). 빼는 건 상태 전환(중지)뿐이다.
export function nextSuspendedPriceListIds(
  suspended: string[],
  input: { replacedIds: string[]; groups: TimeSaleGroup[]; status: SaveTimeSaleWorkflowInput['status'] },
) {
  const own = new Set([...input.replacedIds, ...groupIds(input.groups)]);
  const kept = suspended.filter((id) => !own.has(id));
  const wasSuspended = kept.length < suspended.length;

  return input.status === 'active' || wasSuspended ? [...kept, ...groupIds(input.groups)] : kept;
}

// 스텝: 세일 표시 설정과 그룹 매핑을 설정 저장소에 쓴다.
// 이후 단계가 실패하면 보상 함수가 이전 설정으로 되돌린다.
const saveSaleDisplayStep = createStep(
  'time-sale-save-display',
  async (input: SaveDisplayInput, { container }) => {
    if (groupIds(input.groups).length === 0)
      throw new MedusaError(MedusaError.Types.INVALID_DATA, '세일가를 입력한 품목이 없습니다.');

    const key = input.saleId && isSaleId(input.saleId) ? input.saleId : randomUUID();
    const before = await readTimeSaleSettingsSnapshot(container);
    const { settings } = await loadTimeSaleSettings(container);
    const sales = { ...settings.sales };
    if (input.saleId && input.saleId !== key) delete sales[input.saleId];

    sales[key] = {
      ...input.display,
      periodMode: input.periodMode,
      groups: input.groups
        .filter((group) => group.generalId || group.membershipId)
        .map(({ generalId, membershipId, productId }) => ({ generalId, membershipId, productId })),
    };

    const { enabled } = settings.environment;
    const environment = enabled
      ? settings.environment
      : {
          ...settings.environment,
          suspendedPriceListIds: nextSuspendedPriceListIds(settings.environment.suspendedPriceListIds, input),
        };

    const saved = await saveTimeSaleSettings(container, { ...settings, environment, sales }, input.revision, {
      revalidate: false,
    });
    const snapshot: TimeSaleSettingsSnapshot = { ...before, written: saved.revision };

    return new StepResponse({ saleId: key, revision: saved.revision, enabled }, snapshot);
  },
  async (snapshot, { container }) => {
    if (!snapshot) return;
    await restoreTimeSaleSettings(container, snapshot);
  },
);

// 스텝: 저장 끝난 일반·멤버십 가격표의 제목 접미사와
// 시작 시각이 짝이 맞는지 마지막으로 확인한다.
const verifyTimeSaleGroupsStep = createStep(
  'time-sale-verify-groups',
  async (input: { groups: TimeSaleGroup[] }, { container }) => {
    const ids = groupIds(input.groups);
    const lists = await container.resolve(Modules.PRICING).listPriceLists({ id: ids });
    const byId = new Map(lists.map((list) => [list.id, list]));

    for (const group of input.groups) {
      const general = group.generalId ? byId.get(group.generalId) : undefined;
      const membership = group.membershipId ? byId.get(group.membershipId) : undefined;
      if (!general || !membership) continue;

      const sameTitle = membership.title === `${general.title}${MEMBERSHIP_LIST_TITLE_SUFFIX}`;
      const sameStart = new Date(general.starts_at ?? 0).getTime() === new Date(membership.starts_at ?? 0).getTime();
      if (!sameTitle || !sameStart)
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          '일반·멤버십 가격표의 제목이나 시작 시각이 어긋났습니다.',
        );
    }

    return new StepResponse(true);
  },
);

// 타임세일 저장 워크플로. 순서: 락 → 기존 세일 매핑 → 계획 수립 → 겹침
// 검사 → 가격표 반영 → 표시설정 저장 → 상태 반영 → 검증 → 락 해제.
export const saveTimeSaleWorkflow = createWorkflow('save-time-sale', (input: SaveTimeSaleWorkflowInput) => {
  // 1) 동시 저장 방지 락
  const ownerId = timeSaleLockOwnerStep();
  acquireLockStep({ key: TIME_SALE_WRITE_LOCK, timeout: 30, ttl: TIME_SALE_WRITE_LOCK_TTL, ownerId });

  // 2) 기존 세일과 그룹 맞추기
  const resolved = resolveTimeSaleGroupsStep({ saleId: input.saleId, groups: input.groups });

  // 3) 계획 수립(variant→상품 매핑, 공개 제한 반영) 후 4) 겹침 검사
  const variantIds = transform({ input }, ({ input }) => [
    ...new Set([...(input.general?.prices ?? []), ...(input.membership?.prices ?? [])].map((p) => p.variant_id)),
  ]);
  const variantProducts = mapVariantProductsStep({ variantIds });
  const privacy = resolveTimeSalePrivacyStep({ display: input.display, membership: input.membership });
  const plan = transform(
    { input, resolved, variantProducts, privacy },
    ({ input, resolved, variantProducts, privacy }) =>
      buildSavePlan(
        applyTimeSalePrivacy({ ...input, groups: resolved.groups }, privacy),
        variantProducts,
        resolved.orphanIds,
      ),
  );

  checkTimeSaleOverlapStep({ plan, display: input.display, status: input.status });

  // 5) 가격표 반영: 생성 → 수정 → 가격 교체(기존 가격 삭제 후 재등록) → 불필요한 가격표 삭제
  const created = createPriceListsWorkflow.runAsStep({
    input: { price_lists_data: transform({ plan }, ({ plan }) => plan.create) },
  });

  updatePriceListsWorkflow.runAsStep({
    input: { price_lists_data: transform({ plan }, ({ plan }) => plan.update) },
  });

  const existingPriceIds = getExistingPriceListsPriceIdsStep({
    price_list_ids: transform({ plan }, ({ plan }) => plan.replace.map((item) => item.id)),
  });
  removePriceListPricesWorkflow.runAsStep({
    input: {
      ids: transform({ plan, existingPriceIds }, ({ plan, existingPriceIds }) =>
        plan.replace.flatMap((item) => existingPriceIds[item.id] ?? []),
      ),
    },
  });
  createPriceListPricesWorkflow.runAsStep({
    input: { data: transform({ plan }, ({ plan }) => plan.replace) },
  });

  const removeIds = transform({ plan }, ({ plan }) => plan.remove);
  when({ removeIds }, ({ removeIds }) => removeIds.length > 0).then(() => {
    deletePriceListsWorkflow.runAsStep({ input: { ids: removeIds } });
  });

  // 6) 새로 만든 가격표 id 와 삭제된 id 를 반영해 최종 그룹을 확정
  const groups = transform({ resolved, plan, created }, ({ resolved, plan, created }) => {
    const next = resolved.groups.map((group) => ({ ...group }));
    plan.createRefs.forEach((ref, index) => {
      const id = created[index]?.id ?? null;
      if (ref.kind === 'general') next[ref.group].generalId = id;
      else next[ref.group].membershipId = id;
    });

    return next.map((group) => ({
      ...group,
      generalId: plan.remove.includes(group.generalId ?? '') ? null : group.generalId,
      membershipId: plan.remove.includes(group.membershipId ?? '') ? null : group.membershipId,
    }));
  });

  // 7) 표시 설정 저장 → 8) 활성/초안 상태 반영 → 9) 짝 검증
  const saved = saveSaleDisplayStep({
    saleId: resolved.saleId,
    periodMode: input.periodMode,
    groups,
    display: input.display,
    revision: input.revision,
    status: input.status,
    replacedIds: transform({ plan }, ({ plan }) => plan.excludeIds),
  });

  // 서비스 OFF 면 활성 요청이어도 초안으로 두고, 켤 때 되살린다(중지 목록은 7 에서 기록).
  updatePriceListsStep(
    transform({ groups, input, saved }, ({ groups, input, saved }) =>
      groupIds(groups).map((id) => ({
        id,
        status: input.status === 'active' && saved.enabled ? PriceListStatus.ACTIVE : PriceListStatus.DRAFT,
      })),
    ),
  ).config({ name: 'time-sale-apply-status' });

  verifyTimeSaleGroupsStep({ groups });

  // 10) 락 해제(가격표 쓰기가 모두 끝난 뒤)
  releaseLockStep({ key: TIME_SALE_WRITE_LOCK, ownerId });

  return new WorkflowResponse(
    transform({ groups, saved, resolved, plan }, ({ groups, saved, resolved, plan }) => ({
      saleId: saved.saleId,
      generalId: groups[0]?.generalId ?? null,
      membershipId: groups[0]?.membershipId ?? null,
      revision: saved.revision,
      productIds: [...new Set([...resolved.productIds, ...plan.checks.flatMap((check) => check.productIds)])],
    })),
  );
});

export type SetTimeSaleStatusWorkflowInput = { priceListIds: string[]; active: boolean };

export const SERVICE_OFF_MESSAGE = '서비스가 꺼져 있습니다. 환경설정에서 켠 뒤 활성화하세요.';

// 스텝: 활성화할 때 공개 제한 세일에 일반 가격표가 남았는지,
// 다른 세일과 기간이 겹치는지 검사한다(비활성화는 검사 없음).
const checkActivationOverlapStep = createStep(
  'time-sale-check-activation-overlap',
  async (input: SetTimeSaleStatusWorkflowInput, { container }) => {
    const sale = (await listAllTimeSales(container)).find((item) =>
      input.priceListIds.some((id) => item.priceListIds.includes(id)),
    );
    if (!sale) throw new MedusaError(MedusaError.Types.NOT_FOUND, '타임세일을 찾을 수 없습니다.');
    const found = { priceListIds: sale.priceListIds, productIds: sale.productIds };
    if (!input.active) return new StepResponse(found);

    // 서비스 OFF 중 활성화는 가격만 몰래 켜지므로 거절한다(켜면 OFF 직전 활성 세일이 같이 살아난다).
    const { settings } = await loadTimeSaleSettings(container);
    if (!settings.environment.enabled) throw new MedusaError(MedusaError.Types.INVALID_DATA, SERVICE_OFF_MESSAGE);

    if (isPrivateTimeSale(settings, sale.saleId) && sale.groups.some((group) => group.generalId))
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        '가격 공개 제한 세일에 일반 가격표가 남아 있습니다. 세일 화면에서 다시 저장하세요.',
      );

    const display = settings.sales[sale.saleId];
    const repeat = { repeatHours: display?.repeatHours ?? 0, repeatUntil: display?.repeatUntil ?? null };
    const checks = sale.products.flatMap((product) =>
      product.startsAt && product.endsAt
        ? [{ productIds: [product.productId], startsAt: product.startsAt, endsAt: product.endsAt }]
        : [],
    );
    await assertNoOverlap(container, checks, repeat, sale.priceListIds);

    return new StepResponse(found);
  },
);

type Snapshot = TimeSaleSettingsSnapshot | null;

// 스텝: 서비스 OFF 중 비활성화한 세일을 중지 목록에서 뺀다(켤 때 되살아나지 않게). 실패 시 설정 원복.
const unsuspendTimeSaleStep = createStep(
  'time-sale-unsuspend',
  async (input: { priceListIds: string[] }, { container }) => {
    const { settings, revision } = await loadTimeSaleSettings(container);
    const ids = new Set(input.priceListIds);
    const suspended = settings.environment.suspendedPriceListIds;
    if (!suspended.some((id) => ids.has(id))) return new StepResponse<boolean, Snapshot>(false, null);

    const before = await readTimeSaleSettingsSnapshot(container);
    const environment = { ...settings.environment, suspendedPriceListIds: suspended.filter((id) => !ids.has(id)) };
    const saved = await saveTimeSaleSettings(container, { ...settings, environment }, revision, { revalidate: false });

    return new StepResponse<boolean, Snapshot>(true, { ...before, written: saved.revision });
  },
  async (snapshot, { container }) => {
    if (!snapshot) return;
    await restoreTimeSaleSettings(container, snapshot);
  },
);

// 타임세일 활성/비활성 전환 워크플로: 락 → 겹침 검사 → 가격표 상태
// 변경 → (OFF 중 비활성화면 중지 목록 정리) → 락 해제.
export const setTimeSaleStatusWorkflow = createWorkflow(
  'set-time-sale-status',
  (input: SetTimeSaleStatusWorkflowInput) => {
    const ownerId = timeSaleLockOwnerStep();
    acquireLockStep({ key: TIME_SALE_WRITE_LOCK, timeout: 30, ttl: TIME_SALE_WRITE_LOCK_TTL, ownerId });

    const sale = checkActivationOverlapStep(input);
    const priceListIds = transform({ sale }, ({ sale }) => sale.priceListIds);

    updatePriceListsStep(
      transform({ input, priceListIds }, ({ input, priceListIds }) =>
        priceListIds.map((id) => ({
          id,
          status: input.active ? PriceListStatus.ACTIVE : PriceListStatus.DRAFT,
        })),
      ),
    ).config({ name: 'time-sale-set-status' });

    when({ input }, ({ input }) => !input.active).then(() => {
      unsuspendTimeSaleStep({ priceListIds });
    });

    releaseLockStep({ key: TIME_SALE_WRITE_LOCK, ownerId });

    return new WorkflowResponse(transform({ sale }, ({ sale }) => ({ productIds: sale.productIds })));
  },
);

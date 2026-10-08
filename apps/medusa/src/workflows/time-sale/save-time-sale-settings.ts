import type { MedusaContainer } from '@medusajs/framework/types';
import { MedusaError, Modules, PriceListStatus } from '@medusajs/framework/utils';
import {
  createStep,
  createWorkflow,
  StepResponse,
  transform,
  WorkflowResponse,
} from '@medusajs/framework/workflows-sdk';
import { acquireLockStep, releaseLockStep, updatePriceListsStep } from '@medusajs/medusa/core-flows';
import {
  MAX_SUSPENDED_PRICE_LISTS,
  nextRepeatedPeriod,
  validateTimeSaleSettings,
  type TimeSaleSettings,
} from '../../../../../packages/domain-types/time-sale';
import { listAllTimeSales, type TimeSaleDetail } from '../../utils/time-sale';
import {
  loadTimeSaleSettings,
  PRIVACY_CHANGE_MESSAGE,
  readTimeSaleSettingsSnapshot,
  restoreTimeSaleSettings,
  clearTimeSaleProductCache,
  revalidateTimeSaleCache,
  saveTimeSaleSettings,
  TIME_SALE_WRITE_LOCK,
  TIME_SALE_WRITE_LOCK_TTL,
  timeSalePrivacyConflicts,
  type TimeSaleSettingsSnapshot,
} from '../../utils/time-sale-settings';
import { timeSaleLockOwnerStep } from './save-time-sale';

type StatusUpdate = { id: string; status: PriceListStatus; starts_at?: string; ends_at?: string };

export type TimeSaleServiceTogglePlan = { settings: TimeSaleSettings; updates: StatusUpdate[]; productIds: string[] };

const TOO_MANY_ACTIVE = `활성 타임세일 가격표가 ${MAX_SUSPENDED_PRICE_LISTS}개를 넘어 서비스를 끌 수 없습니다.`;

// 저장할 설정과 가격표 상태 변경을 정한다. 중지 목록은 클라이언트 값을 무시하고 서버가 정한다.
// ON→OFF: 지금 active 인 타임세일 가격표를 기록하고 전부 draft. OFF→ON: 기록한 것만 active, 목록 비움.
export function planTimeSaleServiceToggle(
  prev: TimeSaleSettings,
  next: TimeSaleSettings,
  sales: Pick<TimeSaleDetail, 'saleId' | 'groups' | 'priceListIds' | 'productIds'>[],
  activeIds: string[],
  now = Date.now(),
): TimeSaleServiceTogglePlan {
  const keep = (suspendedPriceListIds: string[]) => ({
    ...next,
    environment: { ...next.environment, suspendedPriceListIds },
  });
  // 상태가 바뀌는 가격표에 걸린 상품(상품 응답 캐시를 비울 대상).
  const touched = (ids: string[]) => {
    const set = new Set(ids);

    return [...new Set(sales.filter((s) => s.priceListIds.some((id) => set.has(id))).flatMap((s) => s.productIds))];
  };
  const wasOn = prev.environment.enabled;
  const isOn = next.environment.enabled;

  if (wasOn === isOn) return { settings: keep(prev.environment.suspendedPriceListIds), updates: [], productIds: [] };

  if (!isOn) {
    if (activeIds.length > MAX_SUSPENDED_PRICE_LISTS)
      throw new MedusaError(MedusaError.Types.INVALID_DATA, TOO_MANY_ACTIVE);

    return {
      settings: keep(activeIds),
      updates: activeIds.map((id) => ({ id, status: PriceListStatus.DRAFT })),
      productIds: touched(activeIds),
    };
  }

  // OFF 동안 회차가 끝난 반복 세일은 다음 회차로 옮겨 켠다
  // (크론을 기다리면 지난 기간으로 1분간 켜진다).
  // 반복 종료일을 넘겨 다음 회차가 없으면 초안으로 둔다.
  const suspended = new Set(prev.environment.suspendedPriceListIds);
  const updates: StatusUpdate[] = [];
  for (const sale of sales) {
    const display = next.sales[sale.saleId];
    for (const group of sale.groups) {
      const ids = [group.generalId, group.membershipId].filter((id): id is string => !!id && suspended.has(id));
      if (ids.length === 0) continue;

      const ended = !!group.startsAt && !!group.endsAt && Date.parse(group.endsAt) <= now;
      if (!ended || !display?.repeatHours) {
        updates.push(...ids.map((id) => ({ id, status: PriceListStatus.ACTIVE })));
        continue;
      }

      const period = nextRepeatedPeriod(
        group.startsAt ?? '',
        group.endsAt ?? '',
        display.repeatHours,
        display.repeatUntil,
        now,
      );
      if (!period) continue;

      const moved = { status: PriceListStatus.ACTIVE, starts_at: period.startsAt, ends_at: period.endsAt };
      updates.push(...ids.map((id) => ({ id, ...moved })));
    }
  }

  return {
    settings: keep([]),
    updates,
    productIds: touched(updates.map((update) => update.id)),
  };
}

// 스텝: 락 안에서 이전 설정과 비교해 공개 제한 변경을 막고, ON/OFF 전환이면 상태 변경 계획을 만든다.
const planTimeSaleSettingsStep = createStep(
  'time-sale-plan-settings',
  async (input: { settings: TimeSaleSettings }, { container }) => {
    const sales = await listAllTimeSales(container);
    const { settings: prev } = await loadTimeSaleSettings(container, sales);

    const titles = timeSalePrivacyConflicts(prev, input.settings, sales);
    if (titles.length > 0)
      throw new MedusaError(MedusaError.Types.INVALID_DATA, `${PRIVACY_CHANGE_MESSAGE}: ${titles.join(', ')}`);

    const ids = sales.flatMap((sale) => sale.priceListIds);
    const lists =
      ids.length === 0
        ? []
        : await container
            .resolve(Modules.PRICING)
            .listPriceLists({ id: ids, status: [PriceListStatus.ACTIVE] }, { select: ['id'] });

    return new StepResponse(
      planTimeSaleServiceToggle(
        prev,
        input.settings,
        sales,
        lists.map((list) => list.id),
      ),
    );
  },
);

// 스텝: 설정을 쓴다. 이 쓰기가 실패하면
// 앞 단계(가격표 상태)가 보상으로 되돌아간다.
const writeTimeSaleSettingsStep = createStep(
  'time-sale-write-settings',
  async (input: { settings: TimeSaleSettings; revision: string }, { container }) => {
    const before = await readTimeSaleSettingsSnapshot(container);
    const saved = await saveTimeSaleSettings(container, input.settings, input.revision, { revalidate: false });
    const snapshot: TimeSaleSettingsSnapshot = { ...before, written: saved.revision };

    return new StepResponse(saved, snapshot);
  },
  async (snapshot, { container }) => {
    if (!snapshot) return;
    await restoreTimeSaleSettings(container, snapshot);
  },
);

// 타임세일 환경설정 저장 워크플로. 순서: 락 → 계획(공개 제한 검사·ON/OFF 판정) →
// 가격표 상태 변경 → 설정 쓰기(revision 어긋나면 409, 상태 변경은 보상으로 원복) → 락 해제.
export const saveTimeSaleSettingsWorkflow = createWorkflow(
  'save-time-sale-settings',
  (input: { settings: TimeSaleSettings; revision: string }) => {
    const ownerId = timeSaleLockOwnerStep();
    acquireLockStep({ key: TIME_SALE_WRITE_LOCK, timeout: 30, ttl: TIME_SALE_WRITE_LOCK_TTL, ownerId });

    const plan = planTimeSaleSettingsStep({ settings: input.settings });

    updatePriceListsStep(transform({ plan }, ({ plan }) => plan.updates)).config({
      name: 'time-sale-toggle-service-status',
    });

    const saved = writeTimeSaleSettingsStep({
      settings: transform({ plan }, ({ plan }) => plan.settings),
      revision: input.revision,
    });

    releaseLockStep({ key: TIME_SALE_WRITE_LOCK, ownerId });

    return new WorkflowResponse({ saved, productIds: transform({ plan }, ({ plan }) => plan.productIds) });
  },
);

// 어드민 설정 저장: 형식 검증(400) → 세일 쓰기 락 아래
// 워크플로로 저장 → 상품·스토어프론트 캐시 비우기.
export async function saveTimeSaleSettingsFromAdmin(container: MedusaContainer, settings: unknown, revision: unknown) {
  try {
    validateTimeSaleSettings(settings);
  } catch (error) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      error instanceof Error ? error.message : '설정을 확인하세요.',
    );
  }

  if (typeof revision !== 'string') {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, 'revision 은 문자열이어야 합니다.');
  }

  const { result } = await saveTimeSaleSettingsWorkflow(container).run({ input: { settings, revision } });
  await clearTimeSaleProductCache(container, result.productIds);
  await revalidateTimeSaleCache(container);

  return result.saved;
}

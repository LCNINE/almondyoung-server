/**
 * 줄 예약 설정의 순수 규칙 (#1247).
 *
 * 바깥(channel-adapter)은 «이 줄의 예약을 판매 단위 N 으로» 만 말한다. 증감이 아니라 설정이다.
 * 여기서 Medusa 의 실제 현재 예약과 비교해 만들기·고치기·지우기를 정하고, 워크플로가 그 묶음을
 * Medusa 예약 워크플로로 한 번에 쓴다 — `inventory_level.reserved_quantity` 캐시를 맞게 두는 길은
 * 그것뿐이다(SQL 로 예약 행을 지웠다가 캐시가 어긋난 이력, `scripts/sellmate/clear-reservations.ts`).
 */

export type ReservationOutcome = 'set' | 'unchanged' | 'deferred' | 'not_managed' | 'not_found' | 'error';

export type ExistingReservation = { id: string; quantity: number };

export type ManagedTarget = { inventoryItemId: string; locationId: string };

export type LineItemReservationPlan = {
  create?: { quantity: number };
  update?: { id: string; quantity: number };
  delete: string[];
  outcome: 'set' | 'unchanged' | 'deferred' | 'not_managed';
};

/**
 * 한 줄의 계획. 수량은 인벤토리 단위(예약 행의 단위)다.
 *
 * - 재고를 관리하지 않는 줄은 아무것도 쓰지 않는다(`not_managed`).
 * - 합이 목표와 같으면 행이 여럿이어도 그대로 둔다 — 쓰지 않아도 되는 쓰기는 하지 않는다.
 * - 줄이는 쓰기가 금지된 줄(`allowDecrease=false`)은 줄이지 않고 `deferred` 로 돌려준다. 판단 기준은
 *   바깥이 기억하는 값이 아니라 지금 Medusa 의 예약 합이다. 늘리는 쓰기는 금지와 상관없이 바로 한다.
 * - 행이 여럿이면 첫 행에 몰고 나머지는 지운다.
 */
export function planLineItemReservation(
  existing: ExistingReservation[],
  target: number,
  allowDecrease: boolean,
  managed: ManagedTarget | null,
): LineItemReservationPlan {
  if (!managed) return { delete: [], outcome: 'not_managed' };

  const current = sumQuantity(existing);
  if (current === target) return { delete: [], outcome: 'unchanged' };
  if (target < current && !allowDecrease) return { delete: [], outcome: 'deferred' };

  if (target === 0) return { delete: existing.map((r) => r.id), outcome: 'set' };
  if (existing.length === 0) return { create: { quantity: target }, delete: [], outcome: 'set' };

  const [first, ...rest] = existing;
  return { update: { id: first.id, quantity: target }, delete: rest.map((r) => r.id), outcome: 'set' };
}

/** 워크플로가 Medusa 에서 읽어 온 한 줄의 재료. */
export type LineItemContext = {
  lineItemId: string;
  variantId: string | null;
  /** variant 가 없거나 지워졌으면 false. */
  manageInventory: boolean;
  /** variant 의 인벤토리 항목(링크). 우리 Medusa 에선 variant 당 하나다. */
  inventoryItems: Array<{ inventoryItemId: string; requiredQuantity: number }>;
  /** 주문 판매채널에 걸린 재고 위치. 투영은 하나만 쓴다. */
  locationIds: string[];
  /** 이 줄의 살아 있는 예약, 만든 순서. 수량은 인벤토리 단위. */
  existing: ExistingReservation[];
};

export type ManagedResolution =
  | { kind: 'managed'; managed: ManagedTarget; requiredQuantity: number }
  | { kind: 'not_managed' }
  | { kind: 'error'; message: string };

/**
 * 이 줄을 Medusa 가 재고로 관리하는가, 관리한다면 어느 항목·위치인가.
 *
 * variant 가 없는 줄(교환 대체 줄은 일부러 variant 를 붙이지 않는다 —
 * `src/workflows/orders/returns/exchange-replacements.ts`)·`manage_inventory=false`·항목 없음은 `not_managed`:
 * 고칠 줄도 실패도 아니다. 항목이 여럿이거나 위치가 하나가 아니면 어디에 잡을지 정할 수 없어 `error` 다 —
 * 조용히 하나를 고르면 엉뚱한 재고를 묶는다.
 */
export function resolveManaged(context: LineItemContext): ManagedResolution {
  if (!context.variantId || !context.manageInventory || context.inventoryItems.length === 0) {
    return { kind: 'not_managed' };
  }
  if (context.inventoryItems.length > 1) {
    return {
      kind: 'error',
      message: `variant ${context.variantId} 에 인벤토리 항목이 ${context.inventoryItems.length}개다 — 하나여야 한다`,
    };
  }
  if (context.locationIds.length !== 1) {
    return {
      kind: 'error',
      message: `주문 판매채널의 재고 위치가 ${context.locationIds.length}개다 — 하나여야 한다`,
    };
  }
  const [item] = context.inventoryItems;
  return {
    kind: 'managed',
    managed: { inventoryItemId: item.inventoryItemId, locationId: context.locationIds[0] },
    requiredQuantity: item.requiredQuantity > 0 ? item.requiredQuantity : 1,
  };
}

export type LineItemReservationRequest = { line_item_id: string; quantity: number; allow_decrease: boolean };

export type LineItemReservationResult = {
  line_item_id: string;
  outcome: ReservationOutcome;
  /** 판매 단위. */
  quantity_before: number;
  /** 판매 단위. 쓰지 않은 줄은 quantity_before 와 같다. */
  quantity_after: number;
  message?: string;
};

export type ReservationCreateInput = {
  line_item_id: string;
  inventory_item_id: string;
  location_id: string;
  quantity: number;
  allow_backorder: true;
  description: string;
  metadata: Record<string, unknown>;
};

export type ReservationUpdateInput = { id: string; quantity: number; allow_backorder: true };

export type ReservationBatchPlan = {
  results: LineItemReservationResult[];
  creates: ReservationCreateInput[];
  updates: ReservationUpdateInput[];
  deletes: string[];
};

export const stockedKey = (inventoryItemId: string, locationId: string) => `${inventoryItemId}:${locationId}`;

export const RESERVATION_SOURCE = 'core-line-reservation-projection';

/**
 * 묶음 전체의 계획. 줄마다 결과를 내고 쓰기는 한 묶음으로 모은다.
 *
 * Medusa 가 쓰기 도중에 거절할 수 있는 것은 여기서 먼저 걸러 그 줄만 `error` 로 둔다 — 쓰기는 한 워크플로라
 * 한 줄이 터지면 묶음 전체가 되감기기 때문이다.
 * - 만들 위치에 인벤토리 레벨이 없음 → Medusa 는 `not stocked at location` 으로 거절한다.
 * - 가용 재고 부족 → `allow_backorder: true` 로 넘긴다. 예약을 늘리는 쓰기는 판매가능수량 이벤트보다 먼저
 *   닿을 수 있고(늘리는 쪽은 기다리지 않는다), 그때 Medusa 가용이 모자라 거절되면 예약이 덜 잡힌 채
 *   남아 오버셀 쪽으로 어긋난다. 가용이 음수가 되는 쪽(잠깐 이중 차감)이 반목표에 맞는 방향이다.
 *   이 플래그는 예약 행에 남지만 Medusa 에서 쓰는 곳은 같은 예약의 다음 수정 때 가용 검사를 건너뛰는 것뿐이다.
 */
export function planReservationBatch(
  requests: LineItemReservationRequest[],
  contexts: Map<string, LineItemContext>,
  stocked: Set<string>,
): ReservationBatchPlan {
  const plan: ReservationBatchPlan = { results: [], creates: [], updates: [], deletes: [] };

  for (const request of requests) {
    const context = contexts.get(request.line_item_id);
    if (!context) {
      plan.results.push(unwritten(request.line_item_id, 'not_found', 0));
      continue;
    }

    const resolved = resolveManaged(context);
    if (resolved.kind === 'not_managed') {
      plan.results.push(unwritten(request.line_item_id, 'not_managed', sumQuantity(context.existing)));
      continue;
    }
    if (resolved.kind === 'error') {
      plan.results.push(unwritten(request.line_item_id, 'error', sumQuantity(context.existing), resolved.message));
      continue;
    }

    const { managed, requiredQuantity } = resolved;
    const before = sumQuantity(context.existing) / requiredQuantity;
    const line = planLineItemReservation(
      context.existing,
      request.quantity * requiredQuantity,
      request.allow_decrease,
      managed,
    );

    if (line.outcome !== 'set') {
      plan.results.push(unwritten(request.line_item_id, line.outcome, before));
      continue;
    }

    if (line.create && !stocked.has(stockedKey(managed.inventoryItemId, managed.locationId))) {
      plan.results.push(
        unwritten(
          request.line_item_id,
          'error',
          before,
          `인벤토리 항목 ${managed.inventoryItemId} 이 위치 ${managed.locationId} 에 레벨이 없다`,
        ),
      );
      continue;
    }

    if (line.create) {
      plan.creates.push({
        line_item_id: request.line_item_id,
        inventory_item_id: managed.inventoryItemId,
        location_id: managed.locationId,
        quantity: line.create.quantity,
        allow_backorder: true,
        description: 'core 판매주문 줄 상태 투영',
        metadata: { source: RESERVATION_SOURCE },
      });
    }
    if (line.update) plan.updates.push({ ...line.update, allow_backorder: true });
    plan.deletes.push(...line.delete);
    plan.results.push({
      line_item_id: request.line_item_id,
      outcome: 'set',
      quantity_before: before,
      quantity_after: request.quantity,
    });
  }

  return plan;
}

/**
 * 묶음 쓰기가 되감긴 뒤의 줄별 결과. `replan` 은 되감긴 뒤 다시 읽은 계획이다.
 *
 * 쓰기가 계획됐던 줄(`set`)만 `error` 다 — 그 줄은 쓰이지 않았으므로 수량은 다시 읽은 지금 값(before = after)이다.
 * 나머지 줄(`unchanged`·`deferred`·`not_managed`·`not_found`·`error`)은 원래 쓰기가 없었으니 다시 읽은 결과 그대로다.
 * 모든 줄을 `error`·0 으로 덮으면 고칠 필요 없는 줄까지 실패로 세고, 0 이 «Medusa 가 0 을 잡고 있다»와 구별되지 않는다.
 */
export function resultsAfterWriteFailure(replan: ReservationBatchPlan, message: string): LineItemReservationResult[] {
  return replan.results.map((result) =>
    result.outcome === 'set'
      ? { ...result, outcome: 'error' as const, quantity_after: result.quantity_before, message }
      : result,
  );
}

function unwritten(
  lineItemId: string,
  outcome: ReservationOutcome,
  before: number,
  message?: string,
): LineItemReservationResult {
  return {
    line_item_id: lineItemId,
    outcome,
    quantity_before: before,
    quantity_after: before,
    ...(message ? { message } : {}),
  };
}

function sumQuantity(rows: ExistingReservation[]): number {
  return rows.reduce((sum, row) => sum + row.quantity, 0);
}

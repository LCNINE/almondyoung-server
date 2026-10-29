import type { ReturnRequestOutcome } from "@/lib/api/medusa/return-outcome"
import type { ReturnRequestInput, ReturnableLine } from "@/lib/types/ui/returns"
import { CUSTOMER_RETURN_REASONS } from "./return-reasons"

/** 한 폼이 반품과 교환을 함께 그린다(N10). */
export type ReturnFormMode = "return" | "exchange"

export type ReturnFormLine = {
  itemId: string
  title: string
  variantTitle: string | null
  thumbnail: string | null
  orderedQuantity: number
  returnable: number
  windowEndsAt: string | null
  /** 같은 품목으로 교환할 수 있는가(인쇄 줄은 false) — 교환 모드에서만 막는다. */
  exchangeable: boolean
  blocked: "none" | "nothing_left" | "not_exchangeable" | "window_closed"
}

/**
 * 주문 품목에 returnable 을 붙인다. returnable 에 없는 품목은 0(nothing_left), 기한이 지났으면 수량이 있어도 window_closed.
 * 교환 모드는 그 사이에 not_exchangeable 을 둔다 — 순서 nothing_left → not_exchangeable → window_closed.
 */
export function buildReturnFormLines(
  items: Array<{ id: string; title: string; variantTitle: string | null; thumbnail: string | null; quantity: number }>,
  returnable: ReturnableLine[],
  now: Date,
  mode: ReturnFormMode,
): ReturnFormLine[] {
  const byItem = new Map(returnable.map((r) => [r.itemId, r]))
  return items.map((item) => {
    const r = byItem.get(item.id)
    const left = r?.returnableQuantity ?? 0
    const windowEndsAt = r?.windowEndsAt ?? null
    const exchangeable = r?.exchangeable ?? false
    let blocked: ReturnFormLine["blocked"] = "none"
    if (left <= 0) blocked = "nothing_left"
    else if (mode === "exchange" && !exchangeable) blocked = "not_exchangeable"
    else if (windowEndsAt !== null && new Date(windowEndsAt).getTime() < now.getTime()) blocked = "window_closed"
    return {
      itemId: item.id,
      title: item.title,
      variantTitle: item.variantTitle,
      thumbnail: item.thumbnail,
      orderedQuantity: item.quantity,
      returnable: Math.max(left, 0),
      windowEndsAt,
      exchangeable,
      blocked,
    }
  })
}

export type ReturnSelection = Record<string, number>

export function initialSelection(lines: ReturnFormLine[], preselectItemId: string | undefined): ReturnSelection {
  const line = preselectItemId ? lines.find((l) => l.itemId === preselectItemId) : undefined
  return line && line.blocked === "none" ? { [line.itemId]: 1 } : {}
}

export function toggleLine(sel: ReturnSelection, line: ReturnFormLine): ReturnSelection {
  if (line.blocked !== "none") return sel
  if (line.itemId in sel) {
    const { [line.itemId]: _removed, ...rest } = sel
    return rest
  }
  return { ...sel, [line.itemId]: 1 }
}

/** 수량을 1~returnable 로 자른다. 막힌 줄은 그대로. */
export function setLineQuantity(sel: ReturnSelection, line: ReturnFormLine, qty: number): ReturnSelection {
  if (line.blocked !== "none") return sel
  const clamped = Math.min(Math.max(Math.trunc(Number.isFinite(qty) ? qty : 1), 1), line.returnable)
  return { ...sel, [line.itemId]: clamped }
}

export function validateReturnForm(sel: ReturnSelection, reason: string): "select_item" | "select_reason" | null {
  if (Object.keys(sel).length === 0) return "select_item"
  if (!reason) return "select_reason"
  return null
}

/** 고를 수 있는 사유 칩. 교환은 판매자 잘못일 때만 되므로 부담 주체 seller 인 사유만. */
export function reasonsFor(mode: ReturnFormMode): typeof CUSTOMER_RETURN_REASONS {
  return mode === "exchange" ? CUSTOMER_RETURN_REASONS.filter((r) => r.feeBearer === "seller") : CUSTOMER_RETURN_REASONS
}

/** 사유가 정한 택배비 부담 주체. 고객이 고를 수 없는 사유·빈 값은 null. 교환은 언제나 seller. */
export function feeNotice(reason: string, mode: ReturnFormMode): "customer" | "seller" | null {
  if (mode === "exchange") return "seller"
  return CUSTOMER_RETURN_REASONS.find((r) => r.value === reason)?.feeBearer ?? null
}

/** 모드마다 문구가 갈리는 키. 교환은 `exchange.<key>`. */
export type ReturnFormCopyKey =
  | "title"
  | "empty"
  | "linesTitle"
  | "reasonTitle"
  | "submit"
  | "selectItem"
  | "selectReason"
  | "done"

/** 문구 키(네임스페이스 `mypage.order.returnRequest` 기준). */
export function copyKey(mode: ReturnFormMode, key: ReturnFormCopyKey): string {
  return mode === "exchange" ? `exchange.${key}` : key
}

export type SubmitState = { requestId: string; locked: ReturnRequestInput | null; conflict: boolean }

/**
 * 제출 결과로 다음 상태를 정한다.
 * - unknown: 만들어졌는지 모른다 → 보낸 본문을 잠그고 같은 id 로 다시 보낸다.
 * - request_id_conflict: 끝 상태 — 새 id 는 두 번째 반품이 된다. id 와 잠금은 그대로, conflict 만 켠다.
 * - 그 밖의 확정 답(rejected·unavailable·not_found·canceled_replay): 새 id, 잠금 풀림.
 * - requested: 화면이 완료로 넘어간다 — 상태는 그대로.
 */
export function nextSubmitState(
  state: SubmitState,
  sent: ReturnRequestInput,
  outcome: ReturnRequestOutcome,
  newId: () => string,
): SubmitState {
  switch (outcome.kind) {
    case "requested":
      return state
    case "unknown":
      return { requestId: state.requestId, locked: sent, conflict: false }
    case "rejected":
      if (outcome.reason === "request_id_conflict") return { ...state, conflict: true }
      return { requestId: newId(), locked: null, conflict: false }
    default:
      return { requestId: newId(), locked: null, conflict: false }
  }
}

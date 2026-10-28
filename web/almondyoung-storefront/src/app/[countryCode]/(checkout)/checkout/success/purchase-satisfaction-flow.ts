import type {
  PurchaseSatisfaction,
  PurchaseSatisfactionInput,
} from "@/lib/api/medusa/purchase-satisfaction"

export const MEMO_MAX = 300

export const REASON_CODES = [
  "ADDRESS_INPUT",
  "COUPON_DISCOUNT",
  "CASH_RECEIPT",
  "PAYMENT_METHOD",
  "PAYMENT_ERROR",
  "PRODUCT_SEARCH",
  "OTHER",
] as const

export type SatisfactionStep = "rate" | "detail" | "thanks"

export type SatisfactionState = {
  step: SatisfactionStep
  rating: number
  saving: boolean
  failed: boolean
  reasons: string[]
  memo: string
}

type Deps = {
  orderId: string
  initial: PurchaseSatisfaction | null
  save: (
    orderId: string,
    input: PurchaseSatisfactionInput
  ) => Promise<PurchaseSatisfaction>
  track: (name: string, params: Record<string, unknown>) => void
}

export function createSatisfactionFlow({ orderId, initial, save, track }: Deps) {
  let state: SatisfactionState = {
    step: initial ? "thanks" : "rate",
    rating: initial?.rating ?? 0,
    saving: false,
    failed: false,
    reasons: [],
    memo: "",
  }
  const listeners = new Set<() => void>()

  const set = (patch: Partial<SatisfactionState>) => {
    state = { ...state, ...patch }
    listeners.forEach((l) => l())
  }

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    canSubmit: () => state.reasons.length > 0 || state.memo.trim() !== "",

    async selectRating(rating: number) {
      if (state.saving) return
      set({ rating, saving: true, failed: false })
      try {
        await save(orderId, { rating })
      } catch {
        set({ step: "rate", rating: 0, saving: false, failed: true })
        return
      }
      track("purchase_satisfaction", { rating })
      set({
        step: rating >= 4 ? "thanks" : "detail",
        saving: false,
        reasons: [],
        memo: "",
      })
    },

    toggleReason(code: string) {
      if (state.saving) return
      set({
        reasons: state.reasons.includes(code)
          ? state.reasons.filter((c) => c !== code)
          : [...state.reasons, code],
      })
    },

    setMemo(memo: string) {
      if (state.saving) return
      set({ memo: memo.slice(0, MEMO_MAX) })
    },

    async submitDetail() {
      if (state.saving || !this.canSubmit()) return
      const memo = state.memo.trim()
      const reasons = state.reasons
      const input: PurchaseSatisfactionInput = {
        rating: state.rating,
        reasons,
        ...(memo ? { memo } : {}),
      }
      set({ saving: true, failed: false })
      try {
        await save(orderId, input)
      } catch {
        set({ saving: false, failed: true })
        return
      }
      track("purchase_satisfaction_detail", {
        reasons_count: reasons.length,
      })
      set({ step: "thanks", saving: false })
    },

    skip() {
      set({ step: "thanks", failed: false })
    },

    changeRating() {
      set({ step: "rate", failed: false, reasons: [], memo: "" })
    },
  }
}

export type SatisfactionFlow = ReturnType<typeof createSatisfactionFlow>

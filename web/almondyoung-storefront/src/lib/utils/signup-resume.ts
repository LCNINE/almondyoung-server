/**
 * 「계좌만 등록하고 멤버십 가입은 안 된」 고객을 가려낸다.
 *
 * 멤버십 정기결제 가입은 자동이체 계좌 등록(다른 화면)을 다녀와야 끝나는데, 등록만 하고 떠나면 계좌는
 * 은행 심사에 들어가 있는데 가입(계약)은 없다. 이런 고객에게 「등록한 계좌로 가입 마무리하기」를 보인다.
 *
 * 스토어프론트 경로 별칭을 쓰지 않는다 — vitest 에 별칭이 없어 순수 함수로 두고 테스트한다.
 */

export type SignupResumeMethod = {
  id: string
  providerType: string
  status: string
  displayName: string | null
  createdAt: string
  cmsMemberStatus?: string | null
}

export type SignupResumeAgreement = {
  subscriberType: string
  status: string
}

export type SignupResumeTarget =
  | { kind: "none" }
  | {
      kind: "resume"
      billingMethodId: string
      displayName: string | null
      /** 은행 심사 중인 계좌인가(가입은 되지만 첫 출금은 승인 뒤). */
      pendingMandate: boolean
    }

export function decideSignupResume(input: {
  hasCurrentSubscription: boolean
  methods: SignupResumeMethod[]
  agreements: SignupResumeAgreement[]
  /** 심사 중 계좌로도 가입을 받는가(선적용 정기결제). 꺼져 있으면 승인된 계좌만 후보다. */
  pendingMandateAllowed: boolean
}): SignupResumeTarget {
  // 1회결제 가입자는 약정이 없으므로 약정만 보면 이미 가입한 사람을 잡는다 — 구독을 먼저 본다.
  if (input.hasCurrentSubscription) return { kind: "none" }
  if (
    input.agreements.some(
      (a) => a.subscriberType === "MEMBERSHIP" && a.status === "ACTIVE"
    )
  ) {
    return { kind: "none" }
  }

  const candidates = input.methods
    .filter(
      (m) =>
        m.providerType === "CMS_BATCH" &&
        m.status === "ACTIVE" &&
        (m.cmsMemberStatus !== "PENDING" || input.pendingMandateAllowed)
    )
    // 승인된 계좌가 먼저, 같으면 최근에 등록한 것.
    .sort((a, b) => {
      const pa = a.cmsMemberStatus === "PENDING" ? 1 : 0
      const pb = b.cmsMemberStatus === "PENDING" ? 1 : 0
      if (pa !== pb) return pa - pb
      return b.createdAt.localeCompare(a.createdAt)
    })

  const target = candidates[0]
  if (!target) return { kind: "none" }
  return {
    kind: "resume",
    billingMethodId: target.id,
    displayName: target.displayName,
    pendingMandate: target.cmsMemberStatus === "PENDING",
  }
}

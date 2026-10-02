import { describe, expect, it } from "vitest"
import { decideSignupResume, type SignupResumeMethod } from "./signup-resume"

const cms = (over: Partial<SignupResumeMethod> = {}): SignupResumeMethod => ({
  id: "bm-1",
  providerType: "CMS_BATCH",
  status: "ACTIVE",
  displayName: "국민 ••1234",
  createdAt: "2026-09-20T00:00:00.000Z",
  cmsMemberStatus: "PENDING",
  ...over,
})

const base = {
  hasCurrentSubscription: false,
  agreements: [],
  pendingMandateAllowed: true,
}

describe("decideSignupResume", () => {
  it("offers to finish the signup with an account that is still under bank review", () => {
    expect(decideSignupResume({ ...base, methods: [cms()] })).toEqual({
      kind: "resume",
      billingMethodId: "bm-1",
      displayName: "국민 ••1234",
      pendingMandate: true,
    })
  })

  it("also offers it once the account is approved but no membership was started", () => {
    const r = decideSignupResume({
      ...base,
      methods: [cms({ cmsMemberStatus: "REGISTERED" })],
    })
    expect(r).toMatchObject({ kind: "resume", pendingMandate: false })
  })

  it("stays quiet for current members, including one-time members who have no agreement", () => {
    expect(
      decideSignupResume({
        ...base,
        hasCurrentSubscription: true,
        methods: [cms()],
      })
    ).toEqual({ kind: "none" })
  })

  it("stays quiet when a membership agreement is already active", () => {
    expect(
      decideSignupResume({
        ...base,
        methods: [cms()],
        agreements: [{ subscriberType: "MEMBERSHIP", status: "ACTIVE" }],
      })
    ).toEqual({ kind: "none" })
  })

  it("ignores accounts that cannot be used and non-CMS methods", () => {
    expect(
      decideSignupResume({
        ...base,
        methods: [
          cms({ status: "REVOKED" }),
          cms({
            id: "card",
            providerType: "TOSS_BILLING",
            cmsMemberStatus: null,
          }),
        ],
      })
    ).toEqual({ kind: "none" })
  })

  it("does not offer a pending account when pending signups are not accepted", () => {
    expect(
      decideSignupResume({
        ...base,
        pendingMandateAllowed: false,
        methods: [cms()],
      })
    ).toEqual({ kind: "none" })
  })

  it("prefers an approved account, then the newest one", () => {
    const r = decideSignupResume({
      ...base,
      methods: [
        cms({ id: "pending-new", createdAt: "2026-09-25T00:00:00.000Z" }),
        cms({
          id: "approved-old",
          cmsMemberStatus: "REGISTERED",
          createdAt: "2026-09-01T00:00:00.000Z",
        }),
        cms({
          id: "approved-new",
          cmsMemberStatus: "REGISTERED",
          createdAt: "2026-09-10T00:00:00.000Z",
        }),
      ],
    })
    expect(r).toMatchObject({ kind: "resume", billingMethodId: "approved-new" })
  })
})

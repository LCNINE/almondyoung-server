import { api } from "../../../../lib/api/api"
import { issueMemberToken, type PremiumUsage } from "../../../../lib/beautytop/member-token"
import { getSignedInMemberId } from "../../../../lib/beautytop/session"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

export async function POST(request: Request) {
  return issueMemberToken(request, {
    getMemberId: getSignedInMemberId,
    recordPremiumUsage: async (acknowledged) => {
      const body = await api<PremiumUsage>("membership", "/me/benefit-usages", {
        method: "POST",
        body: { kind: "BEAUTYTOP_PREMIUM", acknowledged },
        cache: "no-store",
      })
      if (!body?.status) throw new Error("Unexpected membership response")
      return body
    },
    getConfig: () => ({
      // Server environment only; never use NEXT_PUBLIC_ for this key.
      privateKey: process.env.BEAUTYTOP_SIGNING_PRIVATE_KEY ?? "",
      apiOrigin: process.env.BEAUTYTOP_API_ORIGIN ?? "",
    }),
  })
}

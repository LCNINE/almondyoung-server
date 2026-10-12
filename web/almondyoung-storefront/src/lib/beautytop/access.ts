import "server-only"

import { api } from "@/lib/api/api"
import { getAccessToken } from "@lib/data/cookies"

export type BeautyTopAccess = "anonymous" | "nonMember" | "member"

// The token route decides with the same membership endpoint, so the page never
// shows the board to someone whose token request would be refused.
// An expired session still throws 401 so error.tsx can restore the token.
export async function getBeautyTopAccess(): Promise<BeautyTopAccess> {
  if (!(await getAccessToken())) return "anonymous"
  const body = await api<{ active: boolean }>("membership", "/subscriptions/current/active", {
    cache: "no-store",
  })
  return body?.active === true ? "member" : "nonMember"
}

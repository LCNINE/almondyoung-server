import "server-only"

import { api } from "@/lib/api/api"

export interface WalletHandoffCodeRequest {
  redirectUri: string
  codeChallenge: string
  nonce?: string
  scope?: string
}

/**
 * 결제창(wallet-web) 진입 인가 코드 발급.
 *
 * 쇼핑몰에 로그인된 고객 몫으로 wallet-web 의 인가 코드를 user-service 에서 받는다. 코드는 wallet-web 이
 * 만든 PKCE challenge 에 묶이고 한 번만 교환되므로, 이 코드를 받은 브라우저(wallet-web state 쿠키를 가진)
 * 밖에서는 쓸 수 없다.
 */
export async function issueWalletHandoffCode(
  input: WalletHandoffCodeRequest
): Promise<string> {
  const res = await api<{ code: string }>("users", "/auth/payment-handoff", {
    method: "POST",
    body: { ...input, codeChallengeMethod: "S256" },
  })

  return res.code
}

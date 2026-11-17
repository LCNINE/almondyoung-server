import { mintPaymentHandoffToken } from "@/lib/api/users/auth/payment-handoff"

// wallet-web 은 자기 호스트 쿠키로 세션을 따로 들고 있어, 스토어프론트에서 계정을 전환해도 이전 계정 세션이 남는다.
// 그래서 wallet-web 으로 갈 때는 항상 지금 고객의 핸드오프 토큰으로 세션을 덮어쓰고, 핸드오프를 못 쓰면
// wallet-web 에 남은 세션을 재사용하지 않도록 /login(IdP 활성 세션)으로 보낸다.

function walletWebBaseUrl(): string {
  return process.env.NEXT_PUBLIC_WALLET_WEB_URL || "http://localhost:3200"
}

function isUnauthorizedError(error: unknown): boolean {
  const err = error as Error & { digest?: string }

  return err?.digest === "UNAUTHORIZED" || err?.message === "UNAUTHORIZED"
}

async function restoreStorefrontToken(): Promise<boolean> {
  try {
    const res = await fetch("/api/auth/restore-token", {
      method: "POST",
      credentials: "include",
    })

    return res.ok
  } catch {
    return false
  }
}

async function mintHandoffTokenWithRestore(): Promise<string | null> {
  try {
    return await mintPaymentHandoffToken()
  } catch (error) {
    if (!isUnauthorizedError(error)) return null
  }

  if (!(await restoreStorefrontToken())) return null

  try {
    return await mintPaymentHandoffToken()
  } catch {
    return null
  }
}

/** `path` 는 wallet-web 내부 경로(`/pay/...`, `/billing-change?...`). */
export async function goToWalletWeb(path: string): Promise<void> {
  const base = walletWebBaseUrl()
  const handoffToken = await mintHandoffTokenWithRestore()
  const target = handoffToken
    ? `${base}/auth/handoff?h=${encodeURIComponent(handoffToken)}&redirect_to=${encodeURIComponent(path)}`
    : `${base}/login?redirect_to=${encodeURIComponent(path)}`

  window.location.href = target
}

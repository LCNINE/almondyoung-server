// wallet-web 은 자기 호스트 쿠키로 세션을 따로 들고 있어, 쇼핑몰에서 계정을 전환해도 이전 계정 세션이 남는다.
// 그래서 wallet-web 으로 갈 때는 항상 /auth/handoff 를 거친다. 거기서 이 쇼핑몰(/api/wallet-handoff)이 지금
// 고객 몫의 인가 코드를 내주고, wallet-web 은 그 코드로 세션을 새로 만든다.

/** `path` 는 wallet-web 내부 경로(`/pay/...`, `/billing-change?...`). */
export function goToWalletWeb(path: string): void {
  const base = process.env.NEXT_PUBLIC_WALLET_WEB_URL || "http://localhost:3200"

  window.location.href = `${base}/auth/handoff?redirect_to=${encodeURIComponent(path)}`
}

import Medusa from "@medusajs/js-sdk"

const getMedusaBaseUrl = () => {
  const isServer = typeof window === "undefined"

  if (isServer) {
    return process.env.BACKEND_URL + "/medusa"
  } else {
    return `${window.location.origin}/api/medusa`
  }
}

export const sdk = new Medusa({
  baseUrl: getMedusaBaseUrl(),
  debug: process.env.NODE_ENV === "development",
  publishableKey: process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY,
  auth: {
    type: "session",
  },
})

export const appConfig = {
  appName: "아몬드영",
  appDescription: "세상의 모든 미용재료가 있는 곳 - 아몬드영",
  // (https:// 빼고 도메인만 입력. 끝에 /도 빼야 함. ex) yoursite.com
  domainName: "amondyoung.com",
  supportEmail: "support@amondyoung.com",
  auth: {
    // 로그인 경로. 개인 경로 보호 및 401 오류 처리에 사용
    loginUrl: "/login",
    // 로그인 성공 후 리다이렉트될 경로.
    redirect_to: "/", // 좀 더 고민이 필요함 일단 기본값은 홈으로 설정했음
  },
}

// API Gateway 사용 설정
// Gateway 안정성 문제 등으로 직접 서비스 호출이 필요할 경우 false로 설정하세요.
export const USE_API_GATEWAY = false

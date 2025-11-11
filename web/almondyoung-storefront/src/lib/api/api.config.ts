function API_BASE_URL() {
  const isServer = typeof window === "undefined"

  if (isServer) {
    return process.env.API_BASE_URL
  } else {
    return ""
  }
}

// 각 서비스의 전체 Base URL (기존 코드 호환성 유지)
const PIM_BASE_URL = `${API_BASE_URL()}/pim`
const WMS_BASE_URL = `${API_BASE_URL()}/wms`
const USER_SERVICE_BASE_URL = `${API_BASE_URL()}/users`
const MEDUSA_BASE_URL = `${API_BASE_URL()}/medusa`
const WALLET_SERVICE_BASE_URL = `${API_BASE_URL()}/wallet`
const MEMBERSHIP_SERVICE_BASE_URL = `${API_BASE_URL()}/membership`
const NOTIFICATION_SERVICE_BASE_URL = `${API_BASE_URL()}/notification`
const CHANNEL_ADAPTER_SERVICE_BASE_URL = `${API_BASE_URL()}/channel-adapter`

export {
  CHANNEL_ADAPTER_SERVICE_BASE_URL,
  MEDUSA_BASE_URL,
  MEMBERSHIP_SERVICE_BASE_URL,
  NOTIFICATION_SERVICE_BASE_URL,
  PIM_BASE_URL,
  USER_SERVICE_BASE_URL,
  WALLET_SERVICE_BASE_URL,
  WMS_BASE_URL,
}

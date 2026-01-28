import Medusa from "@medusajs/js-sdk"
import { requireBackendBaseUrl } from "./backend"

const getMedusaBaseUrl = () => {
  const isServer = typeof window === "undefined"

  if (isServer) {
    return requireBackendBaseUrl("medusa")
  } else {
    return `${window.location.origin}/api/medusa`
  }
}

export const sdk = new Medusa({
  baseUrl: getMedusaBaseUrl(),
  debug: process.env.NODE_ENV === "development",
  publishableKey: process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY,
  auth: {
    type: "jwt",
  },
})

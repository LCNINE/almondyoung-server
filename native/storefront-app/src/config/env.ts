function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing required env var: ${name}`)
  return value
}

export const appEnv = {
  storefrontOrigin: required(
    "EXPO_PUBLIC_STOREFRONT_ORIGIN",
    process.env.EXPO_PUBLIC_STOREFRONT_ORIGIN,
  ),
  medusaUrl: required("EXPO_PUBLIC_MEDUSA_URL", process.env.EXPO_PUBLIC_MEDUSA_URL),
  medusaPublishableKey: required(
    "EXPO_PUBLIC_MEDUSA_PUBLISHABLE_KEY",
    process.env.EXPO_PUBLIC_MEDUSA_PUBLISHABLE_KEY,
  ),
  authWebOrigin: required("EXPO_PUBLIC_AUTH_WEB_ORIGIN", process.env.EXPO_PUBLIC_AUTH_WEB_ORIGIN),
  appClientId: required("EXPO_PUBLIC_APP_OAUTH_CLIENT_ID", process.env.EXPO_PUBLIC_APP_OAUTH_CLIENT_ID),
  userServiceUrl: required(
    "EXPO_PUBLIC_USER_SERVICE_URL",
    process.env.EXPO_PUBLIC_USER_SERVICE_URL,
  ),
  notificationUrl: required(
    "EXPO_PUBLIC_NOTIFICATION_URL",
    process.env.EXPO_PUBLIC_NOTIFICATION_URL,
  ),
  defaultCountryCode: process.env.EXPO_PUBLIC_DEFAULT_COUNTRY_CODE ?? "kr",
}

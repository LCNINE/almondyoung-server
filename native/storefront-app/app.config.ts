import type { ExpoConfig } from "expo/config"

const config: ExpoConfig = {
  name: "아몬드영",
  slug: "almondyoung-storefront-app",
  version: "1.0.0",
  orientation: "portrait",
  scheme: "almondyoung",
  android: {
    package: "com.almondyoung.storefront",
    versionCode: 1,
    googleServicesFile: "./google-services.json",
  },
  plugins: ["expo-secure-store", "expo-notifications", "expo-web-browser"],
}

export default config

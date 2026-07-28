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
    // `google-services.json` 은 .gitignore 대상이고, EAS Build 는 git 아카이브를
    // 업로드하므로 로컬 파일은 빌드 워커에 올라가지 않는다 — 그대로 두면 Android
    // 빌드가 "file not found" 로 죽는다. EAS 쪽에는 file 타입 환경변수로 올리고
    // (그 값이 워커에서 실제 파일 경로가 된다), 값이 없으면 로컬 경로로 떨어진다.
    // 이 이중화 덕에 로컬 `expo run:android` 와 EAS 빌드가 같은 config 를 쓴다.
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? "./google-services.json",
  },
  plugins: ["expo-secure-store", "expo-notifications", "expo-web-browser"],
}

export default config

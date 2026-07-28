import type { ExpoConfig } from "expo/config"

const config: ExpoConfig = {
  name: "아몬드영",
  // EAS 프로젝트(extra.eas.projectId)의 slug 와 일치해야 한다 — 다르면 모든 eas 명령이 거부된다.
  slug: "almondyoung",
  // 계정이 여럿(lcnine / lcnine-co)이라 소유 조직을 명시한다. 프로젝트는 @lcnine-co/almondyoung.
  owner: "lcnine-co",
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
  // `eas init` 은 동적 config(app.config.ts)에 자동으로 써넣지 못하므로 수동으로 둔다.
  // 이 값이 없으면 EAS 명령이 매번 프로젝트를 새로 만들려 든다.
  extra: {
    eas: {
      projectId: "625c8981-ed94-4b62-a733-38c6b33e8c4d",
    },
  },
}

export default config

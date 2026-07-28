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
  // EAS Update. 이게 있어야 eas.json 의 channel 이 의미를 갖고, JS 만 바뀐 수정을
  // 스토어 심사 없이 내보낼 수 있다(설계 문서 §13 의 전제). `eas update:configure` 가
  // 동적 config 에 자동으로 못 써서 수동으로 둔다.
  // runtimeVersion 이 `appVersion` 정책이므로 OTA 는 같은 version("1.0.0")으로 만든
  // 빌드에만 적용된다 — 네이티브가 바뀌면 version 을 올려 새 스토어 빌드를 낸다.
  updates: {
    url: "https://u.expo.dev/625c8981-ed94-4b62-a733-38c6b33e8c4d",
  },
  runtimeVersion: {
    policy: "appVersion",
  },
  // `eas init` 은 동적 config(app.config.ts)에 자동으로 써넣지 못하므로 수동으로 둔다.
  // 이 값이 없으면 EAS 명령이 매번 프로젝트를 새로 만들려 든다.
  extra: {
    eas: {
      projectId: "625c8981-ed94-4b62-a733-38c6b33e8c4d",
    },
  },
}

export default config

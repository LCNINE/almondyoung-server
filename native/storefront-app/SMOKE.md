# 수동 스모크 체크리스트

빌드마다 실기기에서 확인한다. 웹뷰 상호작용은 자동 테스트 대상이 아니다.

## 선행 조건 (실기기 빌드 전 필수)

아래 세 가지가 없으면 빌드 자체가 실패하거나 로그인이 되지 않는다. 이 문서를
집어든 사람이 놀라지 않도록 맨 위에 적어둔다.

- [ ] **`google-services.json`**: 기존 Firebase 프로젝트에 패키지명
      `com.almondyoung.storefront` 로 Android 앱을 추가한 뒤 다운로드하여
      `native/storefront-app/google-services.json` 에 배치한다. `app.config.ts` 가
      이 경로를 `googleServicesFile` 로 참조한다. 파일이 없으면 Android 빌드가
      실패한다. (이 파일은 `.gitignore` 대상이므로 저장소에는 없다.)
- [ ] **OAuth 클라이언트 등록 (user-service)**:
  - 신규 public 클라이언트 `almondyoung-android-app` — redirect_uri
    `almondyoung://oauth/callback` (앱 자체 PKCE 로그인, `pkce-login.ts` 의
    `APP_LOGIN_REDIRECT`).
  - 기존 클라이언트 `medusa-storefront` 에 redirect_uri
    `almondyoung://callback/oidc` 를 **추가** (웹뷰 로그인, `callback.ts` 의
    `WEBVIEW_LOGIN_REDIRECT`). 기존에 등록된 redirect_uri 는 하나도 제거하지
    않는다 — 하나라도 빠지면 웹 로그인이 즉시 깨진다.
- [ ] **`eas.json` 의 `env` 값이 빌드 대상 환경과 일치하는지 확인**: `config/env.ts`
      가 `App.tsx` import 시점에 필수 `EXPO_PUBLIC_*` 7개를 즉시 검증하는데, `.env`
      는 `.gitignore` 대상이고 EAS Build 는 git 아카이브를 업로드하므로 로컬
      `.env` 값은 빌드에 반영되지 않는다 — `eas.json` 의 `build.<profile>.env` 에
      커밋된 값만 실제로 쓰인다. 현재 `preview`/`production` 두 프로파일 모두
      `.env.example` 의 프로덕션 값(origin 들, Medusa publishable key)을 기본값으로
      커밋해뒀다. `EXPO_PUBLIC_MEDUSA_PUBLISHABLE_KEY` 는 `.env.example` 자체가
      `pk_...` 플레이스홀더라 그대로 옮겨져 있다 — 실제 프로덕션 키로 교체돼
      있는지 반드시 확인한다. preview 빌드를 스테이징/다른 환경으로 보낼
      계획이면 그 프로파일의 origin 들도 빌드 전에 맞게 바꿔야 한다. 확인 없이
      빌드하면 설치 후 화면도 못 띄우거나(빈 값) 잘못된 환경으로 요청을 쏘는
      채로 배포된다.

## 탐색
- [ ] 앱 실행 → storefront 홈이 전체화면. 앱 크롬 없음. 웹 하단바만 보임
- [ ] 하단바가 홈 인디케이터/제스처 바를 침범하지 않음 (safe-area)
- [ ] **상태바/네비게이션 바 침범 (safe-area, Android 회귀 위험)**: `App.tsx` 는
      `react-native` 의 `SafeAreaView` 를 쓰는데, RN 내장 구현은 iOS 에서만
      실제로 inset 을 적용하고 Android 에서는 사실상 no-op 이다.
      실기기(제스처 내비게이션 기기와 3버튼 내비게이션 기기 각각)에서 storefront
      상단 콘텐츠가 상태바에 가리지 않는지, 하단 고정바가 제스처/내비게이션
      바에 가리지 않는지 직접 확인한다. 가려지면 이는 실제 버그이며 이슈로
      등록한다 (자동 테스트로 잡히지 않음).
- [ ] 상품 상세 진입 → 시스템 백 → 이전 화면
- [ ] 홈에서 백 → "한 번 더 누르면 종료" 토스트 → 두 번째 백에 종료
- [ ] 아래로 당기기 → 새로고침

## 외부 도메인
- [ ] 결제 진입 → 상단 닫기 바가 있는 모달로 열림
- [ ] 모달에서 닫기 → 메인 웹뷰로 복귀. 히스토리 정상

## 로그인
- [ ] 첫 실행 → Custom Tabs 로그인. 카카오 로그인 동작
- [ ] 로그인 후 웹뷰가 로그인 상태 (마이페이지 진입 가능)
- [ ] 장바구니가 계정에 연결됨
- [ ] 앱 재실행 → 로그인 화면 없이 바로 진입
- [ ] 신규 계정으로 가입 → customer 자동 생성 확인
- [ ] **로그아웃 → 웹뷰는 그대로 살아있고, 로그아웃된 storefront 홈으로 이동한다
      (SplashGate 로 돌아가지 않는다)**: 웹의 signout 서버 액션 →
      `/oauth/end_session` 리다이렉트 → user-service `endSession` 까지 이어지는
      체인이 웹뷰 안에서 스스로 끝까지 진행돼야 하므로, 앱이 웹뷰를 먼저 죽이면
      안 된다. 앱을 완전히 재시작해야만 SplashGate 가 다시 보인다(그리고 이번엔
      로그인 화면으로 이어져야 한다).
- [ ] **로그인 화면은 정확히 한 번만 보인다**: 완전히 새로 설치한 상태(앱 데이터
      삭제 또는 재설치)에서 로그인한다. SplashGate 는 앱 자체 PKCE 로그인(보이는
      Custom Tabs 로그인 1회) 후 그 IdP 세션으로 웹뷰용 authorize 를 무음으로
      재상환한다 — 두 번째 OIDC 흐름에서 로그인 UI 가 다시 뜨면 안 된다. 로그인
      창이 두 번 보이거나, 두 번째 흐름에서 화면이 멈추면 실패.

## 푸시

**딥링크 payload 계약**: `App.tsx` 는 FCM data payload 의 `path` 키를 읽어
`${storefrontOrigin}${path}` 로 이동한다 (`typeof path !== "string"` 이거나
`/` 로 시작하지 않으면 조용히 무시). 이 키는 서버의
`apps/notification/src/provider/providers/push/fcm.provider.ts` 가 자동으로
채워주지 않는다 — `notificationId`/`campaignId`/`category`/`priority`/
`clickAction`/`sound` 와 caller 가 넘긴 `metadata.fcmDataVariables` 만 만든다.
캠페인 발송 쪽에서 `metadata.fcmDataVariables` 등을 통해 **`path` 라는 정확한
키 이름**으로, **국가 프리픽스를 포함한 절대 경로**를 채워 보내야 한다 —
`/kr/products/123` 이 맞고 `/products/123` 은 틀리다 (`toLocalizedPath` 없이
그대로 origin 뒤에 붙는다). 설계 문서 §9.1 에도 동일하게 기록돼 있다.
테스트 푸시를 보낼 때 이 계약대로 payload 를 구성한다. 예:
```json
{ "data": { "path": "/kr/products/123" } }
```

- [ ] 로그인 후 알림 권한 요청
- [ ] 테스트 푸시 수신
- [ ] 알림 탭 → 해당 경로로 웹뷰 이동 (위 payload 계약대로 `data.path` 를 채워
      보낸다)
- [ ] **로그인 진행 중 도착한 알림 탭 (경합 시나리오)**: 로그아웃 상태에서 앱을
      완전히 종료한 뒤, 푸시 알림을 탭해 콜드 스타트한다 — 알림 탭이 SplashGate
      의 로그인 흐름이 아직 끝나기 전에 도착하는 상황을 만드는 것이 목적이다.
      로그인은 (앱 PKCE + 웹뷰 재상환 두 단계이지만 사용자에게는) 딱 한 번만
      진행되고, 완료 후 홈이 아니라 알림이 가리키던 경로로 바로 이동해야 한다.
      로그인이 중간에 끊기거나, 홈으로 떨어지거나, 알림 탭이 무시되면 실패.
- [ ] **로그아웃하면 푸시가 멈추고, 재로그인하면 재개된다**: 로그아웃한 뒤 같은
      기기로 테스트 푸시를 보내 도착하지 않는지 확인한다. 그다음 다시 로그인해
      테스트 푸시를 한 번 더 보내 정상 수신되는지 확인한다 (기존 "로그아웃 후
      푸시가 오지 않음" 항목에 재로그인 후 재개 여부를 추가).

## 오류
- [ ] 비행기 모드 실행 → 네이티브 오류 화면 (브라우저 오류 페이지 아님)
- [ ] **오류 화면에서 시스템 백 키가 살아있음**: 비행기 모드로 네이티브 오류
      화면을 띄운 상태에서 하드웨어 백 키를 누른다. 첫 번째 누름에 "한 번 더
      누르면 종료됩니다" 토스트가 떠야 하고, 그 상태에서 다시 누르면(윈도우 안)
      앱이 종료돼야 한다. 아무 반응 없이 조용히 씹히면(먹통) 실패 — 오류 화면
      전환 시 `canGoBack` 상태가 리셋되지 않으면 이 증상이 재발한다.
- [ ] 네트워크 복구 후 다시 시도 → 정상
- [ ] **재시도는 실패했던 페이지로 돌아간다 (홈이 아님)**: 상품 상세 페이지로
      이동한 뒤 그 페이지에서 강제로 실패를 유발한다(예: 그 화면에서 비행기
      모드 진입). 오류 화면에서 "다시 시도"를 탭했을 때 홈이 아니라 방금 보던
      그 상품 상세 페이지로 돌아오는지 확인한다.
- [ ] **웹뷰 렌더러 프로세스 강제 종료 후 복구**: 개발자 옵션의 메모리 압박
      시뮬레이션 또는 `adb shell am kill <패키지명 또는 웹뷰 렌더러 프로세스>`
      로 웹뷰 렌더러 프로세스를 강제 종료한다. 앱이 그대로 멈추거나 크래시하지
      않고 네이티브 오류 화면으로 전환되어야 하며, "다시 시도"로 정상
      복구되어야 한다 (내부적으로 새 웹뷰 인스턴스를 강제 재생성한다).

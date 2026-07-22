# 물류 현장 네이티브 앱 (Tauri 2) — 설계 스펙

- 날짜: 2026-07-20
- 대상: `native/warehouse-app` (신규)
- 브랜치: `docs/warehouse-native-app-design`
- 상태: 설계 승인됨 (구현 전) — 브레인스토밍 산출물, 구현 플랜은 후속

## 1. 배경 / 문제

현재 물류팀은 `apps/admin-web`(Next.js) 안에서 현장 작업을 처리한다. admin-web은 물류와 무관한 기능(mall·payments·membership·cs·matching·users 등)이 대부분이라 현장 작업자에게 과한 화면이다. admin-web 안엔 이미 물류 성격의 `mobile/*` 라우트(`schedule`·`search`·`inbound`·`pick`·`invoice`)가 사실상 존재하지만, 웹으로는 **현장 하드웨어(바코드 리더기·라벨 프린터)에 제대로 붙지 못한다.**

그래서 **물류팀 전용 standalone 앱**을 **Tauri 2** 기반으로 신설한다. 데스크톱(패킹 스테이션)과 Android(핸드헬드) 양쪽에서 돌고, 현장 하드웨어에 네이티브로 연동하며, 물류 작업만 담은 집중 UX를 제공한다.

## 2. 동력 & 스코프

### 핵심 동력 (우선순위)
1. **네이티브 하드웨어** (1순위) — 브라우저가 못 하는 현장 기기 연동. **이 앱의 존재 이유.**
2. **집중/단순화** (2순위) — 물류팀에게 자기 작업만 보이는 전용 UX.
3. (배포/설치성은 부차 — 자동업데이트로 충족. 오프라인은 비동력.)

### 연동 하드웨어
- **카메라 바코드/QR 스캔** (주로 Android 핸드헬드)
- **USB/USB-C HID 바코드 리더기** (마트 계산대형 키보드 웨지) — Windows·Android 공통
- **ZPL 라벨 프린터** (Zebra 등) — Windows 스테이션 (진짜 네이티브 요구)

### 플랫폼
- **Windows 데스크톱 스테이션** + **Android 폰/PDA**. (macOS·iOS 없음 → 서명/배포 마찰 최소.)

### v1 목표 (전체 물류 루프)
입고/검수 · 피킹(집품) · 패킹+운송장/라벨 발급 · 재고 검색/조정/실사.

### 비목표 (v1 범위 외 / 후속)
- **오프라인 큐잉·로컬 우선 동기화** — v1은 온라인 우선 + 재시도/멱등. (전방호환만 확보, 미구현.)
- **애플 플랫폼(macOS/iOS)**.
- **세분 권한(scope) 단위 분해** — v1은 단일 `warehouse` 역할.
- **인텐트 방식(DataWedge) PDA 지원** — v1은 키보드 웨지 전제. 실제 인텐트 기기 도입 시 얇은 네이티브 플러그인 추가.
- **미래 고객용 모바일앱**(webview 쇼핑몰 + push) — 같은 `native/` 홈을 쓰되 별개 프로젝트.
- **admin-web 코드 재사용/공유 패키지** — 완전 신규, 참고만.

## 3. 아키텍처 골격

### 앱 1개 · Tauri 2 · 빌드 타깃 2개
하나의 Tauri 코드베이스에서 Windows·Android를 각각 빌드. 프론트(React)는 공유하되, 하드웨어 구현만 플랫폼별 조건부(`#[cfg(desktop)]`/`#[cfg(mobile)]` + Cargo features).

### 프로필 분리 — 방식 (B): 공통 토대 + 프로필별 화면군
두 프로필(스테이션·핸드헬드)은 작업·하드웨어·화면 크기가 다르므로, **반응형 단일 UI(A)**나 **완전 두 앱(C)**이 아니라, **한 코드베이스 안에서 `core`(공유 토대)를 두고 `profiles/station`·`profiles/handheld` 화면군을 별도로** 둔다.

- **기본 진입 프로필은 플랫폼으로 결정**: Windows → station, Android → handheld. 설정 오버라이드 허용.
- `core`는 워크플로우를 모른다(auth/data/design/hardware). `profiles`가 `core`+`domains`를 조립.

### 프론트 스택
Vite + React + shadcn/radix + Tailwind + TanStack Query. **완전 신규**(admin-web/백엔드 DTO는 도메인·API 계약 참고용, 코드 결합 0).

## 4. 하드웨어 모듈

세 기기를 각각 **포트(인터페이스)**로 추상화하고 플랫폼 구현을 뒤에 숨긴다. 화면 코드는 하드웨어 출처를 모른다.

### ① USB-HID 리더기 — 플러그인 0
키보드 웨지(타이핑 후 Enter). Rust 불필요, 순수 프론트.
- `ScanProvider` + `useScanner()` 훅: 전역 keydown 버퍼링 → **키 간격(<~30–50ms) + 종결자(Enter/Tab)**로 "사람 타이핑 vs 스캔" 판별 후 flush.
- 포커스 불문. **Windows·Android(USB-OTG) 공통.** (스캔 소스는 프로필 가정이 아니라 기기별 런타임 capability.)

### ② 카메라 스캔
- **Android**: Tauri 공식 `plugin-barcode-scanner`(네이티브 카메라 + MLKit, 권한 처리).
- **Windows**(웹캠, 드묾): `getUserMedia` + `BarcodeDetector`/zxing-wasm 폴백.

### ★ 스캔 소스 통합 (가장 중요한 추상화)
①(USB-HID, 항상 리스닝)와 ②(카메라, 온디맨드)를 **하나의 스캔 이벤트 스트림**으로 합친다. 화면은 "바코드 하나 줘"라고만 하고 출처를 모른다. → 한 기기에서 두 소스 공존 가능(예: Android 핸드헬드 + USB 리더기).

### ③ ZPL 프린터 — 진짜 네이티브 요구
Rust `print_raw(target, bytes)` Tauri 커맨드. 두 경로 지원:
- **네트워크 TCP:9100 raw** — 드라이버리스, 순수 Rust, 어떤 기기서든(Android 포함).
- **Windows 스풀러 RAW pass-through**(WritePrinter) — USB 부착 Zebra.
- **ZPL 생성은 프론트(TS) 템플릿** — 운송장/바코드/상품 라벨을 데이터로 버전 관리(라벨 변경이 Rust 재빌드를 안 부름). 인쇄 전 **라벨 미리보기**(jsbarcode 류)로 오출력 방지.

### 프로필 ↔ 하드웨어 매핑

| | 스테이션(Win) | 핸드헬드(Android) |
|---|---|---|
| 스캔 | USB-HID | 카메라 and/or USB-HID |
| 인쇄 | ZPL(스풀러/네트워크) | 선택 — 네트워크 프린터만 |

### 플랫폼 조건부 & 권한
스풀러=데스크톱 전용, 카메라 플러그인=모바일. 공유 JS는 안정된 커맨드 인터페이스만 호출, 미지원 기능은 "이 플랫폼 미지원" 반환 → 프로필별 UI에서 숨김. Tauri 2 **capabilities(권한 ACL)**에 camera/network 등 선언.

## 5. 인증 — 네이티브 OIDC + PKCE

기존 IdP는 이 모노레포의 **user-service + auth-web**. admin-web은 confidential OIDC RP다. 네이티브 앱은 별도 **public 클라이언트**를 쓴다.

- **클라이언트 등록**: user-service `oauth_clients`에 **신규 public 클라이언트**(PKCE, 시크릿 없음). redirect URI = **커스텀 스킴 딥링크** `almondwms://oauth/callback` (Tauri `plugin-deep-link`: Windows=레지스트리 프로토콜 핸들러, Android=인텐트 필터). *(데스크톱 대안: loopback `127.0.0.1:port`.)*
- **흐름**: PKCE verifier/state/nonce 생성 → **시스템 브라우저**로 auth-web `/oauth/authorize` (임베드 웹뷰 아님, RFC 8252 권장) → 사용자 로그인 → `almondwms://oauth/callback?code=…` 딥링크 → state 검증 → user-service `/oauth/token`에 code+verifier 교환(시크릿 없음) → access/refresh/id 토큰 → idToken을 JWKS로 검증(nonce/iss/aud).
- **토큰 보관**: refresh(장수명·민감) → `plugin-stronghold`(암호화 볼트) 또는 OS 키체인. access → 메모리.
- **리프레시**: 401/만료 시 `grant_type=refresh_token`, 회전 시 교체. HTTP 클라이언트에 **single-flight**(동시 401 중복 갱신 방지), 실패 시 강제 재로그인.
- **로그아웃**: 로컬 토큰 소거(+ 선택적 end_session).

## 6. 데이터 레이어

- **모든 백엔드 호출은 Tauri 네이티브 HTTP(`plugin-http`/reqwest)** — 브라우저 fetch 아님.
  - **CORS 해소**: 네이티브 HTTP는 브라우저 CORS를 우회 → 웹뷰 origin 문제 소멸. 남은 전제는 (1) 백엔드가 **공개 도메인 도달** (2) **토큰 수용**뿐.
- **TanStack Query on `plugin-http` fetcher** — 도메인별 훅(inbound/inventory/picking/packing-waybill).
- **타입 계약**: 백엔드 OpenAPI 있으면 **코드젠**(코드 결합 0인데 타입 정확), 없으면 손 선언.
- **멱등성 + 낙관적 락**: 입고/조정/출고 mutation에 **idempotency-key** 부착(프록시가 이미 이 헤더 전달). inventory는 append-only 원장 + `version` 낙관적 락 → **409 → 최신 version 리페치 → 재시도/안내** 흐름을 데이터 레이어에 내장.
- **에러 매핑**: 백엔드 도메인 예외(404/400/409/500)를 현장 친화 메시지로.
- **오프라인 전방호환**: 모든 mutation을 단일 커맨드 레이어로 깔때기 → 후속에 큐로 감싸면 오프라인 확장(v1 미구현).

## 7. 역할 / 권한 — `warehouse`

현장 작업자에게 admin/master를 그대로 주지 않고 **전용 `warehouse` 역할**을 쓴다(최소권한).

- **참고 — 이미 존재하는 자산**: 백엔드 waybill 엔드포인트가 이미 `warehouse.operate`·`shipment.reopen` **스코프**로 가드돼 있다(`docs/superpowers/specs/2026-07-20-waybill-issuance-admin-web-design.md`, `apps/core/.../waybill.controller.ts` 참조). 즉 RBAC에 이미 `warehouse.*` 스코프 계열이 있어, "역할 신설"은 이 스코프들을 묶는 역할 정의 + 나머지 물류 엔드포인트 가드 확장 수준으로 축소될 수 있다. (구현 전 실측 — §13.)
- v1은 **세분 scope 분해는 하지 않음** — 단일 `warehouse` 역할이 물류 엔드포인트 전반을 커버.

## 8. 위치 & 프로젝트 구조

### 위치 — 신규 최상위 `native/`
레포 컨벤션의 진짜 구분축은 "**URL로 서빙(`web/`) vs 설치형 바이너리로 배포**"다. 이 앱은 웹 기술이지만 `.msi`/`.apk`로 배포되고 네이티브 하드웨어를 쓰므로 `web/`·`apps/`(백엔드) 어디에도 안 맞는다. **설치형 네이티브 클라이언트** 범주에 새 홈 `native/`를 만든다. 미래 고객 모바일앱도 `native/` 아래.

### 구조
```
native/warehouse-app/
├─ src/                     # Vite + React 프론트
│  ├─ app/                  # 셸·라우팅·프로필 부트스트랩
│  ├─ core/                 # 공유 토대 (비즈니스 무지)
│  │  ├─ auth/              #   OIDC PKCE, 토큰스토어, refresh single-flight
│  │  ├─ data/              #   plugin-http fetcher, TanStack Query, idempotency/락
│  │  ├─ hardware/          #   포트: scanSource()·printer()·camera() (JS)
│  │  └─ design/            #   shadcn/radix/tailwind
│  ├─ profiles/
│  │  ├─ station/           # 스테이션 화면군 (packing·waybill·print)
│  │  └─ handheld/          # 핸드헬드 화면군 (inbound·pick·inventory)
│  ├─ domains/              # inventory·inbound·picking·packing 훅/타입
│  └─ generated/            # OpenAPI 코드젠(있으면)
└─ src-tauri/               # Rust
   ├─ src/{printing/,deep_link.rs,secure_store.rs,lib.rs}
   ├─ capabilities/         # Tauri v2 권한 ACL (플랫폼/윈도우별)
   └─ tauri.conf.json, Cargo.toml
```
- **`core/` vs `profiles/`** 분리가 방식 (B)의 물리적 표현.
- **프로필 부트스트랩**: `plugin-os` platform으로 Windows→station, Android→handheld + 설정 오버라이드.
- **결합 0 유지**: 프론트는 **자체 lockfile 독립 프로젝트**(루트 npm workspace 밖), 형제 앱 코드 import 안 함. lint/prettier 규칙만 공유. **새 툴체인(Rust + Android NDK)이 레포에 진입 — CI 명시 필요.**

## 9. 빌드 · 배포 · 업데이트

- **Windows**: `tauri build` → `.msi`/NSIS. 미서명 시 SmartScreen 경고 → 코드서명 인증서 구매 또는 사내 수용. **`plugin-updater` 자동업데이트**(서명 아티팩트를 S3 정적 호스팅 — 레포에 file-service/S3 존재).
- **Android**: `tauri android build` → `.apk`/`.aab`, 키스토어 서명. 배포 = 사내 APK 사이드로드(또는 Play 내부테스트).
- **런타임 설정 화면**: OIDC/백엔드 URL·네트워크 프린터 IP를 **사이트별로 재빌드 없이** 설정.

## 10. 테스트 전략

- **Vitest 유닛 (TDD 대상 — 결정적 로직)**: HID 키스트로크 버스트 파서(스캔/타이핑 판별), ZPL 템플릿 생성기, PKCE/OIDC 헬퍼, 멱등키+낙관적락 재시도 로직.
- **컴포넌트(Testing Library)**: 도메인 훅을 가짜 plugin-http 트랜스포트로.
- **Rust(`cargo test`)**: `print_raw` 타깃 파싱·TCP 프레이밍. (스풀러는 OS 의존 → 기기 수동.)
- **하드웨어 = 기기 수동 스모크**: Phase 0 스파이크를 **"진단(diagnostics)" 화면**으로 상시 탑재 — 감지 스캔 이벤트 나열 + 테스트 인쇄 발사. 테스트 하네스이자 현장 트러블슈팅 도구(`warehouse` 역할 뒤).
- **E2E(`tauri-driver`)**: v1 제외, 컴포넌트+기기 스모크로 커버. 후속 여지.

## 11. v1 단계 릴리스 (리스크 순서)

각 Phase는 독립 출시 가능. 핸드헬드 3개는 점진 배포, 스테이션(인쇄)은 마지막.

- **Phase 0 — 토대 + 하드웨어 스파이크** 🎯
  Tauri Win+Android 셸, OIDC 로그인+토큰 보관, `plugin-http`+TanStack Query 데이터 레이어, 디자인시스템, 프로필 라우팅, **3개 하드웨어 스파이크(USB-HID 스캔 · 카메라 스캔 · ZPL 테스트 인쇄)를 실제 기기에서 검증**. 비즈니스 로직 0. → #1 동력이자 #1 리스크인 하드웨어 3종을 맨 앞에서 증명.
- **Phase 1 — 재고 검색·조정·실사 (핸드헬드)**
  read + 낙관적 락 mutation. 데이터 레이어 실전 증명. 즉시 유용.
- **Phase 2 — 입고/검수 (핸드헬드)**
  RECEIVE 이벤트 + 로케이션 적치.
- **Phase 3 — 피킹 (핸드헬드)**
  피킹리스트 + 예약/shipment-line 매칭.
- **Phase 4 — 패킹 + 운송장/라벨 + ZPL 인쇄 (스테이션)**
  전체 출고 마감. 프린팅은 Phase 0 스파이크로 증명됨 → 여기선 워크플로우만. (기존 waybill 모듈 계약 재사용.)

## 12. 백엔드 선행 작업 항목

순수 프론트 프로젝트지만 아래 백엔드 변경이 딸려온다:

1. **신규 public OIDC 클라이언트** 등록 (user-service `oauth_clients`, PKCE, redirect `almondwms://oauth/callback`).
2. **`warehouse` 역할** 정의/등록 (`@app/roles` + user-service RBAC). 기존 `warehouse.*` 스코프 활용.
3. **물류 엔드포인트 authorization 확장** — inventory·inbound 등 이 앱이 쓰는 core 엔드포인트가 `warehouse` 역할/스코프를 허용하도록. (waybill 계열은 이미 `warehouse.operate`.)
4. (검증 결과에 따라) **Bearer 토큰 추출기** 추가 — 가드가 쿠키 전용이면.

## 13. 검증 항목 (구현 전 확인 — 설계엔 안 막힘)

1. **토큰 수용 방식**: 백엔드 가드(`@app/auth-core`)가 쿠키만 읽나, `Authorization: Bearer`도 받나? → Bearer면 그걸로, 쿠키 전용이면 네이티브가 `Cookie:` 헤더 수동 부착(백엔드 변경 0) 또는 bearer 추출기 추가.
2. **공개 도달**: core/user-service 등이 공개 게이트웨이로 노출되나?
3. **OpenAPI**: 백엔드에 Swagger/OpenAPI 스펙 있나? (타입 코드젠 가능 여부.)
4. **RBAC 실측**: `warehouse.*` 스코프 현황과 물류 엔드포인트 가드가 어디까지 이미 warehouse를 허용하는지.
5. **PDA 스캐너 출력 방식**: 현장 도입/예정 기기가 키보드 웨지인지 인텐트(DataWedge)인지.

## 14. 주요 결정 로그

| 결정 | 선택 | 근거 |
|---|---|---|
| 기술 | Tauri 2 | 한 코드베이스 → Windows+Android, 네이티브 하드웨어 |
| 프로필 분리 | (B) 공통 토대 + 프로필별 화면군 | 두 프로필 작업/하드웨어 상이, 집중 UX |
| 프론트 재사용 | 완전 신규(참고만) | 결합 0, 목적형 UX |
| 인증 | 네이티브 OIDC(PKCE public) + 백엔드 직호출 | 네이티브 정석, admin-web 독립 |
| HTTP | `plugin-http`(네이티브) | CORS 우회, 토큰 네이티브 부착 |
| 역할 | 전용 `warehouse` (세분 scope 없이) | 최소권한, 기존 `warehouse.*` 활용 |
| 위치 | 신규 최상위 `native/` | "설치형 바이너리" 범주, 미래 고객앱 공용 홈 |
| 오프라인 | 온라인 우선(큐 미구현, 전방호환만) | 비동력 |
| 릴리스 | Phase 0(하드웨어 스파이크)부터 리스크 순 | #1 리스크 선증명 |

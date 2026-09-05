# 로컬 전 과정(E2E) 검증 환경 — 구축 핸드오프

> **목적:** 관리자 액션 · 회원가입 · 장바구니 · 쿠폰 적용 · 결제 · 어드민 주문조회 · 매칭을
> **한 로컬 스택에서, 크롬으로 사람이 하듯** 검증할 수 있게 세운다.
>
> **이 문서는 환경만 다룬다.** 쿠폰 도메인 절차는 `docs/superpowers/plans/2026-09-05-coupon-rehearsal-3.md`.
>
> 근거: 2026-09-05 쿠폰 리허설 3차. 그날 세션 시간의 대부분이 여기 적힌 것들을 하나씩 발견하는 데 들어갔다.
> **정본은 `docs/local-dev.md` 이고, 이 문서는 거기에 없던 것만 모았다** — 안정화되면 접어 넣을 것.

---

## 0. 🔴 먼저 읽을 한 문단

**「떠 있다」와 「최신이다」는 다르다.** 3차 착수 시 포트 8개가 전부 열려 있었지만 프로세스는 **4일 묵은 코드**였고
Medusa 스키마는 **3주 밀려** 있었으며 `coupon_grant` 테이블 자체가 없었다. 그 상태로 검증을 돌렸으면
판정 SQL 이 죽고 결과는 전부 무의미했다.

**그래서 매 세션 시작은 이것이다:**

```bash
bash scripts/local/preflight-e2e.sh
```

컨테이너·포트·프로세스 신선도·스키마·시드·조용히 죽는 env 키·포트 충돌을 한 번에 잰다. ✗ 가 있으면 그것부터.

---

## 1. 앱 지도 — **11개다** (2차 지침서는 8개로 적었다)

| 앱 | 포트 | 왜 필요한가 | 기동 |
|---|---|---|---|
| user-service | 3000 | IdP. 가입·로그인·역할 | `npx dotenv -e apps/user-service/.env -- nest start user-service` |
| membership | 3001 | 멤버십 트리거 | `npx dotenv -e apps/membership/.env -- nest start membership` |
| channel-adapter | **3003** | 이벤트 인박스·외부채널 | `npm run start:channel-adapter:dev` |
| file-service | **3010** | **상품 이미지 업로드** | `npx dotenv -e apps/file-service/.env -- nest start file-service` |
| **core** | **3100** | 🔴 **어드민 주문조회·출고·매칭이 전부 여기** | `npx dotenv -e apps/core/.env -- nest start core` |
| **wallet-web** | **3200** | 🔴 **결제 화면. 체크아웃이 이리로 넘어간다** | `npm run start:wallet-web:dev` |
| wallet | 5001 | 결제·포인트 백엔드 | `npx dotenv -e apps/wallet/.env -- nest start wallet` |
| storefront | 8000 | 쇼핑몰 | `(cd web/almondyoung-storefront && npm run dev)` |
| auth-web | 8001 | 로그인/가입 UI | `(cd web/auth-web && npm run dev)` |
| admin-web | 8002 | 관리자 | `(cd apps/admin-web && npm run dev)` |
| Medusa | 9000 (+**19000** 메트릭) | 커머스 코어 | `(cd apps/medusa && npx medusa develop)` |

**2차 지침서에 없어서 3차가 결제에서 막힌 원인이 `wallet-web` 이다.** 체크아웃 「결제하기」는
`localhost:3200/auth/handoff?...` 로 넘어간다. 그 앱이 없으면 브라우저가 그냥 에러 페이지를 띄운다.

**`core` 는 이번에 안 띄웠다** — 그래서 admin-web 콘솔에 `/proxy/api/sales-orders/stats` 재시도가 무한히 찍혔다.
다음 세션의 「주문조회·매칭」은 core 없이는 성립하지 않는다.

---

## 2. 준비 순서 — 이 순서를 지켜야 한다

```bash
# ① 컨테이너. 🔴 kafka 를 recreate 하면 zookeeper 에 옛 broker znode 가 남아 즉사한다.
docker compose up -d postgres redis
docker compose stop kafka && docker compose restart zookeeper && docker compose up -d kafka
until (echo > /dev/tcp/127.0.0.1/9092) 2>/dev/null; do sleep 2; done   # 9092 가 열릴 때까지 기다린다

# ② 마이그레이션 — drizzle 과 Medusa 는 별개다. 둘 다 해야 한다.
npm run db:migrate:local          # 🔴 search 에서 멈춘다. Ctrl+C 해도 된다 — 아래 줄이 진짜다.
DBU=$(grep -m1 '^DATABASE_URL=' apps/user-service/.env | cut -d= -f2- | tr -d '"'"'"' ')
DATABASE_URL="$DBU" npx drizzle-kit migrate --config apps/user-service/database/drizzle/drizzle.config.ts
(cd apps/medusa && npx medusa db:migrate --execute-safe-links)

# ③ 시드 3종
npm run db:seed:user-service:local                    # 역할·admin 계정·OAuth 클라이언트 3개
npx tsx scripts/local/seed-wallet-local.ts            # 🔴 결제수단·지역. 없으면 결제 불가
(cd apps/medusa && npx medusa exec ./src/scripts/seed.ts && npx medusa exec ./src/scripts/seed-shipping.ts)

# ④ SMS 스텁 (회원가입 폰 인증)
nohup node scripts/local/sms-stub.js > logs/sms-stub.log 2>&1 &

# ⑤ 앱 기동 — kafka 가 «열린 뒤» 여야 한다 (§3 참조)
```

🔴 **`npm run db:migrate:local` 은 `search` 에서 멈춘다.** `SERVICES` 목록에서 `user_service` 가 `search`
**뒤**에 있어, 스크립트를 그냥 돌리면 **user-service 는 영영 마이그레이션되지 않는다.** 그 결과는 §4 참조.

---

## 3. 🔴 포트 충돌 — 손봐야 한다

`apps/channel-adapter/.env` 와 `apps/file-service/.env` 가 **둘 다 `PORT=3010`** 이다.
`scripts/local/start-all.sh` 는 channel-adapter 를 **3003** 으로 본다.

현재 상태로는 **먼저 뜬 쪽이 이기고 다른 쪽은 죽는다.** 그리고 admin-web 의 `FILE_SERVICE_URL=http://localhost:3010`
이므로, channel-adapter 가 3010 을 쥐면 **파일 업로드가 channel-adapter 로 간다.**

```bash
# channel-adapter 를 start-all.sh 와 맞춘다
sed -i 's/^PORT=3010/PORT=3003/' apps/channel-adapter/.env
# 메트릭 포트도 따라간다 (PORT+10000): 13010 → 13003
```

**앱 3개(channel-adapter·wallet·membership)는 kafka 없이 부팅 중 «죽는다».** 경고가 아니라
`KafkaJSNonRetriableError` 로 프로세스가 종료된다. 재시도 5회를 태우고 죽으므로 kafka 와 동시에 띄우면 진다.

---

## 4. env 파일 — **없어서 조용히 죽는 것들**

`.env` 는 전부 gitignore 다. 아래는 **템플릿에 없어서 직접 넣어야 하는** 것만 모았다.

| 파일 | 넣을 것 | 없으면 |
|---|---|---|
| `apps/medusa/.env` | `PORT=9000` | `:19000/metrics` 가 **아예 안 열린다**. 앱은 멀쩡히 뜨고 메트릭만 조용히 없다 |
| `apps/medusa/.env` | `COUPON_AUTO_ISSUE_ENABLED=true` | 쿠폰 자동발급 API 가 빈 배열만 반환 |
| `apps/admin-web/.env.local` | `WALLET_SERVICE_URL=http://localhost:5001` | 적립금 화면이 조용히 죽는다(통계가 전부 `0` 으로 보인다) |
| `apps/user-service/.env` | `NOTIFICATION_SERVICE_URL=http://127.0.0.1:3099`<br>`NOTIFICATION_INTERNAL_KEY=local-rehearsal-stub-key` | 회원가입 폰 인증이 **503** → 가입 UI 를 못 지난다 |
| **`apps/wallet-web/.env.local`** | **파일 자체가 없다.** 아래 전문 | 결제 페이지가 `Missing required env var: OIDC_ISSUER_URL` 로 죽는다 |

### `apps/wallet-web/.env.local` (전문 — 그대로 만들 것)

```bash
# OIDC — wallet-web 자체가 RP다 (lib/auth/env.ts 가 6개를 전부 required 로 요구)
OIDC_ISSUER_URL=http://localhost:3000
OIDC_AUTHORIZATION_URL=http://localhost:8001/oauth/authorize
OIDC_CLIENT_ID=wallet-web
OIDC_CLIENT_SECRET=local-rehearsal-medusa-storefront-secret
OIDC_REDIRECT_URI=http://localhost:3200/auth/callback
OIDC_POST_LOGOUT_REDIRECT_URI=http://localhost:3200
OAUTH_JWKS_URL=http://localhost:3000/.well-known/jwks.json

# wallet API
WALLET_API_URL=http://localhost:5001
NEXT_PUBLIC_WALLET_API_URL=http://localhost:5001
WALLET_API_KEY=dev-secret

# 결제 후 스토어프론트로 복귀 허용
WALLET_ALLOWED_RETURN_ORIGINS=http://localhost:8000
ALLOWED_RETURN_HOST_SUFFIXES=localhost
```

🟢 `wallet-web` 은 **이미 `oauth_clients` 에 시드돼 있다**(redirect `http://localhost:3200/auth/callback`).
클라이언트 등록은 필요 없고 `.env.local` 만 만들면 된다. `OIDC_CLIENT_SECRET` 은 로컬 RP 3개가 공유하는
`seed-user-service-local.ts` 의 `LOCAL_CLIENT_SECRET` 기본값이다.

### 값이 어긋나면 조용히 401/400 이 되는 3쌍

`OAUTH_INTERNAL_SECRET`(user-service↔auth-web) · `OIDC_CLIENT_SECRET`(RP 3개↔`oauth_clients` 시드) ·
`WALLET_API_KEY`(medusa↔wallet↔wallet-web).

---

## 5. 계정과 로그인

| 용도 | 아이디 | 비밀번호 |
|---|---|---|
| 관리자 | **`admin`** | `Rehearsal1234!` |
| 구매자(기존) | `buyer01` · `s2buyer01` · `s2buyer02` · `test01` | 각자 다름 |

🔴 **로그인 식별자는 이메일이 아니라 `users.login_id` 다.** `admin@almondyoung.com` 을 넣으면
입력칸 글자수 제한에 걸린다. 비밀번호 기본값은 `scripts/local/seed-user-service-local.ts` 의 `LOCAL_ADMIN_PASSWORD`.

🔴 **스토어프론트 로그인 URL 은 `/kr/login`** 이다. `(account)` 는 괄호 route group 이라 URL 에 안 들어간다 —
`/kr/account/login` 은 404.

### 회원가입 (폰 인증)

`user-service` 는 인증문자를 notification 의 `POST /internal/sms/send` 에 위임한다. **notification 을 실제로
띄우면 안 된다** — 프로바이더가 NHN SMS 라 실 번호로 발송된다. 대신 스텁을 쓴다:

```bash
node scripts/local/sms-stub.js &      # :3099, 외부로 아무것도 안 보낸다
```

번호는 아무 값이나 되고, **인증번호는 두 곳에서 읽는다**:

```bash
tail -3 logs/sms-stub.log                                  # [SMS-STUB] … 인증번호: 515266
psql "$USER_SERVICE_DB" -c "SELECT phone_number, code, expires_at FROM phone_verifications ORDER BY created_at DESC LIMIT 1;"
```

코드는 **평문 6자리, 유효 3분**. 저장이 발송과 같은 트랜잭션이라 스텁이 성공을 줘야 행이 남는다.

---

## 6. 🔴 크롬으로 사람처럼 조작할 때의 함정

### ① 어드민과 고객을 «동시에» 유지할 수 없다

**`localhost` 쿠키는 포트를 구분하지 않는다.** 스토어프론트(:8000)에서 고객으로 로그인하면
admin-web(:8002)의 어드민 세션까지 그 고객으로 **교체된다.** 라이브는 도메인이 달라 안 겹치지만 로컬은 겹친다.

증상: 어드민 화면이 멀쩡히 보이는데 백엔드 호출만 **403**. 우상단 아바타 글자가 바뀌어 있는 게 유일한 단서다.

**대책 — 셋 중 하나를 반드시 정하고 시작할 것:**
- **(권장) 브라우저 프로필/시크릿 창을 분리한다** — 어드민용 창과 고객용 창을 따로 연다
- 또는 작업을 **어드민 구간 / 고객 구간으로 묶어** 순서대로 하고, 구간이 바뀔 때마다 재로그인한다
- 매번 재로그인은 사람이 해야 한다 (아래 ③)

### ② `BYPASS_AUTH=true` 가 그 함정을 숨긴다

`apps/admin-web/.env.local` 의 `BYPASS_AUTH=true` 는 admin-web **자기 미들웨어·라우트 가드만** 건너뛴다.
프록시가 백엔드로 보내는 토큰은 그대로다. 그래서 세션이 일반 사용자로 강등돼도 **로그인 화면으로 안 내쫓고**,
화면은 다 보이는데 모든 API 가 403 이 된다.

### ③ 에이전트가 못 하는 두 가지

**비밀번호 입력과 계정 생성은 에이전트가 하지 않는다.** 사람이 해야 하는 지점은 정확히 둘이다 —
**어드민 최초 로그인**과 **신규 가입 + 스토어프론트 첫 로그인**. 세션 시작 시 미리 알리고,
그 차례가 오기 전에 다시 알릴 것. 그때 가서 막히면 흐름이 끊긴다.

### ④ 화면과 로그를 성공 증거로 쓰지 말 것

- **스토어프론트 OIDC 콜백은 실패해도 HTTP 200 이다** (`callback/oidc/route.ts` 의 `renderError`).
  로그의 `GET /kr/callback/oidc … 200` 은 성공을 뜻하지 않는다. 실제로 Medusa 는 **401** 이었다.
  → 로그인 성공 판정은 **`SELECT … FROM customer`** 로 한다.
- **화면이 API 실패를 `0` 으로 그린다** (적립금 통계 4칸). 「데이터가 없다」와 「권한이 없다」가 같아 보인다.
- Medusa customer 는 **스토어프론트 첫 로그인 때** 생긴다. 가입만으로는 안 생긴다.

---

## 7. 검증 판정은 DB 로

화면·로그가 못 미더우므로 각 단계의 근거를 DB 에서 읽는다. DB URL 은 각 앱 `.env` 의 `DATABASE_URL`.

| 단계 | 판정 |
|---|---|
| 가입 | `user_service.users` 에 `login_id` 행 |
| 스토어프론트 로그인 | `medusa.customer` 에 `has_account=t` 행 (**이게 생겨야 로그인된 것**) |
| 장바구니 | `medusa.cart` |
| 쿠폰 적용 | 체크아웃 합계 변화 + `medusa.promotion` |
| 결제 | `wallet.payment_intents` · `wallet.point_events` |
| 주문 | `medusa.order` + `medusa.order_cart` 링크 |
| 주문조회·매칭 | core DB (앱 `apps/core/.env`) |

---

## 8. ⛔ 미해결 — 다음 세션의 첫 관문

**포인트 전액(0원) 결제가 승인되지 않는다.**

```
결제 화면(:3200)에서 포인트 전액 사용 → 결제금액 0원 → 「0원 결제하기」
→ Medusa: Error was thrown trying to authorize payment session - payses_… was not authorized with the provider
```

- 직전에 `POST /hooks/payment-events ← 200` 이 있으므로 **wallet → Medusa 웹훅은 도달했다**
- 결제수단 시드(§2 ③)를 넣은 **뒤에도** 재현된다
- 원인 미규명. **0원 승인 경로**가 의심되나 확인 안 됨

**이게 풀려야 「결제 → 주문 → 주문조회」가 이어진다.** 다음 세션은 여기서 시작하는 게 맞다.
우회하고 싶으면 포인트를 일부만 쓰고 나머지를 다른 수단으로 태우는 조합을 먼저 시도해 볼 것
(결제수단은 「카드 간편결제」·「무통장입금」 두 종이 시드된다).

---

## 9. 이번에 신설한 것

| 파일 | 무엇 |
|---|---|
| `scripts/local/preflight-e2e.sh` | 사전 점검. 세션 시작마다 돌린다 |
| `scripts/local/seed-wallet-local.ts` | 로컬 wallet reference 시드(결제수단·지역). 이게 없어 결제가 막혔다 |
| `scripts/local/sms-stub.js` | 폰 인증용 로컬 SMS 스텁. 외부 발송 없음 |
| `docs/local-e2e-environment.md` | 이 문서 |

---

## 10. 다음 세션 시작 프롬프트 (복붙용)

```
로컬 전 과정(E2E) 검증 환경을 세우고, 크롬으로 사람이 하듯 전 과정을 확인한다.
검증 범위: 관리자 액션 · 회원가입 · 장바구니 · 쿠폰 적용 · 결제 · 어드민 주문조회 · 매칭.

환경 문서: docs/local-e2e-environment.md — 먼저 전문을 읽어라. 정본은 docs/local-dev.md 이고
이 문서는 거기에 없던 것만 모은 것이다. 앱은 8개가 아니라 «11개» 다(core·file-service·wallet-web 포함).

시작 절차:
  1. bash scripts/local/preflight-e2e.sh  → ✗ 를 전부 해결하고 시작한다
  2. ⛔ 미해결 블로커는 §8 의 «0원 결제 승인 실패» 다. 여기서 시작하는 게 맞다.

규칙:
  - 「떠 있다」를 「최신이다」로 읽지 마라. 프로세스 기동 시각과 스키마를 먼저 재라(§0).
  - 성공 판정은 화면·로그가 아니라 DB 로 한다(§7). 콜백은 실패해도 200 을 준다.
  - 🔴 비밀번호 입력과 계정 생성은 네가 하지 않는다. 사람이 해야 하는 지점 둘(§6-③)을
    «시작할 때» 미리 알리고, 그 차례가 오기 전에 다시 알려라.
  - 🔴 어드민과 고객을 한 브라우저에서 동시에 유지할 수 없다(§6-①). 시작 전에 창 분리 여부를 정하라.
  - 막히면 2~3회 만에 멈추고 물어라. 환경 결함이 계속 나오는 영역이다.
  - 새로 발견한 환경 결함은 그때그때 이 문서에 추가하고 커밋해라.
```

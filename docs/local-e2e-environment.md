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
npm run db:migrate:local          # 11개 논리 DB 전부 (dev_core 포함). 이제 안 멈춘다 — 아래 참조
(cd apps/medusa && npx medusa db:migrate --execute-safe-links)

# ③ 시드 5종 + 🔴 키 동기화 1
npm run db:seed:user-service:local                    # 역할·admin 계정·OAuth 클라이언트 3개
npx tsx scripts/local/seed-wallet-local.ts            # 🔴 결제수단·지역. 없으면 결제 불가
npm run db:seed:core:local                            # 🔴 판매채널(수집 게이트) + 매칭 레코드 backfill
(cd apps/medusa && npx medusa exec ./src/scripts/seed.ts && npx medusa exec ./src/scripts/seed-shipping.ts)
npm run sync:medusa-keys:local                        # 🔴 §2-A. 안 하면 storefront·수집이 «조용히» 401
npm run db:seed:points:local                          # 적립금. 🔴 §2-B — 새 DB 에선 대상 계정을 직접 준다

# ④ SMS 스텁 (회원가입 폰 인증)
nohup node scripts/local/sms-stub.js > logs/sms-stub.log 2>&1 &

# ⑤ 앱 기동 — kafka 가 «열린 뒤» 여야 한다 (§3 참조)
```

### 🔴 §2-A. Medusa 를 초기화하면 «하드코딩된 API 키 4개»가 전부 죽는다

2026-09-06 전체 초기화에서 실제로 밟았다. `medusa` DB 를 밀고 다시 시드하면 API 키가 새로 발급되는데,
그 값이 `.env` **와 커밋된 템플릿**에 박혀 있다:

| 키 | 박혀 있던 곳 | 죽으면 |
|---|---|---|
| `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` | storefront `.env.local` **+ `env-templates/.env.storefront.local.example`** | Store API 401 → 화면은 **「상품이 없습니다」**로만 보인다 |
| `MEDUSA_API_KEY`(secret) | channel-adapter `.env` · admin-web `.env.local` | 주문 수집 401 → 어드민 주문조회가 **「0건」** |

**증상이 전부 「0건」이라 환경 문제로 안 보인다.** 그래서 스크립트로 옮겼다:

```bash
npm run sync:medusa-keys:local        # scripts/local/sync-medusa-keys.sh
```

DB 에서 publishable(`title='Webshop'`)을 읽어 넣고, secret 은 **지금 값이 아직 유효한지 실제 호출로 재서**
무효일 때만 새로 발급한다(`create-local-secret-key.ts`). 끝에 `store/regions`·`admin/orders` 를 쳐서
둘 다 200 인지 확인한다. 🔴 **secret 토큰은 DB 에 해시로 저장된다** — 평문은 발급 시 1회뿐이라
「DB 에서 읽어 복구」가 원리적으로 불가능하다. 반영하려면 세 앱을 **재기동**해야 한다.

### 🔴 §2-B. `db:seed:points:local` 의 기본 대상 계정은 새 DB 에 «없다»

user-service 시드가 만드는 계정은 **`admin` 하나뿐**이다(`buyer01`·`s2buyer01` 등은 옛 세션에서 손으로
만든 것이라 초기화하면 사라진다). 그래서 인자 없이 돌리면 아무에게도 적립되지 않는다.
가입을 «먼저» 하고 그 아이디를 준다:

```bash
LOCAL_POINT_LOGIN_IDS=<가입한아이디> npm run db:seed:points:local
```

⚠️ `apps/medusa/src/scripts/seed.ts` 는 **상품을 만들지 않는다**(store·region·tax·publishable key·
sales channel 까지만). 앞선 판이 `reh-a`·`reh-b`·`reh-c` 를 이 시드의 산물로 적은 것은 **틀렸다** —
그건 옛 세션에서 따로 만든 것이다. 초기화 직후 Medusa 상품은 **0개**이고, §8-D 로 직접 만들어야 한다.

🟢 **(2026-09-06 해결) `db:migrate:local` 이 `search` 에서 멈추던 원인은 «논리 DB `search` 가 없어서»였다.**
`init-db.sql` 은 DB 11개를 만드는데 그 목록에 `search` 가 없다. drizzle-kit 은 없는 DB 에 대해 에러가 아니라
**무한 재시도**를 하므로 스크립트가 거기서 굳었고, 목록상 뒤에 있던 `user_service` 는 **영영 마이그레이션되지
않았다.** `migrate-all.sh` 가 이제 **없는 DB 를 만들고**, 서비스당 180초 타임아웃 뒤 다음으로 넘어간다.

🔴 **`apps/core/.env` 는 `core` 가 아니라 `dev_core` 를 쓴다.** 그런데 `migrate-all.sh` 의 목록엔 `core` 만
있었다 — 즉 **core 만 조용히 스키마가 밀린다.** 2026-09-06 실측에서 `dev_core` 는 3개 밀려 있었다
(migrations 82 vs `core` 85). 목록에 `dev_core` 를 추가해 고쳤다. `core` 는 통합테스트·`refresh-from-live`
전용이고 **E2E 로 띄우는 core 가 보는 DB 는 `dev_core` 다** — 판정 SQL 을 `core` 에 날리면 안 된다.

---

## 3. 🟢 (해결) 포트 충돌 — `.env` 는 gitignore 라 머신마다 다시 밟는다

`apps/channel-adapter/.env` 와 `apps/file-service/.env` 가 **둘 다 `PORT=3010`** 이었다.
`scripts/local/start-all.sh` 는 channel-adapter 를 **3003** 으로 본다.

증상이 고약하다: **먼저 뜬 쪽이 이기고 다른 쪽은 조용히 죽는다.** 2026-09-06 실측에서 실제로
channel-adapter 가 3010 을 쥐고 file-service 는 아예 안 떠 있었는데, preflight 는 **「3010 file-service ✓」로
초록을 줬다** — 포트가 열렸는지만 보고 «누가» 쥐었는지는 안 보기 때문이다. admin-web 의
`FILE_SERVICE_URL=http://localhost:3010` 이므로 그 상태에서 **상품 이미지 업로드는 channel-adapter 로 간다.**

```bash
# channel-adapter 를 start-all.sh 와 맞춘다 (.env 는 gitignore — 새 머신에선 다시 해야 한다)
sed -i 's/^PORT=3010/PORT=3003/' apps/channel-adapter/.env
# 메트릭 포트도 따라간다 (PORT+10000): 13010 → 13003
```

⚠️ **preflight 의 포트 검사는 «열림»만 본다.** 포트가 초록이어도 그 앱이 맞는지는 별개다.

**앱 3개(channel-adapter·wallet·membership)는 kafka 없이 부팅 중 «죽는다».** 경고가 아니라
`KafkaJSNonRetriableError` 로 프로세스가 종료된다. 재시도 5회를 태우고 죽으므로 kafka 와 동시에 띄우면 진다.

---

## 4. env 파일 — **없어서 조용히 죽는 것들**

`.env` 는 전부 gitignore 다. **템플릿은 `env-templates/` 에 있다** — `.env.<앱>.local.example` 을
각 앱 위치로 복사한다(`docs/local-dev.md` §141). 파일이 전부 dotfile 이라 `ls` 로는 안 보인다;
`ls -a env-templates/` 로 봐야 한다.

🔴 **템플릿 자체가 틀려 있던 것 하나** (2026-09-06 수정): `.env.core.local.example` 의
`OIDC_ISSUER_URL` 이 **라이브**(`https://user.almondyoung.com`)를 가리켰다 — 아래 항목의 발원지다.
복사만 하면 그대로 어드민 API 전량 401 을 맞는다.

같은 날 템플릿에 보탠 것: `core`·`channel-adapter` 의 `CORE_INTERNAL_KEY`, channel-adapter 의
`PORT=3003`·`PIM_API_URL`, admin-web·auth-web 의 `127.0.0.1` 값들, admin-web `WALLET_SERVICE_URL`,
그리고 **없던 두 개** — `.env.wallet-web.local.example` · `.env.channel-adapter.local.example`.

아래는 그럼에도 **직접 판단해 넣어야 하는** 것들이다.

| 파일 | 넣을 것 | 없으면 |
|---|---|---|
| `apps/medusa/.env` | `PORT=9000` | `:19000/metrics` 가 **아예 안 열린다**. 앱은 멀쩡히 뜨고 메트릭만 조용히 없다 |
| `apps/medusa/.env` | `COUPON_AUTO_ISSUE_ENABLED=true` | 쿠폰 자동발급 API 가 빈 배열만 반환 |
| `apps/admin-web/.env.local` | `WALLET_SERVICE_URL=http://localhost:5001` | 적립금 화면이 조용히 죽는다(통계가 전부 `0` 으로 보인다) |
| `apps/user-service/.env` | `NOTIFICATION_SERVICE_URL=http://127.0.0.1:3099`<br>`NOTIFICATION_INTERNAL_KEY=local-rehearsal-stub-key` | 회원가입 폰 인증이 **503** → 가입 UI 를 못 지난다 |
| **`apps/wallet-web/.env.local`** | **파일 자체가 없다.** 아래 전문 | 결제 페이지가 `Missing required env var: OIDC_ISSUER_URL` 로 죽는다 |
| **`apps/core/.env`** | **`OIDC_ISSUER_URL=http://localhost:3000`** | 🔴 아래 별도 항목 — **어드민 API 전부 401** |

### 🔴 `apps/core/.env` 의 `OIDC_ISSUER_URL` 이 라이브를 가리킨다

2026-09-06 실측에서 이 값이 **`https://user.almondyoung.com`(라이브 IdP)** 이었다.
`libs/authorization` 은 이 값으로 `${OIDC_ISSUER_URL}/.well-known/jwks.json` 을 만들어 토큰 서명을 검증한다.
로컬 user-service 는 `kid=lcnine-auth-local-1` 로 서명하는데 라이브 JWKS 에 그런 키가 있을 리 없다 →
**core 의 모든 어드민 API 가 401.**

증상이 §6-④ 그 자체다: 주문조회 화면은 **「총 주문 0건」** 을 멀쩡히 그렸고, 타일은 `-` 였다.
로그를 봐야 진실이 나온다:

```bash
grep 'Unable to find a signing key' logs/core.log     # core 쪽 진짜 사유
grep 'sales-orders' logs/admin-web.log | tail          # 401 인지 200 인지
```

`http://localhost:3000` 으로 바꾸고 core 를 재기동하면 `200`. `ALLOWED_AUDIENCES` 는 비어 있으면
`aud` 를 검사하지 않으므로 건드릴 필요 없다(`jwt-access.strategy.ts:114`).

### ⚠️ `analytics`(3040)·`ugc-service`(3030) 는 `.env` 가 아예 없다

그래서 **부팅하다 죽는다** — `EventsModule.forApp` 이 kafka 설정 `null` 을 읽고
`TypeError: Cannot read properties of null (reading 'clientId')`.

이 둘은 위 11개 목록 «밖»이라 E2E 검증엔 필요 없지만, **어드민 대시보드가 호출한다**:
`/api/proxy/analytics/summary` 가 `ECONNREFUSED :3040` 으로 **500**, 「미답변 리뷰」 타일은 빈칸.
대시보드에서 그 두 칸이 비는 건 **정상이다** — 주문·결제 판정과는 무관하다.

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

### ① 어드민과 고객을 «동시에» 유지할 수 없다 — **127.0.0.1 우회는 성립하지 않는다**

**`localhost` 쿠키는 포트를 구분하지 않는다.** 스토어프론트(:8000)에서 고객으로 로그인하면
admin-web(:8002)의 어드민 세션까지 그 고객으로 **교체된다.** 2026-09-06 재확인 — 어드민으로 로그인한
직후 스토어프론트를 열자 상단이 **「관리자 · 로그아웃」**으로 떠 있었다. 라이브는 도메인이 달라 안 겹친다.

#### 🔴 (2026-09-06 철회) 앞선 판의 「어드민을 `127.0.0.1:8002` 로 열면 두 세션이 공존한다」는 **틀렸다**

그 처방대로 세팅하면 어드민 로그인이 **`/login?error=state_cookie_missing` 무한 루프**에 빠진다.
원인은 `ALLOWED_REDIRECT_HOSTS` 가 아니다. 둘이다:

1. **`AUTH_WEB_ORIGIN` 이 체인을 다시 `localhost` 로 되돌린다.** auth-web 의
   `app/oauth/authorize/page.tsx:34` 가 복귀 URL 을 `${env.selfOrigin}${…}` 로 만드는데
   `selfOrigin` 은 `AUTH_WEB_ORIGIN`(=`http://localhost:8001`) 한 값이다. RP 만 127.0.0.1 로
   옮기면 로그인 도중 호스트가 갈린다.
2. **더 근본적인 것 — `request.nextUrl.origin` 이 Host 를 무시한다.** admin-web 의
   `src/app/auth/callback/route.ts` 는 성공/실패 리다이렉트를 **절대 URL**로 만드는데
   (`new URL(stateRecord.redirectTo, request.nextUrl.origin)` · `failRedirect`),
   Next 15.5.7 dev 는 이 origin 을 **언제나 `http://localhost:8002`** 로 준다. 실측:

   ```bash
   curl -sS -o /dev/null -D - 'http://127.0.0.1:8002/auth/callback' | grep -i location
   # location: http://localhost:8002/login?error=missing_code_or_state   ← Host 는 127.0.0.1 이었다
   ```

   그래서 콜백이 **127.0.0.1 에 세션 쿠키를 심어 놓고 localhost 로 돌려보낸다.** 쿠키는 고아가 되고
   미들웨어는 세션이 없다고 판단해 다시 `/login` → authorize → 콜백 … 이 무한히 돈다.
   `next dev -H 127.0.0.1` 로 바인딩을 바꿔도 **결과는 같다**(실측). 즉 이건 설정으로 못 푼다 —
   admin-web 이 리다이렉트를 상대 경로로 만들어야 풀리는 **코드 쪽 제약**이다.

#### ✅ 그래서 이렇게 한다 — 호스트는 전부 `localhost`, 구간을 «순서대로»

`AUTH_WEB_ORIGIN`·모든 RP 의 `OIDC_AUTHORIZATION_URL`·`OIDC_REDIRECT_URI` 를 **`localhost` 로 통일**하고
(즉 앞선 판이 지시한 127.0.0.1 치환을 **되돌리고**), 어드민과 고객을 **섞지 말고 순서대로** 한다:

| 구간 | 하는 일 | 끝나면 |
|---|---|---|
| A. 어드민 | 상품 생성·가격정책·발행, 쿠폰 생성 | `GET localhost:8002/api/auth/signout` 으로 로그아웃 |
| B. 고객 | 가입·로그인·장바구니·쿠폰·결제·주문 | 그대로 둔다 |
| C. 어드민 | 주문조회·매칭 | 고객 세션은 여기서 죽는다 (검증은 이미 끝났다) |

세션이 하나뿐이므로 **구간을 넘을 때마다 재로그인**한다. B→C 재로그인은 계정 허브에 저장된
계정을 고르면 비밀번호 없이 넘어간다.

🔴 **구간 A→B 로 넘어갈 때 로그아웃은 «어드민 쪽에서» 해야 한다.** 스토어프론트의 「로그아웃」을
눌러도 상단은 그대로 「관리자」였다(실측) — 그 쿠키를 심은 건 admin-web 이기 때문이다.
`http://localhost:8002/api/auth/signout` 을 열면 한 번에 지워진다.

### ② `BYPASS_AUTH=true` 가 그 함정을 숨긴다 — **E2E 에선 꺼라**

`apps/admin-web/.env.local` 의 `BYPASS_AUTH=true` 는 admin-web **자기 미들웨어·라우트 가드만** 건너뛴다.
프록시가 백엔드로 보내는 토큰은 그대로다. 그래서 세션이 일반 사용자로 강등돼도 **로그인 화면으로 안 내쫓고**,
화면은 다 보이는데 모든 API 가 403 이 된다.

**E2E 검증에서는 `BYPASS_AUTH=false` 로 둔다.** 실제 OIDC 로그인을 하므로 켜 둘 이유가 없고, 꺼 두면
세션이 깨졌을 때 403 으로 숨는 대신 로그인 화면으로 튕겨 **즉시 보인다.**
(MSW 로 화면만 보려는 개발에는 `true` 가 맞다 — 용도가 다르다.)

### ③ 비밀번호·계정 생성 — 에이전트가 해도 된다

앞선 판에는 「비밀번호 입력과 계정 생성은 사람이 한다」고 적혀 있었다. 그건 **기술적 제약이 아니라
남의 비밀번호를 대신 타이핑하지 않는다는 일반 가드레일**이었고, 여기엔 적용할 대상이 없다 —
쓰는 값이 `scripts/local/seed-user-service-local.ts` 에 **평문으로 커밋된 로컬 시드 비밀번호**
(`Rehearsal1234!`)이고 계정은 로컬 일회용이다. 보호할 비밀이 없다.

**그러니 에이전트가 끝까지 간다 — 어드민 로그인도, 폰 인증을 포함한 신규 가입도.** 사람 개입 0회.
(라이브·스테이징 자격증명이면 얘기가 다르다. 이 면제는 **로컬 시드 값에 한정**된다.)

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

## 8. 🟢 (해결) 결제 — 「0원 결제」는 범인이 아니었다

앞선 판은 이렇게 적혀 있었다: *「포인트 전액(0원) 결제가 승인되지 않는다 … 0원 승인 경로가 의심된다」*.
**틀렸다.** 2026-09-06 실측에서 **포인트 전액 0원 결제는 그대로 성공했다** — 주문 생성까지 갔다.

같은 증상(`Session: payses_… was not authorized with the provider`)이 **무통장입금 11,500원에서도 똑같이**
난다. 즉 금액이 0인지와 무관하다. 그 문구는 **Medusa 가 만드는 최종 문장일 뿐 원인을 담지 않는다.**

### 진짜 원인을 읽는 곳

Medusa 는 `almond-payment` provider 의 `authorizePayment` 가 `'pending'` 을 돌려주면 저 문장을 던진다.
`'pending'` 이 나오는 경로는 하나다 — wallet 의 `finalize-approval` 이 **409 `NO_STAGED_APPROVAL`** 을
줬고 intent 가 `CREATED` 로 남은 것. **왜 적재분이 없는지는 `charges` 행에만 적혀 있다:**

```bash
W=postgresql://postgres:postgres@localhost:5432/wallet
psql "$W" -c "select id,status,payable_amount,metadata from payment_intents order by created_at desc limit 3;"
psql "$W" -x -c "select operation,status,error_code,error_message from charges
                 where intent_id='<위 intent id>';"
```

2026-09-06 실측에서 나온 값: `error_code=BANK_TRANSFER_BANK_NOT_CONFIGURED`,
`error_message=TOSS_VIRTUAL_ACCOUNT_BANK is not configured`. **화면에도 Medusa 로그에도 없는 문장이다.**

### 로컬에서 쓸 수 있는 결제수단은 «포인트» 하나다

`apps/wallet/.env` 에 `TOSS_*` 가 **하나도 없다**. 그런데

- **카드 간편결제** → 토스 결제창·승인 API (`TOSS_CLIENT_KEY`/`TOSS_SECRET_KEY`)
- **무통장입금** → 토스 «가상계좌 발급» API (`TOSS_SECRET_KEY` + `TOSS_VIRTUAL_ACCOUNT_BANK`)

둘 다 외부 PG 를 실제로 부른다. 그러므로 **로컬 E2E 의 결제는 포인트로 한다.**
적립금은 **시드로 넣는 게 빠르다** — 어드민 화면을 거칠 필요 없다:

```bash
npm run db:seed:points:local                        # 기본 구매자 4명에게 100,000P
LOCAL_POINT_LOGIN_IDS=e2e01 npm run db:seed:points:local   # 새로 만든 계정에
```

결제 화면에서 「전액 사용」을 누르면 0원 결제로 주문이 생성된다.
(어드민 경로도 물론 된다: `/payments/points` → 사용자 검색 → 적립금 지급)

🔴 **지연 승인(deferred approval)은 TOSS 전용이다.** `readStagedApproval()` 은
`staged.provider !== 'TOSS'` 이면 무조건 `null` 을 돌려준다(`deferred-approval.ts`).
즉 `ALMOND_DEFERRED_APPROVAL` 이 켜진 상태(기본값)에서 **무통장입금은 Toss 키를 다 채워도
`NO_STAGED_APPROVAL` 로 실패한다.** 로컬에서 무통장입금을 꼭 봐야 한다면
`apps/medusa/.env` 에 `ALMOND_DEFERRED_APPROVAL=false` 를 넣어 즉시승인 경로로 되돌려야 한다.

🟢 **승인이 실패해도 주문은 안 남는다.** 실패한 무통장 시도는 `medusa."order"` 에 행을 남기지 않았다
(`order_cart` 에 링크 한 줄만 남는다). 워크플로 롤백은 제대로 동작한다.

---

## 8-B. 🔴 주문 수집 게이트 — 주문을 만들어도 core 로 안 흘러온다

Medusa 에 주문이 생겨도 **core 의 `sales_orders` 에는 저절로 생기지 않는다.** channel-adapter 가
5분마다 폴링해 가져오는데, 그 앞에 게이트가 셋 있고 **로컬에선 셋 다 닫혀 있었다**(2026-09-06 실측).

증상은 로그 한 줄로만 드러난다. 어드민 주문조회는 그냥 「0건」이다:

```bash
grep '활성 판매채널' logs/channel-adapter.log | tail -3
# 활성 판매채널 조회에 실패해 이번 주기의 모든 채널을 건너뛴다 (워터마크 불변):
#   CORE_INTERNAL_KEY 가 설정되지 않아 활성 판매채널을 조회할 수 없다
```

**열어야 하는 것 셋:**

| 무엇 | 어디 | 값 |
|---|---|---|
| `CORE_INTERNAL_KEY` | `apps/core/.env` **와** `apps/channel-adapter/.env` | 아무 값이나, **둘이 같아야** 한다 |
| `PIM_API_URL` | `apps/channel-adapter/.env` | `http://localhost:3100` |
| `sales_channels` 행 | core DB(`dev_core`) | `site='medusa'`, `is_active=true` 1행 |

🔴 **`PIM_API_URL` 의 기본값은 `http://localhost:3001` 이다 — membership 포트다**
(`sales-channel.client.ts:27`). 안 적으면 엉뚱한 서비스에 물어보게 된다. core 는 3100 이다.

🔴 **`sales_channels` 는 로컬에서 0행이다.** 활성 채널이 없으면 수집할 대상이 없어 게이트가 닫힌 채로 조용하다.

**정본 시드가 이미 있다 — 손으로 INSERT 하지 말 것.** `PimSeedStep` 이 고정 UUID 로 넣는다.
`npm run db:seed:ref` 는 SST/AWS 를 읽어 로컬에서 못 쓰므로, 로컬 러너를 쓴다:

```bash
npm run db:seed:core:local     # scripts/local/seed-core-local.ts
```

⚠️ **손으로 넣은 행은 그 시드를 «막는다».** `sales_channels` 에는 `uq_sales_channels_site` UNIQUE 가
걸려 있는데 시드의 INSERT 는 `ON CONFLICT (id) DO NOTHING` 이다. 같은 `site` 를 다른 id 로 미리
넣어 두면 시드가 unique 위반으로 실패하고 **`success:false` 를 조용히 돌려준다**(2026-09-06 실측).
이미 손으로 넣었다면 그 행을 지우고 시드를 다시 돌린다.

셋을 채우고 core·channel-adapter 를 재기동한 뒤 확인:

```bash
curl -s -H "Authorization: Bearer $CORE_INTERNAL_KEY" \
  http://localhost:3100/internal/channels/active-sites     # {"sites":["medusa"]} 여야 한다
```

`site` 로 쓸 수 있는 값은 `medusa` · `naver` · `coupang` · `3pl` 이다.

---

## 8-C. 🟢 (해결) 격리를 푸는 법 — core PIM 에 상품을 만들어 투영한다

**2026-09-06 에 실제로 뚫었다.** 아래 «왜»를 먼저 읽고, 절차는 그 다음 §8-D 를 본다.

### ⛔ 왜 격리되는가

§8-B 의 게이트 셋을 열면 수집이 실제로 돌고 **우리 주문을 잡는다.** 그런데 적재되지 않고 격리된다:

```
[medusa] Quarantined 3 order collection failures due to missing PIM identity metadata
```

```bash
psql "$CHANNEL_ADAPTER_DB" -x -c "select external_order_id, reason, affected_lines
  from order_collection_failures order by created_at desc limit 1;"
# reason        | channel_product_identification_failed
# affected_lines| [{"cause":"no_embedded_ids", ...}]
```

**왜:** `medusa` 채널의 능력은 `lineIdentity: 'embedded'` 다(`channel-capabilities.ts:76`).
즉 주문 라인에서 우리 식별자 **셋(`variantId`·`masterId`·`versionId`)을 Medusa variant 의 metadata 에서
직접 읽는다.** 셋 중 하나라도 없으면 그 라인은 「Core Catalog 를 통하지 않고 채널에서 직접 만들어진 상품」
으로 판정돼 격리된다(`channel-line-identity.resolver.ts:60`).

`reh-a`·`reh-b`·`reh-c` 는 `apps/medusa/src/scripts/seed.ts` 가 **Medusa 안에서 바로** 만든 상품이라
그 metadata 가 `null` 이다. 그리고 core 는 아예 비어 있다 — 2026-09-06 실측:

```
product_masters 0 · product_variants 0 · channel_variant_listings 0
```

**어드민 「매칭」 화면으로는 못 푼다.** 그 화면은 `/matchings/order-lines`, 즉 **이미 core 에 적재된
주문의 라인**을 다룬다. 격리는 그보다 한 단계 앞이다.

---

## 8-D. ✅ 격리를 푸는 절차 (실측으로 통과한 경로)

**core 에서 상품을 만들어 발행하면 채널 어댑터가 Medusa 로 투영하면서 식별자 셋을 심어 준다.**
`reh-a` 같은 Medusa 시드 상품으로는 절대 안 된다 — 새로 만들어야 한다.

1. 어드민 `http://127.0.0.1:8002/mall/product-registration` → **「상품 생성하고 편집 페이지로 이동」**
   (master + draft version 이 생기고 편집 페이지로 간다)
2. **기본 정보 → 수정**: 상품명·브랜드·공급가·시장가 입력 후 저장
3. **옵션/variant**: 「기본 품목」이 자동으로 하나 있다. 단일 상품이면 그대로 둔다
4. **「Version 발행」** — `version이 active로 발행되었습니다` 토스트가 뜨면 즉시 채널 어댑터가 투영한다
5. 확인:
   ```bash
   psql "$MEDUSA_DB" -x -c "select v.id, v.metadata::text, p.metadata::text
     from product_variant v join product p on p.id=v.product_id where p.handle='<masterId>';"
   # variant metadata 에 pimVariantId, product metadata 에 pimMasterId·pimVersionId 가 있어야 한다
   ```
6. 스토어프론트에서 그 상품을 구매한다(URL 은 `/kr/products/<masterId>`)
7. 다음 폴링(**5분 단위 정각**)에 `[medusa] Polled 1 order candidates (emitted: 1 …)` 이 찍히고
   core `sales_orders` 에 행이 생긴다

⚠️ **판매가는 「가격 정책」에서 따로 넣어야 한다.** 기본 정보의 공급가·시장가는 판매가가 아니다.
안 넣으면 **0원짜리 상품이 그대로 판매 가능**해진다(실측: 상품 0원 + 배송비 2,500원으로 주문됨).
발행이 이를 막지 않는다.

⚠️ **주문조회 목록의 기본 필터는 「주문 미확정」이다.** 새로 들어온 주문은 「매칭안됨」에 있다.
상단 «주문 현황» 타일(`매칭대기`)은 필터와 무관하게 세므로 거기부터 본다.

### 🟢 매칭 레코드는 시드로 채운다 — 상품을 발행할 때마다

「SKU 구성 매칭」 다이얼로그 상단에 이 문구가 뜨면 버튼이 절대 활성화되지 않는다:

> 이 주문의 매칭 레코드가 없습니다. PIM에서 상품 이벤트가 누락되었을 수 있습니다.

**상품 발행은 Medusa 투영은 일으키지만 core 안의 `product_matchings` 행은 만들지 않는다.**
그 행을 채우는 건 `ProductMatchingBackfillSeedStep` 이고, 로컬 러너에 묶여 있다:

```bash
npm run db:seed:core:local     # 상품을 «새로 발행할 때마다» 다시 돌린다
```

`status='pending'` 행이 생기면 경고가 사라지고, 공급처·물류처·재고소유 셋만 고르면 버튼이 열린다
(원가는 필수가 아니다).

### ⛔ 벽 ①(신규) — 새 DB 엔 `suppliers` 가 0행이라 매칭을 «시작조차» 못 한다

「SKU 구성 매칭」 다이얼로그는 **공급처·물류처·재고소유** 셋을 필수로 받는데, 초기화 직후 `dev_core` 의
`suppliers` 는 **0행**이라 드롭다운이 전부 비어 있다(2026-09-06 실측). 앞선 판이 이 벽을 못 본 것은
`dev_core` 를 밀지 않아 옛 픽스처가 남아 있었기 때문이다.

**이 셋을 채우는 시드가 `seed-core-local.ts` 에 없다** — 다음 세션의 후보 작업이다.

🔴 **다이얼로그의 「신규 등록」은 `window.prompt()` 다** (`InventoryMatchingDialog.tsx:327`·`:344`).
그래서 눌러도 «아무 창이 안 뜬 것처럼» 보였다 — 브라우저 모달이라 자동화가 통과하지 못한다.
같은 파일 `:458` 에는 `alert()` 도 있다(「최소 1개 이상의 옵션을 입력해주세요」). 옵션 없이 버튼을
누르면 모달이 떠서 **확장이 먹통이 된다.**

### ⛔ 벽 ②(규명 완료 · 이슈로 이관) — `POST /inventory-matching` 은 core 에 «한 번도 없었다»

라우트가 «사라진» 게 아니라 **처음부터 백엔드가 없다.** 404 와 401 의 차이가 증거다:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3100/inventory-matching   # 404 (라우트 부재)
curl -s -o /dev/null -w '%{http_code}\n'      http://localhost:3100/matchings                # 401 (라우트 있음)
```

**이 칸은 로컬 환경으로 못 뚫는다. 라이브에서도 같은 404 다.** 여기서 더 파지 말 것 —
전체 규명(호출 사슬 · 기대 동작 · 옛 DTO 의 갈 곳 없는 필드 · 권고 인터페이스 · 남은 결정 3건)은
**이슈 #791** 에 있다: <https://github.com/LCNINE/almondyoung-server/issues/791>

🟢 **우회로는 있다** — 재고상품 화면(`features/inventory/skus/…/sku-form-dialog`)에서 SKU 를 먼저 만들고
매칭 화면의 **수동 탭**으로 연결하면 매칭 자체는 끝낼 수 있다. E2E 를 이어가야 한다면 이 경로를 쓴다.

⚠️ 같은 화면의 `GET /variants/:id` **400 은 별개이고, 라우트 부재가 아니다.** core 에 라우트는 있고
(`product-variants.controller.ts:147`) `versionId` 또는 `masterId` 중 하나가 **필수 쿼리**인데
호출자가 안 보내서 나는 400 이다.

---

## 8-E. 🟢 2026-09-06 전 구간 통과 기록 (전체 초기화 → E2E)

논리 DB 11개를 drop/재생성한 «맨바닥»에서 문서와 시드만으로 아래까지 통과했다.
(`core` DB 는 라이브 스냅샷이라 제외 — E2E 가 보는 것은 `dev_core` 다.)

| 단계 | 판정 근거 | 결과 |
|---|---|---|
| 어드민 로그인 | `logs/admin-web.log` 의 `/api/proxy/users/admin/business-licenses` | **200** |
| 상품 생성·발행 | 어드민 「version이 active로 발행되었습니다」 | ✓ |
| Medusa 투영 | `product.metadata` 에 `pimMasterId`·`pimVersionId`, `product_variant.metadata` 에 `pimVariantId` | 셋 다 존재 |
| 매칭 레코드 | `dev_core.product_matchings` | 1행 `pending` |
| 쿠폰 생성 | `medusa.promotion` + `promotion_application_method` | `E2E1000` / `fixed 1000` |
| 회원가입(폰인증) | `user_service.users` | 1행 |
| 스토어프론트 로그인 | `medusa.customer.has_account` | `t` |
| 장바구니·쿠폰 | 체크아웃 합계 9,900+2,500−1,000 | **11,400원** |
| 결제(포인트 전액) | `wallet.payment_intents.status` / `charges` | **CAPTURED** / AUTHORIZE·CAPTURE 둘 다 SUCCEEDED |
| 적립금 차감 | `wallet.point_events` | `REDEEM −11,400` |
| 주문 | `medusa."order"` + `order_promotion` | `display_id=1`, 쿠폰 링크됨 |
| 주문 수집 | `logs/channel-adapter.log` | `Polled 1 (emitted: 1, **quarantined: 0**)` |
| core 적재 | `dev_core.sales_orders` | 1행, `total_amount=11400`, `wallet_intent_id` 연결 |
| 격리 | `channel_adapter.order_collection_failures` | **0건** |
| 어드민 주문조회 | 대시보드 「매칭 대기 **1**」 · `/order/matching` 목록 | ✓ |
| 매칭 | — | ⛔ 위 벽 ①·② |

**막힌 것은 매칭 한 칸뿐이고, 그 원인은 환경이 아니라 코드다.**

---

## 8-F. 🔴 브라우저로 사람처럼 할 때 새로 걸린 것 셋

1. **주소 검색이 «팝업 창»이라 에이전트가 못 쓴다.** 배송지 등록의 우편번호·기본주소는 `readOnly`
   이고 다음 우편번호(`t1.daumcdn.net/mapjsapi/…postcode.v2.js`)로만 채울 수 있는데, 그 UI 는
   MCP 탭 그룹 **밖의 새 창**으로 떠서 조작이 불가능하다. 스크립트는 정상 로드된다(`window.daum` 존재) —
   막히는 건 자동화 쪽이다. 우회는 React 네이티브 setter 로 두 칸을 직접 채우는 것:

   ```js
   const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
   const f=(el,v)=>{set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));
                    el.dispatchEvent(new Event('change',{bubbles:true}));};
   const i=[...document.querySelectorAll('input')];  f(i[3],'06035'); f(i[4],'서울 강남구 가로수길 5');
   ```

2. **「배송 요청사항」이 필수인데 그렇게 안 보인다.** 안 고르면 결제하기가 조용히 안 먹고
   토스트로 **「배송 메모를 선택해주세요.」**만 뜬다. 「문 앞에 놓아주세요」를 고르면 공동현관
   비밀번호 입력이 열리므로 **「비밀번호없이 출입 가능해요」**를 선택해야 넘어간다.

3. **쿠폰 «이름»이 고객에게 끝까지 안 보인다.** 어드민에 `E2E 검증 쿠폰 1000원` 으로 넣었는데
   체크아웃 드롭다운·적용 후 표시 모두 **`1,000원 할인 (E2E1000)`** — 코드만 나온다(재확인).

## 9. 이번에 신설한 것

| 파일 | 무엇 |
|---|---|
| `scripts/local/preflight-e2e.sh` | 사전 점검. 세션 시작마다 돌린다 |
| `scripts/local/seed-wallet-local.ts` | 로컬 wallet reference 시드(결제수단·지역). 이게 없어 결제가 막혔다 |
| **`scripts/local/seed-core-local.ts`** | **로컬 core(`dev_core`) reference 시드 — `npm run db:seed:core:local`.** `PimSeedStep`(수집 게이트를 여는 `sales_channels`) + `ProductMatchingBackfillSeedStep`(매칭 화면을 여는 `product_matchings`). 둘 다 없으면 «조용히» 막힌다 |
| **`scripts/local/seed-points-local.ts`** | **로컬 구매자 적립금 — `npm run db:seed:points:local`.** 🔴 `point_events` 만 넣으면 «잔액은 맞는데 결제는 INSUFFICIENT_POINTS» 가 된다 — 사용은 `point_event_details` 의 lot 에서 차감한다. 두 테이블을 함께 쓴다 |
| `scripts/local/sms-stub.js` | 폰 인증용 로컬 SMS 스텁. 외부 발송 없음 |
| **`scripts/local/sync-medusa-keys.sh`** | **`npm run sync:medusa-keys:local`.** Medusa 초기화로 죽는 API 키 2종을 .env 3곳에 맞춘다 — §2-A |
| **`env-templates/.env.membership.local.example`** | membership 로컬 템플릿 신설. 배포용 템플릿엔 `PORT`·`OIDC_ISSUER_URL`·`MEMBERSHIP_INTERNAL_KEY` 가 없다 |
| `docs/local-e2e-environment.md` | 이 문서 |

⚠️ `scripts/local/seed-dev-core`(디렉터리)와 헷갈리지 말 것. 그쪽은 **`dev_core` 를 drop/create** 하고
창고·SKU·주문 픽스처를 채우는 파괴적 개발 시드다. 위 `seed-core-local.ts` 는 멱등이고 아무것도 지우지 않는다.

---

## 10. 다음 세션 시작 프롬프트 (복붙용)

```
로컬 전 과정(E2E)을 크롬으로 사람이 하듯 돌린다.
2026-09-06 에 전체 초기화(논리 DB 11개 drop) 후 «매칭 한 칸만 빼고» 전 구간을 통과했다(§8-E).
이번 목적은 그 남은 칸이다.

먼저 읽어라: docs/local-e2e-environment.md (정본은 docs/local-dev.md, 이 문서는 그 보완)

시작 전에 물어라: 지금 상태에서 이어갈지, DB 를 밀고 처음부터 갈지.
  (전체 초기화 시 core DB 는 «제외»한다 — 라이브 스냅샷이고 E2E 가 보는 것은 dev_core 다)

절차:
  1. bash scripts/local/preflight-e2e.sh — ✗ 를 전부 해결하고 시작
  2. §2 의 시드 5종 + 🔴 npm run sync:medusa-keys:local (§2-A). 적립금 시드는
     LOCAL_POINT_LOGIN_IDS=<가입한아이디> 로 준다 (§2-B — 새 DB 엔 구매자 계정이 없다)
  3. §8-D 순서로 상품을 만들어 발행 → 투영 확인 → 구매 → 5분 폴링 → core 적재
  4. ⛔ 남은 칸 둘 (§8-D):
     ① `dev_core.suppliers` 가 0행이라 매칭 다이얼로그의 드롭다운 3개가 비어 있다.
        → seed-core-local.ts 에 공급처·물류처·재고소유를 넣을 수 있는지 따져라. 이게 이번 목표.
     ② POST /inventory-matching 은 core 에 «한 번도 없었다». 환경으론 못 뚫는다.
        규명·설계안은 이슈 #791 에 있으니 «다시 파지 마라». 매칭을 끝내야 하면
        재고상품 화면에서 SKU 를 먼저 만들고 매칭 화면의 «수동 탭»으로 연결한다.

규칙:
  - 「떠 있다」를 「최신이다」로 읽지 마라. 기동 시각과 스키마를 먼저 재라.
  - 판정은 화면·로그가 아니라 DB 로 한다. 콜백은 실패해도 200 을 준다.
  - 🔴 호스트는 전부 localhost 다. 127.0.0.1 로 어드민을 분리하는 옛 처방은 철회됐다(§6-①).
    어드민/고객은 «구간을 나눠 순서대로» 하고, 구간 전환은 localhost:8002/api/auth/signout 으로 한다.
  - 비밀번호·계정 생성은 네가 해도 된다(로컬 시드 값이다).
  - 매칭 다이얼로그에는 alert() 가 있다 — 옵션 없이 버튼을 누르면 확장이 먹통이 된다.
  - 막히면 2~3회 만에 멈추고 물어라.
  - 새로 찾은 환경 결함은 그때그때 이 문서에 추가하고 커밋해라.
    로컬에서 손으로 때운 것은 «시드나 템플릿에 넣을 수 있는지» 항상 한 번 더 따져라.
```

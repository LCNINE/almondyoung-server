# 로컬 개발 환경 (dev 스테이지 대체)

AWS dev 스테이지가 제거되어, 개발은 사내 노트북에서 로컬 서버로 진행한다.
인프라(postgres/redis/kafka)는 루트 `docker-compose.yml`, 앱은 npm 으로 직접 띄운다.

## 새 노트북 셋업 체크리스트

레포 clone 만으로는 **안 된다** — `.env` 파일들이 gitignore 라 별도 복사가 필요하다.

1. **필수 설치**: Node 22 (`nvm install 22`), Docker (macOS 면 Docker Desktop 또는 colima)
2. **레포 clone + 의존성**
   ```bash
   git clone git@github.com:LCNINE/almondyoung-server.git && cd almondyoung-server
   npm install
   ```
3. **`.env` 복사** — 기존에 쓰던 머신에서 묶어서 가져온다:
   ```bash
   # 기존 머신에서
   tar czf envs.tgz apps/*/.env
   # 새 머신 레포 루트에서
   tar xzf envs.tgz
   ```
4. **인프라 기동**
   ```bash
   docker compose up -d
   ```
   postgres 최초 기동 시 `scripts/local/init-db.sql` 이 논리 DB 11개
   (core, dev_core, medusa, wallet, analytics, channel_adapter, membership, notification, ugc, file_service, user_service)를 만든다.
   `dev_core` 는 core 단독 로컬 개발용 DB — 아래 "core 단독 개발 + `dev_core` 시드" 절 참고.
5. **로컬 포트 배치** — `.env` 들의 PORT 와 서비스 간 URL(`OIDC_ISSUER_URL`, `WALLET_BASE_URL` 등)은 아래 표 기준으로 맞춘다. (배포판 `.env` 묶음을 그대로 받았다면 이미 반영돼 있음.)

   | 앱 | 포트 | | 앱 | 포트 |
   |---|---|---|---|---|
   | user-service | 3000 | | file-service | 3010 |
   | membership | 3001 | | ugc-service | 3030 |
   | channel-adapter | 3003 | | analytics | 3040 |
   | notification | 3050 | | search | 3060 |
   | core | 3100 | | wallet | 5001 |
   | medusa | 9000 | | storefront / auth-web | 8000 / 8001 |
   | admin-web | 8002 | | wallet-web | 3200 |

   프론트엔드 4개(storefront 8000 / auth-web 8001 / admin-web 8002 / wallet-web 3200)는 각 앱 `package.json` 의 `dev` 스크립트에 이 포트가 `-p` 로 박혀 있어 `npm run dev` 만으로 뜬다. admin-web 8002·wallet-web 3200 은 OIDC redirect_uri(각 앱 env + user_service `oauth_clients`)와도 일치해야 로그인이 된다.

   각 앱 `.env` 공통 키:
   ```
   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/<논리DB>   # 예: core → .../core
   KAFKA_BROKERS=localhost:9092    # KAFKA_API_KEY/SECRET 는 삭제 또는 주석
   REDIS_URL=redis://localhost:6379
   ```
   core 를 warehouse-app 등 클라이언트 개발용으로 **단독** 띄울 거라면 `.../core` 가 아니라
   `.../dev_core` 를 써야 한다 — 아래 "core 단독 개발 + `dev_core` 시드" 절 참고. `core` 로 잘못
   맞추면 시드가 없는 빈 DB 라 재고조회가 원인 신호 없이 텅 비어 보인다.
   전체 필수 키 목록의 SoT 는 `deployments/lcnine/{services,auth}/infra/services.ts` 의 각 서비스 `environment` 블록 — `.env` 가 안 맞으면 여기와 대조할 것. 시크릿 값은 `sst secret list --stage dev` 로 조회.
6. **스키마 마이그레이션**
   ```bash
   npm run db:migrate:local        # drizzle 서비스 전체 (셸에서 localhost URL 주입 — 원격 DB 절대 안 건드림)
   cd apps/medusa && DATABASE_URL=postgresql://postgres:postgres@localhost:5432/medusa npx medusa db:migrate --execute-safe-links
   ```
7. **서비스 실행**

   **일괄 기동 (dev 서버 노트북용 권장)** — 한 번 빌드 후 nest 서비스 10개 + medusa 를 전부 띄운다:
   ```bash
   sudo apt install -y tmux   # 최초 1회
   tmux                        # 터미널 닫아도 유지되게 tmux 안에서
   npm run start:all:local     # 빌드 → 일괄 기동. 로그는 logs/<서비스>.log
   # tmux 에서 빠져나오기: Ctrl+B 누른 뒤 D / 다시 붙기: tmux attach
   ```
   코드 업데이트 반영: `git pull` 후 Ctrl+C 로 내리고 다시 `npm run start:all:local`.
   빌드 생략 재시작: `SKIP_BUILD=1 ./scripts/local/start-all.sh`

   **개별 실행 (개발 머신용)** — watch 모드:
   ```bash
   npm run start:main:dev          # core
   npm run start:user-service:dev
   npm run start:wallet:dev
   # ...
   ```

8. **(선택) live 데이터 복제** — 빈 DB 대신 라이브 데이터로 시작하려면 (AWS 로그인 + tunnel 권한 필요):
   ```bash
   ./scripts/local/refresh-from-live.sh   # live RDS → 로컬 PG 전체 덤프/복원
   ```
   ⚠️ 라이브 개인정보가 노트북에 복제되므로 회사 기기에서만.

## 윈도우 노트북인 경우 (WSL2)

레포 스크립트가 bash 라 cmd/PowerShell 에선 안 돈다. 전부 WSL2 안에서 실행한다.

1. PowerShell(관리자): `wsl --install` → 재부팅 → Ubuntu 초기 설정
2. **Docker Desktop** 설치 → Settings 에서 *WSL 2 based engine* + *WSL integration (Ubuntu)* 켜기
3. 이후 모든 작업은 **Ubuntu(WSL) 터미널**에서. 레포는 반드시 WSL 홈(`~/`)에 clone — `/mnt/c/...` (윈도우 디스크) 에 두면 빌드가 수 배 느리고 파일 워처가 깨진다:
   ```bash
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash && source ~/.bashrc
   nvm install 22
   git clone git@github.com:LCNINE/almondyoung-server.git ~/almondyoung-server && cd ~/almondyoung-server
   npm install
   tar xzf /mnt/c/Users/<윈도우계정>/Downloads/almondyoung-local-envs.tgz   # .env 묶음을 다운로드 폴더에 받아둔 경우
   ```
4. 나머지는 체크리스트 4~7 과 동일 (`docker compose up -d` → `npm run db:migrate:local` → 서비스 실행).

**다른 기기에서 WSL2 서버로 접속하기** — WSL2 는 NAT 뒤라 윈도우 밖에서 바로 안 보인다. 둘 중 하나:
- **Tailscale 을 WSL(Ubuntu) 안에 설치** (제일 간단): `curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up`. WSL 이 자기 tailscale IP 를 받아 포트포워딩 없이 `http://<tailscale IP>:<포트>` 로 접속.
- **같은 LAN 만 필요하면** Windows 11 미러드 네트워킹: 윈도우 사용자 폴더에 `.wslconfig` 작성 후 `wsl --shutdown`:
  ```
  [wsl2]
  networkingMode=mirrored
  ```
  그리고 윈도우 방화벽에서 해당 포트 인바운드 허용. 이러면 `http://<윈도우 IP>:<포트>` 로 접속.

## 다른 사람이 이 노트북에 접속하기

앱들이 `0.0.0.0` 바인딩이라 서버 쪽 설정은 필요 없다.

- **같은 사무실 LAN**: `http://<노트북 IP>:<포트>` (IP 는 `ipconfig getifaddr en0` / `ip addr`)
- **다른 네트워크**: 양쪽에 [Tailscale](https://tailscale.com) 설치 후 `http://<tailscale IP>:<포트>`
- macOS 는 첫 실행 시 방화벽 허용 프롬프트만 수락하면 됨. 리눅스는 `ufw allow <포트>`.
- DB 도 직접 붙어야 하면 `postgresql://postgres:postgres@<노트북 IP>:5432/<논리DB>` (compose 가 5432 를 노출).

## 전체 스택 로컬 구동 (user-service·auth-web 포함)

`core` 단독이 아니라 **로그인·주문·결제까지 로컬에서 닫으려면** IdP(user-service + auth-web)와
결제(wallet)까지 띄운다. 2026-08-30 쿠폰 개통 리허설 1차가 이 구성으로 돌았고, 그 실행 기록은
이슈 #488 의 「리허설 1차 실행 기록」 절에 있다.

**왜 라이브 user-service 를 쓰지 않는가.** 스토어프론트 로그인은 Medusa 가 중개한다 —
storefront → Medusa `/auth/customer/user-service-sso` → auth-web `/oauth/authorize` → user-service.
그래서 `medusa-storefront` OAuth 클라이언트에 `http://localhost:8000/kr/callback/oidc` 가
등록돼 있어야 하는데 **라이브에는 없다**(실측: 「등록되지 않은 redirect_uri 입니다」).
라이브 클라이언트에 localhost 를 등록하는 것은 라이브 IdP 설정 변경이므로, 로컬 IdP 를 쓴다.

### 1. 인프라 + 스키마

```bash
docker compose up -d                 # postgres·redis·kafka (redis 가 내려가 있으면 Medusa 가 안 뜬다)
npm run db:migrate:local             # drizzle 서비스 전체
cd apps/medusa && npx medusa db:migrate --execute-safe-links && cd ../..
```

### 2. `.env` 배치

`env-templates/.env.<앱>.local.example` 을 각 앱 위치로 복사한다.

| 템플릿 | 복사 위치 | 포트 |
|---|---|---|
| `.env.user-service.local.example` | `apps/user-service/.env` | 3000 |
| `.env.medusa.local.example` | `apps/medusa/.env` | 9000 |
| `.env.wallet.local.example` | `apps/wallet/.env` | 5001 |
| `.env.admin-web.local.example` | `apps/admin-web/.env.local` | 8002 |
| `.env.auth-web.local.example` | `web/auth-web/.env.local` | 8001 |
| `.env.storefront.local.example` | `web/almondyoung-storefront/.env.local` | 8000 |

user-service 의 RS256 키쌍만 생성이 필요하다:

```bash
./scripts/local/gen-oauth-keys.sh >> apps/user-service/.env   # 템플릿의 자리표시자 두 줄은 지운다
```

**세 값이 앱 사이에서 일치해야 한다** — 어긋나면 조용히 401/400 이 난다:

| 값 | 맞춰야 하는 곳 |
|---|---|
| `OAUTH_INTERNAL_SECRET` | user-service ↔ auth-web |
| `OIDC_CLIENT_SECRET` | medusa ↔ storefront ↔ user_service `oauth_clients` 시드 |
| `WALLET_API_KEY` | medusa ↔ wallet |

### 3. 시드

```bash
npm run db:seed:user-service:local          # 역할 6·스코프 12·admin 계정·OAuth 클라이언트 3
cd apps/medusa && npx medusa exec ./src/scripts/seed.ts && npx medusa exec ./src/scripts/seed-shipping.ts
npx medusa user -e <관리자메일> -p <비밀번호>   # Medusa 어드민 계정 (user-service 계정과 별개다)
```

`db:seed:user-service:local` 은 정본 `UserServiceSeedStep` 을 로컬 DB 로 돌린다
(`npm run db:seed:ref` 는 SST/AWS 에서 DB URL 을 읽어 로컬에선 못 쓴다). 만들어지는 관리자 계정은
`admin` / `LOCAL_ADMIN_PASSWORD`(기본 `Rehearsal1234!`), 역할 `master`+`admin`.

**admin-web 의 `MEDUSA_API_KEY`** 는 Medusa 관리자 API 키다. 한 번 만들어 `.env.local` 에 넣는다:

```bash
TOK=$(curl -s -X POST http://localhost:9000/auth/user/emailpass -H 'content-type: application/json' \
  -d '{"email":"<관리자메일>","password":"<비밀번호>"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
curl -s -X POST http://localhost:9000/admin/api-keys -H "authorization: Bearer $TOK" \
  -H 'content-type: application/json' -d '{"title":"admin-web-local","type":"secret"}'
```

### 4. 기동

```bash
npx dotenv -e apps/user-service/.env -- nest start user-service   # :3000
(cd web/auth-web && npm run dev)                                  # :8001
(cd apps/medusa && npx medusa develop)                            # :9000
npx dotenv -e apps/wallet/.env -- nest start wallet               # :5001
(cd apps/admin-web && npm run dev)                                # :8002
(cd web/almondyoung-storefront && npm run dev)                    # :8000
```

`http://localhost:8000/kr/login` → auth-web 계정 허브 → 로그인이 되면 배선이 다 맞은 것이다.

### 5. 결제 없이 주문을 완결하는 법

`checkout-template.tsx` 가 `pp_almond-payment_almond-payment` 로 고정돼 있어 주문 완료는
wallet 을 거친다. 그런데 **PG 자격증명(`NICEPAY_*`·`TOSS_*`)은 전부 optional** 이고,
`POINTS` 는 외부 PG 를 타지 않는 **ledger** provider다. 그래서 포인트로 전액 결제하면
결제창 없이 주문이 완결된다 — `confirm` DTO 의 `pointsToApply` 가 전액을 덮으면
`paymentMethodId` 가 필요 없다.

```bash
# 1) 포인트 지급 (admin 토큰, user-service 의 user id 로)
curl -X POST http://localhost:5001/v1/admin/points/earn \
  -H "Cookie: accessToken=$ADMIN_AT" -H "Idempotency-Key: $(uuidgen)" \
  -H 'content-type: application/json' -d '{"userId":"<user-service user id>","amount":100000,"reason":"local test"}'
# 2) 결제 세션의 intentId 로 포인트 결제 → status CAPTURED
curl -X POST http://localhost:5001/v1/payment-intents/<intentId>/confirm \
  -H "Cookie: accessToken=$USER_AT" -H "Idempotency-Key: $(uuidgen)" \
  -H 'content-type: application/json' -d '{"pointsToApply":<총액>}'
# 3) Medusa 카트 완료
curl -X POST http://localhost:9000/store/carts/<cartId>/complete -H "authorization: Bearer <customer jwt>" ...
```

wallet 의 쓰기 API 는 **전부 `Idempotency-Key` 헤더가 필수**고(없으면 400),
`/v1/admin/*` 은 API 키가 아니라 **`accessToken` 쿠키**로 인증한다.

### 6. Medusa HTTP 통합 스펙

```bash
scripts/local/run-medusa-integration.sh --testPathPattern 'coupon-'
scripts/local/run-medusa-integration.sh --modules --testPathPattern 'promotion-meta'   # 모듈 통합 스펙
```

`docker compose` 의 **postgres 와 redis 가 둘 다** 있어야 한다(Medusa 서버는 안 떠 있어도 된다 —
러너가 in-app 으로 띄운다). 스펙마다 임시 DB 를 만들었다 지우므로 `medusa` DB 는 건드리지 않는다.

**redis 는 선택이 아니다.** `medusa-config.js` 에서 `TEST_TYPE` 으로 in-memory 로 갈리는 것은
`event_bus` 하나뿐이고, `cache-redis`·`caching-redis`·`workflow-engine-redis`·`locking-redis` 는
통합 스펙에서도 `REDIS_URL` 로 실제 접속한다. redis 없이 돌리면 `ECONNREFUSED` 가 잔뜩 찍히다가
앱 부팅 단계에서 스펙이 실패한다(2026-09-03 실측).

**`npm run test:integration:http` 도 `npm run test:integration:modules` 도 직접 부르지 말 것.**
둘 다 같은 러너 계열이라 같은 이유로 죽는다. 러너는 `DATABASE_URL` 이 아니라
`DB_HOST`/`DB_USERNAME`/`DB_PASSWORD`/`DB_PORT` 를 읽는데(`@medusajs/test-utils/dist/database.js:12-15`)
`.env` 에 그 넷이 없어서 전 스펙이 `SASL: client password must be a string` 으로 죽는다 —
스펙이 빨간 게 아니라 환경이 안 넘어간 것이다. 위 스크립트가 `DATABASE_URL` 에서 넷을 파생시켜 넘긴다.

**CI 도 이걸 돌린다(2026-09-03 부터).** `medusa-unit-tests.yml` 의 `integration` job 이
postgres + redis service 를 띄우고 모듈·HTTP 통합 스펙을 모두 돌린다 — `apps/medusa/**` 를
건드린 PR 에만 붙는다. 그 전까지는 로컬 실행이 유일한 방어선이었고, `integration-tests/http/` 의
쿠폰 스펙 8개는 한 번도 게이트를 통과한 적이 없었다(ADR-0034 결정 4).

로컬 실행은 여전히 유용하다 — CI 는 PR 을 올려야 돌지만 이건 지금 돌릴 수 있다.

### 부팅 중 실제로 걸린 것들

리허설 1차에서 막힌 지점. 같은 데서 또 막히지 않도록 남긴다.

- **user-service 는 `KAFKA_BROKERS` 없이 못 뜬다.** 「설정되지 않아 Kafka를 사용하지 않습니다」
  경고를 찍은 뒤 `EventsModule.forApp` 이 `kafka.clientId` 를 역참조해 죽는다. 선택 아님.
- **user-service 의 포트 변수는 `PORT` 다.** `env.validation.ts` 에 `USER_SERVICE_PORT` 가
  있지만 `main.ts` 는 `process.env.PORT ?? 3030` 만 읽는다 — 아무도 안 읽는 변수다.
- **회원가입 `birthday` 는 ISO(`1990-01-01`)여야 한다.** `sign-up.dto.ts` 의 예시값
  `19900101` 은 `new Date()` 에서 Invalid Date 가 되어 500 이 난다.
- **storefront `.env.template` 을 그대로 쓰면 안 된다.** 옛 도메인(`almondyoung-next.com`) +
  `USE_RAILWAY_BACKEND=true` 라 라이브를 본다. `false` 로 두면 `lib/config/backend.ts` 의
  `LOCAL_SERVICE_URLS` 가 쓰여 전부 localhost 로 간다.
- **`AUTH_WEB_URL` 을 세우는 순간 Medusa 의 customer 인증이 `user-service-sso` 하나로 좁혀진다**
  (`medusa-config.js` 의 `authMethodsPerActor`). 비워두면 emailpass 로도 로그인되지만,
  그러면 스토어프론트 로그인 버튼은 404 다(provider 미등록).
- **`localhost` 는 부모 도메인 쿠키를 못 쓴다.** `PARENT_COOKIE_DOMAIN` 은 비우고
  `PARENT_COOKIE_SECURE=false`, auth-web 도 `COOKIE_SECURE=false`.

## core 단독 개발 + `dev_core` 시드

warehouse-app 등 클라이언트 개발용으로 core 만 로컬에 띄우고, 전용 논리 DB `dev_core` 를
한 명령으로 밀고 다시 시딩한다. 통합테스트·`refresh-from-live.sh` 가 쓰는 `core` 와 분리돼 있어
서로를 오염시키지 않는다. 설계 근거: `docs/superpowers/specs/2026-07-23-local-core-dev-environment-design.md`

```bash
docker compose up -d                 # postgres + kafka + zookeeper (kafka 없으면 core 가 안 뜬다)
cp env-templates/.env.core.local.example apps/core/.env   # <사용자>/<임의값> 채우기
npm run dev:core:reset               # drop → create → migrate → 스코프 → 시드
npm run dev:core:reset -- --bulk     # SKU +300 · 로케이션 +50 (페이지네이션 체감용)
npm run start:main:dev               # core :3100
```

- **Kafka 는 끌 수 없다.** `main.ts` 가 조건 없이 `startAllMicroservices()` 를 부르므로 브로커에
  못 붙으면 부팅이 실패한다. compose 브로커로 **격리**하는 것이지 비활성화하는 게 아니다.
  `KAFKA_API_KEY/SECRET` 를 넣지 않아 라이브 Confluent 접속은 애초에 불가능하다.
- **`KAFKA_GROUP_ID` 는 안전장치가 아니다.** `apps/core/src/main.ts` 와 `sales-order.module.ts` 가
  컨슈머 `groupId` 를 리터럴 `'almondyoung-order-consumer'` 로 하드코딩하고 있어 이 변수를 아예 읽지 않는다
  (라이브 배포도 같은 변수를 세팅하지만 마찬가지로 무시된다). 로컬/라이브를 그룹 이름으로 격리한다는
  발상은 성립하지 않는다 — 실질 방어선은 바로 위 `KAFKA_API_KEY/SECRET` 미설정 하나뿐이다.
- **user-service 는 라이브를 쓴다.** core 가 `OIDC_ISSUER_URL` 로 JWKS 검증만 하므로 그대로 통과한다.
  **역할은 라이브 계정이 가진 것 그대로**이므로, 어떤 역할로 로그인했는지가 곧 로컬에서 무엇이
  되는지를 결정한다.
- **inventory 엔드포인트에도 이제 scope 게이트가 있다** (#551 이 라우트 154개에 `@RequireScopes`
  부착). "로그인만 되면 inventory 는 다 된다"는 예전 서술은 더 이상 사실이 아니다. 역할별 경계:

  | 역할 | 되는 것 | 안 되는 것 |
  |---|---|---|
  | `logistics_worker` | 재고조회·입고확정·적치·실사 카운트·이동 (`inventory.operate`), 피킹·검수·출고 (`fulfillment.warehouse.operate`) | 재고조정·실사 차이 반영(`inventory.adjust`), 마스터데이터(`inventory.manage`), 강제출고(`fulfillment.dispatch.force`) |
  | `logistics_manager` | 위 전부 + `adjust`/`manage`/`warehouse.manage` + 강제출고·recall·재개방 | `fulfillment.tracking.ingest` (택배사 전용) |
  | `admin` | inventory 4개 전부 | **fulfillment 스코프 0개** — 피킹·출고는 못 한다 |
  | `master` | 전부 (ScopeGuard 가 무조건 통과) | — |

  ⚠️ **라이브 개발 계정이 `admin` 이면 `logistics_worker` 의 권한 구멍이 로컬에서 드러나지 않는다.**
  현장 역할로 검증하려면 라이브 user-service 에 그 역할을 가진 계정이 필요하다.
- **`npm run generate:token` 의 HS256 토큰은 curl 검증용이다.** 임의 역할로 발급할 수 있어 권한
  경계를 확인하기 좋지만, **warehouse-app 에는 토큰 주입 경로가 없다**(`src/app/config.ts` 가 OIDC
  로만 토큰을 얻는다). 앱 화면에서 역할을 바꿔 보려면 위처럼 라이브 계정이 필요하다.
  - ⚠️ **그 토큰에 `iss` 를 넣으면 core 가 무조건 401 을 준다.** `JwtAccessStrategy.validate()` 는
    *iss 가 있을 때만* issuer 를 검증하고, 그 분기는 RS256 OIDC 토큰용이다 — 로컬 core 의
    `OIDC_ISSUER_URL` 은 `https://user.almondyoung.com` 이라 어떤 로컬 값을 넣어도 안 맞는다.
    2026-08-26 이전의 `generate:token` 이 `iss: 'almondyoung-auth'` 를 박고 있어서 **이 문장이
    사실이 아니었다** (스크립트가 발급한 토큰이 core 에 못 들어갔다). 직접 서명할 때도 페이로드는
    `{ sub, userId, email, roles }` 까지만 둔다.
  - 쿠키로도 같은 토큰을 쓴다. admin-web 프록시가 `accessToken` 쿠키를 그대로 업스트림에 넘긴다:

    ```bash
    curl --cookie "accessToken=$TOKEN" http://localhost:8002/api/proxy/api/purchase-orders
    ```
- 시드는 결정론적이다. SKU 코드 `DEV-SKU-0001…`, 바코드 `88000000001…`, 주문번호 `DEV-ORDER-0001…`,
  운송장번호 `DEV-WAYBILL-0001…` 이 리셋해도 그대로라 종이에 적어두고 스캔 테스트에 쓸 수 있다.
- **출고작업(단순출고)이 시드만으로 바로 열린다.** 주문 10건 중 planned 인 5건이 배치
  `DEV-BATCH-0001` 에 묶이고 각각 `registered` 운송장을 갖는다 — 앱의 `출고작업` 큐가 비지 않고,
  운송장번호를 스캔하면 그대로 단순출고가 시작된다. plan·session·피커 claim 은 시드가 만들지 않는다.
  `SimpleOutboundService.prepare()` 가 `queued` work item 에서 직접 만드는 것이 실제 경로라, 미리
  만들어두면 앱이 그 경로를 밟지 못한다.
- **창고 피킹 방식**: 부천(판매 창고)만 `supported_picking_strategies = ['discrete']` 이고 중국
  (비판매)은 빈 배열이다 — 라이브 `WAREHOUSE_CONSTANTS` 와 같은 구분. 이 컬럼이 비면
  `picking-strategy.registry.ts` 의 `resolveForWarehouse` 가 409 를 던져 **출고 배치를 아예 만들 수
  없다.** 시드는 멀쩡히 도는데 출고만 조용히 막히므로, 출고가 409 면 여기부터 본다.
- **시드 로직을 바꾼 뒤 검증**: `npm run test:seed-dev-core:integration` 이 `scripts/local/seed-dev-core/`
  전체(스코프·마스터데이터·재고·입고·주문·출고대기·`--bulk`)를 실제로 리셋해가며 검증한다. 리셋 스크립트를 셸아웃으로
  두 번(기본 + `--bulk`) 부르므로 `--runInBand` 로 직렬 실행되고, 로컬 `dev_core` 를 실제로 drop/create 한다.
  테스트 완료 후 DB 는 `--bulk` 상태(SKU 320개, 로케이션 64개)로 남으므로, 기본 시드(SKU 20개, 로케이션 14개)로
  돌아가려면 `npm run dev:core:reset` 을 다시 한 번 실행한다.
- warehouse-app 은 기본이 로컬 core 다. 라이브로 붙으려면
  `cd native/warehouse-app && npm run tauri:dev:live`.
  **core 의 포트나 호스트를 바꾸면 `native/warehouse-app/src-tauri/capabilities/default.json` 의
  `http:default` → `allow` 목록도 같이 고쳐야 한다.** Tauri 의 `plugin-http` 는 deny-by-default 라
  scope 에 없는 URL 은 요청이 앱 밖으로 나가기 전에 거부된다 — `.env` 만 고치면 화면엔 평범한
  에러만 뜨고 콘솔에서야 `url not allowed on the configured scope` 를 보게 된다. capability 는
  `build.rs` 가 컴파일 타임에 읽으므로 고친 뒤 `tauri dev` 재빌드가 필요하다(HMR 로는 반영 안 됨).
- **`SEED_DEV_CORE_URL` 을 기본값(`localhost:5432/dev_core`)과 다르게 주면 확인 프롬프트가 뜬다.**
  `sst tunnel` 이 떠 있으면 guard 를 통과하는 `localhost` 가 실제로는 라이브 클러스터일 수 있어서다
  (guard.ts 는 호스트/DB이름만 보고, tunnel 여부는 못 본다). `yes` 를 입력해야 진행하며, 비대화식
  stdin(파이프/CI)에서는 안전 측으로 즉시 거부하고 hang 하지 않는다 — `npm run test:seed-dev-core:integration`
  은 이 변수를 기본값과 동일한 문자열로 설정해서 부르므로 프롬프트 자체를 타지 않는다.
- **쓰기 워크플로우 후 outbox 를 확인할 때 `StockReceived` 26건은 예외다.** inventory/fulfillment 쓰기의
  확인 대상은 `public.outbox_events`(`apps/core/src/modules/inventory/schema/inventory.schema.ts` 의
  inventory 전용 outbox)다 — 같은 이름의 `event.outbox_events`(`libs/events` 범용 outbox, `pgSchema('event')`)도
  `dev_core` 안에 따로 존재하지만 inventory/fulfillment 의 쓰기는 거기 쌓이지 않는다. (catalog 모듈은
  다르다 — `product-masters.service.ts`/`product-versions.service.ts`/`categories.service.ts` 는
  `OutboxPublisher.saveEvent` 로 실제로 `event.outbox_events` 에 쓴다. PIM 쪽 outbox 를 볼 땐 이 절이
  아니라 그 테이블을 봐야 한다.) 잘못 짚으면 조용히 0건이 나와 "outbox 가 깨끗하다"는 착각을 준다.
  ```sql
  SELECT count(*) FROM public.outbox_events WHERE event_type = 'StockReceived';
  -- → 26
  ```
  `InventoryCommandService.receive()`
  가 만드는 페이로드가 `packages/event-contracts/streams/inventory.stream.ts` 의 `StockReceivedSchema` 와
  안 맞아(`stockEventId`/`inboundType`/`receivedAt` 누락, `afterQuantity`/`occurredAt` 존재) 발행이 매번 throw 한다.
  이 브랜치와 무관한 **기존 결함**(`develop` 에도 있음)이고, `StockReceived` 소비자가 현재 0개라 기능은
  안 깨지며 5회 재시도 후 `failed` 로 종료된다(무한 pending 아님). 로컬 셋업이 고장난 게 아니다 — 드레인
  확인 시 이 26건은 제외하고 나머지가 쌓이지 않는지만 본다.

## 상품 일괄 등록/수정 로컬 테스트

admin-web → core → file-service 를 한 노트북에서 전 구간 돌리는 절차는 별도 문서에 있다 —
`.env` 세 개, `file_contexts` 시드, HS256 우회 로그인이 추가로 필요하다:
`docs/local-dev-bulk-session.md`

## 물류 통합 테스트 (jest, 로컬 DB)

inventory/fulfillment 도메인의 통합 테스트(`*.integration.spec.ts`)는 서비스를 직접 와이어링해 실제 postgres 에 대고 도메인 불변식을 검증한다. HTTP·auth·Kafka 를 경유하지 않으므로 `.env` 도 불필요하다.

```bash
npm run test:core:integration:local                       # 전체 integration
npm run test:core:integration:local -- receive.integration  # 특정 패턴만
```

⚠️ 패턴 없이 맨 커맨드로 돌리면 `*.integration.spec.ts` 전체가 매칭되는데, 여기엔 core 가 아닌 다른 앱(membership/wallet/channel-adapter 등)의 스펙도 걸린다 — 그 스펙들은 각자의 논리 DB 를 기대하므로 core DB 로 돌리면 실패한다. 항상 좁히는 패턴(예: `-- golden-path.integration`)을 붙일 것.

러너(`scripts/local/test-core-integration-local.sh`)가 compose postgres 기동 → core 마이그레이션 → jest(`--runInBand`)를 한 번에 한다. 대부분의 spec 은 **rollback-only**(케이스를 tx 로 감싸고 끝에 `Rollback` throw)라 DB 를 더럽히지 않고 Kafka 도 불필요(outbox 는 mock).

**새 통합 테스트 작성 레시피** — `inventory-command.service.receive.integration.spec.ts` 를 템플릿으로:

1. `const DATABASE_URL = process.env.DATABASE_URL; const describeIfDb = DATABASE_URL ? describe : describe.skip;` 게이트.
2. `beforeAll` 에서 `postgres(DATABASE_URL, { max: 1 })` → `drizzle(sql, { schema: wmsSchema })`, DbService 최소 대역 `{ db, run }`, 서비스 직접 `new`. outbox 는 `new InventoryOutboxService(dbService)`.
3. `inRollbackTx(fn)` 헬퍼로 각 케이스를 감싸고, 픽스처(warehouse/holder/sku/location `locationType: 'zone'`)는 `randomUUID()` 접미사로 tx 안에서 insert.
4. 검증은 `trx.select().from(wmsTables.stockLedgers)`(재고 투영) / `wmsTables.stockEvents`(이벤트 로그)로. `stock_summary` 는 VIEW 라 검증에 쓰지 않는다.

**SO×FO×출고 종단 스펙 (2026-07)**: `sales-order-to-fulfillment.conversion` / `fulfillment-stock-allocation` / `outbound-batch-pick-ship` / `so-to-ship.golden-path` 4개는 세 BC(sales-order·fulfillment·inventory)를 한 tx로 관통하는 종단 스펙이다. 공용 와이어링/픽스처/숫자 어서션은 `apps/core/src/modules/fulfillment/services/__support__/` 에 있다. 재고 숫자 정합성은 골든값 + 보존식 + 이벤트로그 대조(I1~I6, 설계 스펙 참고)로 검증한다. 실행 예: `npm run test:core:integration:local -- golden-path.integration`.

### Outbound V2 release suite

Outbound V2의 17개 대표 흐름, barrier 기반 동시성 경합, migration rehearsal은 실제 Core PostgreSQL을 사용한다. Docker daemon과 루트 `compose.yml`의 `postgres`가 필요하며 테스트는 반드시 serial(`--runInBand`)로 실행한다. 시간 지연에 기대는 sleep은 사용하지 않고 각 경합 지점의 lock/barrier가 양쪽 작업의 진입을 확인한다.

```bash
# compose 기동 + Core migration + 모든 outbound-v2 DB suite
npm run test:core:integration:local -- outbound-v2

# 권한 행렬(worker/manager/unknown/missing scope/forged operator)은 DB 없이 별도 실행
npx jest --runInBand apps/core/src/modules/fulfillment/services/outbound-v2-authorization.spec.ts

# partial shipment 및 sales-order별 단일 adapter routing 계약
npx jest --runInBand apps/channel-adapter/src/consumers/shipment-events.contract.spec.ts
```

DB suite는 아래를 포함한다.

- `outbound-v2-*-scenarios.integration.spec.ts`: 번호 1~17을 계획/통합(1~5), warehouse 작업(6~10), dispatch lifecycle(11~15), recovery(16~17)로 나눠 실행하며 각 checkpoint에서 FOI demand, 활성 shipment line/reservation, on-hand/reserved/available, session 수량, dispatch source/event, outbox 보존식을 검증한다.
- `outbound-v2-concurrency.integration.spec.ts`: reserve/split/claim/last-scan dispatch/recall 경합의 exactly-once 결과.
- `outbound-v2-migration-rehearsal.integration.spec.ts`: 기존 행의 SKU/SO/ledger hash를 기록한 뒤 expand 상태에서 signed audit/allowlisted cleanup/verify/V2 create를 실행하고 hash 불변 및 cutover 이전 주문 미재생을 확인한다.

실패 시 첫 번째 깨진 보존식과 scenario 번호를 먼저 확인한다. commit형 concurrency fixture가 중간에 강제 종료되어 행을 남겼다면 `docker compose down -v` 후 다시 실행한다. release 증거에는 위 세 명령, Docker/DB 이미지 버전, commit SHA를 함께 기록한다.

**커밋형 caveat**: `unified-reservation.service.lock.integration.spec.ts`(동시 락)·`store-return-exchange.refund.integration.spec.ts` 2개는 롤백 불가라 unique 접미사 행을 남긴다. pristine 이 필요하면 `docker compose down -v && docker compose up -d` 후 `npm run db:migrate:local`.

## 아직 로컬화 안 된 것

- **OIDC SSO 로그인 플로우** (storefront/admin 로그인): user-service DB 에 `oauth_clients` 시드가 필요하고 auth-web(8001)도 띄워야 한다. 백엔드 API 자체는 SSO 없이 동작.
- **알림톡 실발송**: dev 시크릿부터 `NhnSecretKey` 가 빈 값이라 로컬 `.env` 엔 더미(`local-dummy-no-send`)를 넣어 부팅만 되게 함. 실발송 테스트는 라이브에서만.

- **reference/demo 시드** (`db:seed:ref`, `db:seed:demo`): `sst shell` 의 `Resource.Db` 에 의존해서 로컬 postgres 에 못 쓴다.
  core 개발용 시드는 위 "core 단독 개발 + `dev_core` 시드" 로 대체됐다. 다른 서비스(wallet/membership 등)의
  로컬 시드가 필요해지면 `scripts/seeding/lib/db-connection.ts` 에 `DATABASE_URL` fallback 을 추가한다.
- **OpenSearch** (search / ugc 리뷰 정렬): compose 에 없음. search 앱을 로컬에서 돌려야 할 때 추가.
- **S3, NHN Cloud SMS, 소셜 로그인 등 외부 서비스**: `.env` 의 기존 키를 그대로 쓰면 됨 (로컬화 대상 아님).

## 트러블슈팅

- **`password authentication failed` 인데 `docker exec` 로는 접속되는 경우**: 호스트에 다른 PostgreSQL(EDB 설치판, postgres.app, Homebrew 등)이 이미 5432 를 점유해 localhost 접속을 가로채는 것.
  `ps aux | grep postgres` 로 확인하고 정지하거나 (EDB 예: `sudo launchctl bootout system /Library/LaunchDaemons/postgresql-18.plist`),
  compose 포트를 바꾸고 `LOCAL_PG=postgresql://postgres:postgres@localhost:<포트>` 로 마이그레이션 실행.
- **drizzle-kit 이 조용히 exit 0 하는데 테이블이 안 생김**: 위와 같은 접속 실패를 drizzle-kit 이 삼키는 증상. DB 접속부터 psql 로 확인할 것.

## 주의

- `apps/medusa/docker-compose.yml` 은 postgres/redis/kafka 포트가 루트 compose 와 겹친다 — 둘 다 띄우지 말 것. 루트 compose 를 쓴다.
- `db:setup` / `db:bootstrap` / `db:migrate` (sst 경로) 는 live 배포용으로만 남는다.

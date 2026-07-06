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
   postgres 최초 기동 시 `scripts/local/init-db.sql` 이 논리 DB 10개
   (core, medusa, wallet, analytics, channel_adapter, membership, notification, ugc, file_service, user_service)를 만든다.
5. **로컬 포트 배치** — `.env` 들의 PORT 와 서비스 간 URL(`OIDC_ISSUER_URL`, `WALLET_BASE_URL` 등)은 아래 표 기준으로 맞춘다. (배포판 `.env` 묶음을 그대로 받았다면 이미 반영돼 있음.)

   | 앱 | 포트 | | 앱 | 포트 |
   |---|---|---|---|---|
   | user-service | 3000 | | file-service | 3010 |
   | membership | 3001 | | ugc-service | 3030 |
   | channel-adapter | 3003 | | analytics | 3040 |
   | notification | 3050 | | search | 3060 |
   | core | 3100 | | wallet | 5001 |
   | medusa | 9000 | | storefront / auth-web | 8000 / 8001 |

   각 앱 `.env` 공통 키:
   ```
   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/<논리DB>   # 예: core → .../core
   KAFKA_BROKERS=localhost:9092    # KAFKA_API_KEY/SECRET 는 삭제 또는 주석
   REDIS_URL=redis://localhost:6379
   ```
   전체 필수 키 목록의 SoT 는 `deployments/lcnine/{services,auth}/infra/services.ts` 의 각 서비스 `environment` 블록 — `.env` 가 안 맞으면 여기와 대조할 것. 시크릿 값은 `sst secret list --stage dev` 로 조회.
6. **스키마 마이그레이션**
   ```bash
   npm run db:migrate:local        # drizzle 서비스 전체 (셸에서 localhost URL 주입 — 원격 DB 절대 안 건드림)
   cd apps/medusa && DATABASE_URL=postgresql://postgres:postgres@localhost:5432/medusa npx medusa db:migrate --execute-safe-links
   ```
7. **서비스 실행** (필요한 것만)
   ```bash
   npm run start:main:dev          # core
   npm run start:user-service:dev
   npm run start:wallet:dev
   # ...
   ```

## 다른 사람이 이 노트북에 접속하기

앱들이 `0.0.0.0` 바인딩이라 서버 쪽 설정은 필요 없다.

- **같은 사무실 LAN**: `http://<노트북 IP>:<포트>` (IP 는 `ipconfig getifaddr en0` / `ip addr`)
- **다른 네트워크**: 양쪽에 [Tailscale](https://tailscale.com) 설치 후 `http://<tailscale IP>:<포트>`
- macOS 는 첫 실행 시 방화벽 허용 프롬프트만 수락하면 됨. 리눅스는 `ufw allow <포트>`.
- DB 도 직접 붙어야 하면 `postgresql://postgres:postgres@<노트북 IP>:5432/<논리DB>` (compose 가 5432 를 노출).

## 아직 로컬화 안 된 것

- **OIDC SSO 로그인 플로우** (storefront/admin 로그인): user-service DB 에 `oauth_clients` 시드가 필요하고 auth-web(8001)도 띄워야 한다. 백엔드 API 자체는 SSO 없이 동작.
- **알림톡 실발송**: dev 시크릿부터 `NhnSecretKey` 가 빈 값이라 로컬 `.env` 엔 더미(`local-dummy-no-send`)를 넣어 부팅만 되게 함. 실발송 테스트는 라이브에서만.

- **reference/demo 시드** (`db:seed:ref`, `db:seed:demo`): `sst shell` 의 `Resource.Db` 에 의존해서 로컬 postgres 에 못 쓴다.
  당장 필요하면 기존 DB 에서 `pg_dump --data-only` 로 가져올 것. 자주 필요해지면 `scripts/seeding/lib/db-connection.ts` 에 `DATABASE_URL` fallback 추가.
- **OpenSearch** (search / ugc 리뷰 정렬): compose 에 없음. search 앱을 로컬에서 돌려야 할 때 추가.
- **S3, Twilio, 소셜 로그인 등 외부 서비스**: `.env` 의 기존 키를 그대로 쓰면 됨 (로컬화 대상 아님).

## 트러블슈팅

- **`password authentication failed` 인데 `docker exec` 로는 접속되는 경우**: 호스트에 다른 PostgreSQL(EDB 설치판, postgres.app, Homebrew 등)이 이미 5432 를 점유해 localhost 접속을 가로채는 것.
  `ps aux | grep postgres` 로 확인하고 정지하거나 (EDB 예: `sudo launchctl bootout system /Library/LaunchDaemons/postgresql-18.plist`),
  compose 포트를 바꾸고 `LOCAL_PG=postgresql://postgres:postgres@localhost:<포트>` 로 마이그레이션 실행.
- **drizzle-kit 이 조용히 exit 0 하는데 테이블이 안 생김**: 위와 같은 접속 실패를 drizzle-kit 이 삼키는 증상. DB 접속부터 psql 로 확인할 것.

## 주의

- `apps/medusa/docker-compose.yml` 은 postgres/redis/kafka 포트가 루트 compose 와 겹친다 — 둘 다 띄우지 말 것. 루트 compose 를 쓴다.
- `db:setup` / `db:bootstrap` / `db:migrate` (sst 경로) 는 live 배포용으로만 남는다.

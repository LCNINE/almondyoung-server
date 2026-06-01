# deployments/lcnine/ — lcnine 배포 구조

상위 `deployments/CONVENTIONS.md` 의 3-env(platform/auth/services) 분리 규칙을 lcnine 에 적용한 실제 구성. 코드 수정 전에 이 문서로 의존 방향과 자원 소유권을 먼저 잡을 것.

## 앱 구성 (모두 region `ap-northeast-2`)

| 폴더 | SST `name` | 책임 |
|---|---|---|
| `platform/` | `lcnine-platform` | VPC + Kafka(Redpanda 1-node) — 공유 인프라 |
| `auth/` | `lcnine-auth` | IdP: user-service + auth-web. 자체 Postgres·ALB |
| `services/` | `lcnine-services` | 커머스/물류/결제 도메인 + Medusa + admin/wallet web |

세 앱 공통: stage 가 `live` 면 운영(`removal: retain`, `protect: true`, `*.almondyoung-next.com`), 그 외(`dev` 등)는 `.dev.lcnine-dev.com` 접두사 + `removal: remove`.

배포 순서: `platform → auth → services` (최초 부트스트랩 시. 이후엔 SSM late-binding 으로 독립 재배포 가능).

## 1. lcnine-platform — 공유 인프라

`platform/infra/shared.ts`

- **VPC** (`sst.aws.Vpc`, bastion 상시 ON — `sst tunnel` 로 IdP DB 등 내부 자원 시딩/점검용. t4g.nano 월 ~$3).
- **Redpanda 1-노드 Kafka**: EC2 `t4g.micro` (ARM AL2023) + EBS gp3 10GB(영속). Cloud Map A 레코드 `Redpanda.<stage>.lcnine-platform.sst:9092` 로 VPC 내부 DNS 공개. PLAINTEXT.
  - Fargate/EFS 는 Seastar AIO 미지원이라 EC2+EBS 선택. 단일 노드라 인스턴스/AZ 장애 시 짧은 다운타임 — application 레이어 transactional outbox 가 재시도로 흡수.
  - bootstrap: `redpanda.cloud-init.sh` (EBS 포맷/마운트 + Docker + systemd unit, `__REDPANDA_ADVERTISE_DNS__` 치환).
  - 인스턴스 라이프사이클 보강 사항(systemd bootstrap 분리 / snapshot 경유 교체 / AMI pin) 은 [`platform/REDPANDA_HARDENING.md`](platform/REDPANDA_HARDENING.md) 참조.

`platform/infra/services.ts` 가 SSM 으로 publish:

- `/lcnine-platform/<stage>/vpc-id`
- `/lcnine-platform/<stage>/kafka-brokers`
- `/lcnine-platform/<stage>/kafka-security-protocol` (현재 `PLAINTEXT`)

## 2. lcnine-auth — IdP (분리된 SST 앱)

`auth/infra/shared.ts`

- 위 SSM 두 키를 읽어 **platform VPC 공유** (`sst.aws.Vpc.get`). 같은 VPC 라서 Redpanda Cloud Map DNS 가 자동 해석됨.
- 자체 소유: `Postgres("IdpDb")`, `Cluster`, **specific hostname ALB** (`user.<base>`).
  - services 의 wildcard ALB 와의 Route53 우선순위 충돌을 피하기 위함 (specific A record > wildcard alias).
- 도메인: `user.dev.lcnine-dev.com` / live 시 `user.almondyoung-next.com`, `auth.<base>` 도 동일 패턴.

`auth/infra/services.ts`

- **user-service** (Fargate, `apps/user-service/Dockerfile`, monorepo root context). `AuthSecret`/`JwtRefreshSecret`/`JwtVerificationTokenSecret`/`OauthClients`/`OauthInternalSecret` 주입. `COOKIE_DOMAIN=.<baseDomain>`. 데모 단계라 Kakao/Twilio/Cafe24/S3 secret 은 주석.
- **auth-web** (`sst.aws.Nextjs` — OpenNext + CloudFront). `web/auth-web` 빌드, 도메인 `auth.<base>`. ALB 와 별개 배포라 충돌 없음.

SSM publish:

- `/lcnine-auth/<stage>/user-service-url`, `auth-web-url`, `issuer-url`
- `/lcnine-auth/<stage>/auth-secret` — **TEMP(시연용)** SecureString. services 의 Medusa 가 동일 시크릿으로 user-service JWT 를 verify 하기 위함.

## 3. lcnine-services — 도메인 서비스

`services/infra/shared.ts`

- platform VPC + Kafka 를 SSM 으로 가져옴.
- 자체 소유: `Postgres("Db")`, `Redis("Redis")` (ElastiCache Serverless), **wildcard ALB** (`*.dev.lcnine-dev.com` 또는 `*.almondyoung-next.com`).
- 한 Postgres 인스턴스에 서비스별 논리 DB(`dbUrl("analytics")` 등)로 분리. Redis 도 DB 인덱스로 분리.
- `createService()` 헬퍼: ECS Fargate Service + ALB 룰. `transform.listenerRule` 로 hostHeader 조건을 직접 덮어써 wildcard ALB 한 대에 host 기반 멀티플렉싱.

`services/infra/services.ts` — 배포 서비스 목록:

| 이름 | hostname | 포트 | 비고 |
|---|---|---|---|
| Analytics | `analytics.…` | 3040 | |
| ChannelAdapter | `channel-adapter.…` | 3000 | Naver/Coupang 키는 현재 더미 |
| Membership | `membership.…` | 3000 | Wallet 호출 |
| Notification | `notification.…` | 3000 | NHN AlimTalk + Resend |
| **Core** | `core.…` | 3000 | **wms + pim 통합 superset** (`apps/core`) |
| UgcService | `ugc.…` | 3030 | |
| Wallet | `wallet.…` | 3000 | Toss/Nicepay, Medusa 결제 webhook |
| FileService | `file.…` | 3000 | S3 (`almondyoung-demo`) |
| Search | `search.…` | 3000 | AWS OpenSearch Service Domain (VPC, 단일 AZ, t3.small.search) — `services/infra/shared.ts` 에서 owned |
| Medusa | `medusa.…` | 9000 | DB+Redis link, 600s grace, IdP `AUTH_SECRET` 으로 JWT verify |
| AdminWeb | `admin.…` | — | Next.js / OpenNext / CloudFront |
| WalletWeb | `wallet-web.…` | — | Next.js / OpenNext / CloudFront |
| Storefront | `www.…` | — | Next.js / OpenNext / CloudFront. Medusa STORE_CORS에 등록된 슬롯 |

cross-stack: `/lcnine-auth/<stage>/user-service-url`, `/auth-web-url`, (TEMP) `auth-secret` 을 읽어 Medusa·Storefront·admin 등에 주입.

### Core

`apps/core` (= 배포 이름 **Core**, hostname `core.…`) 는 **wms 와 pim 의 도메인을 모두 포함하는 통합 백엔드**. legacy `apps/wms`, `apps/pim` 은 제거됨 — 신규 도메인 로직은 모두 Core 에 추가.

다른 서비스 환경변수에서 wms/pim 을 참조하던 자리(예: ChannelAdapter 의 `PIM_API_URL`)는 `url("core")` 로 통합되어 있음. Medusa checkout 은 Core/WMS URL 을 받지 않고 Medusa local inventory projection 으로 재고를 판단한다.

## 핵심 설계 포인트

1. **3-앱 분리 + 단일 공유 VPC** — platform 이 VPC/Kafka 를 만들고 auth/services 는 `Vpc.get` 으로 공유. SSM Parameter Store 가 cross-stack 글루.
2. **ALB 분리 전략** — auth 는 specific hostname ALB(`id.`), services 는 wildcard ALB(`*.`). Route53 specific A record 우선순위로 충돌 회피.
3. **Kafka = 1-노드 Redpanda on EC2** — 비용 최적. 다운타임은 outbox 로 흡수.
4. **Stage 정책** — `live` 만 운영, 나머지는 `.dev.` 접두 비운영. bastion 은 dev/live 모두 ON.
5. **Secret 은 `sst secret set`** — 각 앱·stage 별로 따로 세팅 필요.
6. **TEMP(시연용) hack** 두 가지 — `TEMP:` 주석 위치 확인 후 정식화 여부 판단:
   - IdP `AUTH_SECRET` SecureString export → Medusa/Wallet 가 동일 시크릿으로 user-service JWT verify.
   - `OAUTH_BYPASS_VALIDATION=true` 로 OAuth client/redirect 검증 우회.

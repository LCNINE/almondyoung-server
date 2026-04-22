# deployments/ 컨벤션

여러 회사에 동일 시스템을 배포하기 위한 SST 앱 배치 규칙.

## 폴더 구조

```
deployments/{company}/{env}/
├── sst.config.ts
└── infra/
    ├── shared.ts
    └── services.ts
```

- `{company}`: 회사 slug, 소문자 짧게 (`lcnine`, `df`)
- `{env}`: 앱 역할, 아래 세 값 중 하나

| env | 책임 |
|---|---|
| `platform` | VPC, Kafka(Redpanda/MSK), 공유 네트워킹. 다른 두 env의 인프라 의존성을 SSM으로 publish |
| `auth` | IdP (user-service + auth-web). OAuth client 발급/토큰 |
| `services` | 커머스/물류/결제 등 도메인 서비스 |

## 앱 이름 (SST `name`)

`{company}-{env}` 규칙.

```ts
$config({ app() { return { name: "lcnine-auth", ... } } })
```

Pulumi state가 `{app-name}/{stage}` 키로 저장되므로 **한 번 배포된 이름은 state 이전 없이는 바꿀 수 없다**. 신규 앱을 만들 때 이름을 먼저 확정할 것.

| 회사 | env | 앱 이름 | 경로 |
|---|---|---|---|
| lcnine | platform | `lcnine-platform` | `deployments/lcnine/platform/` |
| lcnine | auth | `lcnine-auth` | `deployments/lcnine/auth/` |
| lcnine | services | `lcnine-services` | `deployments/lcnine/services/` |
| df | platform | `df-platform` | `deployments/df/platform/` |
| df | auth | `df-auth` | `deployments/df/auth/` |
| df | services | `df-services` | `deployments/df/services/` |

## SSM 네임스페이스

Cross-stack 참조는 SSM Parameter Store로 주고받는다. 키 포맷:

```
/{app-name}/{stage}/{resource-name}
```

예:
- `/lcnine-auth/dev/user-service-url`
- `/lcnine-auth/dev/issuer-url`
- `/lcnine-platform/live/kafka-brokers`
- `/lcnine-platform/live/vpc-id`

**Publish** (해당 자원을 소유한 앱):
```ts
new aws.ssm.Parameter("IdpUserServiceUrl", {
  name: `/lcnine-auth/${$app.stage}/user-service-url`,
  type: "String",
  value: userServiceUrl,
});
```

**Read** (consumer 앱):
```ts
const idpUserServiceUrl = aws.ssm.getParameterOutput({
  name: `/lcnine-auth/${$app.stage}/user-service-url`,
}).value;
```

## Stage

- `live` — 운영 stage. **유일한 특별 취급 stage**.
  - `removal: "retain"` (삭제 저항성)
  - `protect: true` (`sst remove` 시 추가 확인)
  - 도메인에 접두사 없음 (`id.almondyoung-next.com` 같이 베이스 도메인 바로 사용)
- `live` 이외의 모든 stage(`dev`, `staging`, `pr-*` 등) — 비운영 취급.
  - `removal: "remove"` (state 삭제 시 리소스 동반 정리)
  - 도메인에 `.dev.` 접두사 (예: `id.dev.almondyoung-next.com`)

VPC bastion은 **dev/live 모두 상시 ON**. VPC 내부 리소스(IdP DB 등)에 대한 시딩·점검 접근(`sst tunnel`) 경로가 필요하고, t4g.nano 1대 비용(월 ~$3)은 무시할 수준.

배포·삭제 커맨드 예:
```bash
npx sst deploy --stage dev
npx sst deploy --stage live     # 운영 배포
```

과거 `"production"` 이 맡던 역할을 `"live"` 로 통일. 신규 코드는 반드시 `live` 기준으로 작성.

## 배포 순서

의존 방향: `services → platform`, `services → auth`, `auth → platform`

따라서 일반 순서:
1. `platform` (VPC, Kafka 등 기반)
2. `auth` (IdP)
3. `services` (커머스 등)

최초 부트스트랩이 아니라면 각 앱은 독립적으로 재배포 가능 (SSM read는 late-binding).

## 도메인

- `platform`은 도메인 자원 소유 안 함 (VPC/내부 서비스만)
- `auth`: `id.<base>` (IdP API), `auth.<base>` (auth-web)
- `services`: 회사별 서비스 hostname은 `services` 앱이 결정. `auth`와 **다른 hostname**을 써야 ALB/CloudFront Route53 충돌 없음.

같은 Route53 존을 공유하는 경우 ALB는 **wildcard가 아닌 specific hostname** 도메인으로 잡을 것 (specific A record가 wildcard alias보다 Route53에서 우선되므로 충돌 회피).

## 레거시 (이주 대상)

현재 컨벤션을 따르지 않는 기존 배포:

| 현재 | 이주 목표 | 비고 |
|---|---|---|
| `deployments/df/` (`df`) | `deployments/df/services/` + `df-services` | platform/auth 분리 작업과 함께 진행 |

이주 전까지는 기존 이름/경로를 유지하되, **신규는 반드시 이 컨벤션을 따를 것**.

## 주의

- **JWT `iss` 클레임**(예: `"almondyoung-auth"`)은 애플리케이션 레이어 identity 값이지 SST 앱 이름과 무관. 앱 rename해도 `iss`는 기존 토큰 호환을 위해 유지.
- `$app.stage`는 모든 회사에서 동일한 의미(`dev`/`staging`/`live`)로 쓰되, SSM 키 분리는 `{app-name}`이 회사·환경을 모두 담으므로 자연스럽게 해결됨.

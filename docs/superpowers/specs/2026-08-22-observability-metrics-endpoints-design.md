# 관측 메트릭 엔드포인트 — 전 앱 확장과 경계 정리

- 날짜: 2026-08-22
- 관련 이슈: #613
- 관련 ADR: ADR-0029 (events 등록 표면), 후속으로 파생된 이슈

## 1. 문제

재시도 소진·non-retryable 에러로 DLQ 에 빠진 이벤트를 세는 `events_dlq_messages_total` /
`events_dlq_send_failures_total` 카운터가 `libs/events/src/dlq/dlq.metrics.ts` 에 있다.
prom-client 의 전역 register 는 **프로세스 단위**이고, Alloy 는 Core 하나만 스크레이프한다
(`config.alloy:104`, `services.ts:170` 의 단일 `CORE_METRICS_TARGET`).

결과: Core 를 뺀 나머지 앱에서 DLQ 로 빠지는 이벤트는 **로그에만 남고 지표·알림·추이가 없다.**
그리고 스크레이프 설정만의 문제가 아니다 — 다른 앱들은 `/metrics` 엔드포인트 자체가 없다
(`register.metrics()` 호출: core 1건, 나머지 0건).

부수적으로 확인된 두 가지:

- Core 의 `/metrics` 는 `@Public()` 이고 Core 는 퍼블릭 ALB(`domainSlug: 'core'`) 뒤에 있어
  **인증 없이 인터넷에서 열린다** (`curl https://core.almondyoung.com/metrics` → 200, 13KB).
- Alloy 의 스크레이프 타깃이 Cloud Map DNS 이름을 향하는 **static target 하나**라,
  인스턴스가 2개가 되는 순간 지표가 조용히 망가진다 (§3.5).

## 2. 범위

### 이번에 하는 것

1. `@app/shared` 에 공용 metrics HTTP 서버를 두고, `@app/events` 를 쓰는 앱 9개가 각자 띄운다.
2. 그 서버를 **앱의 ALB 포트가 아닌 별도 포트**에 띄워 인터넷 경로를 구조적으로 없앤다.
3. Core 의 기존 `/metrics` 컨트롤러(inventory 모듈 안)를 제거한다.
4. Alloy 의 스크레이프를 static target → `discovery.dns` 로 바꿔 **인스턴스 수와 무관하게** 옳게 만든다.

마이그레이션 0건 · 신규 시크릿 0건 · 신규 AWS 리소스 0건.

### 이번에 하지 않는 것 (후속)

- **admin-web status page.** 6개 앱 지표가 실제로 Grafana 에 들어온 뒤에 결정한다. 다만 그때
  `/health` fan-out 으로 짓지 말 것 — 인스턴스가 N개면 ALB 가 그중 하나에만 물어보므로 동전던지기다.
  up/down 의 정확한 정본은 앱이 아니라 AWS (ECS `DescribeServices` + ELBv2 `DescribeTargetHealth`) 다.
- **`/events/trace/*` 잠그기.** `EventTraceController` 가 `@SetMetadata('isPublic', true)` 라
  5개 앱에서 이벤트 체인이 공개 상태다. 별도 이슈.
- **`MetricsService` 죽은 코드 제거.** `setAvailableStock`(`sku_id`×`warehouse_id` 라벨 —
  카디널리티 폭탄) 과 `createCustom*` 3종은 호출처가 0곳이다. 별도 이슈.
- **`@Cron` 리더 선출.** 40개(core 15·membership 8·wallet 7·user-service 6·channel-adapter 4)가
  스케줄러 락 없이 돈다. 코드의 `pg_advisory_xact_lock` 은 전부 업무 단위 락이다.
  **`scaling.max` 를 실제로 올리려면 이게 선행 조건이다.** 별도 이슈.
- **`/health` 포맷 통일.** 앱마다 제각각이다 (core 는 `{status,service}`, wallet 만 `/v1/ready` 로
  DB 핑, search 는 OpenSearch 를 찔러 `degraded` 를 내지만 `@Public()` 이 없고, membership 은
  `{status:'ok'}` 뿐). ALB 헬스체크는 정상 동작 중이라 급하지 않다.

## 3. 설계

### 3.1 배포 토폴로지 (실측)

앱마다 태스크 하나인 구조가 **아니다.** 6개 경량 앱은 2개 태스크에 묶여 있고,
태스크 안에서 `supervisor.mjs` 가 앱마다 **별도 Node 프로세스**를 띄운다.

| 앱 | ECS 서비스 | Cloud Map 이름 | 앱 포트 | 메트릭 포트 |
|---|---|---|---|---|
| core | Core | `Core.live.lcnine-services.sst` | 3000 | 13000 |
| wallet | Wallet | `Wallet.live.lcnine-services.sst` | 3000 | 13000 |
| analytics | ServicesBundleA | `ServicesBundleA.live.lcnine-services.sst` | 3040 | 13040 |
| channel-adapter | ServicesBundleA | 〃 | 3001 | 13001 |
| membership | ServicesBundleA | 〃 | 3002 | 13002 |
| notification | ServicesBundleB | `ServicesBundleB.live.lcnine-services.sst` | 3003 | 13003 |
| search | ServicesBundleB | 〃 | 3004 | 13004 |
| ugc | ServicesBundleB | 〃 | 3030 | 13030 |
| user-service | UserService (lcnine-auth) | `UserService.live.lcnine-auth.sst` | 3000 | 13000 |

`file-service` 는 `@app/events` 사용 0건이라 제외한다. `medusa` 는 우리 코드가 아니다.

프로세스가 앱마다 분리돼 있으므로 **prom-client 전역 register 도 앱마다 분리**된다. 즉 한 태스크에
3개 앱이 있어도 지표가 섞이지 않는다. 대신 **메트릭 포트는 태스크 안에서 겹치면 안 된다.**

`user-service` 는 별도 SST 배포(`lcnine-auth`)지만 **같은 Cloud Map 네임스페이스(`sst`)** 에
등록돼 있어 lcnine-services 의 Alloy 가 DNS 로 그대로 도달한다.

### 3.2 포트 규칙 — `PORT + 10000`

메트릭 포트를 앱 포트에서 파생시킨다. 앱 포트는 한 태스크 안에서 이미 유일하므로(ALB 룰이 강제)
**파생 포트도 자동으로 유일**하다. 별도 env 를 앱마다 심을 필요가 없다.

- 기본값: `Number(process.env.PORT) + 10000`
- 덮어쓰기: `METRICS_PORT` 가 있으면 그 값 (로컬·예외 상황용)
- `PORT` 미설정(일부 로컬·테스트): 서버를 띄우지 않고 조용히 건너뛴다. 배포 환경에서는
  standalone 은 `shared.ts` 의 `PORT: String(opts.port)`, 번들은 `supervisor.mjs` 의
  `env.PORT` 로 **항상 설정된다**

### 3.3 공용 metrics 서버

`libs/shared/src/observability/metrics-server.ts` (신규). 이미 있는 `observability/` 폴더에 둔다 —
`telemetry.ts` 와 나란한 자리다. **새 lib 을 만들지 않는다.**

```ts
import { createServer, Server } from 'node:http';
import { register } from 'prom-client';

function resolvePort(): number | undefined {
  const explicit = Number(process.env.METRICS_PORT);
  if (Number.isInteger(explicit) && explicit > 0) return explicit;
  const appPort = Number(process.env.PORT);
  return Number.isInteger(appPort) && appPort > 0 ? appPort + 10000 : undefined;
}

export function startMetricsServer(): Server | undefined {
  const port = resolvePort();
  if (!port) return undefined;   // PORT 미설정(일부 테스트) 이면 조용히 건너뛴다

  const server = createServer((req, res) => {
    if (req.url !== '/metrics') {
      res.writeHead(404).end();
      return;
    }
    register
      .metrics()
      .then((body) => {
        res.writeHead(200, { 'Content-Type': register.contentType });
        res.end(body);
      })
      .catch(() => res.writeHead(500).end());
  });

  server.listen(port, '0.0.0.0');
  // 이벤트 루프를 붙들지 않게 한다 — 앱의 종료 경로에 개입하지 않고,
  // Nest 가 닫히면 프로세스가 그대로 빠져나간다.
  server.unref();
  return server;
}
```

설계상 지켜야 할 것:

- **Nest 밖이다.** 로거·예외필터·가드가 안 붙는다. 그래서 코드가 짧아야 하고, 라우팅은
  `/metrics` 단 하나다. 그 밖은 404.
- **`unref()` 를 반드시 붙인다.** 안 붙이면 종료 시 이 핸들이 이벤트 루프를 붙들어 태스크 종료가
  `GRACEFUL_TIMEOUT_MS`(28s) 까지 늘어질 수 있다.
- 예외를 삼키고 500 을 낸다. 스크레이프 실패는 Alloy 쪽 `up=0` 으로 드러난다.

### 3.4 앱별 배선 — `tracing.ts` 한 줄

9개 앱 전부 `src/tracing.ts` 라는 동일한 진입 훅을 이미 갖고 있고, `main.ts` 첫 줄에서
`import './tracing'` 한다. 여기에 한 줄을 더한다. **`main.ts` 는 건드리지 않는다.**

```ts
import { startTelemetry } from '@app/shared/observability/telemetry';
import { startMetricsServer } from '@app/shared/observability/metrics-server';

startTelemetry({ serviceName: 'core' });
startMetricsServer();
```

`telemetry.ts` 와 같은 이유로 **deep 경로 import** 를 쓴다 (`@app/shared` 배럴을 당기면 OTEL SDK
시작 전에 다른 모듈이 로드된다).

### 3.5 Alloy — static target → `discovery.dns`

SST 는 서비스마다 Cloud Map 에 **A 레코드 / TTL 60 / MULTIVALUE 라우팅**으로 등록하고
(`.sst/platform/.../service.ts:2377-2379`), 태스크마다 인스턴스를 하나씩 붙인다 (실측: Core 는
현재 1개, `10.0.13.115`).

지금처럼 DNS 이름을 static target 하나로 두면 인스턴스가 2개가 됐을 때 스크레이프마다 아무
태스크에나 붙는다. 카운터가 A값 → B값 → A값으로 오르내리고 Prometheus 는 그 감소를 **카운터
리셋으로 해석**한다. 에러 없이 그래프만 틀린다.

`discovery.dns` 는 A 레코드를 전부 열거해 **IP 하나당 target 하나**를 만들고 `instance` 라벨을
분리한다. 그러면 `sum by (job) (...)` 이 인스턴스 수와 무관하게 옳다.

앱마다 블록 한 쌍을 쓴다 (9쌍):

```alloy
discovery.dns "core" {
  names = ["Core." + sys.env("METRICS_DNS_SUFFIX_SERVICES")]
  type  = "A"
  port  = 13000
}

prometheus.scrape "core" {
  targets         = discovery.dns.core.targets
  job_name        = "core"
  metrics_path    = "/metrics"
  scrape_interval = "30s"
  forward_to      = [prometheus.remote_write.grafanacloud.receiver]
}
```

- 한 Cloud Map 이름에 여러 앱이 붙는 번들은 **포트만 다른 블록을 앱 수만큼** 만든다
  (ServicesBundleA → 3쌍, ServicesBundleB → 3쌍).
- `job_name` 은 기존 OTEL `service_name` 과 **같은 값**으로 맞춘다 (core, wallet, analytics,
  channel-adapter, membership, notification, search, ugc, user-service). Tempo·Loki 라벨과
  상관을 유지하기 위해서다. 번들 앱의 정본은 `supervisor.mjs` 의 `otel` 필드다 — ugc 는
  `'ugc'` 이지 `'ugc-service'` 가 아니다 (`startTelemetry` 는 `OTEL_SERVICE_NAME` 을 우선한다).
- `scrape_interval = "30s"` 는 현행 값을 유지한다 (Core 메모리 스파이크 관측용 주석 참조).

블록이 9쌍이라 장황하지만, 명시적이라 읽는 데 추론이 필요 없다. Alloy `declare` 로 압축하는 것은
후속에서 판단한다.

### 3.6 인프라 env

`services.ts` 의 Alloy `environment` 에서 `CORE_METRICS_TARGET` 을 제거하고 접미사 2개를 넣는다:

```ts
METRICS_DNS_SUFFIX_SERVICES: $interpolate`${$app.stage}.${$app.name}.${vpc.nodes.cloudmapNamespace.name}`,
METRICS_DNS_SUFFIX_AUTH:     $interpolate`${$app.stage}.lcnine-auth.${vpc.nodes.cloudmapNamespace.name}`,
```

**구현 시 검증할 것**: Alloy 설정에서 문자열 `+` 연결이 되는지. 안 되면 접미사 2개 대신
앱별 전체 이름 env 9개로 되돌린다 (동작은 동일, 장황해질 뿐).

### 3.7 왜 별도 포트인가

인터넷 도달 경로가 **코드나 룰이 아니라 라우팅의 부재로** 막힌다. 실측 근거:

| 항목 | 확인 결과 |
|---|---|
| 태스크 정의에 포트 추가 필요 | **불필요** — SST 가 `portMappings: [{ containerPortRange: "1-65535" }]` (`fargate.ts:1186`) |
| 보안그룹 룰 추가 필요 | **불필요** — 태스크 SG `sg-0b6926d27482653e6` 가 `10.0.0.0/16` 에서 전 프로토콜·전 포트 허용 |
| 인터넷에서 13000번대 도달 | **불가** — ALB 리스너 룰이 `forward: '<앱포트>/http'` 하나뿐이고, 태스크는 private subnet + `assignPublicIp: false` |

대안이던 "Nest 컨트롤러 + ALB 차단 룰"은 `@Public()` 을 정확히 걸어야 하고 차단 룰이 앱 수만큼
필요하며, 그 룰이 지워지면 조용히 다시 열린다. Core 가 지금 정확히 그 상태다.

별도 포트의 대가는 §3.3 에 적은 셋이다: Nest 로거가 안 붙고, `unref()` 를 잊으면 종료가 늘어지며,
로컬에서 포트를 하나 더 쓴다.

## 4. 배포

**앱과 Alloy 는 분리 배포가 아니다.** `config.alloy` 는
`deployments/lcnine/services/observability/alloy/Dockerfile` 이 이미지에 COPY 하고,
Alloy 컨테이너는 `deployments/lcnine/services/infra/services.ts` 의
`new sst.aws.Service('Observability', ...)` 로 떠 있어 Core·Wallet·번들과 **같은 SST 앱
(lcnine-services)** 이다. 즉 `sst deploy` (lcnine-services) 한 번이 8개 앱과 Alloy 설정을
**동시에** 롤링한다 — "1. 앱 배포 → 3. Alloy 설정 반영 배포"로 나눌 수 없다.

1. `sst deploy` (lcnine-services) — 8개 앱(core, wallet, analytics, channel-adapter,
   membership, notification, search, ugc) 과 Alloy 설정이 함께 바뀐다.
2. `sst deploy` (lcnine-auth) — user-service.

**롤링 중 수 분간 일부 job 이 `up=0` 인 것은 정상이다.** 새 Alloy 설정(코드)과 새 태스크
IP(discovery.dns 대상)가 동시에 굴러가는 동안, 아직 내려가지 않은 옛 태스크나 아직 뜨지
않은 새 태스크를 향한 스크레이프는 실패할 수 있다. 태스크 교체가 끝나면 저절로 사라진다.

**user-service 는 1번과 별개로, 2번(lcnine-auth 배포)을 하기 전까지 계속 `up=0` 이다** —
같은 배포가 아니므로 자동으로 따라가지 않는다.

마이그레이션 없음. 시크릿 없음. 롤백은 배포 되돌리기로 충분하다.

## 5. 완료 판정

`sum by (job) (events_dlq_messages_total)` 은 **판정 기준으로 쓸 수 없다.** prom-client 의 라벨
카운터는 한 번도 증가하지 않으면 시리즈 자체가 생기지 않는다. 실제로 현재 Core 응답에도
`events_dlq_*` 는 HELP/TYPE 만 있고 샘플이 0건이다 (이슈 본문의 "2건"은 그 사이 Core 재시작으로
사라졌다 — 카운터는 프로세스 메모리다).

판정은 스크레이프 성립 여부로 한다:

```promql
count(up == 1) by (job)   # core, wallet, analytics, channel-adapter,
                          # membership, notification, search, ugc, user-service — 9개
```

**`up==1` 을 앱 헬스로 읽으면 안 된다.** metrics 서버는 `tracing.ts` 에서 Nest 부팅 **전**에
포트를 연다. 즉 Nest 가 DB 커넥션 대기 등으로 아직 요청을 못 받는 상태여도 `up=1` 이 나온다.
`up` 은 "스크레이프가 성립한다"만 뜻하고, 앱이 실제로 트래픽을 처리하는지는 별도로 확인해야
한다 (ALB 헬스체크·`/health` 등).

## 6. 검증 계획

- **단위**: `metrics-server.spec.ts` — `/metrics` 가 200 + `register.contentType`, 그 외 경로 404,
  포트 파생 규칙(`PORT + 10000`, `METRICS_PORT` 우선), `unref()` 호출 여부.
- **로컬 수동**: `PORT=3000 npm run start:main:dev` 로 앱 기동 후 `curl -s localhost:13000/metrics | head`
  에 `events_dlq_messages_total` HELP 줄이 보이는지. **`PORT` 를 명시해야 한다** — 각 앱은
  `main.ts` 에서 `PORT` 미설정 시 자체 기본 포트로 폴백하는데, `resolveMetricsPort` 는 그 폴백을
  모르고 `process.env.PORT` 만 본다. `PORT` 없이 로컬 기동하면 `METRICS_PORT` 도 없는 한
  metrics 서버가 조용히 스킵된다(§3.2).
- **게이트**: `npm run type-check` 0, `npx jest --maxWorkers=2` 실패 0.
- **배포 후**: Grafana 에서 §5 쿼리로 job 9개 확인. 그리고 `curl https://core.almondyoung.com/metrics`
  가 404 가 되는지 (기존 컨트롤러 제거 확인).

## 7. 리스크

| 리스크 | 완화 |
|---|---|
| `unref()` 누락 → 태스크 종료 지연 | 단위 테스트로 고정 |
| Alloy 문자열 `+` 연결 미지원 | §3.6 대로 앱별 전체 이름 env 9개로 폴백 |
| Alloy 이미지가 `:latest` — `discovery.dns` 동작이 버전에 좌우 | 배포 후 §5 쿼리로 즉시 확인. 버전 핀은 별도 이슈 |
| 활성 시리즈 증가 (앱당 `collectDefaultMetrics` ~35) | Core 만 `collectDefaultMetrics` 를 켠 상태를 유지하고, 나머지 앱은 켜지 않는다. 필요해지면 개별 판단 |
| `job` 라벨이 기존 `service_name` 과 어긋남 | §3.5 대로 `supervisor.mjs` 의 `otel` 값을 정본으로 삼는다 |
| `instance` 라벨의 의미가 바뀐다 — 옛 static target 은 `instance="Core.live.lcnine-services.sst:3000"` 이었고, `discovery.dns` 는 A 레코드를 IP 로 펼치므로 이제 `instance="10.0.x.y:13000"` 이다. 기존 Grafana 패널·알림이 `instance=` 값으로 고정돼 있으면 배포 후 조용히 빈 그래프가 된다. 배포마다 태스크 IP 가 바뀌므로 매번 새 시리즈 세트가 생긴다 | 배포 전 기존 패널·알림 쿼리에서 `instance=` 하드코딩 여부를 확인하고, `job` 라벨 기준으로 바꿔 둘 것 |

## 8. 후속 이슈로 낼 것

1. admin-web status page (데이터 정본은 AWS 컨트롤 플레인)
2. `/events/trace/*` 공개 노출 잠그기
3. `MetricsService` 죽은 API 제거
4. `@Cron` 리더 선출 — `scaling.max > 1` 의 선행 조건
5. Alloy 이미지 버전 핀

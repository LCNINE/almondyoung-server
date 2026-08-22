# 관측 메트릭 엔드포인트 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `@app/events` 를 쓰는 앱 9개가 각자 별도 포트로 Prometheus 메트릭을 노출하고, Alloy 가 인스턴스 수와 무관하게 그 전부를 스크레이프한다.

**Architecture:** Nest 밖의 작은 `node:http` 서버를 앱마다 `앱포트 + 10000` 에 띄운다. ALB 리스너 룰이 앱 포트만 포워딩하므로 이 포트는 인터넷 경로가 없다. Alloy 는 static target 대신 `discovery.dns` 로 Cloud Map A 레코드를 태스크마다 하나씩 target 으로 펼친다.

**Tech Stack:** TypeScript / NestJS(Fastify) / prom-client / Grafana Alloy / SST(Pulumi) on AWS ECS Fargate

**Spec:** `docs/superpowers/specs/2026-08-22-observability-metrics-endpoints-design.md`

**Branch:** `feat/observability-metrics-endpoints` — `develop` 에서 딴다. `develop` 에 직접 커밋하지 않는다.

## Global Constraints

- 대상 앱 9개 (`@app/events` 사용): `core` · `wallet` · `membership` · `notification` · `analytics` · `search` · `channel-adapter` · `ugc-service` · `user-service`. `file-service` 는 `@app/events` 사용 0건이라 **제외**한다.
- 메트릭 포트 규칙: `METRICS_PORT` 가 있으면 그 값, 없으면 `Number(process.env.PORT) + 10000`. 둘 다 없으면 서버를 띄우지 않는다.
- 배포 환경의 실제 포트: core 13000 · wallet 13000 · analytics 13040 · channel-adapter 13001 · membership 13002 · notification 13003 · search 13004 · ugc 13030 · user-service 13000.
- Alloy `job` 라벨은 기존 OTEL `service_name` 과 **같은 값**을 쓴다: `core` `wallet` `analytics` `channel-adapter` `membership` `notification` `search` `ugc` `user-service`. 번들 앱의 정본은 `deployments/lcnine/services/bundle/supervisor.mjs` 의 `otel` 필드다 — ugc 는 `'ugc'` 이지 `'ugc-service'` 가 **아니다**.
- `@app/shared/observability/*` 는 반드시 **deep 경로**로 import 한다 (`@app/shared` 배럴 금지). 배럴을 당기면 OTEL SDK 시작 전에 다른 모듈이 로드돼 계측을 놓친다 — `libs/shared/src/observability/telemetry.ts` 주석 참조.
- 마이그레이션 0건 · 신규 시크릿 0건 · 신규 AWS 리소스 0건. 이 계획에서 `drizzle` 관련 파일을 만들 일은 없다.
- 검증 게이트: `npm run type-check` 에러 0, `npx jest --maxWorkers=2` 실패 0. (`--maxWorkers=2` 없이 돌리면 OOM 이 난다.)
- `collectDefaultMetrics()` 는 Core 만 켠 현재 상태를 **유지**한다. 다른 앱에 새로 켜지 않는다 (활성 시리즈 비용).

---

### Task 1: 공용 metrics 서버 (`@app/shared`)

앱 프로세스마다 `/metrics` 를 뱉는 최소 HTTP 서버. Nest 와 무관한 독립 서버다.

**Files:**
- Create: `libs/shared/src/observability/metrics-server.ts`
- Test: `libs/shared/src/observability/metrics-server.spec.ts`

**Interfaces:**
- Consumes: 없음 (`prom-client` 의 전역 `register` 만 읽는다)
- Produces:
  - `resolveMetricsPort(env?: NodeJS.ProcessEnv): number | undefined`
  - `startMetricsServer(env?: NodeJS.ProcessEnv): Server | undefined` — `node:http` 의 `Server`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`libs/shared/src/observability/metrics-server.spec.ts`:

```ts
import type { AddressInfo } from 'node:net';
import { Counter, register } from 'prom-client';
import { resolveMetricsPort, startMetricsServer } from './metrics-server';

describe('resolveMetricsPort', () => {
  it('PORT 에 10000 을 더한다', () => {
    expect(resolveMetricsPort({ PORT: '3040' } as NodeJS.ProcessEnv)).toBe(13040);
  });

  it('METRICS_PORT 가 PORT 보다 우선한다', () => {
    expect(
      resolveMetricsPort({ PORT: '3040', METRICS_PORT: '9999' } as NodeJS.ProcessEnv),
    ).toBe(9999);
  });

  it('둘 다 없으면 undefined — 서버를 띄우지 않는다', () => {
    expect(resolveMetricsPort({} as NodeJS.ProcessEnv)).toBeUndefined();
  });

  it('PORT 가 숫자가 아니면 undefined', () => {
    expect(resolveMetricsPort({ PORT: 'nope' } as NodeJS.ProcessEnv)).toBeUndefined();
  });
});

describe('startMetricsServer', () => {
  let server: ReturnType<typeof startMetricsServer>;
  let port: number;

  beforeAll(async () => {
    // 전역 register 는 프로세스 단위라 다른 spec 이 먼저 등록해 뒀을 수 있다.
    register.clear();
    new Counter({
      name: 'events_dlq_messages_total',
      help: 'test fixture',
      labelNames: ['topic'],
      registers: [register],
    });

    // METRICS_PORT=0 → OS 가 빈 포트를 준다. 테스트가 고정 포트를 잡지 않게 한다.
    server = startMetricsServer({ METRICS_PORT: '0' } as NodeJS.ProcessEnv);
    if (!server) throw new Error('server did not start');
    await new Promise<void>((resolve) => server!.once('listening', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    register.clear();
  });

  it('GET /metrics 는 200 과 Prometheus 텍스트를 준다', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/metrics`);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(await res.text()).toContain('events_dlq_messages_total');
  });

  it('그 밖의 경로는 404', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/nope`);
    expect(res.status).toBe(404);
  });

  it('unref 되어 있다 — 종료 시 이벤트 루프를 붙들지 않는다', () => {
    // Node 내부 핸들. 이 서버가 태스크 종료를 지연시키지 않는다는 것을 고정한다.
    const handle = (server as unknown as { _handle?: { hasRef?: () => boolean } })._handle;
    expect(handle?.hasRef?.()).toBe(false);
  });

  it('PORT 도 METRICS_PORT 도 없으면 서버를 만들지 않는다', () => {
    expect(startMetricsServer({} as NodeJS.ProcessEnv)).toBeUndefined();
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
npx jest libs/shared/src/observability/metrics-server.spec.ts --maxWorkers=2
```

기대: `Cannot find module './metrics-server'` 로 실패.

- [ ] **Step 3: 최소 구현을 쓴다**

`libs/shared/src/observability/metrics-server.ts`:

```ts
import { createServer, Server } from 'node:http';
import { register } from 'prom-client';

/**
 * 메트릭 포트를 앱 포트에서 파생한다.
 *
 * 앱 포트는 한 ECS 태스크 안에서 이미 유일하다 (ALB 룰이 강제하고, 번들 태스크는
 * `supervisor.mjs` 의 APPS 테이블이 강제한다). 그래서 `+10000` 파생 포트도 자동으로
 * 유일하고, 앱마다 별도 env 를 심을 필요가 없다.
 */
export function resolveMetricsPort(env: NodeJS.ProcessEnv = process.env): number | undefined {
  const explicit = Number(env.METRICS_PORT);
  if (Number.isInteger(explicit) && explicit >= 0) return explicit;

  const appPort = Number(env.PORT);
  if (!Number.isInteger(appPort) || appPort <= 0) return undefined;
  return appPort + 10000;
}

/**
 * Prometheus 스크레이프용 최소 HTTP 서버. **Nest 밖**이다 — 로거·예외필터·가드가
 * 붙지 않으므로 이 파일은 짧게 유지한다. 라우팅은 `/metrics` 하나뿐이다.
 *
 * 방향에 주의: 이 서버는 Alloy 로 아무것도 보내지 않는다. Alloy 가 주기적으로
 * 긁어간다(pull). 트레이스·로그가 OTLP push 인 것과 반대다.
 *
 * ALB 리스너 룰은 앱 포트만 포워딩하고 태스크는 private subnet + assignPublicIp:false
 * 이므로, 이 포트에는 인터넷 경로가 존재하지 않는다. 그래서 인증 가드를 두지 않는다.
 */
export function startMetricsServer(env: NodeJS.ProcessEnv = process.env): Server | undefined {
  const port = resolveMetricsPort(env);
  if (port === undefined) return undefined;

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
      .catch(() => {
        res.writeHead(500).end();
      });
  });

  server.listen(port, '0.0.0.0');
  // 이벤트 루프를 붙들지 않게 한다. 이게 없으면 SIGTERM 후에도 이 핸들이 살아 있어
  // 태스크 종료가 supervisor 의 GRACEFUL_TIMEOUT_MS(28s)까지 늘어질 수 있다.
  server.unref();
  return server;
}
```

- [ ] **Step 4: 통과를 확인한다**

```bash
npx jest libs/shared/src/observability/metrics-server.spec.ts --maxWorkers=2
```

기대: 8개 테스트 전부 PASS (`resolveMetricsPort` 4건 + `startMetricsServer` 4건).

- [ ] **Step 5: 커밋**

```bash
git checkout -b feat/observability-metrics-endpoints
git add libs/shared/src/observability/metrics-server.ts libs/shared/src/observability/metrics-server.spec.ts
git commit -m "feat(shared): 앱 프로세스마다 Prometheus /metrics 를 별도 포트로 노출한다"
```

---

### Task 2: 앱 9개 배선 (`tracing.ts`)

9개 앱 전부 `src/tracing.ts` 라는 동일한 진입 훅을 갖고 있고 `main.ts` 첫 줄이 `import './tracing'` 이다. **`main.ts` 는 건드리지 않는다.**

**Files:**
- Modify: `apps/core/src/tracing.ts`, `apps/wallet/src/tracing.ts`, `apps/membership/src/tracing.ts`, `apps/notification/src/tracing.ts`, `apps/analytics/src/tracing.ts`, `apps/search/src/tracing.ts`, `apps/channel-adapter/src/tracing.ts`, `apps/ugc-service/src/tracing.ts`, `apps/user-service/src/tracing.ts`
- Test: `libs/shared/src/observability/metrics-wiring.spec.ts` (신규)

**Interfaces:**
- Consumes: Task 1 의 `startMetricsServer()`
- Produces: 없음 (배선만)

- [ ] **Step 1: 실패하는 배선 테스트를 쓴다**

배선은 부팅해야만 실행되는 코드라 런타임 테스트가 어렵다. 대신 **소스를 읽어 고정**한다.
저장소 전체를 grep 하는 `libs/events` 의 계약 검사와 같은 계열의 테스트다.

`libs/shared/src/observability/metrics-wiring.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// @app/events 를 쓰는 앱 전부. file-service 는 events 미사용이라 제외한다.
const APPS = [
  'core',
  'wallet',
  'membership',
  'notification',
  'analytics',
  'search',
  'channel-adapter',
  'ugc-service',
  'user-service',
];

describe('metrics 서버 배선', () => {
  it.each(APPS)('%s 의 tracing.ts 가 startMetricsServer 를 부른다', (app) => {
    const source = readFileSync(
      join(__dirname, '..', '..', '..', '..', 'apps', app, 'src', 'tracing.ts'),
      'utf8',
    );

    expect(source).toContain('startMetricsServer');
    // 배럴(@app/shared)을 당기면 OTEL SDK 시작 전에 다른 모듈이 로드된다.
    expect(source).toContain("from '@app/shared/observability/metrics-server'");
    expect(source).not.toContain("from '@app/shared'");
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
npx jest libs/shared/src/observability/metrics-wiring.spec.ts --maxWorkers=2
```

기대: 9건 전부 `toContain('startMetricsServer')` 에서 FAIL.

- [ ] **Step 3: 9개 `tracing.ts` 를 고친다**

각 파일을 아래 형태로 만든다. `<serviceName>` 은 **그 파일에 이미 있는 값을 그대로 둔다** (core → `'core'`, ugc-service → `'ugc-service'`, 등). 새로 정하지 않는다.

```ts
// 공용 OpenTelemetry 부트스트랩. 반드시 main.ts 의 첫 import 로 유지할 것 —
// 계측 대상 모듈보다 먼저 SDK 가 시작돼야 trace_id 주입/자동계측이 성립한다.
// deep 경로로 import (배럴 @app/shared 우회) — 이유는 telemetry.ts 주석 참고.
import { startTelemetry } from '@app/shared/observability/telemetry';
import { startMetricsServer } from '@app/shared/observability/metrics-server';

startTelemetry({ serviceName: 'core' });
// 트레이스·로그는 위에서 Alloy 로 push 하고, 메트릭은 아래 포트를 Alloy 가 pull 해 간다.
startMetricsServer();
```

- [ ] **Step 4: 통과와 게이트를 확인한다**

```bash
npx jest libs/shared/src/observability --maxWorkers=2
npm run type-check
```

기대: 배선 9건 PASS, `type-check` 에러 0.

- [ ] **Step 5: 실제로 뜨는지 로컬에서 한 번 본다**

소스 grep 테스트는 배선이 *적혀 있음*만 보장한다. 뜨는 것까지 확인한다.

```bash
npm run start:main:dev &
sleep 20
curl -s http://localhost:13000/metrics | grep -c 'events_dlq_messages_total'
kill %1
```

기대: `1` 이상 (HELP/TYPE 줄). 카운터 **샘플**은 실제 DLQ 유입 전엔 안 나오는 게 정상이다.
`curl: (7) Failed to connect` 이면 core 의 `PORT` 가 3000 으로 설정됐는지 확인한다
(`apps/core/.env`) — `PORT` 가 없으면 `startMetricsServer` 는 조용히 건너뛴다.

- [ ] **Step 6: 커밋**

```bash
git add apps/*/src/tracing.ts libs/shared/src/observability/metrics-wiring.spec.ts
git commit -m "feat(observability): 앱 9개가 각자 metrics 서버를 띄우도록 배선한다"
```

---

### Task 3: Core 의 기존 `/metrics` 컨트롤러 제거

Core 의 `/metrics` 는 `@Public()` + 퍼블릭 ALB 라 인증 없이 인터넷에서 열려 있다 (실측: 200, 13KB). Task 1·2 로 대체됐으므로 제거한다. `MetricsService` 자체는 남긴다 — 대사 서비스들이 쓴다.

**Files:**
- Delete: `apps/core/src/modules/inventory/shared/controllers/metrics.controller.ts`
- Delete: `apps/core/src/modules/inventory/shared/controllers/metrics.controller.spec.ts`
- Create: `apps/core/src/modules/inventory/shared/services/metrics.service.spec.ts`
- Modify: `apps/core/src/modules/inventory/shared/shared.module.ts` (`controllers` 배열과 `MetricsController` import)

**Interfaces:**
- Consumes: 없음
- Produces: 없음 (제거)

- [ ] **Step 1: 지워질 테스트의 가치 있는 절반을 먼저 옮긴다**

`metrics.controller.spec.ts` 의 두 번째 테스트는 컨트롤러가 아니라 `MetricsService` 의 회귀
(게이지를 호출마다 재등록해 2번째 컴포넌트에서 throw 하던 버그)를 고정한다. 컨트롤러를 지워도
이 보호는 남겨야 한다.

`apps/core/src/modules/inventory/shared/services/metrics.service.spec.ts`:

```ts
import { register } from 'prom-client';
import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  beforeEach(() => {
    // 전역 register 는 프로세스 단위다. 같은 프로세스의 다른 spec 이 등록해 뒀으면
    // 필드 이니셜라이저에서 중복 등록 throw 가 난다.
    register.clear();
  });

  afterAll(() => {
    register.clear();
  });

  it('한 번의 상세 헬스체크에서 컴포넌트 3개를 기록해도 throw 하지 않는다', () => {
    const service = new MetricsService();

    // health.service.ts 는 상세 체크 한 번에 세 컴포넌트를 기록한다.
    // 게이지를 recordHealthCheck 안에서 만들던 시절엔 2번째에서 중복 등록으로 throw 했다.
    expect(() => {
      service.recordHealthCheck('database', 'healthy', 5);
      service.recordHealthCheck('memory', 'healthy', 3);
      service.recordHealthCheck('business', 'unhealthy', 10);
    }).not.toThrow();
  });

  it('기록한 헬스 게이지가 전역 register 에 나타난다', async () => {
    const service = new MetricsService();
    service.recordHealthCheck('database', 'healthy', 5);

    await expect(register.metrics()).resolves.toContain('wms_health_status');
  });
});
```

- [ ] **Step 2: 새 테스트가 통과하는지 확인한다 (제거 전)**

```bash
npx jest apps/core/src/modules/inventory/shared/services/metrics.service.spec.ts --maxWorkers=2
```

기대: 2건 PASS. (여기서 실패하면 제거를 진행하지 말 것 — 옮긴 보호가 성립하지 않는다는 뜻이다.)

- [ ] **Step 3: 컨트롤러와 그 spec 을 지우고 모듈에서 뗀다**

```bash
git rm apps/core/src/modules/inventory/shared/controllers/metrics.controller.ts \
       apps/core/src/modules/inventory/shared/controllers/metrics.controller.spec.ts
```

`apps/core/src/modules/inventory/shared/shared.module.ts` 에서 두 곳을 고친다:

```ts
// 지운다:
import { MetricsController } from './controllers/metrics.controller';

// 바꾼다:
controllers: [MetricsController, HealthController, BarcodeGenerationController],
// →
controllers: [HealthController, BarcodeGenerationController],
```

`MetricsService` 는 `providers` 와 `exports` 에 **그대로 둔다** — `ledger-reconciliation.service.ts`,
`fulfillment-reservation-reconciliation.service.ts`, `fulfillment-reconciliation.service.ts`,
`sales-orders.service.ts`, `health.service.ts` 가 주입받아 쓴다.

- [ ] **Step 4: 게이트를 돌린다**

```bash
npm run type-check
npx jest --maxWorkers=2
```

기대: `type-check` 에러 0, jest 실패 0. `MetricsController` 를 참조하는 곳이 남아 있으면
`type-check` 가 잡는다.

- [ ] **Step 5: 커밋**

```bash
git add -A apps/core/src/modules/inventory/shared/
git commit -m "refactor(core): 인터넷에 열려 있던 /metrics 컨트롤러를 제거한다"
```

---

### Task 4: Alloy 스크레이프를 `discovery.dns` 로 바꾸고 9개 앱을 대상에 넣는다

현재 Alloy 는 Cloud Map DNS 이름을 static target **하나**로 쓴다. SST 는 서비스마다 A 레코드 /
TTL 60 / MULTIVALUE 로 등록하고 태스크마다 인스턴스를 하나씩 붙이므로, 인스턴스가 2개가 되면
스크레이프마다 아무 태스크에나 붙는다. 카운터가 오르내리면 Prometheus 는 그 감소를 **리셋으로
해석**해 그래프가 조용히 틀린다. `discovery.dns` 는 A 레코드를 IP 하나당 target 하나로 펼쳐
`instance` 라벨을 분리한다.

**Files:**
- Modify: `deployments/lcnine/services/observability/alloy/config.alloy:101-114` (`prometheus.scrape "core"` 블록 전체를 대체)
- Modify: `deployments/lcnine/services/infra/services.ts:170` (`CORE_METRICS_TARGET` 을 접미사 2개로 교체)

**Interfaces:**
- Consumes: Task 1·2 가 띄운 포트들
- Produces: Grafana 에 `job` 라벨 9종 (`core` `wallet` `analytics` `channel-adapter` `membership` `notification` `search` `ugc` `user-service`)

- [ ] **Step 1: `services.ts` 의 env 를 바꾼다**

`deployments/lcnine/services/infra/services.ts` 의 Alloy `environment` 에서 이 줄을 지운다:

```ts
CORE_METRICS_TARGET: $interpolate`${serviceDiscoveryName('Core')}:3000`,
```

대신 넣는다:

```ts
// Cloud Map DNS 접미사. 서비스 이름만 앞에 붙이면 완성된다 (config.alloy 가 조립).
// user-service 는 별도 SST 배포(lcnine-auth)지만 같은 네임스페이스에 등록돼 있어 닿는다.
METRICS_DNS_SUFFIX_SERVICES: $interpolate`${$app.stage}.${$app.name}.${vpc.nodes.cloudmapNamespace.name}`,
METRICS_DNS_SUFFIX_AUTH: $interpolate`${$app.stage}.lcnine-auth.${vpc.nodes.cloudmapNamespace.name}`,
```

`serviceDiscoveryName` import 가 이 파일에서 더 이상 안 쓰이면 import 에서도 지운다
(`services.ts:16`). `type-check` 로 확인할 수 없는 파일이므로 **눈으로 확인**한다.

- [ ] **Step 2: `config.alloy` 의 스크레이프 블록을 대체한다**

`prometheus.scrape "core" { ... }` 블록(101~114줄)을 통째로 지우고 아래로 바꾼다.
`scrape_interval = "30s"` 는 현행 값을 유지한다 (Core 메모리 스파이크 관측용 — 기존 주석 참조).

```alloy
// ─── 앱 메트릭 스크레이프 ───
// 앱은 아무것도 보내지 않는다. 여기서 긁어간다(pull). 트레이스·로그가 OTLP push 인 것과 반대다.
//
// static target 을 쓰지 않는 이유: SST 는 서비스마다 Cloud Map A 레코드(TTL 60, MULTIVALUE)를
// 만들고 태스크마다 인스턴스를 하나씩 붙인다. 이름 하나를 static target 으로 두면 인스턴스가
// 2개가 되는 순간 스크레이프마다 아무 태스크에나 붙어, 카운터의 오르내림을 Prometheus 가
// 리셋으로 해석한다. discovery.dns 는 IP 하나당 target 하나로 펼쳐 instance 라벨을 분리한다.
//
// 메트릭 포트 = 앱 포트 + 10000 (libs/shared/src/observability/metrics-server.ts).
// 번들 태스크(ServicesBundleA/B)는 한 이름에 앱이 여러 개라 포트만 다른 블록을 앱 수만큼 둔다.

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

discovery.dns "wallet" {
	names = ["Wallet." + sys.env("METRICS_DNS_SUFFIX_SERVICES")]
	type  = "A"
	port  = 13000
}

prometheus.scrape "wallet" {
	targets         = discovery.dns.wallet.targets
	job_name        = "wallet"
	metrics_path    = "/metrics"
	scrape_interval = "30s"
	forward_to      = [prometheus.remote_write.grafanacloud.receiver]
}

discovery.dns "analytics" {
	names = ["ServicesBundleA." + sys.env("METRICS_DNS_SUFFIX_SERVICES")]
	type  = "A"
	port  = 13040
}

prometheus.scrape "analytics" {
	targets         = discovery.dns.analytics.targets
	job_name        = "analytics"
	metrics_path    = "/metrics"
	scrape_interval = "30s"
	forward_to      = [prometheus.remote_write.grafanacloud.receiver]
}

discovery.dns "channel_adapter" {
	names = ["ServicesBundleA." + sys.env("METRICS_DNS_SUFFIX_SERVICES")]
	type  = "A"
	port  = 13001
}

prometheus.scrape "channel_adapter" {
	targets         = discovery.dns.channel_adapter.targets
	job_name        = "channel-adapter"
	metrics_path    = "/metrics"
	scrape_interval = "30s"
	forward_to      = [prometheus.remote_write.grafanacloud.receiver]
}

discovery.dns "membership" {
	names = ["ServicesBundleA." + sys.env("METRICS_DNS_SUFFIX_SERVICES")]
	type  = "A"
	port  = 13002
}

prometheus.scrape "membership" {
	targets         = discovery.dns.membership.targets
	job_name        = "membership"
	metrics_path    = "/metrics"
	scrape_interval = "30s"
	forward_to      = [prometheus.remote_write.grafanacloud.receiver]
}

discovery.dns "notification" {
	names = ["ServicesBundleB." + sys.env("METRICS_DNS_SUFFIX_SERVICES")]
	type  = "A"
	port  = 13003
}

prometheus.scrape "notification" {
	targets         = discovery.dns.notification.targets
	job_name        = "notification"
	metrics_path    = "/metrics"
	scrape_interval = "30s"
	forward_to      = [prometheus.remote_write.grafanacloud.receiver]
}

discovery.dns "search" {
	names = ["ServicesBundleB." + sys.env("METRICS_DNS_SUFFIX_SERVICES")]
	type  = "A"
	port  = 13004
}

prometheus.scrape "search" {
	targets         = discovery.dns.search.targets
	job_name        = "search"
	metrics_path    = "/metrics"
	scrape_interval = "30s"
	forward_to      = [prometheus.remote_write.grafanacloud.receiver]
}

discovery.dns "ugc" {
	names = ["ServicesBundleB." + sys.env("METRICS_DNS_SUFFIX_SERVICES")]
	type  = "A"
	port  = 13030
}

prometheus.scrape "ugc" {
	targets         = discovery.dns.ugc.targets
	job_name        = "ugc"
	metrics_path    = "/metrics"
	scrape_interval = "30s"
	forward_to      = [prometheus.remote_write.grafanacloud.receiver]
}

discovery.dns "user_service" {
	names = ["UserService." + sys.env("METRICS_DNS_SUFFIX_AUTH")]
	type  = "A"
	port  = 13000
}

prometheus.scrape "user_service" {
	targets         = discovery.dns.user_service.targets
	job_name        = "user-service"
	metrics_path    = "/metrics"
	scrape_interval = "30s"
	forward_to      = [prometheus.remote_write.grafanacloud.receiver]
}
```

- [ ] **Step 3: Alloy 설정 문법을 실제로 검증한다**

이 파일은 `type-check` 도 `jest` 도 안 잡는다. Alloy 바이너리로 직접 검사한다:

```bash
docker run --rm -v "$(pwd)/deployments/lcnine/services/observability/alloy:/cfg" \
  grafana/alloy:latest fmt /cfg/config.alloy > /dev/null && echo "SYNTAX OK"
```

기대: `SYNTAX OK`.

**여기서 문자열 `+` 연결이 거부되면** (스펙 §3.6 의 미확정 항목) 폴백한다 — `METRICS_DNS_SUFFIX_*`
2개 대신 앱별 전체 이름 env 9개(`METRICS_TARGET_CORE` 등)를 `services.ts` 에서 `$interpolate` 로
조립해 넘기고, `names = [sys.env("METRICS_TARGET_CORE")]` 로 쓴다. 동작은 동일하고 장황해질 뿐이다.

- [ ] **Step 4: 대상 목록이 스펙과 일치하는지 눈으로 대조한다**

```bash
grep -c 'discovery.dns "' deployments/lcnine/services/observability/alloy/config.alloy
grep 'job_name' deployments/lcnine/services/observability/alloy/config.alloy
```

기대: `discovery.dns` 블록 9개, `job_name` 9개가 Global Constraints 의 목록과 **문자 그대로** 일치.
특히 `ugc` 이지 `ugc-service` 가 아니어야 한다.

- [ ] **Step 5: 커밋**

```bash
git add deployments/lcnine/services/observability/alloy/config.alloy \
        deployments/lcnine/services/infra/services.ts
git commit -m "feat(observability): Alloy 가 앱 9개를 discovery.dns 로 스크레이프한다"
```

---

### Task 5: 스펙·계획 문서를 브랜치에 올리고 PR 을 연다

**Files:**
- Add: `docs/superpowers/specs/2026-08-22-observability-metrics-endpoints-design.md`
- Add: `docs/superpowers/plans/2026-08-23-observability-metrics-endpoints.md`

- [ ] **Step 1: 전체 게이트를 마지막으로 한 번 더 돌린다**

```bash
npm run type-check
npx jest --maxWorkers=2
```

기대: 둘 다 0. 실패가 있으면 `git stash` 후 `develop` 에서 같은 명령을 돌려 **이 브랜치가 만든
실패인지** 먼저 가른다.

- [ ] **Step 2: 문서를 커밋한다**

```bash
git add docs/superpowers/specs/2026-08-22-observability-metrics-endpoints-design.md \
        docs/superpowers/plans/2026-08-23-observability-metrics-endpoints.md
git commit -m "docs(observability): 메트릭 엔드포인트 설계와 구현 계획을 남긴다"
```

- [ ] **Step 3: 푸시하고 PR 을 연다**

```bash
git push -u origin feat/observability-metrics-endpoints
gh pr create --base develop --title "feat(observability): 앱 9개 메트릭 노출 + Alloy 다중 인스턴스 대응 (#613)" --body "$(cat <<'BODY'
#613 을 닫는다.

## 무엇이 바뀌나
- `@app/events` 를 쓰는 앱 9개가 각자 `앱포트 + 10000` 에 Prometheus `/metrics` 를 노출한다.
- Alloy 가 static target 대신 `discovery.dns` 로 Cloud Map A 레코드를 태스크마다 펼쳐 스크레이프한다.
- 인터넷에 열려 있던 Core 의 `/metrics` 컨트롤러를 제거한다.

## 왜 별도 포트인가
ALB 리스너 룰이 앱 포트만 포워딩하고 태스크는 private subnet + `assignPublicIp:false` 라,
이 포트에는 인터넷 경로가 존재하지 않는다. 차단 룰이나 가드가 필요 없고, 룰이 지워져 조용히
다시 열리는 사고도 구조적으로 안 난다.

## 왜 discovery.dns 인가
SST 는 서비스마다 Cloud Map A 레코드(TTL 60, MULTIVALUE)를 만들고 태스크마다 인스턴스를 붙인다.
이름 하나를 static target 으로 두면 인스턴스가 2개가 되는 순간 스크레이프가 아무 태스크에나
붙고, 카운터의 오르내림을 Prometheus 가 리셋으로 해석해 그래프가 조용히 틀린다.

## 인프라 변경
마이그레이션 0 · 시크릿 0 · 신규 AWS 리소스 0. 태스크 정의와 보안그룹도 변경 없다
(SST 가 컨테이너 포트를 1-65535 전체 매핑하고, 태스크 SG 가 10.0.0.0/16 전 포트를 허용한다).

## 배포 순서
1. `sst deploy` (lcnine-services)
2. `sst deploy` (lcnine-auth) — user-service
3. Alloy 설정 반영 배포

2 와 3 사이에 core 메트릭이 스크레이프되지 않는 창이 한 배포만큼 생긴다. DLQ 카운터는 현재
샘플이 0건이라 잃을 데이터가 없어 수용한다.

## 완료 판정
`count(up == 1) by (job)` 가 9개 job 을 반환한다.
`sum by (job) (events_dlq_messages_total)` 은 판정에 쓸 수 없다 — 라벨 카운터는 한 번도
증가하지 않으면 시리즈 자체가 생기지 않는다.

설계: `docs/superpowers/specs/2026-08-22-observability-metrics-endpoints-design.md`
BODY
)"
```

---

### Task 6 (사람 작업): 배포와 확인

에이전트가 실행하지 않는다. PR 머지 후 사용자가 수행한다.

- [ ] **Step 1: 앱 배포**

```bash
sst deploy --stage live   # deployments/lcnine/services
sst deploy --stage live   # deployments/lcnine/auth  (user-service)
```

- [ ] **Step 2: Alloy 배포**

앱 배포가 끝난 뒤에 한다. 반대로 하면 Alloy 가 잠시 `up=0` 을 낸다.

- [ ] **Step 3: Grafana 에서 완료 판정**

```promql
count(up == 1) by (job)
```

기대: `core` `wallet` `analytics` `channel-adapter` `membership` `notification` `search` `ugc`
`user-service` 9개.

- [ ] **Step 4: 옛 공개 표면이 닫혔는지 확인**

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://core.almondyoung.com/metrics
```

기대: `404`. (이 값이 `200` 이면 Core 배포가 안 반영된 것이다.)

- [ ] **Step 5: 후속 이슈 5건을 연다**

1. admin-web status page — 데이터 정본은 AWS 컨트롤 플레인(ECS `DescribeServices` + ELBv2 `DescribeTargetHealth`). `/health` fan-out 으로 짓지 말 것: 인스턴스가 N개면 ALB 가 그중 하나에만 물어보므로 동전던지기다.
2. `/events/trace/*` 공개 노출 잠그기 — `EventTraceController` 가 `@SetMetadata('isPublic', true)` 라 5개 앱에서 이벤트 체인이 인증 없이 열려 있다.
3. `MetricsService` 죽은 API 제거 — `setAvailableStock`(`sku_id`×`warehouse_id` 라벨, 카디널리티 폭탄) 과 `createCustom*` 3종은 호출처 0곳.
4. `@Cron` 리더 선출 — 40개(core 15·membership 8·wallet 7·user-service 6·channel-adapter 4)가 스케줄러 락 없이 돈다. **`scaling.max > 1` 의 선행 조건이다.**
5. Alloy 이미지 버전 핀 — 현재 `grafana/alloy:latest`.

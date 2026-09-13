# Medusa store/admin 인스턴스 분리 + 공유 Redis 복원 — 구현 계획 (#855)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Medusa 를 `store`(손님 API, 백그라운드 없음)와 `admin`(`/admin/*` + subscriber·cron·워크플로 엔진) 두 ECS 서비스로 나누고, 둘이 공유하는 ElastiCache Valkey 노드를 복원한다.

**Architecture:** `medusa-config.js` 가 `MEDUSA_WORKER_MODE` 로 `workerMode` 를 받는다. SST `createService` 두 번 — 기존 이름 `Medusa` 는 store 로 남겨 ALB 타깃그룹·Cloud Map 이름을 유지하고, 새 `MedusaAdmin` 은 같은 호스트에 `/admin/*` 경로 룰(priority 205)로 붙는다. 사이드카 valkey 는 제거하고 `sst.aws.Redis`(valkey, 클러스터 모드 끔, `t4g.micro`)를 둘 다 본다. `db:migrate` 는 admin 컨테이너만 돈다.

**Tech Stack:** Medusa 2.13.4 (`projectConfig.workerMode`), SST 4.6.10 (`sst.aws.Service`, `sst.aws.Redis`), Pulumi `aws.lb.ListenerRule` conditions, Grafana Alloy `discovery.dns`.

**Spec:** `docs/adr/0037-medusa-store-admin-split-with-shared-redis.md` (+ 2026-09-13 추기) 와 `docs/superpowers/specs/2026-08-13-bulk-import-medusa-load-design.md` §5D. 이슈 #855.

## Global Constraints

- 호스트는 `medusa.` 하나. 룰은 `/admin/*` → admin **하나뿐**. 호출자 URL 변경 없음.
- store 는 `workerMode: server`, admin 은 `shared`. `/hooks/*` 는 store.
- Redis 는 **노드형** Valkey `cache.t4g.micro`, 클러스터 모드 끔 (ADR 추기). Serverless 금지.
- 두 태스크 모두 `arm64`, `1 vCPU / 1 GB`, `scaling { min: 1, max: 1 }` (2026-09-13 사람 결정).
- `db:migrate` 는 admin 만 (2026-09-13 사람 결정). Medusa 는 schema migration 에 잠금이 없다 — `run-migration-scripts.js` 의 락은 data-script 전용.
- dev 스테이지도 같은 구성 (2026-09-13 사람 결정, dev 는 현재 미사용).
- 관측 정본은 `libs/shared/src/observability/scrape-targets.ts` — 표와 `config.alloy` 를 같이 고친다.
- 로컬·테스트 경로는 `workerMode` 미지정 = `shared` 그대로.

---

### Task 1: `workerMode` 배선 + Dockerfile migrate 게이트 + 가드 스펙

**Files:**
- Modify: `apps/medusa/medusa-config.js:28` (`redisUrl` 아래)
- Modify: `apps/medusa/Dockerfile:84` (CMD)
- Modify: `apps/medusa/src/jobs/sync-product-sort-index.ts:8-9` (cron 중복 주석)
- Test: `apps/medusa/src/__tests__/worker-mode-wiring.unit.spec.ts`

**Interfaces:**
- Produces: env `MEDUSA_WORKER_MODE` (`shared` | `server` | `worker`, 미지정 = `shared`), env `MEDUSA_RUN_DB_MIGRATE` (`false` 면 부팅 시 migrate 생략, 미지정 = 실행). Task 3 이 이 두 env 를 넣는다.

- [ ] **Step 1: 실패하는 가드 스펙 작성**

```ts
// apps/medusa/src/__tests__/worker-mode-wiring.unit.spec.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ADR-0037 (#855) — store/admin 분리의 «앱 쪽» 배선 가드.
 *
 * 인프라(services.ts)는 `MEDUSA_WORKER_MODE` 와 `MEDUSA_RUN_DB_MIGRATE` 를 넣는데,
 * 앱이 그 env 를 안 읽으면 두 서비스가 조용히 둘 다 `shared` 로 떠서 cron 이 두 번 돌고
 * migrate 가 두 컨테이너에서 경쟁한다. 텍스트 가드로 배선이 남아 있는지 본다.
 */
const MEDUSA_DIR = join(__dirname, '..', '..');

describe('store/admin 분리 배선 (ADR-0037)', () => {
  it('medusa-config.js 가 MEDUSA_WORKER_MODE 로 workerMode 를 받는다', () => {
    const config = readFileSync(join(MEDUSA_DIR, 'medusa-config.js'), 'utf8');
    expect(config).toMatch(/workerMode:\s*process\.env\.MEDUSA_WORKER_MODE\s*\|\|\s*'shared'/);
  });

  it('Dockerfile CMD 가 MEDUSA_RUN_DB_MIGRATE=false 일 때 migrate 를 건너뛴다', () => {
    const dockerfile = readFileSync(join(MEDUSA_DIR, 'Dockerfile'), 'utf8');
    const cmd = dockerfile.split('\n').find((l) => l.startsWith('CMD '));
    expect(cmd).toBeDefined();
    expect(cmd).toContain('"$MEDUSA_RUN_DB_MIGRATE" != "false"');
    expect(cmd).toContain('medusa db:migrate --execute-safe-links');
    expect(cmd).toContain('yarn start');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd apps/medusa && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest src/__tests__/worker-mode-wiring --silent=false`
Expected: FAIL 2건 (workerMode 없음, CMD 에 게이트 없음)

- [ ] **Step 3: medusa-config.js 에 workerMode 추가**

`redisUrl: process.env.REDIS_URL,` 바로 아래:

```js
    // ADR-0037 (#855): store 인스턴스는 `server`(API 만, subscriber·job·BullMQ 워커 없음),
    // admin 인스턴스는 `shared`. 미지정(로컬·테스트) 은 shared.
    workerMode: process.env.MEDUSA_WORKER_MODE || 'shared',
```

- [ ] **Step 4: Dockerfile CMD 게이트**

```dockerfile
# --execute-safe-links: link sync 가 interactive prompt 에서 멈추지 않도록 안전한 액션만 자동 실행
# MEDUSA_RUN_DB_MIGRATE=false: store 인스턴스는 migrate 를 건너뛴다 (ADR-0037 — Medusa schema
# migration 은 잠금이 없어 두 컨테이너가 동시에 돌면 경쟁한다. admin 하나만 돈다).
CMD ["sh", "-c", "if [ \"$MEDUSA_RUN_DB_MIGRATE\" != \"false\" ]; then yarn medusa db:migrate --execute-safe-links; fi && yarn start"]
```

- [ ] **Step 5: cron 중복 주석 교체** (`sync-product-sort-index.ts`)

기존 `// ponytail: 현재 Medusa 가 worker_mode 미분리(shared) + 2인스턴스라 …` 두 줄을 다음으로:

```ts
// ADR-0037 (#855): 백그라운드(job·subscriber)는 admin 인스턴스(`workerMode: shared`) 하나만 돌린다.
//           store 는 `server` 라 이 job 을 로드하지 않는다 — 인스턴스 중복 실행 문제는 구조로 사라졌다.
```

- [ ] **Step 6: 통과 확인**

Run: 위 Step 2 명령. Expected: PASS 2건.

- [ ] **Step 7: 커밋**

```bash
git add apps/medusa/medusa-config.js apps/medusa/Dockerfile apps/medusa/src/jobs/sync-product-sort-index.ts apps/medusa/src/__tests__/worker-mode-wiring.unit.spec.ts
git commit -m "feat(medusa): workerMode 를 env 로 받고 migrate 를 컨테이너별로 켠다 (#855)"
```

---

### Task 2: 인프라 헬퍼 — 공유 Redis 복원 + `pathPattern` 룰 조건

**Files:**
- Modify: `deployments/lcnine/services/infra/shared.ts:69-74` (Redis 주석 블록), `:108-127` (createService opts), `:198-200` (listenerRule)

**Interfaces:**
- Produces: `redis` (sst.aws.Redis), `redisUrl(dbIndex: number)` → `rediss://user:pass@host:port/<n>` Output. `createService` 옵션 `pathPattern?: string`. `setup()` 반환에 `redis`, `redisUrl` 추가.

- [ ] **Step 1: Redis 블록 복원** — `// ─── Redis: ElastiCache 제거됨 ───` 블록(4줄 주석)을 다음으로 교체:

```ts
  // ─── Redis (ElastiCache Valkey, 노드형) ───
  // ADR-0037 (#855): Medusa 를 store/admin 두 서비스로 나누면서 사이드카 valkey 를 버리고
  // 공유 Redis 를 복원한다 (2026-07 의 「ElastiCache 제거」 결정을 번복). 클러스터 모드는 끈다 —
  // Medusa 의 Redis 모듈 다섯이 전부 단일 노드 ioredis 클라이언트이고 BullMQ 키에 해시태그가 없어
  // 클러스터 프로토콜(Serverless 포함)에서는 CROSSSLOT 위험 (ADR-0037 추기).
  // 영속 정책은 노드형 기본값(스냅샷 없음). 인스턴스는 SST 기본 t4g.micro.
  const redis = new sst.aws.Redis('Redis', { vpc, engine: 'valkey', cluster: false });
  const encodedRedisPassword = redis.password?.apply((p) => encodeURIComponent(p));
  const redisUrl = (dbIndex: number) =>
    $interpolate`rediss://${redis.username}:${encodedRedisPassword}@${redis.host}:${redis.port}/${dbIndex}`;
```

- [ ] **Step 2: `createService` 에 `pathPattern` 옵션** — opts 타입에 추가:

```ts
      // 같은 호스트 안에서 경로로 갈라 붙는 서비스 (예: Medusa admin 의 `/admin/*`).
      // hostHeader 조건에 pathPattern 조건을 AND 로 더한다. priority 를 기본 서비스보다 작게 줘야 먼저 매칭된다.
      pathPattern?: string;
```

`listenerRule` transform 을:

```ts
        listenerRule: (args: Record<string, any>) => {
          args.conditions = [
            { hostHeader: { values: [domain(opts.domainSlug)] } },
            ...(opts.pathPattern ? [{ pathPattern: { values: [opts.pathPattern] } }] : []),
          ];
        },
```

- [ ] **Step 3: 반환에 노출** — `return { … db, dbUrl, …}` 에 `redis, redisUrl,` 추가.

- [ ] **Step 4: 커밋**

```bash
git add deployments/lcnine/services/infra/shared.ts
git commit -m "infra(services): 공유 Redis(valkey 노드형) 복원, createService 에 pathPattern 룰 조건 (#855)"
```

---

### Task 3: `services.ts` — Medusa 를 store/admin 둘로

**Files:**
- Modify: `deployments/lcnine/services/infra/services.ts:17` (setup 구조분해에 `redis, redisUrl`), `:523-650` (Medusa 블록)

**Interfaces:**
- Consumes: Task 1 의 env 두 개, Task 2 의 `redis`·`redisUrl`·`pathPattern`.
- Produces: ECS 서비스 `Medusa`(store)와 `MedusaAdmin`. Cloud Map 이름 `Medusa.<suffix>`·`MedusaAdmin.<suffix>` — Task 4 가 쓴다. `OTEL_SERVICE_NAME` 은 `medusa` / `medusa-admin`.

- [ ] **Step 1: 구조분해에 추가** — `const { …, createService, … } = setup(…)` 에 `redis, redisUrl` 을 넣는다.

- [ ] **Step 2: 공통 env 를 `medusaEnv` 로 추출** — 기존 `environment: { … }` 본문을 `const medusaEnv = { … }` 로 빼되, `REDIS_URL`·`CACHE_REDIS_URL` 두 줄과 주석을 다음으로 바꾼다:

```ts
    // 공유 ElastiCache Valkey (ADR-0037). DB 인덱스 분리는 사이드카 시절과 동일 (0: 이벤트버스·워크플로·락, 1: 캐시).
    REDIS_URL: redisUrl(0),
    CACHE_REDIS_URL: redisUrl(1),
```

`medusaEnv` 는 `Medusa` 블록 **앞**에 두고, 아래 두 서비스가 spread 한다.

- [ ] **Step 3: store 서비스 (기존 `Medusa` 이름 유지)** — 기존 블록을 다음으로 교체:

```ts
  // ─── Medusa — store / admin 두 서비스 (ADR-0037, #855) ───
  // 호스트는 medusa. 하나. ALB 룰은 `/admin/*` → MedusaAdmin(priority 205) 하나뿐이고 나머지
  // (/store, /auth, /hooks, /health, /app)는 아래 store 기본 타깃(priority 210)이 받는다.
  // 리소스 이름 'Medusa' 를 store 에 남긴 이유: ALB 타깃그룹·Cloud Map 이름(관측 discovery.dns)이
  // 교체 없이 유지된다. 롤백은 이 두 블록과 shared.ts 의 Redis 블록을 되돌리는 것.
  const medusaCommon = {
    architecture: 'arm64' as const,
    dockerfile: 'apps/medusa/Dockerfile',
    domainSlug: 'medusa',
    port: 9000,
    link: [db, redis],
    // 사이드카가 빠져 2GB 근거가 사라졌다. Medusa 단독 시절 1GB 로 돌았다 (2026-09-13 결정).
    cpu: '1 vCPU',
    memory: '1 GB',
    scaling: { min: 1, max: 1 },
    buildArgs: {
      VITE_USER_SERVICE_URL: idpUserServiceUrl,
      MEDUSA_BACKEND_URL: url('medusa'),
    },
    loadBalancerHealth: {
      '9000/http': {
        path: '/health',
        interval: '30 seconds',
        timeout: '5 seconds',
        healthyThreshold: 2,
        unhealthyThreshold: 5,
      },
    },
  };

  // store — 손님 읽기·체크아웃·결제 웹훅. subscriber·job·BullMQ 워커를 띄우지 않는다.
  // migrate 는 admin 이 돈다 (Medusa schema migration 은 잠금이 없어 동시 실행이 경쟁한다).
  createService('Medusa', {
    ...medusaCommon,
    priority: 210,
    transform: {
      service: { healthCheckGracePeriodSeconds: 600 },
    },
    environment: {
      ...medusaEnv,
      MEDUSA_WORKER_MODE: 'server',
      MEDUSA_RUN_DB_MIGRATE: 'false',
    },
  });

  // admin — /admin/* API + 백그라운드 전부(subscriber·cron·워크플로 엔진). ECS Exec·백필은 여기.
  createService('MedusaAdmin', {
    ...medusaCommon,
    priority: 205,
    pathPattern: '/admin/*',
    transform: {
      service: {
        healthCheckGracePeriodSeconds: 600,
        // ECS Exec — 백필(`yarn medusa exec`) 을 컨테이너 안에서 직접 실행하기 위해 활성화.
        // SST 가 자동으로 task role 에 ssmmessages:* 권한 부여.
        enableExecuteCommand: true,
      },
    },
    environment: {
      ...medusaEnv,
      // baseEnv 가 domainSlug 로 넣는 OTEL_SERVICE_NAME('medusa') 을 덮어써 Grafana 에서 store 와 갈라 본다.
      // 닫기 판정이 «store 의» CPU·p95 라 구분이 필수다.
      OTEL_SERVICE_NAME: 'medusa-admin',
      MEDUSA_WORKER_MODE: 'shared',
    },
  });
```

`sidecars` 는 없앤다. `createService` 의 `sidecars` 옵션 자체는 남긴다(다른 소비자 없음이지만 헬퍼 삭제는 이 이슈 범위 밖).

- [ ] **Step 4: 정적 확인** — `.sst/platform` 이 없어 tsc 는 못 돌린다. 최소한 `node -e "require('fs').readFileSync('deployments/lcnine/services/infra/services.ts','utf8')"` 수준이 아니라 **`npx sst diff --stage live`** 로 본다. AWS 세션이 없으면 이 단계는 사람 작업으로 넘긴다 (기대 diff: `Redis` 신설 + `MedusaAdmin` 서비스·타깃그룹·리스너룰 신설 + `Medusa` 태스크 정의 변경(사이드카 제거·env·cpu/mem)).

- [ ] **Step 5: 커밋**

```bash
git add deployments/lcnine/services/infra/services.ts
git commit -m "infra(services): Medusa 를 store(Medusa)/admin(MedusaAdmin) 두 서비스로, /admin/* 경로 룰 (#855)"
```

---

### Task 4: 관측 배선 — 스크레이프 대상 11번째 `medusa-admin`

**Files:**
- Modify: `libs/shared/src/observability/scrape-targets.ts` (`medusa` 행 뒤)
- Modify: `deployments/lcnine/services/observability/alloy/config.alloy:243-258`
- Modify: `libs/shared/src/observability/scrape-targets.spec.ts` (「apps/ 의 모든 앱」 테스트 — appDir 중복 허용)

**Interfaces:**
- Consumes: Task 3 의 Cloud Map 이름 `MedusaAdmin`.

- [ ] **Step 1: 표에 행 추가** (medusa 행 바로 뒤)

```ts
  {
    // ADR-0037 (#855): 같은 앱(apps/medusa)의 두 번째 ECS 서비스. job 으로 store/admin 을 가른다.
    job: 'medusa-admin',
    appDir: 'medusa',
    metricsServer: 'own',
    metricsPort: 19000,
    serviceName: 'MedusaAdmin',
    dnsSuffixEnv: 'METRICS_DNS_SUFFIX_SERVICES',
  },
```

- [ ] **Step 2: 가드 스펙 실행 → 실패 확인**

Run: `npx jest libs/shared/src/observability/scrape-targets`
Expected: FAIL — 「job 집합이 양방향으로 같다」(alloy 에 medusa-admin 없음), 「대상 수」, 「apps/ 의 모든 앱」(accounted 에 medusa 가 둘).

- [ ] **Step 3: config.alloy 에 블록 추가** (기존 medusa scrape 블록 뒤). 기존 medusa 주석의 `Medusa 는 scaling max 1 이라 target 은 항상 하나다.` 는 `store 는 scaling max 1 이라 target 은 하나다. admin 은 아래 별도 job.` 으로 고친다.

```alloy
// Medusa admin (ADR-0037, #855). 같은 이미지의 두 번째 ECS 서비스 — /admin/* 와 백그라운드(subscriber·cron).
// job 을 갈라야 «store 의» CPU·지연을 따로 본다 (닫기 판정이 store 다).
discovery.dns "medusa_admin" {
	names = ["MedusaAdmin." + sys.env("METRICS_DNS_SUFFIX_SERVICES")]
	type  = "A"
	port  = 19000
}

prometheus.scrape "medusa_admin" {
	targets         = discovery.dns.medusa_admin.targets
	job_name        = "medusa-admin"
	metrics_path    = "/metrics"
	scrape_interval = "60s"
	forward_to      = [prometheus.relabel.service_labels.receiver]
}
```

- [ ] **Step 4: 스펙의 앱 대조를 집합으로** — 「apps/ 의 모든 앱이 «대상» 이거나 «의도적 제외» 다」 테스트에서:

```ts
      // 한 앱이 ECS 서비스 여럿으로 뜨면(medusa → Medusa/MedusaAdmin, ADR-0037) appDir 이 겹친다. 집합으로 비교.
      const accounted = [
        ...new Set([...SCRAPE_TARGETS.map((t) => t.appDir), ...UNSCRAPED_APPS.map((a) => a.appDir)]),
      ].sort();
```

- [ ] **Step 5: 통과 확인**

Run: `npx jest libs/shared/src/observability`
Expected: PASS 전부 (대상 수 11).

- [ ] **Step 6: 커밋**

```bash
git add libs/shared/src/observability/scrape-targets.ts libs/shared/src/observability/scrape-targets.spec.ts deployments/lcnine/services/observability/alloy/config.alloy
git commit -m "observability: Medusa admin 서비스를 11번째 스크레이프 대상으로 (#855)"
```

---

### Task 5: 문서 — ADR 추기, 런북, 비용 기록

**Files:**
- Modify: `docs/adr/0037-medusa-store-admin-split-with-shared-redis.md` (Decision 끝에 추기)
- Modify: `docs/runbooks/medusa-cpu-saturation.md:1-25` (「태스크 1개」 전제)
- Modify: `docs/aws-cost-report-2026-07-07.md` (ElastiCache 항목에 번복 표시 한 줄)

- [ ] **Step 1: ADR 추기** — Decision 마지막 항목 뒤에:

```markdown
- *2026-09-13 구현 결정(#855)*:
  - 두 태스크 모두 `arm64` `1 vCPU / 1 GB`, `scaling { min: 1, max: 1 }`. 사이드카가 빠져 2GB 근거가 사라졌다.
  - `db:migrate` 는 **admin 컨테이너만** 돈다 (`MEDUSA_RUN_DB_MIGRATE=false` 를 store 에). Medusa 의
    schema migration 에는 잠금이 없다 — `@medusajs/framework/dist/migrations/run-migration-scripts.js` 의
    락은 data-script 전용. 롤링 배포 중 새 store 태스크가 admin 의 migrate 보다 먼저 뜰 수 있으나,
    Medusa 마이그레이션은 additive 라 읽기 경로에 무해하다.
  - dev 스테이지도 같은 구성이다 (dev 는 현재 미사용, 토폴로지를 갈라 둘 이유가 없다).
  - SST 리소스 이름은 store 가 기존 `Medusa` 를 물려받고 admin 이 `MedusaAdmin` 이다 — 타깃그룹·Cloud Map
    이름이 유지돼 관측 배선(`discovery.dns "medusa"`)이 안 끊긴다. 관측은 `medusa-admin` job 이 추가된다.
  - Serverless 를 쓰지 않는 두 번째 이유가 SST 에도 있다 — `sst.aws.Redis` 는 기본이 클러스터 모드 «켬»
    (`cluster: { nodes: 1 }`)이라 `cluster: false` 를 명시해야 한다.
```

- [ ] **Step 2: 런북** — `**즉효약: 재배포(= 재시작)한다.**` 아래 명령의 `--target Medusa` 는 store 다. 「## 왜 재시작으로 낫나」 첫 문장 `Medusa 는 **태스크 1개**로만 돈다 (valkey 사이드카 때문에 스케일아웃 불가).` 를 다음으로:

```markdown
Medusa 는 store(`Medusa`)·admin(`MedusaAdmin`) 두 서비스이고 각각 **태스크 1개**다 (ADR-0037). 사이트 전반이
느리면 store 를, 관리자 화면·대량등록만 느리면 admin 을 재배포한다 (`--target MedusaAdmin`). 옛 「valkey
사이드카 때문에 스케일아웃 불가」 전제는 2026-09-13 에 사라졌다.
```

- [ ] **Step 3: 비용 보고서** — `ElastiCache→valkey 사이드카` 가 있는 첫 문단 끝에 한 줄: `**2026-09-13 번복**: ADR-0037 (#855) 이 ElastiCache Valkey 노드형을 복원하고 Medusa 를 두 태스크로 나눴다. 실측치는 다음 비용 보고서에.`

- [ ] **Step 4: 커밋**

```bash
git add docs/adr/0037-medusa-store-admin-split-with-shared-redis.md docs/runbooks/medusa-cpu-saturation.md docs/aws-cost-report-2026-07-07.md docs/superpowers/plans/2026-09-13-medusa-store-admin-split.md
git commit -m "docs(855): ADR-0037 구현 결정 추기, 런북·비용보고서의 단일 태스크 전제 갱신"
```

---

### Task 6: 게이트 + PR

- [ ] **Step 1:** `npm run type-check` → 에러 0.
- [ ] **Step 2:** `npx jest libs/shared/src/observability scripts/jest --maxWorkers=2` → 실패 0. (전체 `npx jest` 는 OOM 이력 — `--maxWorkers=2`.)
- [ ] **Step 3:** `cd apps/medusa && npm run test:unit` → 실패 0.
- [ ] **Step 4:** PR 생성 (`gh pr create --base develop`). 본문에 **사람 배포 절차**를 적는다:
  1. `aws login --profile login` 후 `cd deployments/lcnine/services && npx sst diff --stage live` 로 기대 diff 확인.
  2. 대량등록이 돌지 않는 시각 (#852 구간 SQL) 에 `npx sst deploy --stage live`. ElastiCache 생성 ~10분.
  3. 배포 후: `aws elbv2 describe-rules` 로 `/admin/*` 룰이 MedusaAdmin 타깃그룹을 가리키는지, 두 서비스 `runningCount=1`, Grafana `up{job="medusa-admin"}==1`.
  4. 옛 사이드카 valkey 의 인플라이트 큐는 유실됐다 — `inbox_events`/outbox 적체가 없는지 확인.
  5. 닫기 판정은 다음 대량등록 세션에서 store CPU·ALB p95 (ADR Consequences).

# P1 IDOR 전수조사 실행 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 인가 표시가 없는 라우트 95건 각각에 IDOR 판정과 검증 가능한 근거를 붙이고, 새 구멍이 생기면 빨개지는 테스트로 못 박는다. 겸사겸사 소스에 하드코딩된 클라우드 DB 크레덴셜 5곳을 제거한다.

**Architecture:** 조사는 앱 단위 서브에이전트 6개가 읽기 전용으로 수행하고 결과를 scratchpad JSON 으로 낸다. 오케스트레이터가 인용된 술어 원문을 `grep -F` 로 기계 검증한다. 쓰기 라우트의 `SAFE` 판정만 반증 에이전트 3개가 다시 공격한다. 최종 판정표는 손으로 쓴 맵이 되어 스냅샷 테스트의 입력이 된다.

**Tech Stack:** Node.js, TypeScript, Jest(ts-jest), TypeScript Compiler API(기존 감사 스크립트), `git grep`

## Global Constraints

- 설계 근거는 `docs/superpowers/specs/2026-08-08-p1-idor-audit-design.md` 다. 계획과 스펙이 어긋나면 스펙이 옳다.
- 상위 상황판은 `docs/api-authz-audit-2026-08.md` 다. 착수/완료 시 그 문서의 상태를 갱신한다.
- 마이그레이션 **0건**. 이 계획의 어떤 태스크도 DB 스키마를 건드리지 않는다.
- **조사/반증 에이전트**(Task 3·4)는 **레포 안의 어떤 파일도 수정 금지**. 쓰기는 scratchpad 한정. (워크트리 오염이 5회 재발했고, 미커밋 편집 변종은 `origin/develop..develop` 탐지를 통과한다.) 이 제약은 조사 에이전트에만 걸린다 — Task 2·5·6·7 의 구현 에이전트는 당연히 레포를 고친다.
- **Task 3·4 는 오케스트레이터가 직접 수행한다.** 그 자체가 에이전트 fan-out 이라 구현 에이전트에게 위임하면 중첩이 된다.
- 브랜치는 `docs/p1-idor-audit-design` 위에서 이어간다. `develop` 에 직접 커밋하지 않는다.
- 검증 기준선:
  - `node scripts/security/route-authz-audit.js` → `[A] 무력화 0` (아니면 exit 1)
  - `npx jest scripts/security` → 전부 통과
  - `npx eslint <변경파일>` → 변경 파일의 **신규 error 0** (총량은 무의미 — 전역 lint 는 상시 debt)
- `apps/core` 타입 검사는 `npm run type-check:scoped` 로 하지 않는다. include 가 5개뿐이라 변경 파일이 안 들어가면 통과해도 의미가 없다. 임시 tsconfig 를 **repo 루트에** 만들어 변경 파일을 include 한다 (루트 밖에 두면 typeRoots 가 안 풀려 `Cannot find type definition file for 'jest'`).

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `scripts/security/no-cloud-credentials.spec.ts` | **신규.** 소스에 비-localhost DB 접속문자열이 0건임을 강제 |
| `scripts/security/route-authz-audit.js` | **수정.** JSON 출력에 `idorTarget` 필드 추가. [B] 판정을 한 곳에서만 정의 |
| `scripts/security/idor-reviewed.spec.ts` | **신규.** 95건 판정 명단 스냅샷. 감사 스크립트의 `idorTarget` 집합과 양방향 비교 |
| `apps/channel-adapter/src/adapter.module.ts` | **수정.** 죽은 Neon fallback 제거 |
| `apps/membership/drizzle/seed.ts` | **수정.** 살아있는 Neon 기본값 제거 → env 없으면 즉시 실패 |
| `apps/membership/test/test-app.module.ts` | **삭제.** import 하는 곳 0 |
| `apps/wallet/test/integration/payment-response-storage.integration.spec.ts` | **삭제.** 없는 모듈 import — 실행 불가 |
| `apps/channel-adapter/src/services/__tests__/channel-adapter.integration.spec.ts` | **삭제.** 없는 모듈 import — 실행 불가 |
| `docs/api-authz-audit-2026-08.md` | **수정.** P1 결과 반영, 관찰 목록을 P2/P3 로 분류 |
| `<scratchpad>/idor/*.json` | 에이전트 산출물. 레포에 커밋하지 않는다 |

---

## Task 1: 크레덴셜 회귀 테스트 + Neon 제거 (PR-0)

이 태스크는 P1 조사와 **독립**이다. 먼저 끝내고 따로 PR 을 낸다.

**Files:**
- Create: `scripts/security/no-cloud-credentials.spec.ts`
- Modify: `apps/channel-adapter/src/adapter.module.ts:108-115`
- Modify: `apps/membership/drizzle/seed.ts:7-10`
- Delete: `apps/membership/test/test-app.module.ts`
- Delete: `apps/wallet/test/integration/payment-response-storage.integration.spec.ts`
- Delete: `apps/channel-adapter/src/services/__tests__/channel-adapter.integration.spec.ts`

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces: 없음 (다른 태스크가 의존하지 않는다)

### 사실관계 (이미 확인됨 — 다시 조사하지 말 것)

| 위치 | 상태 | 근거 |
|---|---|---|
| `channel-adapter/src/adapter.module.ts:112` | 도달 불가 | `config/env.validation.ts:5` 가 `DATABASE_URL: z.string().url()` 로 필수. SST 는 `deployments/lcnine/services/infra/services.ts:212` 에서 주입 |
| `channel-adapter/.../channel-adapter.integration.spec.ts:52` | 실행 불가 | `Cannot find module '../channel-adapter.repository'` |
| `wallet/test/integration/payment-response-storage.integration.spec.ts:44` | 실행 불가 | `Cannot find module '../../src/shared/database/schema'` |
| `membership/test/test-app.module.ts:30` | 죽은 파일 | 이 파일을 import 하는 곳 0건 |
| `membership/drizzle/seed.ts:9` | **살아있음** | `package.json:56` `db:seed:membership` → `npx tsx drizzle/seed.ts` |

- [ ] **Step 1: 실패하는 테스트를 쓴다**

Create `scripts/security/no-cloud-credentials.spec.ts`:

```ts
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * 소스에 하드코딩된 DB 접속문자열은 비밀번호까지 함께 커밋된다. 이 레포는 공개 이력이 있고
 * 히스토리 재작성 이후에도 `refs/pull` 과 포크가 원본을 붙들고 있어 회수되지 않는다
 * (`docs/git-history-rewrite-2026-08-07.md`). 그래서 "지운다"가 아니라 "다시 안 생긴다"로 건다.
 *
 * localhost 계열은 개발 자리표시자라 허용한다. 그 외 호스트는 실재하는 크레덴셜로 본다.
 * 정당한 예외는 `ALLOWED` 에 **이유와 함께** 추가한다 — 그 추가 자체가 리뷰 대상이다.
 */
const REPO = join(__dirname, '..', '..');

const PATTERN = String.raw`(postgres|postgresql|mysql|mongodb|redis)://[A-Za-z0-9_.-]+:[^'"\s@]+@`;

const LOCAL_HOST = /@(localhost|127\.0\.0\.1|host\.docker\.internal)[:/]/i;

/** `"<파일>:<줄>": '이유'` */
const ALLOWED: Record<string, string> = {
  'scripts/local/seed-dev-core/guard.spec.ts:16':
    '원격 호스트를 거부하는지 검증하는 반대 방향 픽스처. 자격증명은 postgres:postgres 기본값이다.',
};

const scan = (): string[] => {
  let out = '';
  try {
    out = execFileSync('git', ['grep', '-InE', PATTERN, '--', '*.ts'], {
      cwd: REPO,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (err) {
    // git grep 은 매치가 없으면 exit 1 이다. 그건 성공이다.
    if ((err as { status?: number }).status === 1) return [];
    throw err;
  }
  return out.split('\n').filter(Boolean);
};

describe('소스에 클라우드 DB 크레덴셜이 없다', () => {
  it('비-localhost 접속문자열이 0건이다', () => {
    const offenders = scan()
      .filter((line) => !LOCAL_HOST.test(line))
      .map((line) => {
        const [file, lineNo] = line.split(':');
        return `${file}:${lineNo}`;
      })
      .filter((loc) => !(loc in ALLOWED));

    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest scripts/security/no-cloud-credentials.spec.ts`

Expected: **FAIL.** `offenders` 에 5건이 담긴다 —
`apps/channel-adapter/src/adapter.module.ts:112`,
`apps/channel-adapter/src/services/__tests__/channel-adapter.integration.spec.ts:52`,
`apps/membership/drizzle/seed.ts:9`,
`apps/membership/test/test-app.module.ts:30`,
`apps/wallet/test/integration/payment-response-storage.integration.spec.ts:44`

5건이 아니면 멈추고 보고한다. 목록이 다르면 그 사이에 뭔가 바뀐 것이다.

- [ ] **Step 3: 죽은 파일 3개를 지운다**

```bash
git rm apps/membership/test/test-app.module.ts \
       apps/wallet/test/integration/payment-response-storage.integration.spec.ts \
       apps/channel-adapter/src/services/__tests__/channel-adapter.integration.spec.ts
```

셋 다 실행되지 않는다 (§사실관계). 커버리지가 0 인 테스트를 지우는 것은 커버리지 손실이 아니다. `channel-adapter.integration` 은 감사 문서 §3-3 이 "기준선 실패"로 적어둔 4건 중 하나이므로, **삭제 후 기준선 실패는 3건이 된다** — Step 7 에서 문서를 고친다.

- [ ] **Step 4: channel-adapter 의 죽은 fallback 을 제거한다**

`apps/channel-adapter/src/adapter.module.ts` 의 `DbModule.forRoot` 를 다음으로 바꾼다:

```ts
    DbModule.forRoot({
      config: {
        // fallback 을 두지 않는다. env.validation.ts 가 DATABASE_URL 을 필수로 강제하므로
        // 값이 없으면 여기 오기 전에 부팅이 죽는 게 옳다 — 조용히 다른 DB 에 붙는 것보다 낫다.
        connectionString: process.env.DATABASE_URL as string,
      },
      schema: { ...channelAdapterSchema },
    }),
```

- [ ] **Step 5: membership seed 의 살아있는 기본값을 제거한다**

`apps/membership/drizzle/seed.ts` 의 상단 상수를 다음으로 바꾼다. 이건 fallback 이 아니라 **실행되는 기본 접속처**였다 — `DATABASE_URL` 없이 `npm run db:seed` 를 돌리면 클라우드 DB 에 시드를 쓴다.

```ts
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    'DATABASE_URL 이 없다. 시드는 접속처를 추측하지 않는다 — ' +
      '`dotenv -e apps/membership/.env -- npm run db:seed:membership` 처럼 명시할 것.',
  );
}
```

기존 `const DATABASE_URL = process.env.DATABASE_URL || '<neon 문자열>';` 을 위 블록으로 대체한다. 아래쪽에서 `DATABASE_URL` 을 쓰는 코드는 그대로 둔다 (narrowing 으로 `string` 이 된다).

- [ ] **Step 6: 테스트가 통과하는지 확인한다**

Run: `npx jest scripts/security`

Expected: **PASS** (전부). `no-cloud-credentials` 와 기존 `route-authz-audit` 둘 다.

- [ ] **Step 7: 기준선 문서를 고친다**

`docs/api-authz-audit-2026-08.md` §3-3 의 첫 항목에서 `channel-adapter.integration` 을 뺀다. 삭제했으므로 더 이상 실패하지 않는다.

```
- `npx jest libs/authorization apps/notification apps/channel-adapter apps/core/src/platform`
  → **실패 3건이 정상**: `coupang-integration`, `pim-snapshot-builder`, `medusa.client`
  (`channel-adapter.integration` 은 2026-08-08 삭제 — 없는 모듈을 import 해 실행 자체가 불가능했다)
```

같은 문서 §2 P2 의 하드코딩 크레덴셜 항목을 🟩 로 바꾸고, **코드 제거로는 끝나지 않는다**는 점과 사람 작업을 남긴다:

```
- **~~`apps/channel-adapter/src/adapter.module.ts`~~** 🟩 코드 제거 완료 (2026-08-08).
  실제로는 3개 Neon 프로젝트 × 5곳이었다. 회귀는 `scripts/security/no-cloud-credentials.spec.ts` 가 막는다.
  ⚠️ **크레덴셜은 여전히 유효하다** — 공개 이력에서 회수되지 않는다. 사람 작업이 남았다:
  - [ ] Neon 프로젝트 `ep-divine-hill-a1nspuc3` 삭제 (membership)
  - [ ] Neon 프로젝트 `ep-young-pine-a149ey1z` 삭제 (wallet)
  - [ ] Neon 프로젝트 `ep-young-thunder-a1bkhlx2` 삭제 (channel-adapter)
```

- [ ] **Step 8: 기준선 회귀가 없는지 확인한다**

```bash
npx jest libs/authorization apps/notification apps/channel-adapter apps/core/src/platform 2>&1 | tail -20
npx eslint apps/channel-adapter/src/adapter.module.ts apps/membership/drizzle/seed.ts scripts/security/no-cloud-credentials.spec.ts
```

Expected: 첫 명령은 실패 **3건** (`coupang-integration`, `pim-snapshot-builder`, `medusa.client`). 4건이면 뭔가 깨뜨린 것이다. 둘째 명령은 신규 error 0.

- [ ] **Step 9: 커밋**

```bash
git add -A
git commit -m "$(cat <<'EOF'
fix(security): 소스의 클라우드 DB 크레덴셜 제거 + 회귀 테스트

3개 Neon 프로젝트 크레덴셜이 5곳에 하드코딩돼 있었다. 그중 4곳은 죽은
코드였고 (env 검증이 선행하는 fallback 1, 없는 모듈을 import 해 실행
불가능한 테스트 2, import 하는 곳이 없는 파일 1), 나머지 1곳은
`npm run db:seed` 의 실제 기본 접속처라 env 없이 돌리면 클라우드 DB 에
시드를 썼다.

공개 이력에서 크레덴셜은 회수되지 않으므로 "지운다" 가 아니라
"다시 안 생긴다" 로 건다. Neon 프로젝트 삭제는 사람 작업으로 남겼다.

Claude-Session: https://claude.ai/code/session_01TUStsws7nvvLB77PpuawCV
EOF
)"
```

---

## Task 2: 감사 스크립트에 `idorTarget` 필드 추가

조사 대상 [B] 판정이 지금은 `printReport()` 안에만 있다. 스냅샷 테스트와 에이전트 입력이 같은 정의를 봐야 하므로 JSON 으로 내보내고, 정의를 한 곳으로 모은다.

**Files:**
- Modify: `scripts/security/route-authz-audit.js:164-193` (`printReport` 와 `--json` 분기)

**Interfaces:**
- Consumes: 없음
- Produces: `--json` 출력의 각 행에 `idorTarget: boolean`. Task 3 의 에이전트 입력과 Task 5 의 스냅샷 테스트가 이걸 쓴다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

Create `scripts/security/idor-reviewed.spec.ts` (이 파일은 Task 5 에서 완성된다. 지금은 첫 테스트만):

```ts
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const AUDIT = join(__dirname, 'route-authz-audit.js');

interface AuditRow {
  app: string;
  verb: string;
  route: string;
  file: string;
  line: number;
  idorTarget: boolean;
}

const runAudit = (): AuditRow[] =>
  JSON.parse(
    execFileSync('node', [AUDIT, '--json'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }),
  ) as AuditRow[];

/** 판정 명단의 키. `<app> <VERB> <route>` — app 이 빠지면 안 된다 (아래 테스트가 이유를 설명한다). */
const keyOf = (r: AuditRow): string => `${r.app} ${r.verb} ${r.route}`;

describe('IDOR 검사 대상 집합', () => {
  it('감사 스크립트가 idorTarget 을 내보낸다', () => {
    const targets = runAudit().filter((r) => r.idorTarget);
    expect(targets).toHaveLength(95);
  });

  // search 와 analytics 가 둘 다 `GET /health` 다. `<VERB> <route>` 로 키를 만들면
  // 95건이 94개로 뭉개지고 스냅샷이 한 건을 조용히 잃는다.
  it('키에 app 이 들어가야 충돌하지 않는다', () => {
    const targets = runAudit().filter((r) => r.idorTarget);
    expect(new Set(targets.map(keyOf)).size).toBe(95);
    expect(new Set(targets.map((r) => `${r.verb} ${r.route}`)).size).toBe(94);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest scripts/security/idor-reviewed.spec.ts`

Expected: **FAIL.** `idorTarget` 이 아직 없으므로 필터 결과가 0건 → `Expected length: 95, Received length: 0`.

- [ ] **Step 3: 판정식을 한 곳으로 모은다**

`scripts/security/route-authz-audit.js` 에서 `const print = (title, list) => {` **바로 위**에 다음을 추가한다:

```js
/**
 * [B] IDOR 검사 대상 판정. printReport 와 --json 이 **반드시** 같은 식을 써야 한다.
 * 두 곳에 복사하면 APPS 맵이 바뀔 때 조용히 어긋난다.
 *
 *   기본차단 앱(core 등): 표시 없는 라우트는 직원 전용이라 정상. 고객이 닿는 @StoreRoute 만 대상.
 *   그 외 앱: 표시가 없으면 인증만 통과하므로 전부 대상.
 */
const isIdorTarget = (r, cfg) =>
  cfg.defaultDeny ? r.storeRoute : !r.isPublic && !r.storeRoute && !r.authz;
```

- [ ] **Step 4: `printReport` 가 그 식을 쓰게 한다**

`printReport()` 안에서 `const unmarked = ...` 줄을 지우고, `if (cfg.defaultDeny) { ... } else { ... }` 블록을 다음으로 바꾼다:

```js
    print(
      cfg.defaultDeny
        ? 'B: @StoreRoute (고객 — IDOR 검사 대상)'
        : 'B: 인가 표시 없음 — 인증만 통과 (IDOR 검사 대상)',
      rows.filter((r) => isIdorTarget(r, cfg)),
    );
```

- [ ] **Step 5: `--json` 이 그 식을 내보내게 한다**

`if (asJson) {` 블록의 `console.log(...)` 를 다음으로 바꾼다:

```js
  console.log(
    JSON.stringify(
      all.map(({ cfg, ...r }) => ({ ...r, idorTarget: isIdorTarget(r, cfg) })),
      null,
      2,
    ),
  );
```

- [ ] **Step 6: 통과와 무회귀를 확인한다**

```bash
npx jest scripts/security
node scripts/security/route-authz-audit.js | tail -5
```

Expected: jest 전부 PASS. 스크립트 사람 출력의 마지막 줄은 `총 라우트 883 / [A] 무력화 0` 이고, 앱별 [B] 건수는 리팩터 전과 같아야 한다 (core 22 / notification 2 / user-service 20 / membership 26 / file-service 5 / ugc-service 12 / search 4 / analytics 4).

- [ ] **Step 7: 커밋**

```bash
git add scripts/security/route-authz-audit.js scripts/security/idor-reviewed.spec.ts
git commit -m "$(cat <<'EOF'
refactor(security): 감사 스크립트가 idorTarget 을 내보낸다

[B] 판정이 printReport 안에만 있어 스냅샷 테스트가 같은 식을 복사해야
했다. APPS 맵이 바뀔 때 조용히 어긋나므로 isIdorTarget 하나로 모으고
--json 에도 실었다.

Claude-Session: https://claude.ai/code/session_01TUStsws7nvvLB77PpuawCV
EOF
)"
```

---

## Task 3: 조사 에이전트 6개 dispatch + 기계 검증

**이 태스크는 레포 파일을 바꾸지 않는다.** 산출물은 scratchpad JSON 이다.

**Files:**
- Create: `<scratchpad>/idor/membership.json`, `core.json`, `user-service.json`, `ugc-service.json`, `file-and-notification.json`, `search-and-analytics.json`

**Interfaces:**
- Consumes: Task 2 의 `idorTarget` 필드
- Produces: 각 JSON 은 `{ verdicts: VerdictRow[], observations: Observation[] }` 형태.
  (Task 5 의 `Verdict` 는 판정값 유니온이다. 이름을 겹치지 않게 `VerdictRow` 로 둔다.)
  ```ts
  type VerdictRow = {
    key: string;        // `<app> <VERB> <route>` — Task 2 의 keyOf 와 동일 형식
    verdict: 'SAFE' | 'VULN' | 'N/A' | 'UNCLEAR';
    evidence: string;   // `<repo상대경로>:<줄번호>`
    predicate: string;  // 그 줄에 실재하는 원문 한 줄 (SAFE 필수). VULN/N/A/UNCLEAR 는 빈 문자열
    note: string;       // VULN 이면 재현 경로, N/A 면 사유, UNCLEAR 면 막힌 지점
  };
  type Observation = { where: string; what: string };  // IDOR 축 밖 발견
  ```

- [ ] **Step 1: 에이전트 입력 파일을 만든다**

`SP` 는 이 세션의 scratchpad 다. 레포 밖이라 오염 위험이 없고, 여기 쓰인 것은 커밋되지 않는다.

```bash
export SP=/tmp/claude-1000/-home-pauseb-workspace-almondyoung-server/f02c6b89-4be9-47c2-adfd-24c12f58f612/scratchpad
mkdir -p "$SP/idor"
node scripts/security/route-authz-audit.js --json > "$SP/idor/audit.json"
node -e "
const fs=require('fs'); const SP=process.env.SP;
const rows=require(SP+'/idor/audit.json').filter(r=>r.idorTarget);
const GROUPS={
  membership:['membership'], core:['core'], 'user-service':['user-service'],
  'ugc-service':['ugc-service'], 'file-and-notification':['file-service','notification'],
  'search-and-analytics':['search','analytics'],
};
for (const [name,apps] of Object.entries(GROUPS)) {
  const g=rows.filter(r=>apps.includes(r.app));
  fs.writeFileSync(SP+'/idor/in-'+name+'.json', JSON.stringify(g,null,2));
  console.log(name.padEnd(24), g.length);
}
"
```

Expected 출력: `membership 26`, `core 22`, `user-service 20`, `ugc-service 12`, `file-and-notification 7`, `search-and-analytics 8`. 합 95.

- [ ] **Step 2: 에이전트 6개를 한 번에 dispatch 한다**

여섯 개를 **한 메시지에** 보내 병렬로 돌린다. `subagent_type: "Explore"` 를 쓴다 (읽기 전용 도구만 가진다 — 오염 방지가 프롬프트 약속이 아니라 도구 수준에서 강제된다).

각 에이전트 프롬프트 (`<GROUP>`, `<APPS>`, `<N>`, `<SP>` 를 치환):

```
apps/<APPS> 의 HTTP 라우트 <N>건에 IDOR(Insecure Direct Object Reference) 판정을 내려라.

대상 목록: <SP>/idor/in-<GROUP>.json  (verb, route, file, line, handler)
결과 저장: <SP>/idor/<GROUP>.json

## 판정 규칙

각 라우트마다 컨트롤러 → 서비스 → 리포지토리를 따라가, 호출자 식별자(userId/customerId)가
**DB 쿼리 술어에 실제로 들어가는지** 확인하고 다음 중 하나로 판정한다:

- SAFE    : 식별자가 조회/변경 술어에 들어간다. `predicate` 에 그 줄의 원문을 그대로 적는다.
- VULN    : 식별자가 술어에 없다. `note` 에 재현 경로(어떤 요청이 남의 데이터를 건드리는지) 적는다.
- N/A     : IDOR 이 성립하지 않는다 (생성 라우트라 대상 객체가 없음, 헬스체크). `note` 에 사유.
- UNCLEAR : 추적이 막혔다. `note` 에 **어디서 막혔는지** 적는다.

## 반드시 지킬 것

1. **컨트롤러가 파라미터를 받는 것은 증거가 아니다.** `@User('userId') userId` 를 받아놓고
   서비스에서 안 쓰는 것이 이 감사가 찾는 함정이다. 컨트롤러만 보면 안전해 보인다.
   리포지토리의 where 절까지 따라가야 판정이다.
2. **`predicate` 는 그 파일 그 줄에 실재하는 원문이어야 한다.** 요약·의역·재구성 금지.
   오케스트레이터가 `grep -F` 로 대조한다. 안 맞으면 판정이 기각된다.
3. **UNCLEAR 는 실패가 아니다.** 확신이 없으면 SAFE 로 적지 말고 UNCLEAR 로 적어라.
   추측한 SAFE 는 이 작업에서 가장 나쁜 결과다 — 안전하다는 문서가 남기 때문이다.
4. **레포 안의 파일을 절대 수정하지 마라.** 쓰기는 <SP> 아래에만. 고칠 점이 보이면 note 에 적어라.

## 참고 — SAFE 증거가 어떤 모양이어야 하는가 (이미 확인된 실제 사례)

  apps/file-service/src/access/file-access.ts:55   `if (file.uploadedBy === user.userId) return true;`
  apps/ugc-service/src/reviews/services/reviews.service.ts:524
      `.where(and(eq(reviews.id, id), eq(reviews.userId, userId), eq(reviews.sourceSystem, SOURCE_SYSTEM)))`

## 이 앱의 인가 관용구

<APPS 에 해당하는 docs/api-authz-audit-2026-08.md §3-1 표의 행을 여기에 붙인다>

## IDOR 축 밖 발견

판정하지 말고 observations 에 모아라. 예: 서비스 위임 토큰이 소유권 검사를 통과하는 경로,
관리자 우회, 하드코딩 값. 이번 작업에서 고치지 않는다.

## 출력 형식

<SP>/idor/<GROUP>.json 에 다음 형태로 쓴다. 대상 목록의 모든 라우트가 verdicts 에 있어야 한다.

{ "verdicts": [ { "key": "<app> <VERB> <route>", "verdict": "...", "evidence": "path:line",
                  "predicate": "...", "note": "..." } ],
  "observations": [ { "where": "path:line", "what": "..." } ] }

최종 응답은 판정 요약 한 문단이면 된다. 상세는 파일에 있다.
```

- [ ] **Step 3: 결과 파일이 다 왔고 건수가 맞는지 확인한다**

```bash
node -e "
const fs=require('fs'); const SP=process.env.SP;
const G=['membership','core','user-service','ugc-service','file-and-notification','search-and-analytics'];
let total=0;
for (const g of G) {
  const p=SP+'/idor/'+g+'.json';
  if (!fs.existsSync(p)) { console.log('MISSING', g); continue; }
  const d=JSON.parse(fs.readFileSync(p,'utf8'));
  const c={}; for (const v of d.verdicts) c[v.verdict]=(c[v.verdict]||0)+1;
  console.log(g.padEnd(24), d.verdicts.length, JSON.stringify(c), 'obs', d.observations.length);
  total+=d.verdicts.length;
}
console.log('합계', total, total===95?'OK':'← 95 가 아니다');
"
```

Expected: 합계 95. 아니면 빠진 그룹의 에이전트를 다시 돌린다.

- [ ] **Step 4: SAFE 판정의 인용을 기계 검증한다**

**이 단계를 건너뛰면 이 계획 전체가 무의미하다.** 에이전트가 지어낸 인용이 여기서 죽는다.

```bash
node -e "
const fs=require('fs'); const SP=process.env.SP;
const G=['membership','core','user-service','ugc-service','file-and-notification','search-and-analytics'];
const bad=[];
for (const g of G) {
  const d=JSON.parse(fs.readFileSync(SP+'/idor/'+g+'.json','utf8'));
  for (const v of d.verdicts.filter(v=>v.verdict==='SAFE')) {
    const [file,ln]=v.evidence.split(':');
    if (!fs.existsSync(file)) { bad.push([v.key,'파일 없음',v.evidence]); continue; }
    const lines=fs.readFileSync(file,'utf8').split('\n');
    const near=lines.slice(Math.max(0,+ln-4), +ln+3).join('\n');   // ±3줄 허용
    if (!near.includes(v.predicate.trim())) bad.push([v.key,'인용 불일치',v.evidence]);
  }
}
console.log(bad.length ? bad.map(b=>b.join('  ')).join('\n') : '전부 일치');
console.log('불일치', bad.length, '건');
"
```

Expected: **불일치 0건.** 0이 아니면 그 판정들을 `UNCLEAR` 로 강등하고 Step 5 에서 직접 읽는다. 강등한 건수를 기록해 둔다 — 그 에이전트의 다른 판정도 의심해야 한다.

- [ ] **Step 5: UNCLEAR 를 직접 읽는다**

강등분을 포함한 모든 `UNCLEAR` 를 오케스트레이터가 직접 읽고 `SAFE`/`VULN`/`N/A` 로 확정한다. 끝까지 불확실하면 `UNCLEAR` 로 남기되, Task 6 의 문서에 **미해결로 명시**한다. 조용히 SAFE 로 만들지 않는다.

- [ ] **Step 6: 중간 결과를 보고한다 (커밋 없음)**

판정 분포(`SAFE`/`VULN`/`N/A`/`UNCLEAR` 건수), 인용 불일치 건수, 관찰 목록 건수를 사용자에게 보고한다. `VULN` 이 나왔으면 라우트와 재현 경로를 같이 낸다. scratchpad 는 커밋하지 않는다.

---

## Task 4: 반증 에이전트 3개 dispatch

**Files:**
- Create: `<scratchpad>/idor/refute-1.json`, `refute-2.json`, `refute-3.json`

**Interfaces:**
- Consumes: Task 3 의 `verdicts` 중 쓰기(`POST|PUT|PATCH|DELETE`) & `SAFE`
- Produces: `{ key, upheld: boolean, reason: string }[]`. `upheld: false` 는 Task 3 의 판정을 `VULN` 으로 뒤집는다.

- [ ] **Step 1: 반증 대상을 뽑아 3등분한다**

```bash
node -e "
const fs=require('fs'); const SP=process.env.SP;
const G=['membership','core','user-service','ugc-service','file-and-notification','search-and-analytics'];
const W=/^\S+ (POST|PUT|PATCH|DELETE) /;
const t=G.flatMap(g=>JSON.parse(fs.readFileSync(SP+'/idor/'+g+'.json','utf8')).verdicts)
         .filter(v=>v.verdict==='SAFE' && W.test(v.key));
console.log('반증 대상', t.length, '건');
for (let i=0;i<3;i++)
  fs.writeFileSync(SP+'/idor/in-refute-'+(i+1)+'.json',
    JSON.stringify(t.filter((_,j)=>j%3===i),null,2));
"
```

대상이 0건이면 (쓰기 37건이 전부 VULN/N/A 였다면) 이 태스크를 건너뛰고 Task 5 로 간다.

- [ ] **Step 2: 에이전트 3개를 한 메시지로 dispatch 한다**

`subagent_type: "Explore"`. 프롬프트 (`<K>`, `<SP>` 치환):

```
아래 SAFE 판정들을 **깨라**. 다른 에이전트가 내린 판정이고, 네 임무는 동의가 아니라 반증이다.

대상: <SP>/idor/in-refute-<K>.json  (key, evidence, predicate)
결과: <SP>/idor/refute-<K>.json

기본값은 **반증**이다. 뒤집을 근거를 찾지 못했을 때만 upheld:true 다.
"술어가 있으니 안전하다" 는 검증이 아니다 — 그 술어가 실제로 효력이 있는지를 봐야 한다.

## SAFE 가 틀리는 네 가지 방식 — 각 라우트마다 넷 다 확인하라

1. **식별자의 출처가 토큰이 아니라 요청 바디/쿼리**. 술어는 멀쩡한데 `userId` 가 클라이언트가
   보낸 값이면 술어는 아무것도 막지 못한다. 술어만 보면 완벽하게 안전해 보인다.
   이 레포에서 2026-08 P0 로 터진 것이 정확히 이 모양이다 (바디의 userId 로 리뷰 자격 발급).
   → 그 식별자가 `@User()`/JWT payload 에서 왔는지 **끝까지** 거슬러 올라가 확인하라.
2. **조건부 술어**. `if` 안에 있어 특정 분기(관리자 플래그, 옵션 파라미터)에서 건너뛴다.
3. **같은 라우트의 다른 도달 경로**. 오버로드·조건 분기·배치 처리기·이벤트 핸들러가
   같은 데이터에 술어 없이 닿는다.
4. **트랜잭션/캐시 경로 우회**. tx 를 받는 오버로드나 캐시 조회가 술어를 건너뛴다.

## 출력

{ "results": [ { "key": "...", "upheld": true|false, "reason": "..." } ] }

upheld:false 면 reason 에 **구체적인 요청 시나리오**를 적어라 ("A 사용자가 이 바디로 호출하면
B 사용자의 X 가 바뀐다"). 시나리오를 못 쓰면 그건 반증이 아니라 의심이므로 upheld:true 로 하되
reason 에 의심 내용을 적어라.

레포 안의 파일을 절대 수정하지 마라. 쓰기는 <SP> 아래에만.
```

- [ ] **Step 3: 뒤집힌 판정을 반영한다**

```bash
node -e "
const fs=require('fs'); const SP=process.env.SP;
const flips=[1,2,3].flatMap(k=>JSON.parse(fs.readFileSync(SP+'/idor/refute-'+k+'.json','utf8')).results)
                   .filter(r=>!r.upheld);
console.log('뒤집힌 판정', flips.length, '건');
for (const f of flips) console.log(' -', f.key, '→', f.reason);
"
```

뒤집힌 건은 Task 3 의 판정을 `VULN` 으로 바꾸고, `note` 에 반증 시나리오를 넣는다. **뒤집힌 건이 있으면 Step 4 를 한다.**

- [ ] **Step 4: 뒤집힌 건은 직접 확인한다 (조건부)**

반증 에이전트도 틀릴 수 있다. `VULN` 으로 바꾸기 전에 오케스트레이터가 그 시나리오를 코드로 직접 따라가 확인한다. 확인되면 `VULN`, 아니면 `SAFE` 를 유지하되 판정 note 에 "반증 시도됨 — 근거 불충분"을 남긴다.

- [ ] **Step 5: 보고한다 (커밋 없음)**

반증 대상 건수, 뒤집힌 건수, 최종 확정된 `VULN` 목록을 사용자에게 보고한다.

---

## Task 5: 스냅샷 회귀 테스트 완성

**Files:**
- Modify: `scripts/security/idor-reviewed.spec.ts` (Task 2 에서 만든 파일에 판정 명단 추가)

**Interfaces:**
- Consumes: Task 3 + Task 4 의 확정 판정 95건
- Produces: `npx jest scripts/security` 가 새 IDOR 대상 라우트를 막는다

- [ ] **Step 1: 명단 초안을 생성한다 (사람이 검수할 원본)**

```bash
node -e "
const fs=require('fs'); const SP=process.env.SP;
const G=['membership','core','user-service','ugc-service','file-and-notification','search-and-analytics'];
const all=G.flatMap(g=>JSON.parse(fs.readFileSync(SP+'/idor/'+g+'.json','utf8')).verdicts)
           .sort((a,b)=>a.key.localeCompare(b.key));
const esc=s=>String(s).replace(/\\\\/g,'\\\\\\\\').replace(/'/g,\"\\\\'\");
console.log(all.map(v=>
  \"  '\"+esc(v.key)+\"': {\n\" +
  \"    verdict: '\"+v.verdict+\"',\n\" +
  \"    evidence: '\"+esc(v.evidence)+\"',\n\" +
  \"    predicate: '\"+esc(v.predicate)+\"',\n\" +
  (v.note ? \"    note: '\"+esc(v.note)+\"',\n\" : '') +
  '  },').join('\n'));
" > "$SP/idor/map-draft.txt"
wc -l "$SP/idor/map-draft.txt"
```

- [ ] **Step 2: 명단을 spec 에 넣는다**

`scripts/security/idor-reviewed.spec.ts` 의 import 아래에 다음을 추가하고, `map-draft.txt` 내용을 `IDOR_REVIEWED` 본문에 붙인다. **붙여넣고 끝내지 말고 눈으로 훑어라** — 이 맵은 사람이 책임지는 문장이다.

```ts
type Verdict = 'SAFE' | 'VULN' | 'N/A' | 'UNCLEAR';

/**
 * IDOR 검사 대상 95건의 판정 명단. 2026-08 감사 P1 (`docs/api-authz-audit-2026-08.md`).
 *
 * 키는 `<app> <VERB> <route>` 다. app 을 빼면 search·analytics 의 `GET /health` 가 충돌해
 * 95건이 94개로 뭉개진다.
 *
 * ⚠️ 이 테스트가 막는 것은 **새 구멍**이지 **기존 방어의 퇴행**이 아니다.
 * 누군가 `eq(reviews.userId, userId)` 를 지워도 여기는 초록이다. IDOR 은 의미론이라
 * AST 로 판정할 수 없다. 초록불을 "IDOR 이 없다" 로 읽지 마라.
 *
 * 새 라우트를 추가했다면: 소유권 검사를 확인하고, 그 근거(file:line 과 술어 원문)를 적어
 * 여기 추가한다. 근거 없이 키만 추가하는 것은 이 장치를 무력화하는 것이다.
 */
const IDOR_REVIEWED: Record<string, { verdict: Verdict; evidence: string; predicate: string; note?: string }> = {
  // ← map-draft.txt 내용
};
```

그리고 Task 2 의 `describe` 블록에 다음 테스트들을 추가한다:

```ts
  it('감사 스크립트의 대상 집합과 명단이 정확히 일치한다', () => {
    const actual = new Set(runAudit().filter((r) => r.idorTarget).map(keyOf));
    const listed = new Set(Object.keys(IDOR_REVIEWED));

    const unlisted = [...actual].filter((k) => !listed.has(k)).sort();
    const stale = [...listed].filter((k) => !actual.has(k)).sort();

    // 새 라우트가 명단에 없다 → 소유권 검사를 확인하고 근거와 함께 추가할 것
    expect(unlisted).toEqual([]);
    // 사라진 라우트가 명단에 남았다 → 명단을 정리할 것
    expect(stale).toEqual([]);
  });

  it('SAFE 판정에는 반드시 증거와 술어 원문이 있다', () => {
    const missing = Object.entries(IDOR_REVIEWED)
      .filter(([, v]) => v.verdict === 'SAFE')
      .filter(([, v]) => !/:\d+$/.test(v.evidence) || v.predicate.trim() === '')
      .map(([k]) => k);

    expect(missing).toEqual([]);
  });

  it('미해결(VULN·UNCLEAR)이 남아 있으면 그 목록이 여기 보인다', () => {
    const open = Object.entries(IDOR_REVIEWED)
      .filter(([, v]) => v.verdict === 'VULN' || v.verdict === 'UNCLEAR')
      .map(([k, v]) => `${k} [${v.verdict}] ${v.note ?? ''}`);

    // 미해결이 남은 상태로 머지할 수 있다. 다만 이 테스트가 목록을 계속 보여준다.
    // 전부 해소하면 이 기대값을 [] 로 바꾸고 회귀를 막는다.
    expect(open).toEqual(EXPECTED_OPEN);
  });
```

`EXPECTED_OPEN` 은 파일 상단에 실제 미해결 목록을 문자열 배열로 적는다. 0건이면 `const EXPECTED_OPEN: string[] = [];`.

- [ ] **Step 3: 통과를 확인한다**

Run: `npx jest scripts/security`

Expected: **PASS** (전부).

- [ ] **Step 4: 테스트가 실제로 잡는지 고의로 확인한다**

**초록불이 배선이 살아있다는 증거는 아니다.** 이 레포에서 실제로 겪은 실패 방식이다. 일부러 깨서 빨개지는 걸 본다.

`apps/search/src/search.controller.ts` 에 임시 라우트를 추가한다:

```ts
  @Get('__idor_canary')
  canary(): string {
    return 'temporary — must be reverted';
  }
```

Run: `npx jest scripts/security/idor-reviewed.spec.ts`

Expected: **FAIL.** `unlisted` 에 `search GET /search/__idor_canary` 가 담기고, `toHaveLength(95)` 도 96 으로 깨진다. 두 테스트가 다 빨개지지 않으면 배선이 잘못된 것이다.

그다음 **되돌린다**:

```bash
git checkout -- apps/search/src/search.controller.ts
npx jest scripts/security   # 다시 전부 PASS
git status --short           # 카나리 흔적이 없는지 확인
```

- [ ] **Step 5: 커밋**

```bash
git add scripts/security/idor-reviewed.spec.ts
git commit -m "$(cat <<'EOF'
test(security): IDOR 검사 대상 95건 판정 명단 스냅샷

감사 스크립트가 [B] 로 분류한 95건 각각에 판정과 근거(file:line +
술어 원문)를 붙이고, 대상 집합과 명단을 양방향 비교해 새 라우트가
근거 없이 들어오는 걸 막는다.

한계를 파일 주석에 명시했다 — 이 테스트는 새 구멍을 막지 기존 술어의
삭제는 잡지 못한다. IDOR 은 의미론이라 AST 로 판정할 수 없다.

Claude-Session: https://claude.ai/code/session_01TUStsws7nvvLB77PpuawCV
EOF
)"
```

---

## Task 6: 감사 문서 갱신

**Files:**
- Modify: `docs/api-authz-audit-2026-08.md` (§0 요약, §2 P1 섹션, §2 P2/P3, §4 착수 순서)

**Interfaces:**
- Consumes: Task 3~5 의 확정 판정과 관찰 목록
- Produces: 없음 (문서가 종착점)

- [ ] **Step 1: P1 섹션을 결과로 바꾼다**

`### P1 ⬜ IDOR 전수 조사 — 95건 (그중 쓰기 37건)` 을 `### P1 🟩 IDOR 전수 조사 — 95건 완료` 로 바꾸고(미해결이 남았으면 🟨), 본문을 다음으로 교체한다:

- 판정 분포표 (앱 × `SAFE`/`VULN`/`N/A`/`UNCLEAR`)
- `VULN` 목록 (있다면) 과 각각의 재현 경로 + 처리 상태
- `UNCLEAR` 목록 (있다면) 과 막힌 지점
- **"우선 볼 곳" 목록은 지운다.** 그 목록이 지목한 file-service 와 ugc 가 둘 다 위양성이었으므로 남겨두면 다음 사람을 잘못 이끈다. 대신 위양성이었다는 사실과 이유(감사 스크립트는 데코레이터를 보고 방어는 서비스 계층에 산다)를 적는다.
- 회귀 장치와 **그 한계**를 적는다: `scripts/security/idor-reviewed.spec.ts` 는 새 구멍을 막지 기존 술어 삭제는 못 잡는다.

- [ ] **Step 2: 관찰 목록을 P2/P3 로 분류해 올린다**

Task 3 의 `observations` 를 읽고 각각을 P2(설계 부채) 또는 P3(동작 확인 필요)로 분류해 해당 섹션에 추가한다. 최소한 이미 알려진 다음 건은 들어가야 한다:

```
- **`apps/file-service/src/access/file-access.ts:58-60`** — `scopes: ['master']` 만 든 서비스
  위임 토큰은 파일 소유권 검사를 전량 통과한다. IDOR 은 아니지만(정상 경로다) 위임 토큰이
  새면 전 사용자 파일이 열린다. `AUTH_SECRET` 공유 구조와 겹쳐 보면 P2 JWT 항목과 한 묶음이다.
```

- [ ] **Step 3: §0 한 줄 요약과 §4 착수 순서를 갱신한다**

§0 에서 "남은 것"의 (a) 항목을 지우고 실제 잔여로 바꾼다. §4 에서 `2. **P1 IDOR** ...` 를 완료 표시하고, 남은 것은 P2/P3 임을 명시한다.

- [ ] **Step 4: 문서가 스스로 모순되지 않는지 확인한다**

```bash
grep -n "95\|IDOR\|P1" docs/api-authz-audit-2026-08.md | head -40
```

§0 요약, §2 P1, §4 착수 순서의 세 군데가 같은 이야기를 하는지 눈으로 확인한다. 이 문서는 상황판이라 서로 어긋나면 다음 세션이 틀린 곳을 믿는다.

- [ ] **Step 5: 커밋**

```bash
git add docs/api-authz-audit-2026-08.md
git commit -m "$(cat <<'EOF'
docs(security): P1 IDOR 전수조사 결과 반영

95건 판정 완료. "우선 볼 곳" 목록은 지웠다 — 그게 지목한 file-service 와
ugc 가 둘 다 위양성이었고, 남겨두면 다음 사람을 같은 곳으로 잘못 이끈다.
위양성의 이유(스크립트는 데코레이터를 보고 방어는 서비스 계층에 산다)를
대신 적었다.

Claude-Session: https://claude.ai/code/session_01TUStsws7nvvLB77PpuawCV
EOF
)"
```

---

## Task 7: `VULN` 수정 (조건부 — 발견된 앱마다 1회)

**`VULN` 이 0건이면 이 태스크는 없다.** 그건 실패가 아니라 근거를 남긴 종결이다.

**Files:** (발견된 라우트에 따라 결정)
- Modify: `apps/<app>/src/**/<domain>.service.ts` — 술어 추가
- Test: `apps/<app>/src/**/__tests__/<domain>.idor.spec.ts` — 신규

**Interfaces:**
- Consumes: Task 4 에서 확정된 `VULN` 의 재현 시나리오
- Produces: Task 5 의 `IDOR_REVIEWED` 에서 해당 키의 `verdict` 가 `SAFE` 로 바뀌고 `EXPECTED_OPEN` 에서 빠진다

- [ ] **Step 1: 호출자를 먼저 확인한다**

**수정 전에 반드시 한다.** 남의 데이터가 보이던 것이 403 이 되는 것은 **동작 변경**이다. 프론트가 그 동작에 의존 중이면 깨진다 (감사 문서 P3 의 죽은 경로 4건이 같은 종류의 부채다).

```bash
# 스토어프론트·admin-web 에서 해당 경로를 부르는 곳을 찾는다.
# 줄 단위 grep 은 여러 줄 호출 `api("svc",\n "path")` 를 놓친다 — 개행을 허용해서 찾는다.
grep -rPzo "api\(\s*\"[^\"]+\",\s*\n?\s*\"[^\"]*<경로조각>[^\"]*\"" \
  web/almondyoung-storefront/src apps/admin-web/src 2>/dev/null | tr '\0' '\n'
```

호출자가 있으면 그 호출이 남의 데이터를 의도적으로 읽는지 확인하고, 그렇다면 수정 범위에 프론트도 포함한다.

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`apps/<app>/src/<domain>/__tests__/<domain>.idor.spec.ts` 를 만든다. 서비스 계층 단위 테스트로 충분하다 — 리포지토리를 모킹하고 **호출자 식별자가 쿼리 조건에 실려 나가는지**를 본다.

```ts
// 예시 — 실제 도메인 이름과 시그니처로 바꿔 쓴다.
describe('<Domain>Service IDOR', () => {
  it('남의 <리소스> 는 찾지 못한다', async () => {
    const rows = [{ id: 'res-1', userId: 'owner' }];
    const repo = { findById: jest.fn(async (id: string, userId: string) =>
      rows.find((r) => r.id === id && r.userId === userId) ?? null) };
    const service = new DomainService(repo as never);

    await expect(service.get('res-1', 'attacker')).rejects.toThrow(NotFoundError);
    expect(repo.findById).toHaveBeenCalledWith('res-1', 'attacker');
  });
});
```

`toHaveBeenCalledWith` 로 **식별자가 리포지토리까지 실려 갔는지**를 함께 못 박는다. 서비스가 식별자를 받아놓고 안 넘기는 것이 원래 버그였으므로, 반환값만 보면 모킹이 우연히 맞아 통과한다.

- [ ] **Step 3: 실패를 확인한다**

Run: `npx jest apps/<app>/src/<domain>/__tests__/<domain>.idor.spec.ts`

Expected: **FAIL.** 술어가 없으므로 남의 리소스가 반환되거나 `findById` 가 식별자 없이 호출된다.

- [ ] **Step 4: 술어를 추가한다**

리포지토리의 `where` 절에 호출자 식별자를 넣는다. 서비스 시그니처에 식별자가 없으면 컨트롤러부터 `@User('userId')` 로 받아 내려보낸다. 이 레포의 관용구를 따른다 — `CLAUDE.md` 의 계층 규칙대로 검증은 Reader/Manager 에, 트랜잭션은 `dbService.run(fn, tx)` 로 전파한다.

- [ ] **Step 5: 통과를 확인한다**

Run: `npx jest apps/<app>/src/<domain>`

Expected: 신규 테스트 PASS, 해당 도메인 기존 테스트 무회귀.

- [ ] **Step 6: 명단을 갱신한다**

`scripts/security/idor-reviewed.spec.ts` 에서 해당 키의 `verdict` 를 `SAFE` 로 바꾸고 `evidence`/`predicate` 에 방금 추가한 술어의 실제 위치와 원문을 적는다. `EXPECTED_OPEN` 에서 그 항목을 뺀다.

Run: `npx jest scripts/security`

Expected: PASS.

- [ ] **Step 7: 커밋**

```bash
git add apps/<app> scripts/security/idor-reviewed.spec.ts
git commit -m "$(cat <<'EOF'
fix(security): <app> <route> 소유권 검사 추가

<재현 경로 한 문장>

Claude-Session: https://claude.ai/code/session_01TUStsws7nvvLB77PpuawCV
EOF
)"
```

---

## 완료 조건

- [ ] `npx jest scripts/security` 전부 통과
- [ ] `node scripts/security/route-authz-audit.js` → `[A] 무력화 0`
- [ ] `npx jest libs/authorization apps/notification apps/channel-adapter apps/core/src/platform` → 실패 **3건** (Task 1 에서 하나 줄었다)
- [ ] `git status --short` 깨끗함 — 카나리·scratchpad 흔적 없음
- [ ] `IDOR_REVIEWED` 95건 전부에 판정이 있고, `SAFE` 는 전부 증거와 술어를 가진다
- [ ] 감사 문서 §0·§2·§4 가 서로 모순되지 않는다
- [ ] Neon 프로젝트 3개 삭제가 **사람 작업으로 문서에 남아 있다** (코드로는 못 끝낸다)

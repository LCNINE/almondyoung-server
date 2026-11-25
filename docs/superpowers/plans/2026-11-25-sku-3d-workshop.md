# SKU 3D 작업실 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 휴대전화 브라우저의 SKU 별 3D 작업실에서 Windows 홈 PC 워커(Codex CLI + Blender)가 만든 GLB 를 보고, 채팅으로 고치고, 승인해 쇼핑몰에 공개한다.

**Architecture:** core 에 작업실·대기열·승인 모듈을 두고, 홈 PC 워커가 HTTPS 로 작업을 claim/lease/heartbeat 한다. 검토 파일은 비공개 file-service 컨텍스트에 두고 core 가 권한 검사 후 바이트를 흘려 준다. 승인은 공개 업로드 → 기존 register(draft) → 기존 publish 를 revision 행의 단계 칸으로 멱등 처리한다.

**Tech Stack:** NestJS + Drizzle(postgres.js), Next.js admin-web + React Query + @google/model-viewer, Node 22 ESM 워커(의존성 없음), Codex CLI 0.161, Blender(경로 설정값).

**Spec:** `docs/superpowers/specs/2026-11-25-sku-3d-workshop-design.md`

**실행 방식(사용자 지정):** Claude 가 각 태스크를 구현한다. 태스크마다 Codex 리뷰(codex:codex-rescue 에이전트, 읽기 전용 리뷰)를 받고, 그 지적을 Claude 가 메인 리뷰로 판정·반영한 뒤 사용자에게 보고하고 허락을 받아 다음 태스크로 간다. 커밋·푸시는 사용자가 지시할 때만.

## Global Constraints
- 테스트는 직렬: `npx jest <경로> --runInBand`. 바뀐 파일의 스펙만 돌린다.
- 통합 스펙은 Testcontainers + `REQUIRE_SKU_3D_WORKSHOP_DB=1` 가드. 스펙 안에서 `dotenv.config()` 금지.
- 레이어: Controller → Service(2~3줄) → Reader/Manager → DB. 서비스는 `@app/shared` 도메인 예외만.
- tx 전파: 공개 메서드는 마지막 인자 `tx?: DbTx`, 안에서 `this.db.run(async (trx) => …, tx)`.
- 모든 새 라우트는 `@RequirePermission` 또는 워커 키 문(`@Public() @ServiceKeyRoute()` + 워커 가드). `scripts/security/route-classification.spec.ts` 초록.
- 기본 테넌트 없음. 워커 라우트는 `x-tenant-id` 헤더 필수.
- GLB: 미터, 텍스처 내장, 2,097,152 바이트 이하, glTF Validator 오류 0.
- Codex 실행: `--last` 금지, 저장된 세션 id 로만 resume. 자식 env 허용 목록만.
- 문구·주석·문서에 특수 인용부호(겹화살괄호, 낫표 등) 금지. 설명 주석은 로직 흐름 한 줄만. 주석에 이슈 번호 금지.
- 논리 단위 사이 빈 줄, return 앞 빈 줄, 한 줄 for-if 금지(AGENTS.md).
- `scripts/home-server` 수정 금지. 운영 DB 마이그·배포·file_contexts 라이브 행 추가는 사용자 확인 후.

## Review Focus
1. 늦게 도착한 결과: lease 를 잃은 워커의 complete/session/events → 409, revision 0개. (Task 4 `rejects late complete after reclaim`)
2. 같은 세션 동시 실행: revise 요청이 running 작업 중에 오면 409, 작업 1개 유지. (Task 3 `rejects message while job active`)
3. 남의 작업실: 다른 owner 의 작업실 id 로 상세·GLB·승인 → 404(존재 숨김), manage 보유자는 열람 가능하되 승인은 owner 만. (Task 3 `hides other owner workshop`)
4. 보던 버전과 다른 승인: sha256 불일치 → 409, 공개 0회. (Task 5 `rejects stale hash`)
5. 공개 재시도: 2단계 뒤 실패 후 재시도 → sku_3d_models 행 1개, approved 1개. (Task 5 `retry after failure creates one version`)

---

### Task 1: 스키마 + 마이그레이션 (작성 완료, 검증·커밋만)

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts` (sku3dWorkshops·sku3dWorkshopJobs·sku3dWorkshopEvents·sku3dWorkshopRevisions·sku3dWorkers, wmsTables 등록)
- Create: `apps/core/drizzle/20261125084408_add-sku-3d-workshop.sql`, `apps/core/drizzle/meta/20261125084408_snapshot.json`, `apps/core/drizzle/meta/_journal.json`

**Interfaces:**
- Produces: 위 테이블 export, 타입 `Sku3dDimensionBasis`, `Sku3dJobKind`, `Sku3dJobStatus`, `Sku3dJobUpload`, `Sku3dEventType`, `Sku3dRevisionReview`, `Sku3dRevisionFiles`.

- [ ] **Step 1:** SQL 이 CREATE TABLE 5개 + 인덱스만인지(expand) 확인. `grep -E "DROP|ALTER TABLE \"(skus|sku_3d_models)\"" apps/core/drizzle/20261125084408_add-sku-3d-workshop.sql` → 출력 없음.
- [ ] **Step 2:** 로컬 도커 core DB 에 적용: `npm run db:migrate -- --stage local --deployment lcnine-services --yes` (로컬 스택 명령은 docs/local-e2e-environment.md 기준으로 확인 후). 기대: 새 마이그 1건 적용.
- [ ] **Step 3:** `npm run type-check` → 이 워크트리 기존 warehouse-app `@tauri-apps` 1건 외 0.
- [ ] **Step 4:** 사용자 승인 후 커밋 `[core] SKU 3D 작업실 테이블을 추가한다` (schema + sql + meta 한 커밋).

---

### Task 2: 비공개 파일 컨텍스트 + 권한 키

**Files:**
- Modify: `apps/file-service/src/database/default-file-contexts.ts` (새 시드)
- Modify: `libs/authorization/src/permissions/permission-catalog.ts`
- Test: 기존 `apps/file-service/src/database/*.spec.ts`, `libs/authorization/src/permissions/*.spec.ts` (permission-dependencies 등)

**Interfaces:**
- Produces: `SKU_3D_WORKSHOP_CONTEXT_ID = 'sku-3d-workshop'` (file-service), 권한 `'inventory.model_workshop.write'`, `'inventory.model_workshop.manage'`.

- [ ] **Step 1:** 시드 추가: `allowPublic: false, allowPrivate: true`, mime `['model/gltf-binary','image/png','image/jpeg','image/webp','text/plain','text/markdown','application/json','application/octet-stream']`, `maxFileSize: 50 * 1024 * 1024`(blend 파일), `pathPrefix: 'inventory/sku-3d-workshop'`. `STAFF_CONTEXT_PERMISSIONS` 에는 넣지 않는다(열람은 core 만).
- [ ] **Step 2:** 권한 두 개 추가. `use`: 이름 `3D 작업실 사용`, grant `['admin', ...LOGISTICS]`, `requires: ['inventory.stock.read']`. `manage`: 이름 `3D 작업실 전체 보기`, grant `ADMIN`, `requires: ['inventory.model_workshop.write']`.
- [ ] **Step 3:** `npx jest libs/authorization apps/file-service/src/database --runInBand` → PASS.
- [ ] **Step 4:** 라이브 `file_contexts` 행은 시드가 아니라 배포 때 SQL 로 넣는다 — 배포 노트에 INSERT 문을 적는다(Task 8).
- [ ] **Step 5:** 커밋 `[file-service·authorization] 3D 작업실 비공개 파일 컨텍스트와 권한을 추가한다`.

---

### Task 3: core 작업실 API (사람 쪽)

**Files:**
- Create: `apps/core/src/modules/inventory/sku-3d-workshop/{sku-3d-workshop.module.ts, sku-3d-workshop.controller.ts, sku-3d-workshop.service.ts, sku-3d-workshop.reader.ts, sku-3d-workshop.manager.ts, sku-3d-workshop.dto.ts, workshop-access.ts}`
- Modify: `apps/core/src/modules/library/clients/file-service.client.ts` (upload 추가), inventory 모듈 등록 파일
- Test: `apps/core/src/modules/inventory/sku-3d-workshop/sku-3d-workshop.integration.spec.ts`, `workshop-access.spec.ts`

**Interfaces:**
- Consumes: Task 1 테이블, Task 2 권한.
- Produces:
  - `FileServiceClient.upload(input: { bytes: Uint8Array; fileName: string; mimeType: string; contextId: string; isPublic: boolean; onBehalfOf: string }): Promise<{ fileId: string }>` (위임 토큰, multipart `files/upload`)
  - `workshopActorOf(user): { userId: string; label: string; canManage: boolean; canPublish: boolean }` (`workshop-access.ts`, 권한은 `PermissionCheckpoints.check` 로)
  - `Sku3dWorkshopManager.open(skuId, actor, tx?) → Workshop` — `INSERT … ON CONFLICT (sku_id, owner_id) DO NOTHING` 후 select. tenantId 는 CLS `TENANT_CONTEXT_KEY`.
  - `Sku3dWorkshopManager.confirmDimensions(workshopId, actor, basis: Sku3dDimensionBasis) → Job` — basis 저장 + create 작업이 없으면 queued 생성, 있으면 그 작업 반환. unique 위반(23505)은 기존 활성 작업 select 로 흡수.
  - `Sku3dWorkshopManager.postMessage(workshopId, actor, body: string) → Job` — 활성 작업 있으면 `ConflictError('지금 만들고 있어요. 끝나면 다시 보내 주세요')`, 완성 revision 없으면 `BadRequestError`, 아니면 user_message 이벤트 + revise 작업(base = 최신 revision) 한 tx.
  - `Sku3dWorkshopReader.detail(workshopId, actor) → WorkshopDetailDto` { workshop, sku{ id, code, name, packageWidthMm, packageLengthMm, packageHeightMm, packageWeightG, photos[{fileId, sortOrder}] }, activeJob|null, revisions[{ id, number, glbSha256, glbBytes, review, createdAt, publishedAt }], worker{ online: boolean, lastSeenAt|null } }. online = 미폐기 워커 중 last_seen_at 이 60초 이내.
  - `Sku3dWorkshopReader.events(workshopId, actor, afterSeq: number) → { events: EventDto[]; activeJob: JobDto|null }` (최대 200개, seq 오름차순)
  - `Sku3dWorkshopReader.revisionFile(workshopId, revisionId, actor, kind: 'glb' | `render-${number}`) → stream` (`FileServiceClient.fetchFile(fileId, ownerId)`)
  - 접근 규칙: owner 이거나 canManage. 아니면 `NotFoundError`(존재 숨김).
- Routes (`@Controller('inventory/sku-3d-workshops')`):
  - `POST skus/:skuId` open — `inventory.model_workshop.write`
  - `GET :id` detail, `GET :id/events?afterSeq=` , `GET :id/revisions/:revisionId/files/:kind` — `inventory.model_workshop.read`
  - `PUT :id/dimensions` {basis}, `POST :id/messages` {body ≤ 2000자} — `inventory.model_workshop.write`

- [ ] **Step 1: 통합 스펙 작성(실패 확인)** — Testcontainers, 최소 `skus`·`sku_reference_photos`·`sku_3d_models` 테이블 + 이 마이그 SQL 적용. 테스트:
  - `open is idempotent` — 같은 (sku, user) 로 open 3번 병렬 → 작업실 1행, 같은 id.
  - `separate workshop per owner` — 다른 user 로 open → 다른 id.
  - `confirmDimensions twice creates one job` — 2번 병렬 → jobs 1행 queued.
  - `rejects message while job active` — 활성 작업 중 postMessage → ConflictError, jobs 1행.
  - `hides other owner workshop` — 다른 user(canManage false) detail → NotFoundError; canManage true → 성공.
  - `events after cursor` — 이벤트 5개 중 afterSeq=2 → seq 3,4,5.
- [ ] **Step 2:** `REQUIRE_SKU_3D_WORKSHOP_DB=1 npx jest apps/core/src/modules/inventory/sku-3d-workshop --runInBand` → FAIL(모듈 없음).
- [ ] **Step 3:** 위 Interfaces 대로 구현. 컨트롤러는 `@User()` 로만 사용자를 받는다(body 의 userId 없음).
- [ ] **Step 4:** 같은 명령 PASS + `npx jest scripts/security/route-classification.spec.ts --runInBand` PASS.
- [ ] **Step 5:** 커밋 `[core] 3D 작업실 열기·치수 확인·채팅·이벤트 API 를 추가한다`.

---

### Task 4: core 워커 API

**Files:**
- Create: `apps/core/src/modules/inventory/sku-3d-workshop/worker/{sku-3d-worker.controller.ts, sku-3d-worker-key.guard.ts, sku-3d-worker.manager.ts, sku-3d-worker.dto.ts}`
- Create: `scripts/sku-3d-worker/new-key.mjs` (키 생성기)
- Test: `worker/sku-3d-worker.integration.spec.ts`, `worker/sku-3d-worker-key.guard.spec.ts`

**Interfaces:**
- Consumes: Task 3 테이블 접근, `FileServiceClient.upload`.
- Produces (워커가 쓰는 HTTP 계약, 전부 `Authorization: Bearer <키>`, `x-tenant-id`):
  - `POST /inventory/sku-3d-worker/claim` → `{ job: { id, leaseToken, kind, workshopId, attempt } } | { job: null }`. lease 120초. 워커 동시 실행 수가 max_concurrency 이상이면 null.
  - `POST …/jobs/:id/heartbeat` {leaseToken} → 204 / 409
  - `POST …/jobs/:id/session` {leaseToken, sessionId} → 204 / 409(작업실에 다른 세션 id)
  - `POST …/jobs/:id/events` {leaseToken, items:[{type:'progress'|'status', body}]} → 204 / 409
  - `GET …/jobs/:id/inputs?leaseToken=` → { sku{code,name,dims,basis}, photos[{fileId, sortOrder, url}], request, sessionId|null, iteration, base{ number, files: {name,url}[] } | null }
  - `POST …/jobs/:id/files` multipart(file, leaseToken) → { fileId, sha256, bytes } — core 가 sha256 을 계산, 작업실 owner 대신 `sku-3d-workshop` 비공개로 올리고 job.uploads 에 추가. 50MB 초과 413.
  - `POST …/jobs/:id/complete` {leaseToken, glb: fileId, renders: fileId[], python, blend, plan, review: Sku3dRevisionReview, provenance} → { revisionId } / 409. 모든 fileId 가 job.uploads 에 있어야 한다. GLB 가 2,097,152 바이트 초과면 400.
  - `POST …/jobs/:id/fail` {leaseToken, error, retryable: boolean} → 204. retryable 이고 attempts < 3 이면 queued 로 되돌림.
  - 모든 워커 호출이 `sku_3d_workers.last_seen_at = now()`.
- 가드: `Authorization` 키 sha256 으로 `sku_3d_workers` 조회(revoked_at null), 없으면 401. 키 원문은 로그에 안 남긴다. `request.sku3dWorker = { id, maxConcurrency }`.
- Claim SQL(펜싱): bulk-session 과 같은 꼴.
```sql
UPDATE sku_3d_workshop_jobs SET status='running', lease_token=$token, lease_until=now()+interval '120 seconds',
  attempts=attempts+1, worker_id=$worker, started_at=coalesce(started_at, now())
WHERE id = (SELECT id FROM sku_3d_workshop_jobs
  WHERE (status='queued' OR (status='running' AND lease_until < now())) AND attempts < 3
  ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *
```
  claim 전에 `status='running' AND lease_until < now() AND attempts >= 3` 을 failed + status 이벤트로 닫는다.
- `new-key.mjs --name <hostId> --env-file <보호된 설정 파일>`: 홈 PC 에서 실행한다. 32바이트 랜덤 키를 만들어 설정 파일의 `SKU3D_WORKER_KEY=` 줄에 바로 쓰고(화면·로그 출력 없음), Windows 면 `icacls` 로 그 파일을 현재 사용자만 읽게 한다. 출력은 `INSERT INTO sku_3d_workers (name, key_hash) VALUES ('<hostId>', '<sha256>');` 한 줄뿐 — 해시라 채팅에 붙여도 키는 드러나지 않는다. 그 INSERT 를 서버 DB(개발은 로컬, 운영은 터널)에서 실행하면 등록 끝. 폐기는 `UPDATE sku_3d_workers SET revoked_at = now() WHERE name = '<hostId>'`.

- [ ] **Step 1: 통합 스펙(실패 확인)**
  - `claim is exclusive` — queued 1개, claim 5번 병렬 → 1개만 job.
  - `reclaims expired lease and fences old token` — claim → lease_until 을 과거로 → 재 claim 새 토큰, attempts 2 → 옛 토큰 heartbeat 409.
  - `rejects late complete after reclaim` — 옛 토큰 complete → 409, revision 0개.
  - `fails after three attempts` — attempts 3 + 만료 → claim 시 failed, job null.
  - `browser disconnect does not cancel` — 화면 쪽 호출이 하나도 없어도 running 작업은 lease 만 보고 진행(취소 경로 없음 확인).
  - `session id is write-once` — 세션 A 저장 후 B → 409, A 유지.
  - `complete requires uploaded files` — job.uploads 에 없는 fileId → 400.
  - `respects max concurrency` — max 1, running 1개 있을 때 claim → null.
  - 가드 스펙: 잘못된 키 401, 폐기 키 401, 올바른 키 통과.
- [ ] **Step 2:** FAIL 확인(위 Task 3 명령과 같은 경로).
- [ ] **Step 3:** 구현. file 업로드는 `FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } })`.
- [ ] **Step 4:** PASS + route-classification PASS.
- [ ] **Step 5:** 커밋 `[core] 3D 작업실 홈 PC 워커용 대기열 API 와 키를 추가한다`.

---

### Task 5: 승인 → 공개

**Files:**
- Modify: `apps/core/src/modules/inventory/sku-3d-models/sku-3d-models.manager.ts` (`register`·`publish` 에 `tx?: DbTx`)
- Modify: `sku-3d-workshop.manager.ts`, `.controller.ts`, module imports(`Sku3dModelsModule` export manager)
- Test: `sku-3d-workshop.integration.spec.ts` 에 추가, 기존 `sku-3d-models.manager.spec.ts`

**Interfaces:**
- Produces: `POST /inventory/sku-3d-workshops/:id/revisions/:revisionId/approve { glbSha256 }` — `inventory.model_workshop.write` + 본문에서 `inventory.master.write` 확인(`PermissionCheckpoints.check`). owner 만. → `{ revisionId, sku3dModelId, version, publishedAt }`.
- `Sku3dWorkshopManager.approve(workshopId, revisionId, glbSha256, actor)`:
  1. revision select, sha 불일치 → `ConflictError('보고 있는 버전이 바뀌었어요')`.
  2. publishedAt 있으면 그대로 반환.
  3. publicGlbFileId 없으면 `fetchFile(glbFileId, ownerId)` 바이트 → `upload({contextId:'sku-3d-model', isPublic:true, mimeType:'model/gltf-binary', onBehalfOf: actor.userId})` → `UPDATE … SET public_glb_file_id WHERE id AND public_glb_file_id IS NULL`.
  4. 한 tx: revision `FOR UPDATE` → sku3dModelId 없으면 `register(skuId, {status:'draft', glbFileId: public, notes:{ workshopId, revisionId, glbSha256 }}, actor.userId, actor.label, trx)` 후 기록 → publishedAt 없으면 `publish(modelId, actor.userId, trx)` 후 approved_*·published_at 기록 → status 이벤트.

- [ ] **Step 1: 스펙(실패 확인)** — FileServiceClient 는 가짜(업로드 id 를 차례로 돌려줌, 호출 횟수 기록), 투영은 기존 통합 스펙처럼 최소 테이블.
  - `rejects stale hash` — 다른 sha → ConflictError, upload 0회, sku_3d_models 0행.
  - `approve publishes once` — 2번 연속 → sku_3d_models 1행 approved, upload 1회.
  - `retry after failure creates one version` — publish 를 1회 실패시키고 재시도 → sku_3d_models 1행, approved 1개.
  - `keeps previous public model until publish` — 기존 v1 approved 상태에서 4단계 전에 실패 → v1 approved 유지.
  - `only owner approves` — canManage 인 다른 user 의 승인 → `ForbiddenError('작업실 주인만 승인할 수 있어요')`, upload 0회.
- [ ] **Step 2:** FAIL 확인.
- [ ] **Step 3:** 구현. 기존 register/publish 의 `this.db.run(..., tx)` 로만 바꾸고 본문은 그대로.
- [ ] **Step 4:** `npx jest apps/core/src/modules/inventory/sku-3d-models apps/core/src/modules/inventory/sku-3d-workshop --runInBand` PASS(DB 가드 켜고 한 번, 끄고 한 번).
- [ ] **Step 5:** 커밋 `[core] 3D 작업실 승인을 기존 등록·공개 순서로 한 번만 반영한다`.

---

### Task 6: 홈 PC 워커

**Files:**
- Create: `scripts/sku-3d-worker/{package.json, worker.mjs, api.mjs, codex-run.mjs, judge.mjs, viewer-check.mjs, env.mjs, review.schema.json, prompts/AGENTS.md, README.md, .env.example}`
- Test: `scripts/sku-3d-worker/*.test.mjs` (`node --test`)

**Interfaces:**
- Consumes: Task 4 HTTP 계약.
- 실행: `node --env-file=<설정 파일> scripts/sku-3d-worker/worker.mjs` (Node 22 내장, 의존성 설치·빌드 없음).
- 설정(env). 홈 PC 준비 파일 필드와의 대응을 README 에 표로 둔다:
  - `SKU3D_SERVER_URL` ← serverBaseUrl. 운영 `https://core.almondyoung.com`, 개발은 그때 띄운 임시 터널 주소. 운영 주소가 아니면 시작 로그 첫 줄에 `임시 개발 연결: <URL>`.
  - `SKU3D_TENANT_ID`, `SKU3D_WORKER_KEY`(보호된 설정 파일에만), `SKU3D_HOST_ID` ← hostId(로그·워커 이름용)
  - `SKU3D_WORK_ROOT` ← jobRoot, `CODEX_BIN` ← codexExecutable, `BLENDER_PATH` ← blenderExecutable, `NODE_BIN` ← nodeExecutable, `GLTF_TRANSFORM_CLI` ← gltfTransformCli, `GLTF_VALIDATOR_CLI`(설치된 gltf-validator 의 bin 경로), `EDGE_BIN`(웹 뷰어 확인용, 기본 `C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`)
  - `SKU3D_CONCURRENCY`(기본 1), `SKU3D_POLL_MS`(기본 5000)
- 프로세스 실행은 전부 `spawn(bin, args, { shell: false, windowsHide: true })`. 작업자 요청문·프롬프트는 stdin 으로만 넣고 명령 문자열에 붙이지 않는다. 제작 중 `npx -y` 금지 — 압축·검증은 `NODE_BIN` + `GLTF_TRANSFORM_CLI` / `GLTF_VALIDATOR_CLI`.
- `childEnv(process.env) → object` (`env.mjs`): 허용 목록 키만 복사(PATH, SystemRoot, USERPROFILE, HOME, APPDATA, LOCALAPPDATA, TEMP, TMP, CODEX_HOME, BLENDER_PATH, NODE_BIN, GLTF_TRANSFORM_CLI). SKU3D_* 는 하나도 넘기지 않는다.
- `codexArgs({ sessionId, workdir, schemaPath, images }) → string[]`: 세션 없으면 `['exec','--json','-s','workspace-write','-C',workdir,'--skip-git-repo-check','--output-schema',schemaPath,...images.flatMap(i=>['-i',i]),'-']`, 있으면 `['exec','resume',sessionId,'--json','-s','workspace-write','-C',workdir,'--skip-git-repo-check','-']`(resume 은 `-i` 가 프롬프트를 삼키므로 이미지 경로는 프롬프트에 적는다). `--last`·`--ephemeral` 금지. 0.166 에서 플래그가 다르면 Windows 실측(Task 8)에서 맞춘다.
- 지시문(`prompts/AGENTS.md`)에 더하는 규칙: Blender 는 `"%BLENDER_PATH%" -b --python-exit-code 1 -P build.py`, 압축은 `"%NODE_BIN%" "%GLTF_TRANSFORM_CLI%" optimize …`, 원본 사진(`inputs/photos`)은 수정 금지·보정은 `work/` 파생 파일, 자동 수정 최대 2회는 이번 revision 안의 한도, 포장 치수를 본체 치수로 확정하지 말고 추정 축척이면 근거·불확실성을 `assumptions` 에.
- `judgeOutputs(iterDir) → { ok: true, files } | { ok: false, reason }` (`judge.mjs`): model.glb 존재, 크기 ≤ 2,097,152, glTF JSON 청크에 외부 `uri` 없음, `GLTF_VALIDATOR_CLI` 오류 0(결과 JSON 을 provenance 에), review.json 스키마 필수 키, renders 6장.
- `viewerCheck(glbPath) → { ok, screenshot }` (`viewer-check.mjs`): 워커(Codex 아님)가 `EDGE_BIN --headless --screenshot` 으로 model-viewer(배경 #c6c6c6, `camera-orbit 0deg 75deg 150%`) 페이지를 찍고, 화면이 배경 단색만이 아닌지(픽셀 분산) 확인. 스크린샷은 `viewer-0.png` 로 업로드해 사람 비교용으로 남긴다. 실패하면 judge 실패.
- review.json 에 `verdict: 'ready_for_review' | 'needs_revision' | 'needs_photos'` 를 더한다(오류가 남았거나 자료가 부족하면 그 값). 화면은 이 값을 배지로 보여 주되 승인 여부는 사람이 정한다.
- 루프: claim → inputs → 폴더 준비(사진 다운로드, `AGENTS.md` 복사, `inputs/product.json`, `inputs/request.md`) → codex 실행(JSONL 줄마다 `thread.started` → session 보고, item 완료 → progress 이벤트 요약 1줄) → 30초 heartbeat, 409 면 자식 kill → judge → 파일 업로드 → complete. 예외는 fail(retryable: 판정 실패·Codex 비정상 종료 true, 4xx false).
- 시작 시 복구: 로컬 상태는 믿지 않는다. 서버 lease 가 끝나면 재 claim 되고, 세션 id 는 서버가 inputs 로 돌려준다.

- [ ] **Step 1: 테스트(실패 확인)** — `node --test scripts/sku-3d-worker`
  - `childEnv drops worker key and server url`
  - `codexArgs never uses --last` (두 경우 모두 `--last` 없음, resume 에 sessionId 위치 확인)
  - `judge rejects oversize glb` / `judge rejects external uri` / `judge accepts valid sample` (작은 GLB 픽스처를 테스트 안에서 바이트로 조립)
  - `heartbeat 409 kills child` (가짜 서버 + `node -e "setInterval(()=>{},1000)"` 자식)
- [ ] **Step 2:** FAIL 확인.
- [ ] **Step 3:** 구현. `prompts/AGENTS.md` 는 대화에서 사용자에게 보인 Codex 지시문 원본.
- [ ] **Step 4:** `node --test scripts/sku-3d-worker` PASS.
- [ ] **Step 5:** 커밋 `[scripts] 3D 작업실 홈 PC 워커를 추가한다`.
- [ ] **Step 6:** Windows 쪽 Codex 용 인계문(브랜치·커밋 SHA·주소·env·키 발급·시작/중지·연결 확인)을 채팅으로 준다. 브랜치 push 는 사용자 지시 후.

---

### Task 7: admin-web 작업실 화면 + 진입 버튼

**Files:**
- Create: `apps/admin-web/src/app/mobile/sku-3d-workshop/[skuId]/page.tsx`, `apps/admin-web/src/features/inventory/sku-3d-workshop/{workshop-view.tsx, workshop-model.ts, workshop-model.spec.ts}`, `apps/admin-web/src/lib/api/domains/inventory/sku-3d-workshop.client.ts`
- Modify: `components/sku-3d-actions.tsx`(지피티로 가기 → 3D 작업실 링크, handoff 코드 삭제), `model-handoff.ts`(buildModelPrompt·chatGptAppUrl·photoUrlsOf·handoffBlockedReason 삭제, 스펙 정리), `app/mobile/sku-field-capture/[skuId]/page.tsx`, `mine/page.tsx`(링크), `mount-model-viewer.ts`(`touchAction` 옵션), `lib/auth/screen-access.ts`, `lib/pii/pii-screens.ts`(PII_SCREEN_NOT_SHOWN), DTO 타입 파일
- Test: `workshop-model.spec.ts`, `sku-3d-actions.spec.tsx` 갱신, 게이트 스펙(screen-access, pii-screens, mutation-guard)

**Interfaces:**
- Consumes: Task 3·5 라우트.
- `workshopStatusText(detail) → string`: 워커 offline 이면 `작업 PC 가 꺼져 있어요. 요청은 대기열에 남아요`, activeJob queued `순서를 기다리고 있어요`, running `만들고 있어요`, 아니면 빈 문자열.
- `viewerRevision(revisions, selectedId) → Revision | null`: 고른 버전, 없으면 가장 큰 number(진행 중에도 이전 완성 버전). 새 버전이 생겨도 고른 버전은 바뀌지 않는다 — 승인은 화면에 떠 있는 그 버전으로만.
- 버전 비교: 두 버전을 골라 뷰어 두 개를 위아래로(휴대전화) 놓고 각 review.summary·verdict 를 함께 표시.
- assistant_message(review.summary + proposals)는 작업 완료 즉시 채팅에 뜬다(폴링으로 도착).
- `mergeEvents(prev, incoming) → Event[]`: seq 로 중복 제거·정렬.
- 폴링: `useQuery(['sku-3d-workshop', id, 'events'])` 2초, 이전 커서 다음부터. 상세는 activeJob 이 바뀌면 무효화.
- 뮤테이션 훅마다 `.permission` 선언(open/dimensions/messages: use, approve: use+master.write).
- 진입: 실측 상세·작업 기록·사진 모아보기에 `<Link href={`/mobile/sku-3d-workshop/${skuId}`}>3D 작업실</Link>`. 페이지가 mount 시 open(POST) — 멱등이라 새로고침·연타 안전.
- 뷰어: `mountModelViewer(container, { src: '/api/proxy/api/inventory/sku-3d-workshops/<id>/revisions/<rid>/files/glb', touchAction: 'pan-y', … })`, auto-rotate 끔.
- 승인 버튼 문구: `승인하고 아몬드영에 반영`, 확인 창에 `v<number> · <sha 앞 8자>` 표시, 요청에 그 revisionId·sha 를 보낸다.

- [ ] **Step 1: 스펙(실패 확인)** — `workshop-model.spec.ts`: `viewerRevision keeps last finished while running`, `mergeEvents dedupes by seq`, `workshopStatusText offline worker`. `sku-3d-actions.spec.tsx`: 버튼 이름 `3D 작업실`, href 확인, `codex://` 없음.
- [ ] **Step 2:** `npm run test:admin-web -- workshop-model sku-3d-actions --maxWorkers=2` FAIL.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** 같은 명령 + 게이트 스펙 PASS, `npm run type-check`.
- [ ] **Step 5:** 로컬 브라우저(사용자 크롬, 모바일 폭)에서 드래그 회전·두 손가락 확대·세로 스크롤 확인 스크린샷.
- [ ] **Step 6:** 커밋 `[admin-web] 실측 화면에서 3D 작업실을 열어 대화·버전·승인을 한다`.

---

### Task 8: 전체 연결 실측 + Windows 인계 문서

**Files:**
- Create: `scripts/sku-3d-worker/WINDOWS.md` (설치·키 발급·작업 스케줄러·중지·운영 전환·격리 실측 절차)
- Create: `docs/superpowers/plans/2026-11-25-sku-3d-workshop-verification.md` (실측 기록)

- [ ] **Step 1 (개발 검증, 임시 개발 연결):** 로컬 스택 기동 → 맥 core 를 Cloudflare 임시 터널로 노출 → 키 발급(new-key.mjs, INSERT 는 로컬 DB) → 홈 PC 에서 워커 실행(사용자가 홈 PC 에서 명령 실행).
- [ ] **Step 2:** 실측 항목을 하나씩 기록: 첫 생성 실제 GLB, 새로고침·재로그인 복원, 버튼 연타, 다른 작업자 격리, 수정 채팅 → 같은 세션 resume(세션 id 동일 확인), 생성 중 이전 버전 보임, 홈 PC 절전/워커 강제 종료 → lease 만료 후 재 claim 과 resume, 늦은 결과 409, 다른 해시 승인 거절, 공개 재시도 1버전.
- [ ] **Step 3 (격리):** Codex 에게 작업 폴더 밖 파일(워커 .env, 다른 작업실 폴더) 읽기·쓰기를 시키는 테스트 프롬프트 → 거부되는지 기록. 안 되면 전용 Windows 로컬 사용자로 워커 실행안을 적용하고 다시 실측.
- [ ] **Step 4:** 사용자에게 개발 검증 결과 보고(개발 검증 완료로만 표시).
- [ ] **Step 5 (운영 연결, 사용자 승인 후):** deploy:preflight → 운영 마이그(expand: migrate → deploy) → file_contexts 라이브 INSERT → `--target` 으로 Core·file-service·admin-web 배포 → 운영 DB 에 워커 키 INSERT → 홈 PC `SKU3D_SERVER_URL` 을 운영 주소로 → 운영 실측 1건 → 운영 연결 완료 보고.

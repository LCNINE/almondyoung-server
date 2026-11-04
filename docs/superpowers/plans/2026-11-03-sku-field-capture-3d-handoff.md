# 실측 사진 → ChatGPT → GLB 등록 구현 계획

> 2026-11-04 변경: Task 4(Chrome 확장)는 구현 뒤 설치 부담으로 접고 ChatGPT 앱 딥링크로 바꿨다. 현재 동작은 스펙 §3 을 따른다.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 실측 작업 현황 사진 카드에 `지피티로 가기`·`GLB 업로드`·`상세` 버튼과 3D 상태를 붙이고, 사진·프롬프트를 ChatGPT 에 넣어 주는 Chrome 확장을 만든다.

**Architecture:** admin-web 은 순수 함수 파일 하나(프롬프트·검증)와 카드 액션 컴포넌트 하나를 더하고 기존 core `sku-3d-models` API 와 file-service 업로드를 그대로 쓴다. 확장은 빌드 없는 MV3 로, 어드민 페이지의 `postMessage` 를 받아 백그라운드가 사진을 모으고 ChatGPT 탭의 파일 입력·입력창에 넣는다. 백엔드·스토어프론트 변경 없음.

**Tech Stack:** Next.js(admin-web), react-query, sonner, shadcn `alert-dialog`/`tooltip`, Jest(ts-jest), Chrome MV3 순수 JS, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-03-sku-field-capture-3d-handoff-design.md`

## Global Constraints

- 작업 위치는 메인 체크아웃의 브랜치 `feat/sku-3d-handoff` (사용자 지시로 워크트리 대신).
- 커밋은 사용자가 명시적으로 요청할 때만. 각 태스크 끝의 Commit 단계는 사용자 승인 뒤에 한다.
- 화면 문구는 해요체, 한 문장 한 메시지. 꺾쇠·낫표 같은 특수 인용부호 금지. 주황 텍스트 금지.
- 설명 주석 금지(번역·로직 흐름 한 줄만 예외). 주석에 이슈 번호 금지. 논리 단위 사이 빈 줄, return 앞 빈 줄, 한 줄 for-if 금지.
- `any`·`as` 캐스팅 금지(근거 없이).
- jest 는 항상 `--maxWorkers=2`.
- file-service 컨텍스트 id `'sku-3d-model'`, 공개(`isPublic: true`), 상한 20 MiB(`20 * 1024 * 1024`), MIME `model/gltf-binary`.
- 등록 API: `GET /inventory/sku-3d-models/skus/:skuId`(버전 내림차순 배열), `POST /inventory/sku-3d-models/skus/:skuId` `{ glbFileId, status: 'approved' }`. 권한 `inventory.master.write`.
- 상세 이동: `/inventory/skus?code=<encodeURIComponent(code)>` 새 탭.
- 확장 허용 오리진: `https://admin.almondyoung.com`, `http://localhost:8002`. 허용 사진 경로 접두사 `/api/proxy/file/files/public/`.
- 치수 매핑: 가로 = `packageWidthMm`, 세로 = `packageLengthMm`, 높이 = `packageHeightMm`, 무게 = `packageWeightG`.

## Review Focus

- 사진 0장인 SKU 에서 `지피티로 가기`: 버튼이 막히고 이유가 보여야 한다(Task 1 `handoffBlockedReason` 테스트).
- 치수가 0 이거나 null: null 은 누락, 0 도 누락으로 본다(Task 1 테스트).
- 확장자가 `.GLB` 대문자이거나 `file.type` 이 빈 문자열: 통과하고 MIME 이 `model/gltf-binary` 로 보정돼야 한다(Task 1 테스트).
- 다른 오리진에서 온 `postMessage`, 허용 경로 밖 URL(`/api/proxy/file/files/private/..`, 다른 호스트): 확장이 무시해야 한다(Task 4 테스트).
- 업로드 확인창에서 취소: 업로드·등록 요청이 하나도 나가면 안 된다(Task 3 수동 확인, 코드상 업로드는 확인 버튼 핸들러 안에서만 시작).

---

### Task 1: 프롬프트·검증 순수 함수

**Files:**
- Create: `apps/admin-web/src/features/inventory/sku-field-capture/model-handoff.ts`
- Test: `apps/admin-web/src/features/inventory/sku-field-capture/model-handoff.spec.ts`

**Interfaces:**
- Consumes: `FieldCaptureDetailDto` (`@/lib/types/dto/inventory`), `resolvePublicFileUrl` (`@/lib/utils/file-url`)
- Produces:
  - `export const GLB_MAX_BYTES = 20 * 1024 * 1024`
  - `export const GLB_MIME = 'model/gltf-binary'`
  - `export function handoffBlockedReason(detail: FieldCaptureDetailDto): string | null` — 사진 0장이면 `'찍은 사진이 없어요'`, 치수·무게 중 null 또는 0 이 있으면 `'실측 정보가 비어 있어요 (가로, 무게)'` 처럼 빠진 항목 이름을 `가로·세로·높이·무게` 순서로 `, ` 로 이어 괄호에. 다 있으면 `null`.
  - `export function buildModelPrompt(detail: FieldCaptureDetailDto): string` — 스펙 §2 본문 그대로, 자리표시자 치환. 사진 수는 `detail.photos.length`.
  - `export function photoUrlsOf(detail: FieldCaptureDetailDto, origin: string): string[]` — `photos` 를 `sortOrder` 오름차순으로, `new URL(resolvePublicFileUrl(fileId)!, origin).href`.
  - `export function glbFileProblem(file: { name: string; size: number }): string | null` — 확장자(대소문자 무시)가 `.glb` 가 아니면 `'GLB 파일만 올릴 수 있어요'`, `size > GLB_MAX_BYTES` 면 `'20MB 이하 파일만 올릴 수 있어요'`.
  - `export function asGlbFile(file: File): File` — `new File([file], file.name, { type: GLB_MIME })`.
  - `export type Sku3dModelDto = { id: string; skuId: string; version: number; glbFileId: string | null; status: 'approved' | 'needs_revision' | 'needs_more_photos' | 'failed'; createdAt: string }` (이 파일이 아니라 `lib/types/dto/inventory.ts` 끝에 export)
  - `export function modelSummary(models: Sku3dModelDto[]): { publishedVersion: number | null; nextVersion: number }` — `publishedVersion` 은 가장 높은 version 의 approved 행이 있으면 그 version(배열 순서에 기대지 않고 max 로), `nextVersion` 은 전체 max version + 1(없으면 1).

- [ ] **Step 1: 실패하는 테스트 작성** — `model-handoff.spec.ts`. 테스트용 `detail(overrides)` 팩토리(가로 120, 세로 80, 높이 45, 무게 210, 사진 2장 sortOrder 2·1, code `'SKU-1'`, name `'테스트 상품'`).

```ts
it('fills the prompt with values', () => {
  const p = buildModelPrompt(detail());
  expect(p.startsWith('첨부한 상품 사진 2장과 실측 정보를 참고해\n')).toBe(true);
  expect(p).toContain('상품명: 테스트 상품\nSKU: SKU-1\n가로: 120mm\n세로: 80mm\n높이: 45mm\n무게: 210g');
  expect(p).toContain('3. 전체 외곽 치수는 120×80×45mm로 맞추고,');
  expect(p).not.toMatch(/\{/);
});
it('blocks when no photos', () => expect(handoffBlockedReason(detail({ photos: [] }))).toBe('찍은 사진이 없어요'));
it('names missing measurements, zero counts as missing', () =>
  expect(handoffBlockedReason(detail({ packageWidthMm: null, packageWeightG: 0 }))).toBe('실측 정보가 비어 있어요 (가로, 무게)'));
it('passes complete detail', () => expect(handoffBlockedReason(detail())).toBeNull());
it('orders photo urls by sortOrder as absolute urls', () =>
  expect(photoUrlsOf(detail(), 'http://localhost:8002')).toEqual([
    'http://localhost:8002/api/proxy/file/files/public/f1',
    'http://localhost:8002/api/proxy/file/files/public/f2',
  ]));
it('accepts uppercase .GLB, rejects others and oversize', () => {
  expect(glbFileProblem({ name: 'a.GLB', size: 10 })).toBeNull();
  expect(glbFileProblem({ name: 'a.gltf', size: 10 })).toBe('GLB 파일만 올릴 수 있어요');
  expect(glbFileProblem({ name: 'a.glb', size: GLB_MAX_BYTES + 1 })).toBe('20MB 이하 파일만 올릴 수 있어요');
});
it('forces the glb mime type', () => {
  const f = asGlbFile(new File(['x'], 'a.glb', { type: '' }));
  expect(f.type).toBe('model/gltf-binary');
  expect(f.name).toBe('a.glb');
});
it('summarises versions', () => {
  expect(modelSummary([])).toEqual({ publishedVersion: null, nextVersion: 1 });
  expect(modelSummary([m(1, 'approved'), m(3, 'failed'), m(2, 'approved')])).toEqual({ publishedVersion: 2, nextVersion: 4 });
});
```
(`sortOrder` 1 인 사진의 fileId 가 `f1`. `m(version, status)` 는 `Sku3dModelDto` 팩토리. `publishedVersion` 은 approved 중 최대.)

- [ ] **Step 2: 실패 확인** — `npm run test:admin-web -- --maxWorkers=2 model-handoff` → 모듈 없음으로 FAIL.
- [ ] **Step 3: 구현** — 위 시그니처대로. 프롬프트 본문은 스펙 §2 코드블록 글자 그대로(줄바꿈·들여쓰기 포함) 템플릿 리터럴로.
- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS.
- [ ] **Step 5: Commit (사용자 승인 뒤)** — `feat(admin-web): 실측 사진 3D 작업용 프롬프트와 GLB 검증 함수를 더한다`

### Task 2: 3D 모델 API 클라이언트·컨텍스트 상수

**Files:**
- Create: `apps/admin-web/src/lib/api/domains/inventory/sku-3d-models.client.ts`
- Modify: `apps/admin-web/src/lib/api/domains/files/upload.client.ts` (컨텍스트 상수 목록에 한 줄)

**Interfaces:**
- Consumes: `Sku3dModelDto` (Task 1), `client`(`../../client`), `ALMONDYOUNG_API_BASE_URL`(`@/const`)
- Produces:
  - `export const SKU_3D_MODEL_CONTEXT_ID = 'sku-3d-model'` (upload.client.ts)
  - `export const sku3dModelsClient = { list(skuId: string): Promise<Sku3dModelDto[]>; register(skuId: string, glbFileId: string): Promise<Sku3dModelDto> }` — `sku-field-capture.client.ts` 와 같은 꼴(`BASE = ${ALMONDYOUNG_API_BASE_URL}/inventory/sku-3d-models`, `encodeURIComponent`). `register` 본문은 `{ glbFileId, status: 'approved' }`.

- [ ] **Step 1: 구현** — 테스트 없음(배선만, Task 3 의 타입 검사가 잡는다).
- [ ] **Step 2: 타입 확인** — `npx tsc --noEmit -p apps/admin-web/tsconfig.json` → 새 에러 0.
- [ ] **Step 3: Commit (사용자 승인 뒤)** — Task 3 과 함께 묶어도 된다.

### Task 3: 카드 액션 컴포넌트와 갤러리 배선

**Files:**
- Create: `apps/admin-web/src/features/inventory/sku-field-capture/components/sku-3d-actions.tsx`
- Modify: `apps/admin-web/src/features/inventory/sku-field-capture/photo-gallery.tsx:126-133` (카드 머리줄에 `<Sku3dActions skuId={head.skuId} code={head.code} name={head.name} dims={head} />`, 머리줄 오른쪽 정렬은 `ml-auto` 래퍼)

**Interfaces:**
- Consumes: Task 1 전부, Task 2 `sku3dModelsClient`·`SKU_3D_MODEL_CONTEXT_ID`, `uploadFileToFileService`, `skuFieldCaptureClient.getDetail`, `fieldCaptureKeys.detail`, `useCan`(`@/hooks/use-permission`), `toast`(`sonner`), `AlertDialog*`(`@/components/ui/alert-dialog`), `Tooltip*`(`@/components/ui/tooltip`).
- Produces: `export function Sku3dActions(props: { skuId: string; code: string; name: string; dims: { packageWidthMm: number | null; packageLengthMm: number | null; packageHeightMm: number | null; packageWeightG: number | null } }): JSX.Element` — 갤러리는 `dims={head}` 로 넘긴다.
- 확장과의 메시지 계약(Task 4 와 공유):
  - 어드민 → 확장: `window.postMessage({ type: 'chatgpt-handoff', requestId: string, prompt: string, photoUrls: string[] }, window.location.origin)`
  - 확장 → 어드민: `window.postMessage({ type: 'chatgpt-handoff-result', requestId, ok: boolean, attached?: number, error?: string }, origin)`
  - 설치 표시: `document.documentElement.dataset.chatgptHandoff === '1'`

동작:
- 3D 상태: `useQuery(['sku-3d-models', skuId], () => sku3dModelsClient.list(skuId))` → `modelSummary`. `3D 공개 중 · v{n}` / `3D 없음`. 로딩 중엔 아무것도 안 보인다.
- `지피티로 가기`: 클릭 때 `queryClient.fetchQuery({ queryKey: fieldCaptureKeys.detail(skuId), queryFn: () => skuFieldCaptureClient.getDetail(skuId) })`. `handoffBlockedReason` 이 있으면 `toast.error(reason)` 하고 끝. (카드에선 `dims` 넷 중 null/0 이 있으면 버튼 disabled + Tooltip 에 `'실측 정보가 비어 있어요'`.)
  - 확장 없음: `toast.error('ChatGPT 연결 확장 프로그램을 먼저 설치해 주세요', { description: '설치 방법은 native/chatgpt-handoff-extension/README.md 에 있어요' })`.
  - 확장 있음: `requestId = crypto.randomUUID()` 로 postMessage, 결과 메시지를 `requestId` 로 기다린다(30초). `ok` 면 `toast.success('ChatGPT 에 사진 {attached}장을 넣었어요')`. 실패·시간 초과면 대체 경로: `navigator.clipboard.writeText(prompt)` 후 사진을 순서대로 `fetch(url, { cache: 'no-store' })` → blob → `<a download="{code}-{i+1}.{확장자}">` 클릭으로 내려받고 `toast.error('ChatGPT 에 바로 넣지 못했어요', { description: '프롬프트를 복사하고 사진을 내려받았어요. 직접 붙여 주세요' })`. 확장자는 blob.type 의 하위 타입(`image/jpeg` → `jpeg`), 모르면 `jpg`.
- `GLB 업로드`(공개 버전 있으면 `GLB 다시 올리기`): 숨긴 `<input type="file" accept=".glb,model/gltf-binary">`. 파일을 고르면 `glbFileProblem` → 있으면 `toast.error` 후 input 값 비우고 끝. 없으면 확인창 연다(파일을 고르기 전엔 절대 안 연다).
  - 확인창: 제목 `3D 모델을 공개할까요?`, 본문에 상품명, 파일 이름·용량(`(size / 1024 / 1024).toFixed(1)MB`), 버전 변화(공개 버전 있으면 `v{published} → v{next}`, 없으면 `v{next}`), 안내 `공개하면 판매 중인 상품 상세에 3D로 보기가 생겨요`. 버튼 `취소`·`공개하기`.
  - `공개하기` 만 `useMutation({ mutationFn, meta: { permission: ['inventory.master.write'] } })` 를 실행: `uploadFileToFileService(asGlbFile(file), { contextId: SKU_3D_MODEL_CONTEXT_ID, isPublic: true, compress: false })` → `sku3dModelsClient.register(skuId, uploaded.id)`. 성공: 목록 쿼리 무효화, `toast.success('v{version} 을 공개했어요')`. 실패: `toast.error` 에 서버 메시지(`errorMessageOf` from `../field-capture-model` 가 있으면 그것).
  - 쓰기 권한 판정: `useCan(['inventory.master.write'])` 가 ready·allowed 가 아니면 업로드 버튼 disabled.
- `상세`: `<a href={`/inventory/skus?code=${encodeURIComponent(code)}`} target="_blank" rel="noreferrer">상세</a>`.
- 버튼 꼴은 기존 카드의 `rounded border px-2 py-1 text-xs` 계열.

- [ ] **Step 1: 컴포넌트 구현과 갤러리 배선**
- [ ] **Step 2: 타입 확인** — `npx tsc --noEmit -p apps/admin-web/tsconfig.json` → 새 에러 0.
- [ ] **Step 3: 권한 게이트** — `npm run test:admin-web -- --maxWorkers=2 mutation-guard screen-access` → PASS.
- [ ] **Step 4: Task 1 회귀** — `npm run test:admin-web -- --maxWorkers=2 sku-field-capture` → PASS.
- [ ] **Step 5: 수동 확인(컨트롤러가 한다)** — 로컬 어드민 8002 `/inventory/sku-field-capture` 에서 카드 버튼 셋·상태 표시, 파일 고르기 전 확인창 안 뜸, 취소 시 네트워크 요청 없음, `.gltf` 거부.
- [ ] **Step 6: Commit (사용자 승인 뒤)** — `feat(admin-web): 실측 사진 카드에 ChatGPT 넘기기와 GLB 공개를 더한다`

### Task 4: Chrome 확장 프로그램

**Files:**
- Create: `native/chatgpt-handoff-extension/manifest.json`
- Create: `native/chatgpt-handoff-extension/rules.js`
- Create: `native/chatgpt-handoff-extension/rules.test.js`
- Create: `native/chatgpt-handoff-extension/admin.js`
- Create: `native/chatgpt-handoff-extension/background.js`
- Create: `native/chatgpt-handoff-extension/chatgpt.js`
- Create: `native/chatgpt-handoff-extension/README.md`

**Interfaces:**
- Consumes: Task 3 의 메시지 계약.
- Produces (`rules.js`, content script 전역과 CommonJS 둘 다로 노출: 끝에 `if (typeof module !== 'undefined') module.exports = { ... }`):
  - `ADMIN_ORIGINS = ['https://admin.almondyoung.com', 'http://localhost:8002']`
  - `isAdminOrigin(origin: string): boolean`
  - `isAllowedPhotoUrl(url: string): boolean` — URL 파싱 실패면 false, `origin` 이 `ADMIN_ORIGINS` 에 있고 `pathname` 이 `/api/proxy/file/files/public/` 로 시작해야 true.
  - `validHandoff(data: unknown): data is { type: 'chatgpt-handoff'; requestId: string; prompt: string; photoUrls: string[] }` — type 일치, requestId·prompt 문자열, photoUrls 가 비지 않은 배열이고 전부 `isAllowedPhotoUrl`.

구성:
- `manifest.json`: `manifest_version: 3`, name `아몬드영 ChatGPT 연결`, `background.service_worker: background.js`(module 아님, `importScripts('rules.js')`), `permissions: ['tabs', 'scripting']`, `host_permissions`: 두 어드민 오리진 `/*` + `https://chatgpt.com/*` + `https://*.amazonaws.com/*`(공개 사진이 S3 로 302). content_scripts: ① 어드민 두 오리진 `matches`, `js: ['rules.js', 'admin.js']`, `run_at: 'document_start'` ② `https://chatgpt.com/*`, `js: ['chatgpt.js']`, `run_at: 'document_idle'`.
- `admin.js`: `document.documentElement.dataset.chatgptHandoff = '1'`. `message` 리스너: `event.source !== window` 이거나 `!isAdminOrigin(event.origin)` 이거나 `!validHandoff(event.data)` 면 무시. `chrome.runtime.sendMessage({ kind: 'handoff', ...data })` 응답을 `window.postMessage({ type: 'chatgpt-handoff-result', requestId, ...응답 }, event.origin)` 로 돌려준다.
- `background.js`: `onMessage` 에서 `sender.origin` 을 `isAdminOrigin` 으로 다시 확인하고 `validHandoff` 재검사. 사진을 순서대로 `fetch(url, { cache: 'no-store' })` → `{ name: 'photo-{i+1}.{ext}', type, base64 }`. 하나라도 실패하면 `{ ok: false, error: '사진을 불러오지 못했어요' }`. `chrome.tabs.create({ url: 'https://chatgpt.com/' })` → `tabs.onUpdated` 로 `status === 'complete'` 대기 → `chrome.tabs.sendMessage(tabId, { kind: 'fill', prompt, files })` 의 응답 `{ ok, attached, error }` 를 그대로 돌려준다(`return true` 로 비동기 응답). 탭 대기 45초 초과면 `{ ok: false, error: 'ChatGPT 화면이 열리지 않았어요' }`.
- `chatgpt.js`: `fill` 메시지를 받으면 최대 20초 동안 200ms 간격으로 `input[type="file"][multiple]` 과 `[contenteditable="true"]`(id `prompt-textarea` 우선) 를 찾는다. 못 찾으면 `{ ok: false, error: 'ChatGPT 입력창을 찾지 못했어요' }`. 찾으면 base64 → `File` 로 `DataTransfer` 에 담아 `input.files = dt.files`, `input.dispatchEvent(new Event('change', { bubbles: true }))`. 입력창 `focus()` 후 `document.execCommand('insertText', false, prompt)`. 전송 버튼은 누르지 않는다. 3초 뒤 첨부 미리보기 수(선택자 상수 하나 `ATTACHMENT_SELECTOR`, 기본 `[data-testid*="attachment"], form img`)를 세고, 보낸 수보다 적으면 화면 오른쪽 위 고정 버튼 `남은 사진 N장 넣기` 를 띄워 남은 파일만 다시 넣는다. 응답 `{ ok: true, attached: 보낸 수 }`.
- `README.md`: 설치(`chrome://extensions` → 개발자 모드 → 압축해제된 확장 프로그램 로드 → 이 폴더), 갱신(폴더 갱신 후 새로고침 아이콘), 동작, 화면 개편으로 깨질 때 고칠 곳(`chatgpt.js` 선택자).

- [ ] **Step 1: 실패하는 테스트** — `rules.test.js`(`node:test` + `node:assert`):

```js
test('admin origins only', () => {
  assert.equal(isAdminOrigin('https://admin.almondyoung.com'), true);
  assert.equal(isAdminOrigin('http://localhost:8002'), true);
  assert.equal(isAdminOrigin('https://evil.example'), false);
  assert.equal(isAdminOrigin('http://localhost:8003'), false);
});
test('public photo path only', () => {
  assert.equal(isAllowedPhotoUrl('http://localhost:8002/api/proxy/file/files/public/abc'), true);
  assert.equal(isAllowedPhotoUrl('http://localhost:8002/api/proxy/file/files/private/abc'), false);
  assert.equal(isAllowedPhotoUrl('https://evil.example/api/proxy/file/files/public/abc'), false);
  assert.equal(isAllowedPhotoUrl('not a url'), false);
});
test('handoff shape', () => {
  const ok = { type: 'chatgpt-handoff', requestId: 'r', prompt: 'p', photoUrls: ['http://localhost:8002/api/proxy/file/files/public/a'] };
  assert.equal(validHandoff(ok), true);
  assert.equal(validHandoff({ ...ok, photoUrls: [] }), false);
  assert.equal(validHandoff({ ...ok, photoUrls: ['https://evil.example/x'] }), false);
  assert.equal(validHandoff({ ...ok, type: 'x' }), false);
  assert.equal(validHandoff(null), false);
});
```
- [ ] **Step 2: 실패 확인** — `node --test native/chatgpt-handoff-extension/rules.test.js` → FAIL.
- [ ] **Step 3: `rules.js` 구현** → 같은 명령 PASS.
- [ ] **Step 4: 나머지 파일 구현.** `manifest.json` 은 `node -e "JSON.parse(require('fs').readFileSync('native/chatgpt-handoff-extension/manifest.json','utf8'))"` 로 확인.
- [ ] **Step 5: 수동 확인(사용자와 함께)** — 확장 로드 → 로컬 어드민 8002 → 사진 6장 넘는 SKU `지피티로 가기` → ChatGPT 유료 계정 탭에 사진 전부·프롬프트, 전송 안 됨. 전송은 하지 않는다.
- [ ] **Step 6: Commit (사용자 승인 뒤)** — `feat: 어드민 사진과 프롬프트를 ChatGPT 에 넣는 Chrome 확장을 더한다`

### 마무리

- [ ] `npm run type-check` 새 에러 0, `npm run test:admin-web -- --maxWorkers=2` PASS, `node --test native/chatgpt-handoff-extension/rules.test.js` PASS.
- [ ] 브랜치 전체 리뷰.

# MD용 상품 일괄등록 양식 AI 스킬 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MD 직원이 Claude Desktop 에서 AI 에게 상품 일괄등록 양식 작성을 맡길 수 있게 하고, 그 과정에서 발생 가능한 카탈로그 대량 중복 사고를 서버에서 막는다.

**Architecture:** core 에 `P-\d{6}` 예약 상품키 가드를 넣어 숨은 시트를 잃은 워크북을 거부한다. 스킬은 `SKILL.md` + 레퍼런스 + 파이썬 스크립트 둘(`read_form.py` 는 시트를 상품 단위로 조인, `write_form.py` 는 원본 워크북에 **변경분만** 적용하고 fail-closed 자체 검사를 돈다)로 구성한다. 열 라벨은 `ALL_COLUMN_SETS` 에서 `columns.md`·`columns.json` 을 생성하고 jest 가 동기화를 강제해 드리프트를 0으로 만든다.

**Tech Stack:** NestJS · Drizzle · exceljs (core) / Next.js · TanStack Query (admin-web) / Python 3 + openpyxl (스킬 스크립트) / jest + pytest

## Global Constraints

- **마이그레이션 0건 · 시크릿 0건 · env 0건 · 이벤트 계약 0건.** 어느 하나라도 필요해지면 계획이 틀린 것이므로 멈추고 보고한다
- 계층 규칙: Controller → Service → Reader/Manager → Repository. Service 는 `HttpException`·drizzle·Express 타입을 import 하지 않는다
- 오류는 `@app/shared` 의 도메인 예외(`BadRequestError` 등)로 던진다. 컨트롤러는 try/catch 로 감싸지 않는다
- `any` / `as` 캐스팅 금지 (문서화된 정당화 없이)
- 스킬 스크립트의 파이썬 의존성은 **openpyxl 하나뿐**이다. 다른 패키지를 추가하지 않는다
- 사용자에게 보이는 모든 메시지는 한국어다
- 스킬 스크립트는 라벨 문자열을 하드코딩하지 않는다 — 항상 `columns.json` 에서 읽는다
- 검증 스코프 주의: `npm run lint`(전역 `--fix`)·전역 `tsc`·`nest build core` 는 이 저장소의 상시 debt 다. 검증은 **변경한 파일의 신규 오류만** 본다
- 커밋은 작업 단위로 자주 한다. 커밋 메시지 끝에 `Claude-Session: https://claude.ai/code/session_01N8ywbrCLv638UbquP3NUXs` 를 붙인다

## File Structure

| 파일 | 책임 |
|---|---|
| `apps/core/.../bulk-session/services/bulk-session.row-key.ts` | 예약 상품키 형식 판정 + 오류 문구. 매니저·접합기가 공유 |
| `apps/core/.../bulk-session/services/bulk-session.manager.ts` (수정) | 파일 수준 게이트 추가 |
| `apps/core/.../bulk-session/services/bulk-upload.assembler.ts` (수정) | 행 수준 게이트 추가 |
| `apps/core/.../bulk-session/services/form-export.columns-doc.ts` | `ALL_COLUMN_SETS` → `columns.md` / `columns.json` 생성 (순수 함수) |
| `skills/product-bulk-form/SKILL.md` | 진입점 — 절대 규칙·작업 흐름·버전 |
| `skills/product-bulk-form/references/columns.md` | ★생성물 |
| `skills/product-bulk-form/references/semantics.md` | 빈칸 의미·행 삭제·예약 키·수정 범위·전량 게이트 |
| `skills/product-bulk-form/references/workflow.md` | MD 가 admin-web 에서 밟는 절차 |
| `skills/product-bulk-form/references/recipes.md` | 세 유스케이스 |
| `skills/product-bulk-form/scripts/columns.json` | ★생성물 — 라벨↔키 매핑 |
| `skills/product-bulk-form/scripts/read_form.py` | xlsx → 상품 단위 JSON |
| `skills/product-bulk-form/scripts/write_form.py` | 원본 xlsx + 변경 JSON → 편집본 (+ 자체 검사) |
| `apps/admin-web/.../bulk-sessions/lib/error-report.ts` | 무효 행 → 붙여넣기용 텍스트 (순수 함수) |
| `apps/admin-web/.../review-panel/index.tsx` (수정) | 복사 버튼 배선 |
| `scripts/build-bulk-form-skill.mjs` | 스킬 zip 빌드 |
| `docs/manuals/일괄등록-AI-스킬-사용법.md` | MD 용 설치·사용 안내 |

---

### Task 0: 런타임 전제 실측 (사람이 수행 — 코드 작성 전 게이트)

스펙 §8 의 두 항목이다. **여기서 openpyxl 이 없고 설치도 막혀 있으면 Task 6~11 의 설계가 성립하지 않으므로** 스크립트를 쓰기 전에 확인한다.

**Files:**
- Modify: `docs/superpowers/specs/2026-08-04-product-bulk-form-md-skill-design.md` (§8 에 실측 결과 기록)

- [ ] **Step 1: Claude Desktop 에서 openpyxl 가용성 확인**

Claude Desktop 에서 코드 실행을 켠 뒤 다음을 그대로 요청한다:

> 파이썬으로 `import openpyxl; print(openpyxl.__version__)` 를 실행해서 결과를 알려줘.

기록할 것: 성공 여부, 버전. 실패하면 `pip install openpyxl` 이 되는지도 확인한다.

- [ ] **Step 2: 네트워크 접근 확인**

같은 곳에서 요청한다:

> 파이썬으로 `https://www.google.com/favicon.ico` 를 내려받아 파일 크기를 알려줘.

기록할 것: 성공 / 차단 / 부분 허용.

- [ ] **Step 3: 결과를 스펙 §8 에 기록**

§8 의 두 항목을 실측 결과 문장으로 바꾼다. 예:

```markdown
## 8. 런타임 실측 결과 (2026-08-__)

- openpyxl: **사전 설치됨 (3.1.5)** — 스크립트 기반 설계 성립
- 네트워크: **차단됨** — §3.7 의 대비책(다운로드 스크립트 생성) 경로가 기본이 된다
```

- [ ] **Step 4: 커밋**

```bash
git add docs/superpowers/specs/2026-08-04-product-bulk-form-md-skill-design.md
git commit -m "docs(spec): 일괄등록 스킬 런타임 전제 실측 결과 기록"
```

**⚠️ openpyxl 이 없고 설치도 불가하면 여기서 멈추고 보고한다.** Task 1~5, 12~13(core·admin-web)은 그대로 유효하므로 그것만 진행하고 스킬 부분은 재설계가 필요하다.

---

### Task 1: 예약 상품키 규칙 모듈

**Files:**
- Create: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.row-key.ts`
- Test: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.row-key.spec.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `isReservedRowKey(rowKey: string): boolean` · `RESERVED_ROW_KEY_WITHOUT_EXPORT_MESSAGE: string` · `reservedRowKeyUnresolvedMessage(rowKey: string): string`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`bulk-session.row-key.spec.ts`:

```typescript
import {
  isReservedRowKey,
  RESERVED_ROW_KEY_WITHOUT_EXPORT_MESSAGE,
  reservedRowKeyUnresolvedMessage,
} from './bulk-session.row-key';

describe('isReservedRowKey', () => {
  it('시스템 발급 형식(P- + 숫자 6자리)을 예약으로 본다', () => {
    expect(isReservedRowKey('P-000001')).toBe(true);
    expect(isReservedRowKey('P-999999')).toBe(true);
  });

  it('앞뒤 공백은 무시한다 — 엑셀 셀에서 흔히 섞인다', () => {
    expect(isReservedRowKey('  P-000001  ')).toBe(true);
  });

  it('자릿수가 다르면 예약이 아니다', () => {
    expect(isReservedRowKey('P-1')).toBe(false);
    expect(isReservedRowKey('P-0000001')).toBe(false);
  });

  it('사람이 지을 법한 키는 예약이 아니다', () => {
    expect(isReservedRowKey('NEW-001')).toBe(false);
    expect(isReservedRowKey('P-ABC123')).toBe(false);
    expect(isReservedRowKey('')).toBe(false);
  });
});

describe('오류 문구', () => {
  it('양식 정보 유실 문구는 재다운로드와 신규 키 대안을 둘 다 안내한다', () => {
    expect(RESERVED_ROW_KEY_WITHOUT_EXPORT_MESSAGE).toContain('양식을 다시');
    expect(RESERVED_ROW_KEY_WITHOUT_EXPORT_MESSAGE).toContain('P-000001');
  });

  it('미해석 문구는 문제의 상품키를 싣는다', () => {
    expect(reservedRowKeyUnresolvedMessage('P-000042')).toContain('P-000042');
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx jest --testPathPattern=bulk-session.row-key.spec -c package.json`
Expected: FAIL — `Cannot find module './bulk-session.row-key'`

- [ ] **Step 3: 최소 구현**

`bulk-session.row-key.ts`:

```typescript
/**
 * 시스템이 양식 프리필에 발급하는 상품키 형식.
 *
 * `form-export.snapshot.reader.ts:128` 이 `P-${seq.padStart(6,'0')}` 로 만든다. 이 형식을
 * **예약**으로 두는 이유는 두 가지다.
 *
 * (1) 워크북의 숨은 `_양식정보` 시트를 잃으면 `exportId` 가 사라지고, 업로드가 그 파일을
 *     "신규 전용 세션"으로 읽어 프리필 행 전량을 신규 상품으로 재생성한다
 *     (스펙 2026-08-04-product-bulk-form-md-skill-design §2.2). 예약 형식을 알면 그 사고를
 *     파일 수준에서 잡을 수 있다.
 * (2) 시스템 발급 키와 사람이 지은 키가 같은 공간을 쓰면 반드시 혼동이 생긴다. 빈 양식에서
 *     작업자가 `P-000001` 을 짓는 것도 함께 막는 것이 의도한 동작이다.
 */
const RESERVED_ROW_KEY_RE = /^P-\d{6}$/;

export function isReservedRowKey(rowKey: string): boolean {
  return RESERVED_ROW_KEY_RE.test(rowKey.trim());
}

/** `exportId` 가 없는 워크북에 예약 키가 있을 때 — 파일 전체를 거부한다. */
export const RESERVED_ROW_KEY_WITHOUT_EXPORT_MESSAGE =
  '수정용 양식인데 양식 정보가 사라졌습니다. 시트를 복사하거나 다른 프로그램으로 다시 저장하면 사라집니다. ' +
  '상품 목록에서 양식을 다시 받아 작성해 주세요. ' +
  '새 상품만 등록하려는 것이라면 상품키를 P-000001 형식이 아닌 다른 값으로 지어 주세요.';

/** `exportId` 는 해석됐는데 그 예약 키가 매핑에 없을 때 — 그 행만 오류로 떨군다. */
export function reservedRowKeyUnresolvedMessage(rowKey: string): string {
  return (
    `상품키 ${rowKey} 는 이 양식에 없는 시스템 발급 키입니다. ` +
    '다른 양식의 행을 섞지 않았는지 확인해 주세요. ' +
    '새 상품이라면 P-000001 형식이 아닌 다른 상품키를 지어 주세요.'
  );
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest --testPathPattern=bulk-session.row-key.spec -c package.json`
Expected: PASS (6건)

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.row-key.ts \
        apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.row-key.spec.ts
git commit -m "feat(bulk-session): P-<6자리> 를 예약 상품키 형식으로 정의"
```

---

### Task 2: 파일 수준 게이트 — exportId 없는 워크북의 예약 키 거부

**Files:**
- Modify: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.manager.ts` (`accept()`, 현재 `:108-114`)
- Test: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.manager.spec.ts` (기존 `describe('BulkSessionManager.accept — exportId 3갈래')` 에 추가)

**Interfaces:**
- Consumes: Task 1 의 `isReservedRowKey`, `RESERVED_ROW_KEY_WITHOUT_EXPORT_MESSAGE`
- Produces: 없음 (기존 `accept()` 시그니처 불변)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`bulk-session.manager.spec.ts` 의 `describe('BulkSessionManager.accept — exportId 3갈래')` 블록 안, 마지막 `it` 뒤에 추가한다. 파일 상단 helper 근처에 워크북 헬퍼도 함께 추가한다:

```typescript
/** exportId 는 없는데 프리필에서 온 예약 상품키가 남아 있는 워크북 — 숨은 시트 유실의 흔적. */
async function orphanedPrefillWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('상품');
  ws.addRow(['상품키', '상품명', '판매가']);
  ws.addRow(['P-000001', '티셔츠', '19000']);
  ws.addRow(['P-000002', '니트', '29000']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
```

테스트 본문:

```typescript
it('exportId 가 없는데 예약 상품키가 있으면 파일을 거부한다 — 대량 중복 생성 방어선', async () => {
  const { manager, fileClient } = harness();

  await expect(
    manager.accept({ buffer: await orphanedPrefillWorkbook(), fileName: 'form.xlsx', userId: 'u1' }),
  ).rejects.toThrow(BadRequestError);

  // 게이트는 업로드보다 먼저 돈다 — 거부된 파일이 S3 에 고아로 남지 않아야 한다
  // (file-service 에 고아 정리 잡이 없다).
  expect(fileClient.upload).not.toHaveBeenCalled();
});

it('exportId 가 없어도 예약 형식이 아닌 상품키는 신규 전용 세션으로 정상 접수된다', async () => {
  const inserted: FakeRow[] = [];
  const { manager } = harness({ onInsert: (v) => inserted.push(v) });

  const out = await manager.accept({ buffer: await newOnlyWorkbook(), fileName: 'form.xlsx', userId: 'u1' });

  expect(out.phase).toBe('uploaded');
  expect(inserted[0]?.exportId).toBeNull();
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx jest --testPathPattern=bulk-session.manager.spec -c package.json -t '예약 상품키'`
Expected: FAIL — 첫 테스트가 reject 하지 않고 정상 접수된다

- [ ] **Step 3: 게이트 구현**

`bulk-session.manager.ts` 상단 import 에 추가:

```typescript
import { isReservedRowKey, RESERVED_ROW_KEY_WITHOUT_EXPORT_MESSAGE } from './bulk-session.row-key';
```

`accept()` 안, `const exportId = parsed.exportId;` 바로 **다음** 줄에 삽입한다 (`assertExportUsable` 호출보다 앞):

```typescript
    // **숨은 시트를 잃은 수정용 양식을 여기서 잡는다.**
    //
    // `exportId` 가 없으면 아래 INSERT 가 `exportId: null` 로 신규 전용 세션을 만들고,
    // 검증 워커는 모든 행을 `kind='create'` 로 읽어 **프리필 행 전량을 신규 상품으로
    // 재생성한다**. 그 사고를 되돌리는 비용이 크고, 원인은 파일 하나라 행 단위로 쪼갤
    // 이유가 없다 — 파일 전체를 거부한다.
    //
    // `else if (parsed.exportId)` (bulk-session-job.manager.ts) 는 "세션 export_id 는
    // NULL 인데 워크북엔 exportId 가 있다"는 **다른** 사고를 막는다. 그쪽은 접수 이후
    // 잡이 삭제된 경우고, 이쪽은 워크북에서 exportId 자체가 사라진 경우다.
    if (!exportId) {
      const orphaned = parsed.sheets.products
        .map((row) => (row.cells.rowKey ?? '').trim())
        .filter((rowKey) => isReservedRowKey(rowKey));
      if (orphaned.length > 0) {
        throw new BadRequestError(RESERVED_ROW_KEY_WITHOUT_EXPORT_MESSAGE);
      }
    }
```

`BadRequestError` 가 이미 import 돼 있는지 확인한다 (이 파일은 `EXPORT_UNUSABLE_MESSAGE` 를 같은 예외로 던지므로 있을 것이다). 없으면 `import { BadRequestError } from '@app/shared';` 를 추가한다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest --testPathPattern=bulk-session.manager.spec -c package.json`
Expected: PASS — 기존 테스트 전부 + 신규 2건

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.manager.ts \
        apps/core/src/modules/catalog/operations/bulk-session/services/bulk-session.manager.spec.ts
git commit -m "feat(bulk-session): 양식 정보 잃은 워크북을 접수 단계에서 거부"
```

---

### Task 3: 행 수준 게이트 — 매핑에 없는 예약 키를 행 오류로

**Files:**
- Modify: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-upload.assembler.ts:35-59`
- Test: `apps/core/src/modules/catalog/operations/bulk-session/services/bulk-upload.assembler.spec.ts`

**Interfaces:**
- Consumes: Task 1 의 `isReservedRowKey`, `reservedRowKeyUnresolvedMessage`
- Produces: 없음 (`assembleUpload(parsed, knownRowKeys)` 시그니처 불변)

접합기에 두는 근거: 이 함수가 이미 상품키 누락·중복을 행 오류로 표시하는 자리이고(`:44-57`), `kind` 를 정하는 유일한 지점이다(`:40`).

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`bulk-upload.assembler.spec.ts` 에 추가한다. 기존 파일의 `ParsedUpload` 조립 헬퍼가 있으면 그것을 쓰고, 없으면 아래 헬퍼를 함께 추가한다:

```typescript
import { assembleUpload } from './bulk-upload.assembler';
import type { ParsedUpload } from './bulk-upload.parser';

function parsedWith(productRows: Array<Record<string, string>>): ParsedUpload {
  return {
    exportId: null,
    sheets: {
      products: productRows.map((cells, i) => ({ rowNumber: i + 2, cells })),
      options: [],
      variants: [],
      categories: [],
      constraints: [],
      images: [],
    },
    present: {
      products: new Set(['rowKey', 'name', 'basePrice']),
      options: new Set<string>(),
      variants: new Set<string>(),
      categories: new Set<string>(),
      constraints: new Set<string>(),
    },
  };
}
```

테스트:

```typescript
describe('assembleUpload — 예약 상품키', () => {
  it('매핑에 없는 예약 키 행은 오류로 표시한다 (다른 양식의 행을 섞은 경우)', () => {
    const out = assembleUpload(parsedWith([{ rowKey: 'P-000042', name: '티셔츠' }]), new Set());

    const row = out.rows[0];
    expect(row.kind).toBe('create');
    expect(row.errors.map((e) => e.message).join(' ')).toContain('P-000042');
  });

  it('매핑에 있는 예약 키는 정상 수정 행이다', () => {
    const out = assembleUpload(parsedWith([{ rowKey: 'P-000042', name: '티셔츠' }]), new Set(['P-000042']));

    expect(out.rows[0].kind).toBe('update');
    expect(out.rows[0].errors).toEqual([]);
  });

  it('예약 형식이 아닌 신규 키는 영향받지 않는다', () => {
    const out = assembleUpload(parsedWith([{ rowKey: 'NEW-001', name: '티셔츠' }]), new Set());

    expect(out.rows[0].kind).toBe('create');
    expect(out.rows[0].errors).toEqual([]);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx jest --testPathPattern=bulk-upload.assembler.spec -c package.json -t '예약 상품키'`
Expected: FAIL — 첫 테스트에서 `errors` 가 비어 있다

- [ ] **Step 3: 게이트 구현**

`bulk-upload.assembler.ts` 상단 import 에 추가:

```typescript
import { isReservedRowKey, reservedRowKeyUnresolvedMessage } from './bulk-session.row-key';
```

`:44` 의 `if (rowKey === '')` 체인에 가지를 하나 더한다. **중복 검사보다 뒤, `else` 앞**에 놓아 기존 판정을 가리지 않게 한다:

```typescript
    if (rowKey === '') {
      row.errors.push({ sheet: '상품', rowNumber: raw.rowNumber, message: '상품키는 필수입니다.' });
    } else if (seen.has(rowKey)) {
      // (기존 중복 처리 — 변경 없음)
      row.errors.push({ sheet: '상품', rowNumber: raw.rowNumber, message: `상품키가 중복되었습니다: ${rowKey}` });
      const first = byKey.get(rowKey);
      if (first && !first.errors.some((e) => e.message.includes('중복'))) {
        first.errors.push({ sheet: '상품', rowNumber: first.rowNumber, message: `상품키가 중복되었습니다: ${rowKey}` });
      }
    } else {
      seen.add(rowKey);
      byKey.set(rowKey, row);
      // **예약 형식인데 신규로 분류됐다 = 이 양식의 매핑에 없는 시스템 발급 키다.**
      // 서로 다른 양식의 시트를 섞은 경우가 대표적이다. 그대로 두면 신규 상품이 만들어져
      // 원본과 중복된다. 파일 전체가 잘못된 것은 아니므로(bulk-session.manager.ts 의 파일
      // 수준 게이트가 그 경우를 이미 걸렀다) 이 행만 떨군다.
      if (row.kind === 'create' && isReservedRowKey(rowKey)) {
        row.errors.push({
          sheet: '상품',
          rowNumber: raw.rowNumber,
          message: reservedRowKeyUnresolvedMessage(rowKey),
        });
      }
    }
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest --testPathPattern=bulk-upload.assembler.spec -c package.json`
Expected: PASS — 기존 + 신규 3건

- [ ] **Step 5: bulk-session 전체 회귀 확인**

Run: `npx jest --testPathPattern='bulk-session|bulk-upload|bulk-draft|form-export' -c package.json`
Expected: PASS. 실패가 있으면 이 변경 때문인지 확인한다 (기존 픽스처가 `P-000001` 을 신규 키로 쓰고 있었다면 그 픽스처를 `NEW-001` 로 고친다 — 가드가 의도대로 문 것이다)

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/bulk-session/services/bulk-upload.assembler.ts \
        apps/core/src/modules/catalog/operations/bulk-session/services/bulk-upload.assembler.spec.ts
git commit -m "feat(bulk-session): 매핑에 없는 예약 상품키를 행 오류로 떨군다"
```

---

### Task 4: admin-web 오류 리포트 포매터

**Files:**
- Create: `apps/admin-web/src/features/mall/bulk-sessions/lib/error-report.ts`
- Test: `apps/admin-web/src/features/mall/bulk-sessions/lib/error-report.spec.ts`

**Interfaces:**
- Consumes: `BulkSessionItem` (`@/lib/types/dto/bulk-session`)
- Produces: `formatErrorReport(items: BulkSessionItem[]): string`

순수 `.ts` 로 분리하는 이유: 이 저장소의 admin-web 은 `.tsx` 를 transform 밖에 두어 **컴포넌트 테스트가 불가능하다.** 판정 로직을 `.ts` 로 빼야 검증된다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```typescript
import { formatErrorReport } from './error-report';
import type { BulkSessionItem } from '@/lib/types/dto/bulk-session';

function item(over: Partial<BulkSessionItem>): BulkSessionItem {
  return {
    id: 'i1', rowNumber: 2, rowKey: 'P-000001', kind: 'update', productName: '티셔츠',
    status: 'invalid', masterId: null, errorMessage: null, draftVersionId: null,
    publishStatus: 'idle', publishError: null, changes: [], conflicts: [],
    ...over,
  };
}

describe('formatErrorReport', () => {
  it('행마다 행번호·상품키·상품명·사유를 한 줄로 낸다', () => {
    const text = formatErrorReport([
      item({ rowNumber: 3, rowKey: 'P-000007', productName: '니트', errorMessage: '[카테고리] 경로를 찾을 수 없습니다: 여성>없음' }),
    ]);

    expect(text).toContain('3행');
    expect(text).toContain('P-000007');
    expect(text).toContain('니트');
    expect(text).toContain('경로를 찾을 수 없습니다');
  });

  it('상품명이 비면 대체 표시를 쓴다 — 행이 망가져 이름을 못 뽑는 경우가 있다', () => {
    expect(formatErrorReport([item({ productName: '' })])).toContain('(이름 없음)');
  });

  it('사유가 없으면 그렇게 적는다 — 빈 줄을 남기지 않는다', () => {
    expect(formatErrorReport([item({ errorMessage: null })])).toContain('(사유 없음)');
  });

  it('머리말에 건수를 실어 붙여넣은 쪽이 전량인지 알 수 있게 한다', () => {
    const text = formatErrorReport([item({}), item({ id: 'i2' })]);
    expect(text.split('\n')[0]).toContain('2건');
  });

  it('빈 목록이면 그렇게 말한다', () => {
    expect(formatErrorReport([])).toContain('오류 행이 없습니다');
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npm run test:admin-web -- --testPathPattern=error-report`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

```typescript
import type { BulkSessionItem } from '@/lib/types/dto/bulk-session';

/**
 * 무효 행을 AI 에게 그대로 붙여넣을 수 있는 텍스트로 만든다.
 *
 * 시트명을 따로 뽑지 않는 이유: `errorMessage` 는 서버가 `RowError` 들을 합친 문자열이라
 * 시트명이 이미 그 안에 들어 있다(`BulkSessionItem` 에 시트 필드 자체가 없다).
 *
 * 머리말에 건수를 싣는다 — 목록 조회가 `limit=100` 으로 클램프되므로(bulk-session.controller.ts:45),
 * 붙여넣은 쪽이 전량인지 잘린 것인지 사람이 알 수 있어야 한다.
 */
export function formatErrorReport(items: BulkSessionItem[]): string {
  if (items.length === 0) return '오류 행이 없습니다.';

  const lines = items.map((item) => {
    const name = item.productName.trim() || '(이름 없음)';
    const reason = item.errorMessage?.trim() || '(사유 없음)';
    return `${item.rowNumber}행 · ${item.rowKey} · ${name} · ${reason}`;
  });

  return [`오류 ${items.length}건`, ...lines].join('\n');
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm run test:admin-web -- --testPathPattern=error-report`
Expected: PASS (5건)

- [ ] **Step 5: 커밋**

```bash
git add apps/admin-web/src/features/mall/bulk-sessions/lib/error-report.ts \
        apps/admin-web/src/features/mall/bulk-sessions/lib/error-report.spec.ts
git commit -m "feat(bulk-session): 무효 행을 붙여넣기용 텍스트로 만드는 포매터"
```

---

### Task 5: admin-web 「오류 목록 복사」 버튼 배선

**Files:**
- Modify: `apps/admin-web/src/features/mall/bulk-sessions/session-detail/review-panel/index.tsx` (`:160-` 헤더 영역)
- Modify: `apps/admin-web/src/lib/services/products/bulk-session.ts` (전량 수집 함수 추가)

**Interfaces:**
- Consumes: Task 4 의 `formatErrorReport`, `bulkSessionClient.getItems`
- Produces: `fetchAllInvalidItems(sessionId: string): Promise<BulkSessionItem[]>`

- [ ] **Step 1: 전량 수집 함수를 쓴다**

`apps/admin-web/src/lib/services/products/bulk-session.ts` 에 추가한다:

```typescript
/** 서버가 `limit` 을 100 으로 클램프한다(bulk-session.controller.ts:45-47). */
const ITEMS_MAX_LIMIT = 100;

/**
 * 무효 행을 **전량** 모은다.
 *
 * `limit=1000` 을 한 번 보내는 방식은 쓰지 않는다 — 서버가 조용히 100 으로 잘라
 * 나머지가 유실된다. 이 저장소는 발행 패널에서 정확히 그 사고를 이미 겪었다
 * (bulk-session.reader.ts:44 주석). 반드시 페이지를 끝까지 돈다.
 */
export async function fetchAllInvalidItems(
  sessionId: string
): Promise<BulkSessionItem[]> {
  const collected: BulkSessionItem[] = [];
  for (let page = 1; ; page += 1) {
    const res = await bulkSessionClient.getItems(sessionId, {
      status: 'invalid',
      page,
      limit: ITEMS_MAX_LIMIT,
    });
    collected.push(...res.data);
    if (collected.length >= res.total || res.data.length === 0) break;
  }
  return collected;
}
```

`BulkSessionItem` 타입이 이 파일에 import 돼 있지 않으면 `@/lib/types/dto/bulk-session` 에서 추가한다.

- [ ] **Step 2: 버튼을 배선한다**

`review-panel/index.tsx` 상단 import 에 추가:

```typescript
import { formatErrorReport } from '../../lib/error-report';
import { fetchAllInvalidItems } from '@/lib/services/products/bulk-session';
```

컴포넌트 안, `const decisionsLocked = ...` 근처에 추가:

```typescript
  const [copying, setCopying] = useState(false);

  async function handleCopyErrors() {
    setCopying(true);
    try {
      const invalid = await fetchAllInvalidItems(sessionId);
      await navigator.clipboard.writeText(formatErrorReport(invalid));
      toast.success(`오류 ${invalid.length}건을 복사했습니다.`);
    } catch {
      toast.error('오류 목록을 복사하지 못했습니다.');
    } finally {
      setCopying(false);
    }
  }
```

헤더 우측 버튼 영역(`:162` 의 `justify-between` 블록 오른쪽)에 버튼을 넣는다. `invalidCount` 는 `:152` 에 이미 있다:

```tsx
          {invalidCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleCopyErrors()}
              disabled={copying}
            >
              {copying ? '복사 중…' : `오류 목록 복사 (${invalidCount})`}
            </Button>
          )}
```

- [ ] **Step 3: 타입 검사**

Run: `npm run type-check:scoped -- apps/admin-web/src/features/mall/bulk-sessions apps/admin-web/src/lib/services/products/bulk-session.ts`

해당 스크립트가 없으면: `npx tsc --noEmit -p apps/admin-web/tsconfig.json 2>&1 | grep -E 'bulk-sessions|bulk-session\.ts'`
Expected: 변경한 파일에 신규 오류 없음 (저장소 상시 debt 는 무시)

- [ ] **Step 4: 브라우저 확인**

`npm run start:admin-web:dev` 로 띄우고 오류가 있는 세션의 검토 화면에서:
- 버튼이 오류 건수와 함께 보인다
- 누르면 토스트가 뜨고 클립보드에 `오류 N건` 머리말 + 행별 줄이 들어온다
- 오류가 0건인 세션에서는 버튼이 보이지 않는다

- [ ] **Step 5: 커밋**

```bash
git add apps/admin-web/src/features/mall/bulk-sessions/session-detail/review-panel/index.tsx \
        apps/admin-web/src/lib/services/products/bulk-session.ts
git commit -m "feat(bulk-session): 검토 화면에 오류 목록 복사 버튼 추가"
```

---

### Task 6: 열 레퍼런스 생성기 + 동기화 테스트

**Files:**
- Create: `apps/core/src/modules/catalog/operations/bulk-session/services/form-export.columns-doc.ts`
- Create: `skills/product-bulk-form/references/columns.md` (생성물)
- Create: `skills/product-bulk-form/scripts/columns.json` (생성물)
- Create: `scripts/generate-bulk-form-columns.ts`
- Test: `apps/core/src/modules/catalog/operations/bulk-session/services/form-export.columns-doc.spec.ts`

**Interfaces:**
- Consumes: `ALL_COLUMN_SETS`, `SHEET_NAMES`, `PRICING_SENTINEL` (`form-export.sheets.ts`)
- Produces: `buildColumnsMarkdown(): string` · `buildColumnsJson(): string`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```typescript
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildColumnsJson, buildColumnsMarkdown } from './form-export.columns-doc';
import { ALL_COLUMN_SETS } from './form-export.sheets';

const SKILL_ROOT = join(__dirname, '../../../../../../../../skills/product-bulk-form');

describe('열 레퍼런스 생성기', () => {
  it('모든 시트와 모든 열 라벨이 마크다운에 들어간다', () => {
    const md = buildColumnsMarkdown();
    for (const set of ALL_COLUMN_SETS) {
      expect(md).toContain(set.name);
      for (const col of set.columns) expect(md).toContain(col.label);
    }
  });

  it('JSON 은 라벨↔키 매핑을 시트별로 담는다', () => {
    const parsed = JSON.parse(buildColumnsJson()) as {
      sheets: Record<string, Array<{ key: string; label: string; required: boolean }>>;
    };
    expect(Object.keys(parsed.sheets)).toEqual(ALL_COLUMN_SETS.map((s) => s.name));
    expect(parsed.sheets['상품']).toContainEqual({ key: 'rowKey', label: '상품키', required: true });
  });
});

describe('커밋된 스킬 파일이 코드와 동기화돼 있다', () => {
  // 이 두 테스트가 깨졌다는 것은 열이 바뀌었는데 스킬이 안 따라왔다는 뜻이다.
  // 고치는 방법: `npx ts-node scripts/generate-bulk-form-columns.ts`
  it('references/columns.md', () => {
    expect(readFileSync(join(SKILL_ROOT, 'references/columns.md'), 'utf8')).toBe(buildColumnsMarkdown());
  });

  it('scripts/columns.json', () => {
    expect(readFileSync(join(SKILL_ROOT, 'scripts/columns.json'), 'utf8')).toBe(buildColumnsJson());
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx jest --testPathPattern=form-export.columns-doc -c package.json`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 생성기 구현**

`form-export.columns-doc.ts`:

```typescript
import { ALL_COLUMN_SETS, PRICING_SENTINEL, SHEET_NAMES } from './form-export.sheets';

/**
 * 스킬이 읽는 열 레퍼런스를 `ALL_COLUMN_SETS` 에서 **생성**한다.
 *
 * 손으로 베낀 표를 스킬에 두면 열이 추가될 때 조용히 어긋나고, 어긋나도 아무 경고 없이
 * 잘못된 양식이 만들어진다. 생성기 + 동기화 테스트가 그 드리프트를 0으로 만든다.
 *
 * 마크다운은 AI 가 읽고, JSON 은 스크립트가 읽는다 — 같은 출처에서 나오므로 둘이 갈릴 수 없다.
 */
export function buildColumnsMarkdown(): string {
  const lines: string[] = [
    '# 워크북 열 레퍼런스',
    '',
    '> 이 파일은 `form-export.sheets.ts` 의 `ALL_COLUMN_SETS` 에서 생성된다. 직접 고치지 마라 —',
    '> `npx ts-node scripts/generate-bulk-form-columns.ts` 로 다시 만든다.',
    '',
    '**볼드가 필수 열이다.** 파서는 헤더 *이름*으로 열을 찾으므로 열 순서는 자유이고, 모르는 열은 무시한다.',
    '',
  ];

  for (const set of ALL_COLUMN_SETS) {
    lines.push(`## ${set.name}`, '', '| 열 | 내부 키 | 필수 |', '|---|---|---|');
    for (const col of set.columns) {
      const label = col.required ? `**${col.label}**` : col.label;
      lines.push(`| ${label} | \`${col.key}\` | ${col.required ? 'O' : ''} |`);
    }
    lines.push('');
  }

  lines.push(
    '## 시트 이름',
    '',
    ...Object.values(SHEET_NAMES).map((name) => `- \`${name}\``),
    '',
    '## 상수',
    '',
    `- 복합 가격규칙 센티넬: \`${PRICING_SENTINEL}\``,
    '',
  );

  return lines.join('\n');
}

export function buildColumnsJson(): string {
  const sheets: Record<string, Array<{ key: string; label: string; required: boolean }>> = {};
  for (const set of ALL_COLUMN_SETS) {
    sheets[set.name] = set.columns.map((col) => ({ key: col.key, label: col.label, required: col.required }));
  }
  return `${JSON.stringify({ sheetNames: SHEET_NAMES, pricingSentinel: PRICING_SENTINEL, sheets }, null, 2)}\n`;
}
```

- [ ] **Step 4: 생성 스크립트를 쓰고 실행한다**

`scripts/generate-bulk-form-columns.ts`:

```typescript
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  buildColumnsJson,
  buildColumnsMarkdown,
} from '../apps/core/src/modules/catalog/operations/bulk-session/services/form-export.columns-doc';

const ROOT = join(__dirname, '..', 'skills', 'product-bulk-form');

function write(relative: string, content: string): void {
  const path = join(ROOT, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
  console.log(`wrote ${path}`);
}

write('references/columns.md', buildColumnsMarkdown());
write('scripts/columns.json', buildColumnsJson());
```

`package.json` scripts 에 추가:

```json
"generate:bulk-form-columns": "ts-node scripts/generate-bulk-form-columns.ts"
```

Run: `npm run generate:bulk-form-columns`

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx jest --testPathPattern=form-export.columns-doc -c package.json`
Expected: PASS (4건)

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/bulk-session/services/form-export.columns-doc.ts \
        apps/core/src/modules/catalog/operations/bulk-session/services/form-export.columns-doc.spec.ts \
        scripts/generate-bulk-form-columns.ts package.json \
        skills/product-bulk-form/references/columns.md skills/product-bulk-form/scripts/columns.json
git commit -m "feat(bulk-form-skill): 열 레퍼런스 생성기와 동기화 테스트"
```

---

### Task 7: `read_form.py` — 시트를 상품 단위로 조인

**Files:**
- Create: `skills/product-bulk-form/scripts/read_form.py`
- Create: `skills/product-bulk-form/tests/conftest.py`
- Create: `skills/product-bulk-form/tests/test_read_form.py`
- Create: `skills/product-bulk-form/requirements-dev.txt`

**Interfaces:**
- Consumes: `scripts/columns.json` (Task 6)
- Produces: `load_columns(path) -> dict` · `read_form(xlsx_path, columns) -> dict` · CLI `python3 read_form.py <xlsx> [--out out.json]`

- [ ] **Step 1: 개발 의존성과 픽스처를 만든다**

`requirements-dev.txt`:

```
openpyxl==3.1.5
pytest==8.3.4
```

`tests/conftest.py`:

```python
"""테스트용 워크북 픽스처. 실제 양식과 같은 시트 이름·헤더를 쓴다."""
import json
import pathlib
import sys

import openpyxl
import pytest

SCRIPTS = pathlib.Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS))


@pytest.fixture
def columns():
    return json.loads((SCRIPTS / "columns.json").read_text(encoding="utf-8"))


def _add_sheet(wb, name, columns, sheet_name, rows):
    ws = wb.create_sheet(name)
    defs = columns["sheets"][sheet_name]
    ws.append([c["label"] for c in defs])
    for row in rows:
        ws.append([row.get(c["key"], "") for c in defs])
    return ws


@pytest.fixture
def prefilled_workbook(tmp_path, columns):
    """프리필 워크북 하나. 숨은 _양식정보 시트를 포함한다."""
    wb = openpyxl.Workbook()
    wb.remove(wb.active)

    _add_sheet(wb, "상품", columns, "상품", [
        {"rowKey": "P-000001", "name": "티셔츠", "basePrice": "19000", "brand": "ACME"},
    ])
    _add_sheet(wb, "옵션", columns, "옵션", [
        {"rowKey": "P-000001", "optionKey": "G1", "optionName": "색상",
         "optionValueKey": "V1", "optionValueName": "빨강"},
        {"rowKey": "P-000001", "optionKey": "G1", "optionName": "색상",
         "optionValueKey": "V2", "optionValueName": "파랑"},
    ])
    _add_sheet(wb, "조합", columns, "조합", [
        {"rowKey": "P-000001", "combination": "V1", "variantCode": "SKU-R"},
        {"rowKey": "P-000001", "combination": "V2", "variantCode": "SKU-B"},
    ])
    _add_sheet(wb, "카테고리", columns, "카테고리", [
        {"rowKey": "P-000001", "categoryPath": "여성패션>티셔츠", "isPrimary": "Y"},
    ])
    _add_sheet(wb, "구매제약", columns, "구매제약", [])
    _add_sheet(wb, "이미지", columns, "이미지", [])
    _add_sheet(wb, "카테고리 참조", columns, "카테고리 참조", [
        {"categoryPath": "여성패션>티셔츠"},
        {"categoryPath": "여성패션>니트"},
    ])

    meta = wb.create_sheet("_양식정보")
    meta["A1"] = "exportId"
    meta["B1"] = "0198f3a1-1111-7000-8000-abcdefabcdef"
    meta.sheet_state = "veryHidden"

    path = tmp_path / "form.xlsx"
    wb.save(path)
    return path
```

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`tests/test_read_form.py`:

```python
from read_form import read_form


def test_상품_단위로_조인된다(prefilled_workbook, columns):
    out = read_form(prefilled_workbook, columns)

    assert len(out["products"]) == 1
    product = out["products"][0]
    assert product["상품키"] == "P-000001"
    assert product["필드"]["name"] == "티셔츠"
    assert len(product["옵션"]) == 2
    assert len(product["조합"]) == 2
    assert product["카테고리"][0]["categoryPath"] == "여성패션>티셔츠"
    assert product["구매제약"] is None


def test_숨은_시트의_exportId_를_읽는다(prefilled_workbook, columns):
    out = read_form(prefilled_workbook, columns)
    assert out["exportId"] == "0198f3a1-1111-7000-8000-abcdefabcdef"


def test_exportId_가_있으면_출처가_프리필이다(prefilled_workbook, columns):
    out = read_form(prefilled_workbook, columns)
    assert out["products"][0]["출처"] == "프리필"


def test_카테고리_참조는_경로_목록으로_나온다(prefilled_workbook, columns):
    out = read_form(prefilled_workbook, columns)
    assert out["카테고리참조"] == ["여성패션>티셔츠", "여성패션>니트"]


def test_헤더_이름으로_찾으므로_열_순서가_바뀌어도_읽는다(tmp_path, columns):
    import openpyxl
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "상품"
    ws.append(["판매가", "상품명", "상품키"])   # 순서를 뒤집는다
    ws.append(["19000", "티셔츠", "NEW-1"])
    path = tmp_path / "reordered.xlsx"
    wb.save(path)

    out = read_form(path, columns)
    assert out["products"][0]["필드"]["name"] == "티셔츠"
    assert out["products"][0]["출처"] == "신규"
```

- [ ] **Step 3: 테스트가 실패하는지 확인**

```bash
python3 -m venv skills/product-bulk-form/.venv
skills/product-bulk-form/.venv/bin/pip install -r skills/product-bulk-form/requirements-dev.txt
skills/product-bulk-form/.venv/bin/python -m pytest skills/product-bulk-form/tests -q
```
Expected: FAIL — `ModuleNotFoundError: No module named 'read_form'`

- [ ] **Step 4: 구현**

`scripts/read_form.py`:

```python
#!/usr/bin/env python3
"""양식 워크북을 상품 단위 JSON 으로 읽는다.

이 스크립트의 본질은 **조인**이다. 워크북은 상품키로 이어진 6개 시트지만 AI 는 상품 하나가
객체 하나인 형태로 다뤄야 시트 간 참조를 손으로 따라다니지 않는다.

라벨은 하드코딩하지 않는다 — 옆의 columns.json 에서 읽는다. 그 파일은 서버 코드
(form-export.sheets.ts)에서 생성되므로 열이 바뀌어도 갈리지 않는다.
"""
import argparse
import json
import pathlib

import openpyxl

META_SHEET = "_양식정보"
META_CELL = "B1"


def load_columns(path):
    return json.loads(pathlib.Path(path).read_text(encoding="utf-8"))


def _read_sheet(wb, sheet_name, defs):
    """헤더 '이름'으로 열을 찾는다 — 열 순서는 자유이고 모르는 열은 무시한다."""
    if sheet_name not in wb.sheetnames:
        return []
    ws = wb[sheet_name]
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return []

    header = ["" if c is None else str(c).strip() for c in rows[0]]
    key_by_index = {}
    for i, label in enumerate(header):
        for d in defs:
            if d["label"] == label:
                key_by_index[i] = d["key"]

    out = []
    for raw in rows[1:]:
        cells = {}
        has_value = False
        for i, value in enumerate(raw):
            key = key_by_index.get(i)
            if key is None:
                continue
            text = "" if value is None else str(value).strip()
            cells[key] = text
            if text:
                has_value = True
        if has_value:
            out.append(cells)
    return out


def read_form(xlsx_path, columns):
    wb = openpyxl.load_workbook(xlsx_path)
    names = columns["sheetNames"]
    sheets = columns["sheets"]

    export_id = None
    if META_SHEET in wb.sheetnames:
        value = wb[META_SHEET][META_CELL].value
        export_id = str(value).strip() if value else None

    products = _read_sheet(wb, names["products"], sheets["상품"])
    children = {
        "옵션": _read_sheet(wb, names["options"], sheets["옵션"]),
        "조합": _read_sheet(wb, names["variants"], sheets["조합"]),
        "카테고리": _read_sheet(wb, names["categories"], sheets["카테고리"]),
        "구매제약": _read_sheet(wb, names["constraints"], sheets["구매제약"]),
    }

    by_key = {}
    out_products = []
    for cells in products:
        row_key = cells.get("rowKey", "")
        product = {
            "상품키": row_key,
            # exportId 가 없으면 프리필 자체가 존재하지 않는다(빈 양식).
            "출처": "프리필" if export_id else "신규",
            "필드": {k: v for k, v in cells.items() if k != "rowKey"},
            "옵션": [], "조합": [], "카테고리": [], "구매제약": None,
        }
        by_key[row_key] = product
        out_products.append(product)

    for sheet_key in ("옵션", "조합", "카테고리"):
        for cells in children[sheet_key]:
            target = by_key.get(cells.get("rowKey", ""))
            if target is not None:
                target[sheet_key].append({k: v for k, v in cells.items() if k != "rowKey"})

    for cells in children["구매제약"]:
        target = by_key.get(cells.get("rowKey", ""))
        if target is not None:
            target["구매제약"] = {k: v for k, v in cells.items() if k != "rowKey"}

    return {
        "exportId": export_id,
        "products": out_products,
        "이미지": _read_sheet(wb, names["images"], sheets["이미지"]),
        "카테고리참조": [
            c.get("categoryPath", "")
            for c in _read_sheet(wb, names["categoryReference"], sheets["카테고리 참조"])
        ],
    }


def main():
    parser = argparse.ArgumentParser(description="양식 워크북을 JSON 으로 읽는다")
    parser.add_argument("xlsx")
    parser.add_argument("--columns", default=str(pathlib.Path(__file__).parent / "columns.json"))
    parser.add_argument("--out")
    args = parser.parse_args()

    data = read_form(args.xlsx, load_columns(args.columns))
    text = json.dumps(data, ensure_ascii=False, indent=2)
    if args.out:
        pathlib.Path(args.out).write_text(text, encoding="utf-8")
        print(f"wrote {args.out}: 상품 {len(data['products'])}건")
    else:
        print(text)


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `skills/product-bulk-form/.venv/bin/python -m pytest skills/product-bulk-form/tests -q`
Expected: PASS (5건)

- [ ] **Step 6: `.venv` 를 gitignore 에 넣고 커밋**

```bash
echo "skills/product-bulk-form/.venv/" >> .gitignore
git add .gitignore skills/product-bulk-form/scripts/read_form.py \
        skills/product-bulk-form/tests skills/product-bulk-form/requirements-dev.txt
git commit -m "feat(bulk-form-skill): read_form.py — 시트를 상품 단위로 조인"
```

---

### Task 8: `write_form.py` — 변경분 적용 엔진

**Files:**
- Create: `skills/product-bulk-form/scripts/write_form.py`
- Create: `skills/product-bulk-form/tests/test_write_form_apply.py`

**Interfaces:**
- Consumes: `columns.json`, Task 7 의 `load_columns`
- Produces: `apply_changes(src_xlsx, changes, out_xlsx, columns) -> dict` (보고서)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/test_write_form_apply.py`:

```python
import openpyxl
import pytest

from read_form import read_form
from write_form import apply_changes


def test_적지_않은_필드는_건드리지_않는다(prefilled_workbook, columns, tmp_path):
    out = tmp_path / "edited.xlsx"
    apply_changes(prefilled_workbook, {"변경": [{"상품키": "P-000001", "필드": {"brand": "NEW"}}]}, out, columns)

    product = read_form(out, columns)["products"][0]
    assert product["필드"]["brand"] == "NEW"
    assert product["필드"]["name"] == "티셔츠"      # 안 건드림
    assert product["필드"]["basePrice"] == "19000"  # 안 건드림


def test_null_은_명시적_비움이다(prefilled_workbook, columns, tmp_path):
    out = tmp_path / "edited.xlsx"
    apply_changes(prefilled_workbook, {"변경": [{"상품키": "P-000001", "필드": {"brand": None}}]}, out, columns)

    assert read_form(out, columns)["products"][0]["필드"]["brand"] == ""


def test_카테고리_행목록은_교체된다(prefilled_workbook, columns, tmp_path):
    out = tmp_path / "edited.xlsx"
    apply_changes(
        prefilled_workbook,
        {"변경": [{"상품키": "P-000001",
                   "카테고리": [{"categoryPath": "여성패션>니트", "isPrimary": "Y"}]}]},
        out, columns,
    )

    cats = read_form(out, columns)["products"][0]["카테고리"]
    assert len(cats) == 1
    assert cats[0]["categoryPath"] == "여성패션>니트"


def test_숨은_시트가_보존된다(prefilled_workbook, columns, tmp_path):
    out = tmp_path / "edited.xlsx"
    apply_changes(prefilled_workbook, {"변경": [{"상품키": "P-000001", "필드": {"brand": "NEW"}}]}, out, columns)

    wb = openpyxl.load_workbook(out)
    assert "_양식정보" in wb.sheetnames
    assert wb["_양식정보"].sheet_state == "veryHidden"
    assert read_form(out, columns)["exportId"] == "0198f3a1-1111-7000-8000-abcdefabcdef"


def test_신규_행은_모든_시트에_추가된다(prefilled_workbook, columns, tmp_path):
    out = tmp_path / "edited.xlsx"
    apply_changes(
        prefilled_workbook,
        {"신규": [{
            "상품키": "NEW-1",
            "필드": {"name": "새 니트", "basePrice": "29000"},
            "옵션": [{"optionKey": "G1", "optionName": "색상", "optionValueKey": "V9", "optionValueName": "검정"}],
            "조합": [{"조합": ["V9"], "variantCode": "SKU-K"}],
            "카테고리": [{"categoryPath": "여성패션>니트", "isPrimary": "Y"}],
        }]},
        out, columns,
    )

    products = {p["상품키"]: p for p in read_form(out, columns)["products"]}
    assert products["NEW-1"]["필드"]["name"] == "새 니트"
    assert products["NEW-1"]["조합"][0]["combination"] == "V9"
    assert len(products) == 2   # 기존 행이 살아 있다


def test_조합은_항상_정렬해_잇는다(prefilled_workbook, columns, tmp_path):
    """서버는 조합 중복을 문자열 원본으로 센다(bulk-draft.options.ts:228-234).
    정렬하지 않으면 V1+V2 와 V2+V1 이 갈려 같은 조합의 품목이 둘 생긴다."""
    out = tmp_path / "edited.xlsx"
    apply_changes(
        prefilled_workbook,
        {"신규": [{"상품키": "NEW-1", "필드": {"name": "x", "basePrice": "1"},
                   "조합": [{"조합": ["V2", "V1"]}]}]},
        out, columns,
    )

    products = {p["상품키"]: p for p in read_form(out, columns)["products"]}
    assert products["NEW-1"]["조합"][0]["combination"] == "V1+V2"


def test_이미지_행이_추가된다(prefilled_workbook, columns, tmp_path):
    out = tmp_path / "edited.xlsx"
    apply_changes(
        prefilled_workbook,
        {"이미지": [{"imageKey": "IMG-10", "sourceValue": "NEW-1-main1.jpg"}]},
        out, columns,
    )

    assert read_form(out, columns)["이미지"] == [{"imageKey": "IMG-10", "sourceValue": "NEW-1-main1.jpg"}]


def test_없는_상품키를_변경하면_실패한다(prefilled_workbook, columns, tmp_path):
    with pytest.raises(ValueError, match="P-999999"):
        apply_changes(prefilled_workbook, {"변경": [{"상품키": "P-999999", "필드": {"brand": "x"}}]},
                      tmp_path / "edited.xlsx", columns)
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `skills/product-bulk-form/.venv/bin/python -m pytest skills/product-bulk-form/tests/test_write_form_apply.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'write_form'`

- [ ] **Step 3: 구현**

`scripts/write_form.py`:

```python
#!/usr/bin/env python3
"""원본 워크북에 **변경분만** 적용해 새 파일을 만든다.

새 워크북을 만들지 않고 원본을 여는 것이 이 스크립트의 존재 이유다. 숨은 `_양식정보`
시트에 든 exportId 가 "이 워크북은 수정용"임을 말하는 유일한 표식이고, 그것을 잃은 파일을
올리면 프리필 행 전량이 신규 상품으로 재생성된다.

그리고 **전체 상태가 아니라 변경분을 받는다.** 적지 않은 키는 셀을 건드리지 않고, 비우려면
None 을 명시해야 한다 — 그래서 우연한 필드 비움이 문법 수준에서 불가능하다.
"""
import argparse
import json
import pathlib

import openpyxl

from read_form import load_columns

META_SHEET = "_양식정보"


def _header_map(ws, defs):
    """헤더 라벨 → 열 번호(1-based). 모르는 열은 담지 않는다."""
    header = next(ws.iter_rows(min_row=1, max_row=1, values_only=True), ())
    out = {}
    for i, cell in enumerate(header):
        label = "" if cell is None else str(cell).strip()
        for d in defs:
            if d["label"] == label:
                out[d["key"]] = i + 1
    return out


def _row_index_by_key(ws, header):
    col = header.get("rowKey")
    if col is None:
        return {}
    out = {}
    for r in range(2, ws.max_row + 1):
        value = ws.cell(row=r, column=col).value
        key = "" if value is None else str(value).strip()
        if key:
            out[key] = r
    return out


def _set_cells(ws, row_index, header, values):
    """None → 빈 문자열(명시적 비움). 키가 없으면 애초에 여기 오지 않는다(안 건드림)."""
    for key, value in values.items():
        col = header.get(key)
        if col is None:
            raise ValueError(f"'{ws.title}' 시트에 '{key}' 에 해당하는 열이 없습니다.")
        ws.cell(row=row_index, column=col).value = "" if value is None else str(value)


def _append_row(ws, header, values, row_key=None):
    target = ws.max_row + 1
    if row_key is not None and "rowKey" in header:
        ws.cell(row=target, column=header["rowKey"]).value = row_key
    _set_cells(ws, target, header, values)
    return target


def _delete_rows_for_key(ws, header, row_key):
    col = header.get("rowKey")
    if col is None:
        return
    for r in range(ws.max_row, 1, -1):
        value = ws.cell(row=r, column=col).value
        if value is not None and str(value).strip() == row_key:
            ws.delete_rows(r)


def _normalize_variant(entry):
    """조합은 배열로 받아 **정렬해** '+' 로 잇는다.

    서버가 조합 중복을 문자열 원본으로 세기 때문이다(bulk-draft.options.ts:228-234).
    문자열을 그대로 받으면 A+B / B+A 가 갈려 같은 조합의 품목이 둘 만들어진다 —
    정렬 책임을 도구가 가져가면 그 사고가 날 자리가 없다.
    """
    out = dict(entry)
    combo = out.pop("조합", None)
    if combo is not None:
        if not isinstance(combo, list):
            raise ValueError("'조합' 은 옵션값키 배열이어야 합니다. 문자열을 직접 만들지 마세요.")
        out["combination"] = "+".join(sorted(str(c).strip() for c in combo if str(c).strip()))
    return out


CHILD_SHEETS = {"옵션": "options", "조합": "variants", "카테고리": "categories"}


def apply_changes(src_xlsx, changes, out_xlsx, columns):
    wb = openpyxl.load_workbook(src_xlsx)
    had_meta = META_SHEET in wb.sheetnames

    names = columns["sheetNames"]
    defs = columns["sheets"]

    products_ws = wb[names["products"]]
    products_header = _header_map(products_ws, defs["상품"])
    row_index = _row_index_by_key(products_ws, products_header)

    report = {"변경": 0, "신규": 0, "이미지": 0}

    for change in changes.get("변경", []):
        row_key = change["상품키"]
        if row_key not in row_index:
            raise ValueError(f"'{row_key}' 상품키가 원본 양식에 없습니다. 수정 대상이 맞는지 확인하세요.")
        _set_cells(products_ws, row_index[row_key], products_header, change.get("필드", {}))

        for sheet_key, name_key in CHILD_SHEETS.items():
            if sheet_key not in change:
                continue   # 안 주면 안 건드린다
            ws = wb[names[name_key]]
            header = _header_map(ws, defs[sheet_key])
            _delete_rows_for_key(ws, header, row_key)
            for entry in change[sheet_key]:
                _append_row(ws, header, _normalize_variant(entry), row_key)
        report["변경"] += 1

    for product in changes.get("신규", []):
        row_key = product["상품키"]
        if row_key in row_index:
            raise ValueError(f"'{row_key}' 상품키가 이미 양식에 있습니다. 신규 행의 상품키는 유일해야 합니다.")
        _append_row(products_ws, products_header, product.get("필드", {}), row_key)
        row_index[row_key] = products_ws.max_row

        for sheet_key, name_key in CHILD_SHEETS.items():
            for entry in product.get(sheet_key, []):
                ws = wb[names[name_key]]
                _append_row(ws, _header_map(ws, defs[sheet_key]), _normalize_variant(entry), row_key)
        report["신규"] += 1

    if "이미지" in changes:
        ws = wb[names["images"]]
        header = _header_map(ws, defs["이미지"])
        for entry in changes["이미지"]:
            _append_row(ws, header, entry)
            report["이미지"] += 1

    if had_meta and META_SHEET not in wb.sheetnames:
        raise ValueError("양식 정보 시트를 잃었습니다. 저장을 중단합니다.")

    wb.save(out_xlsx)
    return report


def main():
    parser = argparse.ArgumentParser(description="원본 양식에 변경분을 적용한다")
    parser.add_argument("src")
    parser.add_argument("changes", help="변경 JSON 파일 경로")
    parser.add_argument("out")
    parser.add_argument("--columns", default=str(pathlib.Path(__file__).parent / "columns.json"))
    args = parser.parse_args()

    changes = json.loads(pathlib.Path(args.changes).read_text(encoding="utf-8"))
    report = apply_changes(args.src, changes, args.out, load_columns(args.columns))
    print(f"변경 {report['변경']}건 · 신규 {report['신규']}건 · 이미지 {report['이미지']}건 → {args.out}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `skills/product-bulk-form/.venv/bin/python -m pytest skills/product-bulk-form/tests -q`
Expected: PASS (13건 = Task 7 의 5건 + 8건)

- [ ] **Step 5: 커밋**

```bash
git add skills/product-bulk-form/scripts/write_form.py skills/product-bulk-form/tests/test_write_form_apply.py
git commit -m "feat(bulk-form-skill): write_form.py 변경분 적용 엔진"
```

---

### Task 9: `write_form.py` 자체 검사 — fail-closed

**Files:**
- Modify: `skills/product-bulk-form/scripts/write_form.py`
- Create: `skills/product-bulk-form/tests/test_write_form_checks.py`

**Interfaces:**
- Consumes: Task 8 의 `apply_changes`
- Produces: `check_workbook(wb, columns, had_meta) -> list[str]` (위반 메시지 목록)

스펙 §3.4 의 8항목이다. 하나라도 걸리면 파일을 만들지 않는다.

> **개정 (2026-08-05, 최종 리뷰 반영)**: 실제 시그니처는 `check_workbook(wb, columns, had_meta, original_keys, touched_keys) -> (problems, warnings)` 다. ③④⑤ 는 이번에 손댄 상품키에만 fail-closed 이고 그 밖의 행은 경고로 나간다 — 근거는 스펙 §3.4 의 같은 날짜 개정 블록.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/test_write_form_checks.py`:

```python
import pytest

from write_form import apply_changes


def _new(row_key, **over):
    base = {"상품키": row_key, "필드": {"name": "x", "basePrice": "1"}}
    base.update(over)
    return base


def test_예약_형식_상품키로_신규를_만들면_거부한다(prefilled_workbook, columns, tmp_path):
    with pytest.raises(ValueError, match="P-000123"):
        apply_changes(prefilled_workbook, {"신규": [_new("P-000123")]}, tmp_path / "o.xlsx", columns)


def test_조합이_옵션_시트에_없는_값키를_가리키면_거부한다(prefilled_workbook, columns, tmp_path):
    with pytest.raises(ValueError, match="V99"):
        apply_changes(
            prefilled_workbook,
            {"신규": [_new("NEW-1",
                           옵션=[{"optionKey": "G1", "optionName": "색", "optionValueKey": "V9", "optionValueName": "검정"}],
                           조합=[{"조합": ["V99"]}])]},
            tmp_path / "o.xlsx", columns,
        )


def test_대표_카테고리가_둘이면_거부한다(prefilled_workbook, columns, tmp_path):
    with pytest.raises(ValueError, match="대표"):
        apply_changes(
            prefilled_workbook,
            {"신규": [_new("NEW-1", 카테고리=[
                {"categoryPath": "여성패션>니트", "isPrimary": "Y"},
                {"categoryPath": "여성패션>티셔츠", "isPrimary": "Y"},
            ])]},
            tmp_path / "o.xlsx", columns,
        )


def test_이미지_원본이_URL_이면_거부한다(prefilled_workbook, columns, tmp_path):
    with pytest.raises(ValueError, match="URL"):
        apply_changes(
            prefilled_workbook,
            {"이미지": [{"imageKey": "IMG-9", "sourceValue": "https://example.com/a.jpg"}]},
            tmp_path / "o.xlsx", columns,
        )


def test_위반이_있으면_출력_파일을_아예_만들지_않는다(prefilled_workbook, columns, tmp_path):
    out = tmp_path / "o.xlsx"
    with pytest.raises(ValueError):
        apply_changes(prefilled_workbook, {"신규": [_new("P-000123")]}, out, columns)
    assert not out.exists()


def test_정상_변경은_통과한다(prefilled_workbook, columns, tmp_path):
    out = tmp_path / "o.xlsx"
    apply_changes(prefilled_workbook, {"변경": [{"상품키": "P-000001", "필드": {"brand": "NEW"}}]}, out, columns)
    assert out.exists()
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `skills/product-bulk-form/.venv/bin/python -m pytest skills/product-bulk-form/tests/test_write_form_checks.py -q`
Expected: FAIL — 예외가 나지 않고 파일이 만들어진다

- [ ] **Step 3: 검사 구현**

`write_form.py` 에 추가한다. `RESERVED_ROW_KEY_RE` 는 서버의 `bulk-session.row-key.ts` 와 같은 형식을 쓴다 — 업로드 전에 알려주는 편이 낫고, 형식 예약이라 드리프트 위험이 사실상 없다:

```python
import re

RESERVED_ROW_KEY_RE = re.compile(r"^P-\d{6}$")


def check_workbook(wb, columns, had_meta):
    """양식 무결성만 본다. 비즈니스 규칙(가격·길이 상한·복합 가격규칙)은 서버 몫이다.

    검사를 얇게 유지하는 것이 설계다 — 서버 규칙을 미러하기 시작하면 그 미러가 조용히
    낡아 '스킬은 통과했는데 서버가 거부' 또는 더 나쁘게 '스킬이 유효한 작업을 막음' 이 된다.
    """
    problems = []
    names, defs = columns["sheetNames"], columns["sheets"]

    # ① 숨은 시트 보존
    if had_meta and META_SHEET not in wb.sheetnames:
        problems.append("양식 정보 시트(_양식정보)를 잃었습니다. 원본을 열어 셀만 고쳐야 합니다.")

    products_ws = wb[names["products"]]
    header = _header_map(products_ws, defs["상품"])

    # ② 필수 헤더
    for d in defs["상품"]:
        if d["required"] and d["key"] not in header:
            problems.append(f"'상품' 시트에 필수 열 '{d['label']}' 이 없습니다.")

    keys = []
    for r in range(2, products_ws.max_row + 1):
        value = products_ws.cell(row=r, column=header["rowKey"]).value if "rowKey" in header else None
        key = "" if value is None else str(value).strip()
        if key:
            keys.append(key)

    # ⑧ 상품키 중복
    for key in {k for k in keys if keys.count(k) > 1}:
        problems.append(f"상품키가 중복되었습니다: {key}")

    known = set(keys)

    # ③ 참조 무결성 + ④ 조합 키 + ⑤ 대표 카테고리
    values_by_product = {}
    for sheet_key, name_key in CHILD_SHEETS.items():
        ws = wb[names[name_key]]
        h = _header_map(ws, defs[sheet_key])
        if "rowKey" not in h:
            continue
        for r in range(2, ws.max_row + 1):
            raw = ws.cell(row=r, column=h["rowKey"]).value
            key = "" if raw is None else str(raw).strip()
            if not key:
                continue
            if key not in known:
                problems.append(f"'{sheet_key}' 시트가 '상품' 시트에 없는 상품키를 참조합니다: {key}")
                continue
            if sheet_key == "옵션" and "optionValueKey" in h:
                v = ws.cell(row=r, column=h["optionValueKey"]).value
                if v:
                    values_by_product.setdefault(key, set()).add(str(v).strip())

    ws = wb[names["variants"]]
    h = _header_map(ws, defs["조합"])
    if "rowKey" in h and "combination" in h:
        for r in range(2, ws.max_row + 1):
            raw = ws.cell(row=r, column=h["rowKey"]).value
            key = "" if raw is None else str(raw).strip()
            combo = ws.cell(row=r, column=h["combination"]).value
            if not key or not combo:
                continue
            for part in str(combo).split("+"):
                part = part.strip()
                if part and part not in values_by_product.get(key, set()):
                    problems.append(f"'{key}' 의 조합이 옵션 시트에 없는 옵션값키를 참조합니다: {part}")

    ws = wb[names["categories"]]
    h = _header_map(ws, defs["카테고리"])
    if "rowKey" in h and "isPrimary" in h:
        primary = {}
        for r in range(2, ws.max_row + 1):
            raw = ws.cell(row=r, column=h["rowKey"]).value
            key = "" if raw is None else str(raw).strip()
            if not key:
                continue
            flag = ws.cell(row=r, column=h["isPrimary"]).value
            primary.setdefault(key, 0)
            if flag is not None and str(flag).strip() == "Y":
                primary[key] += 1
        for key, count in primary.items():
            if count != 1:
                problems.append(f"'{key}' 의 대표 카테고리는 정확히 1개여야 합니다 (현재 {count}개).")

    # ⑥ 예약 상품키 — 프리필에 없던 키를 새로 만들면 서버가 거부한다
    # ⚠️ `original_keys` 는 **변경을 적용하기 전** 원본 워크북의 상품키 집합이다. 호출자
    # (`apply_changes`)가 `_row_index_by_key` 직후에 스냅샷해 넘긴다.
    #
    # 여기서 `keys`(변경 적용 후)로 prefilled 를 만들면 **검사가 무조건 통과한다** —
    # 새로 넣은 P-000123 이 keys 에 들어가고 prefilled 가 그 keys 에서 나오므로 자기
    # 자신을 가린다. (구현 중 실측으로 확인된 결함이다.)
    prefilled = {k for k in original_keys if RESERVED_ROW_KEY_RE.match(k)} if had_meta else set()
    for key in keys:
        if RESERVED_ROW_KEY_RE.match(key) and key not in prefilled:
            if had_meta:
                problems.append(f"'{key}' 는 시스템 예약 상품키 형식입니다. 다른 상품키를 지어 주세요.")
            else:
                # 양식 정보를 잃은 프리필 워크북이다. 여기서 "다른 상품키를 지어 주세요"라고
                # 하면 **정반대 조치를 안내하게 된다** — 키를 바꿔 올리면 서버의 예약 키
                # 가드(bulk-session.manager.ts)를 비껴가 카탈로그가 대량 중복 생성된다.
                problems.append(
                    f"'{key}' 는 시스템이 발급한 상품키인데 이 파일에는 양식 정보가 없습니다. "
                    "상품키를 바꾸지 말고, 상품 목록에서 양식을 다시 받아 작성해 주세요."
                )

    # ⑦ 이미지 URL
    ws = wb[names["images"]]
    h = _header_map(ws, defs["이미지"])
    if "sourceValue" in h:
        for r in range(2, ws.max_row + 1):
            value = ws.cell(row=r, column=h["sourceValue"]).value
            text = "" if value is None else str(value).strip()
            if text.startswith("http://") or text.startswith("https://"):
                problems.append(f"이미지 원본에 URL 은 쓸 수 없습니다: {text}")

    return problems
```

`apply_changes` 의 저장 직전 블록을 교체한다:

```python
    problems = check_workbook(wb, columns, had_meta)
    if problems:
        # **파일을 만들지 않는다.** 반쯤 맞는 워크북을 손에 쥐면 사람이 그걸 올려버린다.
        raise ValueError("양식 검사에서 문제를 찾았습니다:\n- " + "\n- ".join(problems))

    wb.save(out_xlsx)
    return report
```

**신규 행의 예약 키 검사 주의**: `prefilled` 는 "원본에 이미 있던 예약 키"다. 원본을 열어 편집하므로 프리필 행은 그대로 통과하고, `신규` 로 새로 추가한 예약 형식 키만 걸린다. `had_meta` 가 False(빈 양식)면 `prefilled` 가 비어 모든 예약 키가 걸린다 — 의도한 동작이다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `skills/product-bulk-form/.venv/bin/python -m pytest skills/product-bulk-form/tests -q`
Expected: PASS (19건)

- [ ] **Step 5: 커밋**

```bash
git add skills/product-bulk-form/scripts/write_form.py skills/product-bulk-form/tests/test_write_form_checks.py
git commit -m "feat(bulk-form-skill): write_form.py fail-closed 자체 검사 8항목"
```

---

### Task 10: exceljs ↔ openpyxl 상호운용 왕복 테스트

**Files:**
- Create: `apps/core/src/modules/catalog/operations/bulk-session/services/form-export.skill-interop.spec.ts`

**Interfaces:**
- Consumes: `buildFormWorkbook`, `parseUploadWorkbook`, `skills/product-bulk-form/scripts/*.py`
- Produces: 없음

진짜 위험은 스크립트 내부가 아니라 **우리 파서가 만든 파일을 파이썬이 고친 뒤 우리 파서가 다시 읽는** 왕복이다. 이 테스트의 값이 가장 크다.

- [ ] **Step 1: 테스트를 쓴다**

```typescript
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildFormWorkbook } from './form-export.workbook';
import { parseUploadWorkbook } from './bulk-upload.parser';

const SKILL = join(__dirname, '../../../../../../../../skills/product-bulk-form');
const PYTHON = join(SKILL, '.venv/bin/python');

// 파이썬 환경이 없는 CI 에서는 건너뛴다 — 동기화 테스트(form-export.columns-doc.spec.ts)가
// 가장 드리프트 위험이 큰 부분을 이미 항상 검사한다.
const describeIfPython = existsSync(PYTHON) ? describe : describe.skip;

describeIfPython('exceljs ↔ openpyxl 왕복', () => {
  it('스크립트가 고친 워크북을 우리 파서가 그대로 읽는다 — exportId 와 안 건드린 셀이 살아남는다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bulk-form-'));
    const src = join(dir, 'form.xlsx');
    const out = join(dir, 'edited.xlsx');
    const changesPath = join(dir, 'changes.json');
    const exportId = '0198f3a1-1111-7000-8000-abcdefabcdef';

    writeFileSync(
      src,
      await buildFormWorkbook({
        exportId,
        products: [{ rowKey: 'P-000001', name: '티셔츠', basePrice: '19000', brand: 'ACME' }],
        options: [],
        variants: [],
        categories: [{ rowKey: 'P-000001', categoryPath: '여성패션>티셔츠', isPrimary: 'Y' }],
        constraints: [],
        images: [],
        categoryPaths: ['여성패션>티셔츠'],
      }),
    );

    writeFileSync(
      changesPath,
      JSON.stringify({ 변경: [{ 상품키: 'P-000001', 필드: { brand: 'NEWBRAND' } }] }),
    );

    execFileSync(PYTHON, [join(SKILL, 'scripts/write_form.py'), src, changesPath, out]);

    const parsed = await parseUploadWorkbook(require('node:fs').readFileSync(out));

    expect(parsed.exportId).toBe(exportId);
    expect(parsed.sheets.products).toHaveLength(1);
    expect(parsed.sheets.products[0].cells.rowKey).toBe('P-000001');
    expect(parsed.sheets.products[0].cells.brand).toBe('NEWBRAND');
    expect(parsed.sheets.products[0].cells.name).toBe('티셔츠');       // 안 건드림
    expect(parsed.sheets.products[0].cells.basePrice).toBe('19000');  // 안 건드림
    expect(parsed.sheets.categories).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 테스트 실행**

Run: `npx jest --testPathPattern=form-export.skill-interop -c package.json`
Expected: PASS (파이썬 venv 가 있으면). 없으면 skip 으로 표시된다

- [ ] **Step 3: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/bulk-session/services/form-export.skill-interop.spec.ts
git commit -m "test(bulk-form-skill): exceljs↔openpyxl 왕복 상호운용 테스트"
```

---

### Task 11: `SKILL.md` + 레퍼런스 문서

**Files:**
- Create: `skills/product-bulk-form/SKILL.md`
- Create: `skills/product-bulk-form/references/semantics.md`
- Create: `skills/product-bulk-form/references/workflow.md`
- Create: `skills/product-bulk-form/references/recipes.md`

**Interfaces:**
- Consumes: Task 6~9 의 스크립트와 생성물
- Produces: 없음

- [ ] **Step 1: `SKILL.md` 를 쓴다**

```markdown
---
name: product-bulk-form
description: 아몬드영 상품 일괄등록/수정 엑셀 양식을 작성하거나 고칠 때 쓴다. 신규 상품 등록 양식 작성, 기존 상품 대량 수정(카테고리 이동·가격 변경 등), 타 몰에서 모은 상품 데이터를 양식으로 정리하는 작업에 사용한다.
---

# 상품 일괄등록/수정 양식 작성

스킬 버전: 1.0.0 — **작업을 시작할 때 이 버전을 사용자에게 알린다.**

## 절대 규칙

1. **워크북을 새로 만들지 않는다.** `scripts/write_form.py` 만 쓴다. `pandas.to_excel`, 새 `openpyxl.Workbook()` 으로 결과 파일을 만드는 것은 금지다 — 숨은 양식 정보 시트를 잃으면 수정이 **대량 신규 생성**으로 뒤집힌다.
2. 프리필 행의 `상품키`·`옵션키`·`옵션값키`·`조합` 은 **읽기 전용**이다.
3. 사용자가 지시하지 않은 필드는 변경 JSON 에 담지 않는다.
4. 값을 비우려면 `null` 을 명시한다. 확신이 없으면 비우지 말고 사용자에게 묻는다.
5. `[복합 가격규칙]` 이 들어 있는 칸은 건드리지 않는다.
6. 프리필 행에서 **옵션값·조합의 추가·삭제는 불가능하다.** 요청받으면 "양식으로는 안 되고 상품 상세 화면에서 해야 한다"고 답한다.
7. 이미지 `원본` 에 URL 을 쓰지 않는다. 파일 ID 또는 로컬 파일명만 쓴다.
8. **확보하지 못한 이미지가 있으면 조용히 넘어가지 않는다.** 경고하고, 어떤 상품의 어떤 이미지가 빠졌는지 목록으로 보여주고, 조치 방법을 말한다(§이미지).

## 작업 흐름

1. 사용자가 준 워크북을 `python3 scripts/read_form.py <파일>` 로 읽는다
2. 무엇을 바꿀지 사용자와 확인한다 — 특히 비우는 작업은 반드시 확인받는다
3. 변경 JSON 을 만든다 (형식은 아래)
4. `python3 scripts/write_form.py <원본> <변경.json> <결과.xlsx>` 로 적용한다
5. 검사에서 걸리면 고쳐서 다시 돈다. **검사를 우회하지 않는다**
6. 결과 파일을 사용자에게 주고, 다음에 할 일을 `references/workflow.md` 기준으로 안내한다

## 변경 JSON 형식

```json
{
  "변경": [
    { "상품키": "P-000001",
      "필드": { "brand": "ACME", "material": null },
      "카테고리": [{ "categoryPath": "여성패션>가디건", "isPrimary": "Y" }] }
  ],
  "신규": [
    { "상품키": "NEW-001",
      "필드": { "name": "니트", "basePrice": "19900" },
      "옵션": [{ "optionKey": "OPT-색상", "optionName": "색상",
                 "optionValueKey": "OV-빨강", "optionValueName": "빨강" }],
      "조합": [{ "조합": ["OV-빨강"], "variantCode": "SKU-1" }],
      "카테고리": [{ "categoryPath": "여성패션>니트", "isPrimary": "Y" }] }
  ],
  "이미지": [{ "imageKey": "IMG-10", "sourceValue": "NEW-001-main1.jpg" }]
}
```

- 키를 **안 적으면** 그 셀은 건드리지 않는다
- `null` 은 **명시적 비움**이다
- `조합` 은 옵션값키 **배열**이다. 문자열을 직접 만들지 마라 — 스크립트가 정렬해서 잇는다

내부 키 이름은 `references/columns.md` 를 본다.

## 더 읽을 것

- `references/columns.md` — 시트별 열 목록과 내부 키 (자동 생성물)
- `references/semantics.md` — 빈칸의 의미, 행 삭제, 수정 가능 범위, 이미지 전량 게이트
- `references/workflow.md` — 사용자가 화면에서 밟는 절차
- `references/recipes.md` — 카테고리 대량 이동 / 크롤링 정리 / 자체 형식 매핑
```

- [ ] **Step 2: `references/semantics.md` 를 쓴다**

다음을 반드시 담는다:

- **빈칸의 의미**: 프리필 행에서 원래 값이 있었는데 비면 "명시적 비움", 원래도 비었으면 "변경 없음". 신규 행에서는 그냥 미입력
- **행 삭제 = 변경 없음**: 상품 시트에서 프리필 행을 지우면 "이번엔 안 건드림"이지 삭제가 아니다. 임포트는 상품을 삭제하지 않는다
- **열 삭제가 셀 비우기보다 안전하다**: 열이 통째로 없으면 "안 건드림"으로 읽힌다. 셀만 비우면 "비워라"가 된다. 직관과 반대이므로 특히 주의
- **예약 상품키**: `P-` + 숫자 6자리는 시스템 발급 형식이다. 새 상품에 이 형식을 쓰면 거부된다
- **수정 가능 범위**: 스칼라 필드·카테고리·구매제약·이미지·옵션 표시명/색상/정렬·조합 가격은 가능. 옵션값 추가·삭제, 옵션 축 변경, 상품 삭제는 불가
- **가격 센티넬**: `[복합 가격규칙]` 이 든 상품은 가격을 양식으로 못 고친다. 고치면 행 오류
- **이미지 전량 게이트**: 이미지 시트에 적힌 파일명이 하나라도 안 올라오면 세션이 멈추고 취소 외에 나갈 길이 없다. 그래서 **확보 못한 이미지는 적지 않는다**. 대신 반드시 사용자에게 경고하고 목록과 조치 방법을 말한다
- **다중값과 형식**: 부가이미지키·SEO키워드는 `|` 구분, 불리언은 `Y`/`N`, 날짜는 KST 문자열

- [ ] **Step 3: `references/workflow.md` 를 쓴다**

사용자가 admin-web 에서 밟는 절차를 순서대로 담는다:

1. 수정: 상품 목록에서 대상 선택 → 「양식 다운로드」 / 신규만: 「엑셀 일괄 등록/수정」 화면의 「빈 양식 다운로드」
2. (여기서 AI 가 양식을 작성한다)
3. 「엑셀 일괄 등록/수정」 화면에서 「양식 업로드」
4. 검토 화면: 「오류」 탭 확인 — 오류가 있으면 **「오류 목록 복사」 버튼**으로 복사해 AI 에게 붙여넣는다
5. 충돌 탭: 수정 건에서 남이 같은 필드를 먼저 고쳤으면 필드별로 결정한다
6. 승인 → 이미지 단계: 이미지 폴더를 화면에 끌어다 놓는다 (요구된 파일이 전부 올라와야 다음으로 간다)
7. draft 검토 → 「일괄 발행」

각 단계에서 AI 가 할 수 있는 일과 할 수 없는 일을 명시한다.

- [ ] **Step 4: `references/recipes.md` 를 쓴다**

세 유스케이스의 구체적 절차를 담는다:

- **카테고리 대량 이동**: 양식을 읽고 → 대상 상품을 `카테고리` 로 필터 → `변경` 에 각 상품의 `카테고리` 행 목록만 담는다. 다른 시트는 건드리지 않는다. 대표여부는 반드시 1개
- **타 몰 데이터 → 신규 등록**: 수집 데이터를 상품 단위로 정리 → 상품키를 `NEW-001` 식으로 발번(예약 형식 금지) → 옵션이 있으면 옵션키·옵션값키를 사람이 읽을 수 있게 지음 → 조합은 옵션값키 배열로 → 이미지는 파일명 규칙 `<상품키>-<용도><순번>.<확장자>`

  ⚠️ **이미지 URL 은 AI 가 직접 내려받을 수 없다** — 스펙 §8 실측에서 Claude Desktop 샌드박스의 외부 네트워크가 프록시에 막혀 있음이 확인됐다. 따라서 이 레시피의 이미지 절차는 **다운로드 스크립트 경로가 기본**이다: AI 가 이미지 시트에 최종 파일명을 미리 적고, `URL → 그 파일명` 으로 받는 스크립트와 매니페스트를 만들어 MD 에게 준다. MD 가 로컬에서 실행한 뒤 admin-web 3단계에서 폴더를 끌어다 놓는다. "AI 가 받아온다"고 쓰지 마라 — 실행하면 실패한다.
- **MD 자체 형식 → 양식**: 사용자 표의 열을 `columns.md` 의 내부 키에 매핑하는 표를 먼저 만들어 사용자에게 확인받고, 그다음 변환한다

- [ ] **Step 5: 커밋**

```bash
git add skills/product-bulk-form/SKILL.md skills/product-bulk-form/references
git commit -m "docs(bulk-form-skill): SKILL.md 와 레퍼런스 문서"
```

---

### Task 12: zip 빌드 스크립트 + MD 설치 매뉴얼

**Files:**
- Create: `scripts/build-bulk-form-skill.mjs`
- Create: `docs/manuals/일괄등록-AI-스킬-사용법.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: `skills/product-bulk-form/**`
- Produces: `dist/product-bulk-form-<version>.zip`

- [ ] **Step 1: 빌드 스크립트를 쓴다**

`scripts/build-bulk-form-skill.mjs`:

```javascript
// 스킬을 claude.ai 업로드용 zip 으로 묶는다.
//
// claude.ai 커스텀 스킬은 **사용자별 zip 업로드**이고 관리자 배포가 없다. 그래서 MD 각자가
// 이 파일을 받아 올려야 하고, 갱신 때도 각자 다시 올려야 한다. SKILL.md 의 버전이 낡은
// zip 을 쓰는 사람을 찾아내는 유일한 수단이다.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const SKILL = join(ROOT, 'skills', 'product-bulk-form');
const DIST = join(ROOT, 'dist');

const skillMd = readFileSync(join(SKILL, 'SKILL.md'), 'utf8');
const version = /스킬 버전:\s*([0-9]+\.[0-9]+\.[0-9]+)/.exec(skillMd)?.[1];
if (!version) throw new Error('SKILL.md 에서 "스킬 버전: x.y.z" 를 찾지 못했습니다.');

mkdirSync(DIST, { recursive: true });
const out = join(DIST, `product-bulk-form-${version}.zip`);

// 테스트·가상환경은 빼고 스킬 본체만 담는다.
execFileSync(
  'zip',
  ['-r', out, 'product-bulk-form', '-x', '*/.venv/*', '*/tests/*', '*/requirements-dev.txt', '*/__pycache__/*'],
  { cwd: join(ROOT, 'skills'), stdio: 'inherit' },
);
console.log(`\n빌드 완료: ${out}`);
```

`package.json` scripts 에 추가:

```json
"build:bulk-form-skill": "node scripts/build-bulk-form-skill.mjs"
```

- [ ] **Step 2: 빌드해서 내용물을 확인한다**

```bash
npm run build:bulk-form-skill
unzip -l dist/product-bulk-form-1.0.0.zip
```

Expected: `SKILL.md`, `references/*.md`, `scripts/*.py`, `scripts/columns.json` 이 들어 있고 `.venv`·`tests` 는 없다

- [ ] **Step 3: MD 용 매뉴얼을 쓴다**

`docs/manuals/일괄등록-AI-스킬-사용법.md` 에 담을 것:

- **설치**: Claude Desktop → 설정 → 기능(Features) → 스킬 → zip 업로드. **코드 실행이 켜져 있어야 한다**. Pro/Max/Team/Enterprise 요금제 필요
- **갱신**: 관리자가 대신 배포할 수 없으므로 새 zip 이 나오면 각자 다시 올린다. AI 가 작업 시작 시 말하는 버전으로 자기 것이 최신인지 확인한다
- **쓰는 법**: 양식 파일을 대화에 첨부하고 하고 싶은 일을 말한다. 예시 문장 3개(카테고리 이동 / 신규 등록 / 내 표 옮기기)
- **주의**: AI 가 준 파일을 다른 프로그램에서 열어 "다른 이름으로 저장" 하지 않는다 — 양식 정보가 사라져 업로드가 거부된다
- **오류가 났을 때**: 검토 화면의 「오류 목록 복사」 → AI 에게 붙여넣기
- **권한**: `admin` 또는 `master` 권한이 없으면 화면 자체가 열리지 않는다

- [ ] **Step 4: 커밋**

```bash
git add scripts/build-bulk-form-skill.mjs package.json docs/manuals/일괄등록-AI-스킬-사용법.md
echo "dist/" >> .gitignore && git add .gitignore
git commit -m "feat(bulk-form-skill): zip 빌드 스크립트와 MD 설치 매뉴얼"
```

---

### Task 13: 전체 회귀 + 배포 준비 확인

**Files:** 없음 (검증만)

- [ ] **Step 1: core 테스트 회귀**

Run: `npx jest --testPathPattern='bulk-session|bulk-upload|bulk-draft|form-export' -c package.json`
Expected: PASS

- [ ] **Step 2: admin-web 테스트 회귀**

Run: `npm run test:admin-web`
Expected: PASS

- [ ] **Step 3: 파이썬 테스트 회귀**

Run: `skills/product-bulk-form/.venv/bin/python -m pytest skills/product-bulk-form/tests -q`
Expected: PASS (19건)

- [ ] **Step 4: 배포 전제 확인**

```bash
# 마이그레이션이 0건인지 — 하나라도 나오면 계획이 틀린 것이다
git diff --name-only origin/develop..HEAD -- 'apps/core/drizzle/*'
# env·시크릿 변경이 없는지
git diff --name-only origin/develop..HEAD | grep -E 'env.validation|sst.config|\.env' || echo "없음"
```

Expected: 둘 다 비어 있음

- [ ] **Step 5: 배포 순서를 확인하고 보고**

배포는 **core → admin-web → 스킬 zip 배포** 순서다. 다음을 사용자에게 보고한다:

- 이 브랜치의 마이그레이션·시크릿·env·이벤트 계약 건수 (전부 0이어야 한다)
- ⚠️ **스펙 §6 의 선행조건이 여전히 열려 있는지**: 라이브 core 가 `0086d1c9b`(업로드 엔드포인트 Fastify multipart 교체) 이후인지, 수동 스모크 53항목, MD 계정 `roles` 실측

---

## Self-Review

**스펙 커버리지:**

| 스펙 절 | 담당 태스크 |
|---|---|
| §3.2 ① 예약 상품키 가드 (파일 수준) | Task 2 |
| §3.2 ① 예약 상품키 가드 (행 수준) | Task 3 |
| §3.3 스킬 패키지 구조 | Task 7·8·9·11·12 |
| §3.4 `read_form.py` 조인 | Task 7 |
| §3.4 `write_form.py` 변경분 의미 | Task 8 |
| §3.4 조합 정렬 | Task 8 (`_normalize_variant`) |
| §3.4 자체 검사 8항목 | Task 9 |
| §3.5 절대 규칙 8개 | Task 11 (`SKILL.md`) |
| §3.6 지식 범위 | Task 11 (references) |
| §3.7 이미지 파이프라인 | Task 11 (`semantics.md`·`recipes.md`) |
| §3.8 ③ 열 레퍼런스 동기화 | Task 6 |
| §3.9 ④ 오류 목록 복사 | Task 4·5 |
| §3.10 배포 패키징 | Task 12 |
| §5 테스트 전략 | Task 6·7·8·9·10, Task 13 |
| §8 런타임 실측 | Task 0 |

빠진 스펙 요구사항 없음.

**타입 일관성:** `isReservedRowKey`(Task 1) → Task 2·3 에서 같은 이름으로 호출. `formatErrorReport`(Task 4) → Task 5 에서 같은 시그니처. `load_columns`/`read_form`(Task 7) → Task 8 이 `from read_form import load_columns` 로 재사용. `apply_changes`(Task 8) → Task 9 가 같은 함수에 검사를 붙임. `check_workbook`(Task 9)이 쓰는 `_header_map`·`CHILD_SHEETS`·`META_SHEET` 는 전부 Task 8 에서 정의됨.

**주의 (구현자에게):** Task 3 실행 후 기존 테스트 픽스처가 깨질 수 있다. `P-000001` 을 **신규** 키로 쓰던 픽스처가 있다면 가드가 의도대로 문 것이므로, 픽스처를 `NEW-001` 로 고치는 것이 옳은 대응이다 — 가드를 느슨하게 만들지 마라.

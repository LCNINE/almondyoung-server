# 판매상품 대량등록 admin-web 재구축 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** admin-web에 신규 엑셀 대량등록 UI(세션목록/등록위저드/세션상세 3페이지)를 구축하고 기존 CSV 대량등록 UI를 제거한다.

**Architecture:** 백엔드 `feat/product-bulk-import-redesign` 의 `/product-imports/*` 6개 엔드포인트에 대응하는 axios 클라이언트 + react-query 훅을 추가하고, 그 위에 3개 Next.js 페이지와 feature 컴포넌트를 얹는다. 검증(validate)은 무상태 프리뷰, 커밋(commit)은 세션+draft 생성, 게시(publish)는 세션 상세에서 수행한다. 파일은 위저드가 메모리에 쥐고 validate/commit에 재사용한다.

**Tech Stack:** Next.js 15 (App Router, `params: Promise<>`), React 19, `@tanstack/react-query`, axios(`lib/api/client.ts`), Tailwind, sonner(toast), lucide-react. 테스트는 루트 Jest(순수 `.ts` 로직만 — jsdom/tsx 미지원).

## Global Constraints

- 신규 라우트: `/mall/product-imports`(목록) · `/mall/product-imports/new`(위저드) · `/mall/product-imports/[sessionId]`(상세). 모든 페이지 `RouteGuard requireRole={['admin', 'master']}`.
- commit은 **body에 userId를 넣지 않는다**(백엔드 `@User()` 서버 처리). validate/commit은 `multipart/form-data`, 필드명 `file`.
- **커밋 게이팅**: `validCount`/`invalidCount` 기준 `invalidCount === 0 && totalRows > 0` 일 때만 커밋 허용.
- **게시는 세션 상세에서만.** 위저드 커밋 결과 화면엔 "세션 상세로 이동" 링크만.
- 신규 DTO 타입은 `lib/types/dto/product-import.ts` 에만 정의. 기존 `products.ts` 는 CSV 타입 제거만.
- API 클라이언트는 기존 `csv.client.ts` 패턴 준수: `import { ALMONDYOUNG_API_BASE_URL } from '@/const'` + `import { client } from '../../client'`.
- 권위 게이트 = `apps/admin-web` 에서 `tsc --noEmit`(신규/변경 파일에 새 에러 0) + `next build`. UI 컴포넌트는 렌더 유닛테스트 대상 아님(순수 `.ts` 로직만 Jest). 레포 type-check/lint 는 상시 debt 이므로 "변경 파일 신규 에러"만 스코프.
- 롤아웃: 이 브랜치는 develop 분기, PR 대상 develop. `/products/csv/*` 백엔드 제거 배포와 같은 배포에 묶는다(스펙 §7).
- 모든 경로는 `apps/admin-web/` 기준 상대. 명령은 명시된 cwd에서 실행.

---

### Task 1: DTO 타입 + API 클라이언트 + 배럴 연결

**Files:**
- Create: `apps/admin-web/src/lib/types/dto/product-import.ts`
- Create: `apps/admin-web/src/lib/api/domains/products/product-import.client.ts`
- Modify: `apps/admin-web/src/lib/api/domains/products/index.ts` (import/entry/re-export 추가 — csv 항목은 Task 8까지 유지)

**Interfaces:**
- Produces: `product-import.ts` 타입 —
  - `ValidatePreviewDto = { totalRows, validCount, invalidCount, rows: ValidatePreviewRow[] }`
  - `ValidatePreviewRow = { rowNumber: number; productKey: string; status: 'valid'|'invalid'; errors: string[]; resolved: { name: string; categoryNames: string[]; variantCount: number } }`
  - `CommitResultDto = { sessionId: string; createdCount: number; failedCount: number; items: CommitItem[] }`
  - `CommitItem = { rowNumber: number; productKey: string; status: 'created'|'failed'; masterId?: string; errorMessage?: string }`
  - `SessionSummaryDto = { id: string; fileName: string|null; totalRows: number; createdCount: number; failedCount: number; status: string; createdAt: string }`
  - `SessionDetailDto = SessionSummaryDto & { items: CommitItem[] }`
  - `SessionListResponse = { data: SessionSummaryDto[]; total: number; page: number; limit: number }`
  - `PublishResultDto = { published: number; failed: { masterId: string; reason: string }[] }`
- Produces: `productImportClient` 로 `products.productImport.{downloadTemplate,validate,commit,getSessions,getSession,publish}` 접근.

- [ ] **Step 1: DTO 타입 파일 작성**

Create `apps/admin-web/src/lib/types/dto/product-import.ts`:
```ts
// src/lib/types/dto/product-import.ts
// 판매상품 대량등록(엑셀 임포트) API DTO 미러 타입.
// 백엔드: apps/core/.../operations/import/dto/import-response.dto.ts

export interface ResolvedPreview {
  name: string;
  categoryNames: string[];
  variantCount: number;
}

export interface ValidatePreviewRow {
  rowNumber: number;
  productKey: string;
  status: 'valid' | 'invalid';
  errors: string[];
  resolved: ResolvedPreview;
}

export interface ValidatePreviewDto {
  totalRows: number;
  validCount: number;
  invalidCount: number;
  rows: ValidatePreviewRow[];
}

export interface CommitItem {
  rowNumber: number;
  productKey: string;
  status: 'created' | 'failed';
  masterId?: string;
  errorMessage?: string;
}

export interface CommitResultDto {
  sessionId: string;
  createdCount: number;
  failedCount: number;
  items: CommitItem[];
}

export interface SessionSummaryDto {
  id: string;
  fileName: string | null;
  totalRows: number;
  createdCount: number;
  failedCount: number;
  status: string;
  createdAt: string; // JSON 직렬화 결과(백엔드 Date → string)
}

export interface SessionDetailDto extends SessionSummaryDto {
  items: CommitItem[];
}

export interface SessionListResponse {
  data: SessionSummaryDto[];
  total: number;
  page: number;
  limit: number;
}

export interface PublishFailure {
  masterId: string;
  reason: string;
}

export interface PublishResultDto {
  published: number;
  failed: PublishFailure[];
}
```

- [ ] **Step 2: API 클라이언트 작성**

Create `apps/admin-web/src/lib/api/domains/products/product-import.client.ts`:
```ts
'use client';

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import type {
  ValidatePreviewDto,
  CommitResultDto,
  SessionDetailDto,
  SessionListResponse,
  PublishResultDto,
} from '@/lib/types/dto/product-import';
import { client } from '../../client';

const BASE = `${ALMONDYOUNG_API_BASE_URL}/product-imports`;

export const productImportClient = {
  downloadTemplate: async (): Promise<Blob> => {
    const res = await client.get(`${BASE}/template`, { responseType: 'blob' });
    return res.data;
  },

  validate: async (file: File): Promise<ValidatePreviewDto> => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await client.post(`${BASE}/validate`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return res.data;
  },

  commit: async (file: File): Promise<CommitResultDto> => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await client.post(`${BASE}/commit`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return res.data;
  },

  getSessions: async (
    page: number,
    limit: number
  ): Promise<SessionListResponse> => {
    const res = await client.get(BASE, { params: { page, limit } });
    return res.data;
  },

  getSession: async (sessionId: string): Promise<SessionDetailDto> => {
    const res = await client.get(`${BASE}/${sessionId}`);
    return res.data;
  },

  publish: async (sessionId: string): Promise<PublishResultDto> => {
    const res = await client.post(`${BASE}/${sessionId}/publish`);
    return res.data;
  },
};
```

- [ ] **Step 3: 배럴에 연결**

Modify `apps/admin-web/src/lib/api/domains/products/index.ts`. 기존 import 블록(예: `import { csvClient } from './csv.client';` 근처)에 추가:
```ts
import { productImportClient } from './product-import.client';
```
`products` 객체 안 `csv: csvClient,` 다음 줄에 추가:
```ts
  productImport: productImportClient,
```
파일 하단 re-export(예: `export { csvClient } from './csv.client';` 근처)에 추가:
```ts
export { productImportClient } from './product-import.client';
```

- [ ] **Step 4: 타입 게이트**

Run (cwd `apps/admin-web`): `npx tsc --noEmit 2>&1 | grep -E "product-import" || echo "OK: no new errors in product-import files"`
Expected: `OK: no new errors in product-import files`

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/src/lib/types/dto/product-import.ts \
        apps/admin-web/src/lib/api/domains/products/product-import.client.ts \
        apps/admin-web/src/lib/api/domains/products/index.ts
git commit -m "feat(admin-web): product-import DTO 타입 + API 클라이언트"
```

---

### Task 2: react-query 쿼리키 + 훅

**Files:**
- Modify: `apps/admin-web/src/lib/services/products/query-keys.ts`
- Modify: `apps/admin-web/src/lib/services/products/query-keys.spec.ts` (테스트 추가)
- Modify: `apps/admin-web/src/lib/services/products/queries.ts` (쿼리 훅 추가)
- Modify: `apps/admin-web/src/lib/services/products/mutations.ts` (뮤테이션 훅 추가)

**Interfaces:**
- Consumes: `products.productImport.*`(Task 1), `productQueryKeys`(기존).
- Produces:
  - `productQueryKeys.productImports`, `productQueryKeys.productImportsList(page)`, `productQueryKeys.productImport(sessionId)`
  - queries: `useImportSessions(page: number)` → `SessionListResponse`, `useImportSession(sessionId: string)` → `SessionDetailDto`
  - mutations: `useValidateImport()` (`mutate(file)` → `ValidatePreviewDto`), `useCommitImport()` (`mutate(file)` → `CommitResultDto`), `usePublishSession()` (`mutate(sessionId)` → `PublishResultDto`)

- [ ] **Step 1: 실패하는 쿼리키 테스트 작성**

Modify `apps/admin-web/src/lib/services/products/query-keys.spec.ts` — 파일 끝에 추가:
```ts
describe('productImports query keys', () => {
  it('list 키는 page 를 포함한다', () => {
    expect(productQueryKeys.productImportsList(2)).toEqual([
      'product-imports',
      'list',
      2,
    ]);
  });
  it('detail 키는 sessionId 를 포함한다', () => {
    expect(productQueryKeys.productImport('s1')).toEqual([
      'product-imports',
      's1',
    ]);
  });
});
```
(파일 상단에 `import { productQueryKeys } from './query-keys';` 가 이미 있으면 재사용, 없으면 기존 import 스타일에 맞춰 추가.)

- [ ] **Step 2: 테스트 실패 확인**

Run (cwd 레포 루트): `npx jest --testPathPattern="products/query-keys" -t "productImports query keys"`
Expected: FAIL — `productImportsList`/`productImport` is not a function

- [ ] **Step 3: 쿼리키 추가**

Modify `apps/admin-web/src/lib/services/products/query-keys.ts` — `productQueryKeys` 객체 안 `pendingApprovals`/`approvalHistory` 다음(닫는 `} as const;` 직전)에 추가:
```ts
  // 대량등록(엑셀 임포트) 관련
  productImports: ['product-imports'] as const,
  productImportsList: (page: number) =>
    [...productQueryKeys.productImports, 'list', page] as const,
  productImport: (sessionId: string) =>
    [...productQueryKeys.productImports, sessionId] as const,
```

- [ ] **Step 4: 테스트 통과 확인**

Run (cwd 레포 루트): `npx jest --testPathPattern="products/query-keys" -t "productImports query keys"`
Expected: PASS

- [ ] **Step 5: 쿼리 훅 추가**

Modify `apps/admin-web/src/lib/services/products/queries.ts` — 파일 끝에 추가:
```ts
// ===== 대량등록(엑셀 임포트) 쿼리 =====

/** 임포트 세션 목록(페이지네이션, limit 20 고정) */
export const useImportSessions = (page: number) => {
  return useQuery({
    queryKey: productQueryKeys.productImportsList(page),
    queryFn: () => products.productImport.getSessions(page, 20),
    staleTime: 30 * 1000,
  });
};

/** 임포트 세션 상세(성공/실패 아이템 전체) */
export const useImportSession = (sessionId: string) => {
  return useQuery({
    queryKey: productQueryKeys.productImport(sessionId),
    queryFn: () => products.productImport.getSession(sessionId),
    enabled: !!sessionId,
  });
};
```

- [ ] **Step 6: 뮤테이션 훅 추가**

Modify `apps/admin-web/src/lib/services/products/mutations.ts` — 파일 끝에 추가:
```ts
// ===== 대량등록(엑셀 임포트) 뮤테이션 =====

/** 워크북 검증(무상태 프리뷰) */
export const useValidateImport = () => {
  return useMutation({
    mutationFn: (file: File) => products.productImport.validate(file),
  });
};

/** 워크북 커밋(세션 + draft 상품 일괄 생성) */
export const useCommitImport = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => products.productImport.commit(file),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.productImports,
      });
    },
  });
};

/** 세션 draft 일괄 게시 */
export const usePublishSession = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) =>
      products.productImport.publish(sessionId),
    onSuccess: (_res, sessionId) => {
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.productImport(sessionId),
      });
    },
  });
};
```
(`mutations.ts` 상단에 `useMutation`, `useQueryClient`, `products`, `productQueryKeys` import 이 이미 존재 — 재사용. `queries.ts` 상단 `useQuery`/`products`/`productQueryKeys` 동일.)

- [ ] **Step 7: 타입 게이트**

Run (cwd `apps/admin-web`): `npx tsc --noEmit 2>&1 | grep -E "services/products/(queries|mutations|query-keys)" || echo "OK"`
Expected: `OK`

- [ ] **Step 8: Commit**

```bash
git add apps/admin-web/src/lib/services/products/query-keys.ts \
        apps/admin-web/src/lib/services/products/query-keys.spec.ts \
        apps/admin-web/src/lib/services/products/queries.ts \
        apps/admin-web/src/lib/services/products/mutations.ts
git commit -m "feat(admin-web): product-import 쿼리키 + react-query 훅"
```

---

### Task 3: 커밋 게이팅 순수 함수 (TDD)

**Files:**
- Create: `apps/admin-web/src/features/mall/product-imports/wizard/can-commit.ts`
- Create: `apps/admin-web/src/features/mall/product-imports/wizard/can-commit.spec.ts`

**Interfaces:**
- Consumes: `ValidatePreviewDto`(Task 1, `import type`).
- Produces: `canCommit(preview: ValidatePreviewDto | null | undefined): boolean` — `true` iff `preview && preview.totalRows > 0 && preview.invalidCount === 0`.

- [ ] **Step 1: 실패하는 테스트 작성**

Create `apps/admin-web/src/features/mall/product-imports/wizard/can-commit.spec.ts`:
```ts
import { canCommit } from './can-commit';
import type { ValidatePreviewDto } from '@/lib/types/dto/product-import';

const preview = (over: Partial<ValidatePreviewDto> = {}): ValidatePreviewDto => ({
  totalRows: 3,
  validCount: 3,
  invalidCount: 0,
  rows: [],
  ...over,
});

describe('canCommit', () => {
  it('invalid 0 이고 총 행 > 0 이면 true', () => {
    expect(canCommit(preview())).toBe(true);
  });
  it('invalid 가 하나라도 있으면 false', () => {
    expect(canCommit(preview({ invalidCount: 1, validCount: 2 }))).toBe(false);
  });
  it('총 행이 0 이면 false', () => {
    expect(canCommit(preview({ totalRows: 0, validCount: 0 }))).toBe(false);
  });
  it('preview 가 없으면 false', () => {
    expect(canCommit(null)).toBe(false);
    expect(canCommit(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run (cwd 레포 루트): `npx jest --testPathPattern="can-commit"`
Expected: FAIL — Cannot find module './can-commit'

- [ ] **Step 3: 구현**

Create `apps/admin-web/src/features/mall/product-imports/wizard/can-commit.ts`:
```ts
import type { ValidatePreviewDto } from '@/lib/types/dto/product-import';

/**
 * 커밋 게이팅: invalid 행이 0 개이고 등록할 유효 행이 1개 이상일 때만 커밋 허용.
 * (invalid 행이 있으면 파일 수정 → 재검증을 강제한다.)
 */
export function canCommit(
  preview: ValidatePreviewDto | null | undefined
): boolean {
  if (!preview) return false;
  return preview.totalRows > 0 && preview.invalidCount === 0;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run (cwd 레포 루트): `npx jest --testPathPattern="can-commit"`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/src/features/mall/product-imports/wizard/can-commit.ts \
        apps/admin-web/src/features/mall/product-imports/wizard/can-commit.spec.ts
git commit -m "feat(admin-web): 대량등록 커밋 게이팅 canCommit"
```

---

### Task 4: 위저드 스텝 컴포넌트 (업로드 / 검증 / 커밋결과)

**Files:**
- Create: `apps/admin-web/src/features/mall/product-imports/wizard/upload-step.tsx`
- Create: `apps/admin-web/src/features/mall/product-imports/wizard/validate-step.tsx`
- Create: `apps/admin-web/src/features/mall/product-imports/wizard/commit-result-step.tsx`

**Interfaces:**
- Consumes: `products.productImport.downloadTemplate`(Task 1), `canCommit`(Task 3), DTO 타입(Task 1).
- Produces (Task 5 컨테이너가 소비):
  - `UploadStep({ onFileSelected }: { onFileSelected: (file: File) => void })`
  - `ValidateStep({ preview, isLoading, committing, onReupload, onCommit }: { preview: ValidatePreviewDto | null; isLoading: boolean; committing: boolean; onReupload: () => void; onCommit: () => void })`
  - `CommitResultStep({ result, onGoToSession }: { result: CommitResultDto; onGoToSession: () => void })`

- [ ] **Step 1: 업로드 스텝 작성**

Create `apps/admin-web/src/features/mall/product-imports/wizard/upload-step.tsx`:
```tsx
'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { products } from '@/lib/api/domains';
import { FileDown, Upload } from 'lucide-react';

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

interface Props {
  onFileSelected: (file: File) => void;
}

export function UploadStep({ onFileSelected }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [downloading, setDownloading] = useState(false);

  async function handleTemplate() {
    setDownloading(true);
    try {
      const blob = await products.productImport.downloadTemplate();
      downloadBlob(blob, 'product-import-template.xlsx');
      toast.success('템플릿이 다운로드되었습니다.');
    } catch {
      toast.error('템플릿 다운로드 중 오류가 발생했습니다.');
    } finally {
      setDownloading(false);
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    onFileSelected(file);
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-1 text-sm font-semibold">1. 엑셀 파일 업로드</h3>
        <p className="text-xs text-muted-foreground">
          템플릿(Products/Options 시트)을 받아 작성한 뒤 업로드하세요. 업로드하면
          자동으로 검증됩니다.
        </p>
      </div>

      <Button variant="outline" onClick={handleTemplate} disabled={downloading}>
        <FileDown className="mr-2 h-4 w-4" />
        {downloading ? '다운로드 중...' : '템플릿 다운로드'}
      </Button>

      <div
        className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/30 p-8 transition-colors hover:border-primary/50"
        onClick={() => fileRef.current?.click()}
      >
        <Upload className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          클릭하여 엑셀 파일(.xlsx) 선택
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx"
          className="hidden"
          onChange={handleChange}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 검증 스텝 작성**

Create `apps/admin-web/src/features/mall/product-imports/wizard/validate-step.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { canCommit } from './can-commit';
import type { ValidatePreviewDto } from '@/lib/types/dto/product-import';

interface Props {
  preview: ValidatePreviewDto | null;
  isLoading: boolean;
  committing: boolean;
  onReupload: () => void;
  onCommit: () => void;
}

export function ValidateStep({
  preview,
  isLoading,
  committing,
  onReupload,
  onCommit,
}: Props) {
  const [onlyErrors, setOnlyErrors] = useState(false);

  if (isLoading || !preview) {
    return (
      <div className="py-10 text-center text-sm text-muted-foreground">
        검증 중...
      </div>
    );
  }

  const rows = onlyErrors
    ? preview.rows.filter((r) => r.status === 'invalid')
    : preview.rows;
  const commitEnabled = canCommit(preview);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-1 text-sm font-semibold">2. 검증 프리뷰</h3>
        <p className="text-xs text-muted-foreground">
          총 {preview.totalRows}건 · 유효{' '}
          <strong className="text-green-600">{preview.validCount}</strong> · 오류{' '}
          <strong className="text-destructive">{preview.invalidCount}</strong>
        </p>
      </div>

      {!commitEnabled && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          {preview.totalRows === 0
            ? '등록할 유효한 행이 없습니다. 파일을 확인하세요.'
            : `오류 ${preview.invalidCount}건을 수정한 뒤 파일을 다시 업로드해 재검증하세요.`}
        </div>
      )}

      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={onlyErrors}
          onChange={(e) => setOnlyErrors(e.target.checked)}
        />
        오류 행만 보기
      </label>

      <div className="max-h-[420px] overflow-auto rounded-md border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted/50">
            <tr className="text-left">
              <th className="p-2">행</th>
              <th className="p-2">productKey</th>
              <th className="p-2">상태</th>
              <th className="p-2">상품명</th>
              <th className="p-2">카테고리</th>
              <th className="p-2">변형 수</th>
              <th className="p-2">오류</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.rowNumber} className="border-t align-top">
                <td className="p-2">{r.rowNumber}</td>
                <td className="p-2">{r.productKey}</td>
                <td className="p-2">
                  {r.status === 'valid' ? (
                    <span className="text-green-600">유효</span>
                  ) : (
                    <span className="text-destructive">오류</span>
                  )}
                </td>
                <td className="p-2">{r.resolved.name}</td>
                <td className="p-2">{r.resolved.categoryNames.join(' > ')}</td>
                <td className="p-2">{r.resolved.variantCount}</td>
                <td className="p-2 text-destructive">
                  {r.errors.join(', ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex gap-2">
        <Button variant="outline" onClick={onReupload} disabled={committing}>
          파일 다시 업로드
        </Button>
        <Button onClick={onCommit} disabled={!commitEnabled || committing}>
          {committing ? '커밋 중...' : `커밋 (${preview.validCount}건 등록)`}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 커밋 결과 스텝 작성**

Create `apps/admin-web/src/features/mall/product-imports/wizard/commit-result-step.tsx`:
```tsx
'use client';

import { Button } from '@/components/ui/button';
import type { CommitResultDto } from '@/lib/types/dto/product-import';

interface Props {
  result: CommitResultDto;
  onGoToSession: () => void;
}

export function CommitResultStep({ result, onGoToSession }: Props) {
  const failedItems = result.items.filter((i) => i.status === 'failed');

  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-1 text-sm font-semibold">3. 커밋 결과</h3>
        <p className="text-xs text-muted-foreground">
          성공{' '}
          <strong className="text-green-600">{result.createdCount}</strong> · 실패{' '}
          <strong className="text-destructive">{result.failedCount}</strong>{' '}
          — 상품은 draft 로 생성되었습니다. 세션 상세에서 검토 후 게시하세요.
        </p>
      </div>

      {failedItems.length > 0 && (
        <div className="space-y-1 rounded-md border border-destructive/30 bg-destructive/5 p-3">
          <p className="text-sm font-medium text-destructive">
            실패한 행 ({failedItems.length}개)
          </p>
          <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-muted-foreground">
            {failedItems.map((i) => (
              <li key={i.rowNumber}>
                행 {i.rowNumber} ({i.productKey}) — {i.errorMessage}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Button onClick={onGoToSession}>세션 상세로 이동</Button>
    </div>
  );
}
```

- [ ] **Step 4: 타입 게이트**

Run (cwd `apps/admin-web`): `npx tsc --noEmit 2>&1 | grep -E "product-imports/wizard/(upload|validate|commit-result)" || echo "OK"`
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/src/features/mall/product-imports/wizard/upload-step.tsx \
        apps/admin-web/src/features/mall/product-imports/wizard/validate-step.tsx \
        apps/admin-web/src/features/mall/product-imports/wizard/commit-result-step.tsx
git commit -m "feat(admin-web): 대량등록 위저드 스텝 컴포넌트"
```

---

### Task 5: 위저드 컨테이너 + `/new` 라우트

**Files:**
- Create: `apps/admin-web/src/features/mall/product-imports/wizard/index.tsx`
- Create: `apps/admin-web/src/app/(admin)/mall/product-imports/new/page.tsx`

**Interfaces:**
- Consumes: `UploadStep`/`ValidateStep`/`CommitResultStep`(Task 4), `useValidateImport`/`useCommitImport`(Task 2).
- Produces: `ImportWizard()` 기본 export(client), `/mall/product-imports/new` 페이지.

- [ ] **Step 1: 위저드 컨테이너 작성**

Create `apps/admin-web/src/features/mall/product-imports/wizard/index.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { useValidateImport, useCommitImport } from '@/lib/services/products';
import type {
  ValidatePreviewDto,
  CommitResultDto,
} from '@/lib/types/dto/product-import';
import { UploadStep } from './upload-step';
import { ValidateStep } from './validate-step';
import { CommitResultStep } from './commit-result-step';

type Step = 1 | 2 | 3;

const STEP_LABELS: Record<Step, string> = {
  1: '업로드',
  2: '검증',
  3: '완료',
};

function Stepper({ current }: { current: Step }) {
  return (
    <div className="flex gap-2 px-6 pb-2 text-xs">
      {([1, 2, 3] as Step[]).map((s) => (
        <span
          key={s}
          className={
            s === current
              ? 'font-semibold text-primary'
              : 'text-muted-foreground'
          }
        >
          {s}. {STEP_LABELS[s]}
        </span>
      ))}
    </div>
  );
}

export default function ImportWizard() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ValidatePreviewDto | null>(null);
  const [result, setResult] = useState<CommitResultDto | null>(null);

  const validate = useValidateImport();
  const commit = useCommitImport();

  function handleFileSelected(f: File) {
    setFile(f);
    setPreview(null);
    setStep(2);
    validate.mutate(f, {
      onSuccess: setPreview,
      onError: () => {
        toast.error('검증 중 오류가 발생했습니다.');
        setStep(1);
      },
    });
  }

  function handleReupload() {
    setStep(1);
    setFile(null);
    setPreview(null);
  }

  function handleCommit() {
    if (!file) return;
    commit.mutate(file, {
      onSuccess: (res) => {
        setResult(res);
        setStep(3);
      },
      onError: () => toast.error('커밋 중 오류가 발생했습니다.'),
    });
  }

  return (
    <div className="flex flex-col gap-y-4">
      <Container className="divide-y-0">
        <Header
          title="엑셀 대량등록"
          subtitle="엑셀로 판매상품을 일괄 등록합니다. (업로드 → 검증 → 커밋)"
        />
        <Stepper current={step} />
        <div className="p-6 pt-2">
          {step === 1 && <UploadStep onFileSelected={handleFileSelected} />}
          {step === 2 && (
            <ValidateStep
              preview={preview}
              isLoading={validate.isPending}
              committing={commit.isPending}
              onReupload={handleReupload}
              onCommit={handleCommit}
            />
          )}
          {step === 3 && result && (
            <CommitResultStep
              result={result}
              onGoToSession={() =>
                router.push(`/mall/product-imports/${result.sessionId}`)
              }
            />
          )}
        </div>
      </Container>
    </div>
  );
}
```

- [ ] **Step 2: `/new` 페이지 라우트 작성**

Create `apps/admin-web/src/app/(admin)/mall/product-imports/new/page.tsx`:
```tsx
import RouteGuard from '@/components/layout/route-guard';
import ImportWizard from '@/features/mall/product-imports/wizard';

export default function ProductImportNewPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <ImportWizard />
      </div>
    </RouteGuard>
  );
}
```

- [ ] **Step 3: 타입 게이트**

Run (cwd `apps/admin-web`): `npx tsc --noEmit 2>&1 | grep -E "product-imports" || echo "OK"`
Expected: `OK`

- [ ] **Step 4: (선택) 로컬 스모크**

백엔드가 로컬에 있을 때만: dev 서버(`npm run start:admin-web:dev`) → `/mall/product-imports/new` 접속 → 템플릿 다운로드 → 파일 업로드 → 검증 프리뷰 → 커밋 → 세션 상세 이동 확인. 백엔드 미기동 시 이 스텝은 배포 후로 보류(스펙 §8).

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/src/features/mall/product-imports/wizard/index.tsx \
        "apps/admin-web/src/app/(admin)/mall/product-imports/new/page.tsx"
git commit -m "feat(admin-web): 대량등록 위저드 컨테이너 + /new 라우트"
```

---

### Task 6: 세션 목록 페이지 + feature

**Files:**
- Create: `apps/admin-web/src/features/mall/product-imports/session-list/index.tsx`
- Create: `apps/admin-web/src/app/(admin)/mall/product-imports/page.tsx`

**Interfaces:**
- Consumes: `useImportSessions`(Task 2), `SessionSummaryDto`(Task 1).
- Produces: `SessionList()` 컴포넌트, `/mall/product-imports` 페이지(진입점).

- [ ] **Step 1: 세션 목록 feature 작성**

Create `apps/admin-web/src/features/mall/product-imports/session-list/index.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { useImportSessions } from '@/lib/services/products';
import { Plus } from 'lucide-react';

const LIMIT = 20;

export function SessionList() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const { data, isLoading } = useImportSessions(page);

  const sessions = data?.data ?? [];
  const total = data?.total ?? 0;
  const maxPage = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div className="flex flex-col gap-y-4">
      <Container className="divide-y-0">
        <Header
          title="엑셀 대량등록"
          subtitle="과거 대량등록 세션을 확인하거나 새로 등록합니다."
          right={
            <Button onClick={() => router.push('/mall/product-imports/new')}>
              <Plus className="mr-2 h-4 w-4" />새 대량등록
            </Button>
          }
        />
        <div className="p-6 pt-2">
          <div className="overflow-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="text-left">
                  <th className="p-2">파일명</th>
                  <th className="p-2">시도</th>
                  <th className="p-2">성공</th>
                  <th className="p-2">실패</th>
                  <th className="p-2">상태</th>
                  <th className="p-2">생성일시</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr>
                    <td className="p-4 text-muted-foreground" colSpan={6}>
                      불러오는 중...
                    </td>
                  </tr>
                )}
                {!isLoading && sessions.length === 0 && (
                  <tr>
                    <td className="p-4 text-muted-foreground" colSpan={6}>
                      대량등록 이력이 없습니다.
                    </td>
                  </tr>
                )}
                {sessions.map((s) => (
                  <tr
                    key={s.id}
                    className="cursor-pointer border-t hover:bg-muted/30"
                    onClick={() => router.push(`/mall/product-imports/${s.id}`)}
                  >
                    <td className="p-2">{s.fileName ?? '(파일명 없음)'}</td>
                    <td className="p-2">{s.totalRows}</td>
                    <td className="p-2 text-green-600">{s.createdCount}</td>
                    <td className="p-2 text-destructive">{s.failedCount}</td>
                    <td className="p-2">{s.status}</td>
                    <td className="p-2">
                      {new Date(s.createdAt).toLocaleString('ko-KR')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex items-center justify-end gap-2 text-sm">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              이전
            </Button>
            <span className="text-muted-foreground">
              {page} / {maxPage}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= maxPage}
              onClick={() => setPage((p) => p + 1)}
            >
              다음
            </Button>
          </div>
        </div>
      </Container>
    </div>
  );
}
```

- [ ] **Step 2: 목록 페이지 라우트 작성**

Create `apps/admin-web/src/app/(admin)/mall/product-imports/page.tsx`:
```tsx
import RouteGuard from '@/components/layout/route-guard';
import { SessionList } from '@/features/mall/product-imports/session-list';

export default function ProductImportsPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <SessionList />
      </div>
    </RouteGuard>
  );
}
```

- [ ] **Step 3: 타입 게이트**

Run (cwd `apps/admin-web`): `npx tsc --noEmit 2>&1 | grep -E "product-imports/session-list|mall/product-imports/page" || echo "OK"`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add apps/admin-web/src/features/mall/product-imports/session-list/index.tsx \
        "apps/admin-web/src/app/(admin)/mall/product-imports/page.tsx"
git commit -m "feat(admin-web): 대량등록 세션 목록 페이지"
```

---

### Task 7: 세션 상세 페이지 + feature (일괄 게시)

**Files:**
- Create: `apps/admin-web/src/features/mall/product-imports/session-detail/index.tsx`
- Create: `apps/admin-web/src/app/(admin)/mall/product-imports/[sessionId]/page.tsx`

**Interfaces:**
- Consumes: `useImportSession`/`usePublishSession`(Task 2), `PublishResultDto`(Task 1).
- Produces: `SessionDetail({ sessionId }: { sessionId: string })`, `/mall/product-imports/[sessionId]` 페이지.

- [ ] **Step 1: 세션 상세 feature 작성**

Create `apps/admin-web/src/features/mall/product-imports/session-detail/index.tsx`:
```tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { useImportSession, usePublishSession } from '@/lib/services/products';
import type { PublishResultDto } from '@/lib/types/dto/product-import';

interface Props {
  sessionId: string;
}

export function SessionDetail({ sessionId }: Props) {
  const { data: session, isLoading } = useImportSession(sessionId);
  const publish = usePublishSession();
  const [publishResult, setPublishResult] = useState<PublishResultDto | null>(
    null
  );

  function handlePublish() {
    publish.mutate(sessionId, {
      onSuccess: (res) => {
        setPublishResult(res);
        if (res.failed.length === 0) {
          toast.success(`${res.published}건이 게시되었습니다.`);
        } else {
          toast.warning(
            `${res.published}건 게시, ${res.failed.length}건 실패했습니다.`
          );
        }
      },
      onError: () => toast.error('게시 중 오류가 발생했습니다.'),
    });
  }

  if (isLoading || !session) {
    return (
      <div className="py-10 text-center text-sm text-muted-foreground">
        불러오는 중...
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-y-4">
      <Container className="divide-y-0">
        <Header
          title="대량등록 세션 상세"
          subtitle={`${session.fileName ?? '(파일명 없음)'} · 시도 ${session.totalRows} · 성공 ${session.createdCount} · 실패 ${session.failedCount}`}
          right={
            <Button
              onClick={handlePublish}
              disabled={publish.isPending}
            >
              {publish.isPending
                ? '게시 중...'
                : publishResult
                  ? '다시 게시'
                  : '세션 일괄 게시'}
            </Button>
          }
        />

        {publishResult && (
          <div className="mx-6 mb-2 rounded-md border p-3 text-sm">
            <p>
              게시 성공{' '}
              <strong className="text-green-600">
                {publishResult.published}
              </strong>{' '}
              · 실패{' '}
              <strong className="text-destructive">
                {publishResult.failed.length}
              </strong>
            </p>
            {publishResult.failed.length > 0 && (
              <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto text-xs text-muted-foreground">
                {publishResult.failed.map((f) => (
                  <li key={f.masterId}>
                    {f.masterId} — {f.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="p-6 pt-2">
          <div className="overflow-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="text-left">
                  <th className="p-2">행</th>
                  <th className="p-2">productKey</th>
                  <th className="p-2">상태</th>
                  <th className="p-2">상품 / 오류</th>
                </tr>
              </thead>
              <tbody>
                {session.items.map((i) => (
                  <tr key={i.rowNumber} className="border-t align-top">
                    <td className="p-2">{i.rowNumber}</td>
                    <td className="p-2">{i.productKey}</td>
                    <td className="p-2">
                      {i.status === 'created' ? (
                        <span className="text-green-600">생성</span>
                      ) : (
                        <span className="text-destructive">실패</span>
                      )}
                    </td>
                    <td className="p-2">
                      {i.status === 'created' && i.masterId ? (
                        <Link
                          href={`/mall/products-list/${i.masterId}`}
                          className="text-primary underline"
                        >
                          상품 상세
                        </Link>
                      ) : (
                        <span className="text-destructive">
                          {i.errorMessage}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Container>
    </div>
  );
}
```

- [ ] **Step 2: 세션 상세 페이지 라우트 작성 (Next 15 params: Promise)**

Create `apps/admin-web/src/app/(admin)/mall/product-imports/[sessionId]/page.tsx`:
```tsx
import RouteGuard from '@/components/layout/route-guard';
import { SessionDetail } from '@/features/mall/product-imports/session-detail';

export default async function ProductImportSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <SessionDetail sessionId={sessionId} />
      </div>
    </RouteGuard>
  );
}
```

- [ ] **Step 3: 타입 게이트**

Run (cwd `apps/admin-web`): `npx tsc --noEmit 2>&1 | grep -E "product-imports/session-detail|\[sessionId\]" || echo "OK"`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add apps/admin-web/src/features/mall/product-imports/session-detail/index.tsx \
        "apps/admin-web/src/app/(admin)/mall/product-imports/[sessionId]/page.tsx"
git commit -m "feat(admin-web): 대량등록 세션 상세 + 일괄 게시"
```

---

### Task 8: 메뉴/브레드크럼 교체 + 기존 CSV UI 제거 + 최종 빌드 게이트

**Files:**
- Modify: `apps/admin-web/src/lib/utils/menu.ts` (`product-csv` → `product-imports`)
- Modify: `apps/admin-web/src/components/common/breadcrumb-items.ts` (`/mall/csv` → `/mall/product-imports`)
- Modify: `apps/admin-web/src/lib/api/domains/products/index.ts` (csv import/entry/re-export 제거)
- Modify: `apps/admin-web/src/lib/services/products/mutations.ts` (`useCsvBulkImport` 제거)
- Modify: `apps/admin-web/src/lib/types/dto/products.ts` (`CsvImportResultDto` 제거)
- Delete: `apps/admin-web/src/app/(admin)/mall/csv/` (page)
- Delete: `apps/admin-web/src/features/mall/csv/` (전체)
- Delete: `apps/admin-web/src/lib/api/domains/products/csv.client.ts`

**Interfaces:**
- Consumes: Task 5/6/7 의 신규 라우트가 존재해야 메뉴 링크가 유효.

- [ ] **Step 1: 메뉴 항목 교체**

Modify `apps/admin-web/src/lib/utils/menu.ts` — 기존 블록
```ts
      {
        id: 'product-csv',
        title: 'CSV 가져오기/내보내기',
        path: '/mall/csv',
      },
```
을 다음으로 교체:
```ts
      {
        id: 'product-imports',
        title: '엑셀 대량등록',
        path: '/mall/product-imports',
      },
```

- [ ] **Step 2: 브레드크럼 교체**

Modify `apps/admin-web/src/components/common/breadcrumb-items.ts` — 라인
```ts
  { prefix: '/mall/csv', label: 'CSV 가져오기/내보내기' },
```
을 다음으로 교체:
```ts
  { prefix: '/mall/product-imports', label: '엑셀 대량등록' },
```

- [ ] **Step 3: API 배럴에서 csv 제거**

Modify `apps/admin-web/src/lib/api/domains/products/index.ts` — 세 줄 삭제:
```ts
import { csvClient } from './csv.client';   // 삭제
```
```ts
  csv: csvClient,                            // 삭제 (products 객체 내)
```
```ts
export { csvClient } from './csv.client';   // 삭제
```

- [ ] **Step 4: useCsvBulkImport 제거**

Modify `apps/admin-web/src/lib/services/products/mutations.ts` — `export const useCsvBulkImport = () => { ... };` 블록 전체 삭제(약 936~945행).

- [ ] **Step 5: CsvImportResultDto 제거**

Modify `apps/admin-web/src/lib/types/dto/products.ts` — `export interface CsvImportResultDto { ... }` 블록 전체 삭제(약 1009행~).

- [ ] **Step 6: 기존 CSV 파일/디렉터리 삭제**

```bash
cd /home/pauseb/workspace/almondyoung-server
git rm -r "apps/admin-web/src/app/(admin)/mall/csv" \
         apps/admin-web/src/features/mall/csv \
         apps/admin-web/src/lib/api/domains/products/csv.client.ts
```

- [ ] **Step 7: 잔존 참조 확인 (0이어야 함)**

Run (cwd `apps/admin-web/src`):
```bash
grep -rn "products\.csv\|csvClient\|useCsvBulkImport\|CsvImportResultDto\|mall/csv\|features/mall/csv" . --include="*.ts" --include="*.tsx" | grep -v node_modules || echo "OK: no dangling references"
```
Expected: `OK: no dangling references`

- [ ] **Step 8: 타입 게이트 + 빌드 게이트**

Run (cwd `apps/admin-web`):
```bash
npx tsc --noEmit 2>&1 | grep -E "product-import|mall/csv|csv.client|CsvImportResultDto|useCsvBulkImport" || echo "OK: type-check clean for touched files"
npm run build
```
Expected: 첫 명령 `OK: type-check clean for touched files`; `next build` 성공(exit 0). 빌드가 기존 무관한 debt 로 실패하면 변경 파일과 무관함을 확인하고 기록.

- [ ] **Step 9: Commit**

```bash
cd /home/pauseb/workspace/almondyoung-server
git add apps/admin-web/src/lib/utils/menu.ts \
        apps/admin-web/src/components/common/breadcrumb-items.ts \
        apps/admin-web/src/lib/api/domains/products/index.ts \
        apps/admin-web/src/lib/services/products/mutations.ts \
        apps/admin-web/src/lib/types/dto/products.ts
git commit -m "refactor(admin-web): 기존 CSV 대량등록 UI 제거, 엑셀 대량등록으로 메뉴 교체"
```

---

## 배포 후 통합 스모크 (별도, 백엔드 배포 후)

이 플랜의 코드 게이트는 type-check + build 다. 실제 end-to-end 검증은 백엔드 `feat/product-bulk-import-redesign` 이 배포된 뒤 수행(스펙 §8):
1. `/mall/product-imports` → "새 대량등록" → 템플릿 다운로드.
2. 템플릿 작성(오류 행 포함) → 업로드 → 검증 프리뷰에서 오류 행 확인, 커밋 버튼 비활성 확인.
3. 오류 수정 → 재업로드 → 커밋 → 세션 상세 이동.
4. 세션 상세에서 성공 상품 상세 링크 확인, "세션 일괄 게시" → 결과 배너 확인.
5. Medusa/검색에 게시 상품 노출 확인.

---

## Self-Review

**Spec coverage (스펙 §4~§8 대조):**
- §4 라우트/메뉴 → Task 5/6/7(라우트), Task 8(메뉴/브레드크럼). ✅
- §5 제거 대상 → Task 8. ✅
- §6.1 API 클라이언트 → Task 1. §6.2 훅/타입 → Task 1(타입), Task 2(훅). ✅
- §6.3 세션 목록 → Task 6. §6.4 위저드(3스텝+게이팅) → Task 3/4/5. §6.5 세션 상세+게시 → Task 7. ✅
- §7 게시상태 미추적(다시 게시 버튼) → Task 7 Step 1 반영. 롤아웃 → Global Constraints. ✅
- §8 테스트 → Task 2(query-keys spec), Task 3(canCommit spec), 통합 스모크 섹션. ✅

**Placeholder scan:** TBD/TODO 없음. 모든 코드 스텝은 완전한 코드 포함. ✅

**Type consistency:** `canCommit`(Task 3) 시그니처 = Task 4 validate-step 소비와 일치. 클라이언트 메서드명(`downloadTemplate`/`validate`/`commit`/`getSessions`/`getSession`/`publish`, Task 1) = 훅(Task 2)·컴포넌트 호출과 일치. DTO 필드명(`createdCount`/`failedCount`/`invalidCount`/`sessionId`/`masterId`/`errorMessage`/`fileName`)이 백엔드 `import-response.dto.ts` 와 일치. `products.productImport` 접근자(Task 1 배럴) = 훅에서 사용과 일치. ✅

# 상품 상세설명 집중 편집 오버레이 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** draft 상품 상세설명 편집을, 전체화면 오버레이(좌=라이브 미리보기 / 우=Markdown 에디터, 좁으면 위=에디터·아래=미리보기)로 승격하고, 기존 카드는 읽기전용 뷰어로 전환한다.

**Architecture:** 순수 프론트엔드 변경. 편집 표면을 카드 인라인 textarea에서 신규 `Dialog` 오버레이 컴포넌트로 옮긴다. 오버레이가 자기 `draft`를 소유(열릴 때 seed)하고, 저장은 부모 카드가 소유한 `useUpdateMasterVersion`로 위임한다. 저장 성공 시 React Query가 `versionDetail` 쿼리를 invalidate → 읽기전용 카드가 새 값으로 자동 갱신. 커서 삽입 로직은 순수 함수로 추출해 단위 테스트한다.

**Tech Stack:** Next.js(App Router), React, TypeScript, Tailwind, shadcn `Dialog`/`Textarea`/`Button`, `react-markdown`, TanStack Query, Jest(ts-jest, node env), sonner.

## Global Constraints

- 대상 디렉터리: `apps/admin-web/src/features/mall/products-detail/components/description/`
- 타입 안전: `any`/`as` 캐스팅 금지(정당화·팀승인 없이). Nullable 정규화 `string ?? ''`.
- 이 저장소 Jest는 **node 환경 + `.spec.ts`만**(`testRegex: .*\.spec\.ts$`, `testEnvironment: node`) — RTL/jsdom 없음. 따라서 **순수 로직만 유닛 테스트**하고, React 컴포넌트(오버레이·카드)는 타입체크/빌드 + 수동 스모크로 검증한다. `.tsx` 테스트 파일을 만들지 말 것(수집되지 않음).
- 단위 테스트 실행(레포 루트에서): `npx jest <spec 경로>`
- Lint(루트): `npm run lint`
- Admin 타입체크: `npx tsc --noEmit -p apps/admin-web/tsconfig.json`
- 저장 시 `description` 매핑 규칙(기존 유지): `value.trim().length > 0 ? value : null`
- 브랜치: `feat/product-description-focus-editor` (이미 생성됨, 스펙 커밋 존재)

---

### Task 1: `insertAtCursor` 순수 함수 추출 + 단위 테스트 (TDD)

현재 `index.tsx`에 module-local로 있는 `insertAtCursor`를, DOM 의존을 제거한 순수
함수로 별도 파일에 추출한다. 시그니처를 `(current, insert, selection?)`로 바꿔
node 환경에서 `as` 캐스팅 없이 테스트 가능하게 만든다. (기존 `index.tsx`의 로컬
함수는 아직 그대로 둔다 — Task 3에서 제거·교체.)

**Files:**
- Create: `apps/admin-web/src/features/mall/products-detail/components/description/product-description-insert.ts`
- Test: `apps/admin-web/src/features/mall/products-detail/components/description/product-description-insert.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export function insertAtCursor(
    current: string,
    insert: string,
    selection?: { start: number; end: number },
  ): string
  ```
  `selection` 미지정 → 문자열 끝에 append(개행 보정). 지정 → `[start, end)`
  구간에 삽입(앞뒤 개행 보정). Task 2 오버레이가 소비.

- [ ] **Step 1: 실패하는 테스트 작성**

`product-description-insert.spec.ts`:
```ts
import { insertAtCursor } from './product-description-insert';

describe('insertAtCursor', () => {
  it('selection 미지정: 빈 문자열엔 개행 없이 삽입 후 후행 개행', () => {
    expect(insertAtCursor('', 'IMG')).toBe('IMG\n');
  });

  it('selection 미지정: 개행으로 끝나지 않으면 선행 개행 보정 후 append', () => {
    expect(insertAtCursor('hello', 'IMG')).toBe('hello\nIMG\n');
  });

  it('selection 미지정: 이미 개행으로 끝나면 선행 개행 추가 안 함', () => {
    expect(insertAtCursor('hello\n', 'IMG')).toBe('hello\nIMG\n');
  });

  it('커서가 시작(0): 선행 개행 없음', () => {
    expect(insertAtCursor('abc', 'IMG', { start: 0, end: 0 })).toBe('IMG\nabc');
  });

  it('커서가 끝: 후행 개행 없음(뒤가 비어있음)', () => {
    expect(insertAtCursor('abc', 'IMG', { start: 3, end: 3 })).toBe('abc\nIMG');
  });

  it('커서가 중간: prefix/suffix 사이 삽입, 앞뒤 개행 보정', () => {
    expect(insertAtCursor('ab\ncd', 'IMG', { start: 3, end: 3 })).toBe(
      'ab\nIMG\ncd'
    );
  });

  it('선택 구간(start<end)을 삽입물로 대체', () => {
    expect(insertAtCursor('abXYcd', 'IMG', { start: 2, end: 4 })).toBe(
      'ab\nIMG\ncd'
    );
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx jest apps/admin-web/src/features/mall/products-detail/components/description/product-description-insert.spec.ts`
Expected: FAIL — `Cannot find module './product-description-insert'`

- [ ] **Step 3: 최소 구현 작성**

`product-description-insert.ts`:
```ts
/**
 * textarea 커서 위치(selection)에 markdown 조각을 삽입한다.
 * selection 미지정 시 현재 문자열 끝에 append(개행 보정)한다.
 * DOM 비의존 순수 함수 — 호출부(overlay)에서 textarea selection 을 뽑아 전달.
 */
export function insertAtCursor(
  current: string,
  insert: string,
  selection?: { start: number; end: number },
): string {
  if (!selection) {
    const needsLeadingNewline = current.length > 0 && !current.endsWith('\n');
    return `${current}${needsLeadingNewline ? '\n' : ''}${insert}\n`;
  }

  const prefix = current.slice(0, selection.start);
  const suffix = current.slice(selection.end);
  const needsLeadingNewline = prefix.length > 0 && !prefix.endsWith('\n');
  const needsTrailingNewline = suffix.length > 0 && !suffix.startsWith('\n');
  return `${prefix}${needsLeadingNewline ? '\n' : ''}${insert}${needsTrailingNewline ? '\n' : ''}${suffix}`;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest apps/admin-web/src/features/mall/products-detail/components/description/product-description-insert.spec.ts`
Expected: PASS (7 passed)

- [ ] **Step 5: 커밋**

```bash
git add apps/admin-web/src/features/mall/products-detail/components/description/product-description-insert.ts \
        apps/admin-web/src/features/mall/products-detail/components/description/product-description-insert.spec.ts
git commit -m "feat(mall): insertAtCursor 순수 함수 추출 + 단위 테스트"
```

---

### Task 2: `ProductDescriptionFocusEditor` 오버레이 컴포넌트

전체화면 `Dialog` 편집기. 자기 `draft`를 소유하고 열릴 때 `initialValue`로 seed.
좌=라이브 미리보기 / 우=에디터+이미지업로드, `lg` 미만에서 위=에디터·아래=미리보기
스택(`order` 유틸). 저장은 `onSave(draft)`로 위임(저장 후 닫지 않음). 닫기 시
미저장 변경이 있으면 `window.confirm`으로 확인.

**Files:**
- Create: `apps/admin-web/src/features/mall/products-detail/components/description/product-description-focus-editor.tsx`

**Interfaces:**
- Consumes: `insertAtCursor` (Task 1); `ProductDescriptionMarkdown` (`./product-description-markdown`); `MarkdownImageUploadButton` (`./markdown-image-upload-button`, props `{ disabled?, onInsert: (markdown: string) => void }`); shadcn `Dialog`/`DialogContent`/`DialogHeader`/`DialogTitle`, `Textarea`, `Button`.
- Produces:
  ```ts
  export function ProductDescriptionFocusEditor(props: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    initialValue: string;
    onSave: (value: string) => void;
    pending: boolean;
  }): JSX.Element
  ```
  Task 3 카드가 소비.

- [ ] **Step 1: 오버레이 컴포넌트 작성**

`product-description-focus-editor.tsx`:
```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { MarkdownImageUploadButton } from './markdown-image-upload-button';
import { ProductDescriptionMarkdown } from './product-description-markdown';
import { insertAtCursor } from './product-description-insert';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialValue: string;
  onSave: (value: string) => void;
  pending: boolean;
};

export function ProductDescriptionFocusEditor({
  open,
  onOpenChange,
  initialValue,
  onSave,
  pending,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(initialValue);

  // 저장 후에도 오버레이는 열려 있으므로, 저장된 값으로의 재-seed 는 '열릴 때'에만 한다.
  useEffect(() => {
    if (open) setDraft(initialValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const insertMarkdown = (markdown: string) => {
    const el = textareaRef.current;
    setDraft((current) => {
      const selection = el
        ? {
            start: el.selectionStart ?? current.length,
            end: el.selectionEnd ?? current.length,
          }
        : undefined;
      return insertAtCursor(current, markdown, selection);
    });
    textareaRef.current?.focus();
  };

  const handleOpenChange = (next: boolean) => {
    if (!next && draft !== initialValue) {
      const confirmed = window.confirm(
        '저장하지 않은 변경이 있습니다. 편집을 닫을까요?'
      );
      if (!confirmed) return;
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex h-[92vh] w-[96vw] max-w-[96vw] flex-col gap-0 p-0 sm:max-w-[1400px]">
        {/* pr-14: 우상단 기본 닫기(X) 버튼과 저장 버튼이 겹치지 않도록 여백 확보 */}
        <DialogHeader className="flex flex-row items-center justify-between gap-2 border-b px-4 py-3 pr-14 text-left">
          <DialogTitle>상품 상세설명 편집</DialogTitle>
          <Button size="sm" disabled={pending} onClick={() => onSave(draft)}>
            <Save data-icon="inline-start" />
            {pending ? '저장 중...' : '저장'}
          </Button>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-4 lg:grid-cols-2">
          {/* 에디터: 좁을 땐 위(order-1), 넓을 땐 오른쪽(order-2) */}
          <div className="order-1 flex min-h-0 flex-col gap-2 lg:order-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Markdown</span>
              <MarkdownImageUploadButton
                disabled={pending}
                onInsert={insertMarkdown}
              />
            </div>
            <Textarea
              ref={textareaRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Markdown으로 상품 상세설명을 작성하세요."
              className="min-h-0 flex-1 resize-none font-mono text-sm"
            />
          </div>

          {/* 미리보기: 좁을 땐 아래(order-2), 넓을 땐 왼쪽(order-1) */}
          <div className="order-2 min-h-0 overflow-y-auto rounded-md border bg-muted/20 p-4 lg:order-1">
            <div className="mb-2 text-xs font-medium text-muted-foreground">
              미리보기
            </div>
            {draft.trim().length > 0 ? (
              <ProductDescriptionMarkdown value={draft} />
            ) : (
              <div className="py-6 text-center text-sm text-muted-foreground">
                작성한 내용이 여기에 표시됩니다.
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: 타입체크 통과 확인**

Run: `npx tsc --noEmit -p apps/admin-web/tsconfig.json`
Expected: 이 파일 관련 에러 없음. (아직 어디서도 import 하지 않으므로 미사용
경고는 발생하지 않음 — 컴포넌트는 export 됨.)

- [ ] **Step 3: 커밋**

```bash
git add apps/admin-web/src/features/mall/products-detail/components/description/product-description-focus-editor.tsx
git commit -m "feat(mall): 상품 상세설명 전체화면 집중 편집 오버레이 컴포넌트 추가"
```

---

### Task 3: 카드를 읽기전용 뷰어로 전환 + 오버레이 연결

`index.tsx`의 `ProductDetailDescriptionContent`에서 인라인 편집 UI(textarea,
Markdown 헤더 행, 인라인 저장 버튼, 로컬 `insertAtCursor`/`insertMarkdown`/`draft`
state)를 제거한다. 카드는 **저장된 값(`data.description`)** 을 읽기전용으로 렌더하고
펼치기/접기·플로팅 접기·레거시 HTML 미리보기/비우기를 유지한다. `canEdit`일 때
헤더에 **`편집`** 버튼을 노출해 오버레이를 연다. 저장 핸들러는 오버레이에 위임한다.

**Files:**
- Modify: `apps/admin-web/src/features/mall/products-detail/components/description/index.tsx` (전체 재작성)

**Interfaces:**
- Consumes: `ProductDescriptionFocusEditor` (Task 2). `onSave` 는 `(value: string) => void` — 내부에서 `description: value.trim().length > 0 ? value : null` 로 매핑해 `useUpdateMasterVersion` 호출.

- [ ] **Step 1: `index.tsx` 전체 재작성**

`index.tsx` 를 아래 내용으로 교체:
```tsx
'use client';

import { RefObject, Suspense, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronUp, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { CardErrorBoundary } from '@/components/admin-ui-experimental/common/card-error-boundary';
import { Container } from '@/components/admin-ui-experimental/common/container';
import { Header } from '@/components/admin-ui-experimental/common/header';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Spinner } from '@/components/ui/spinner';
import { useInViewport } from '@/lib/hooks/use-in-viewport';
import { useUpdateMasterVersion } from '@/lib/services/products/mutations';
import { useProductDetailSuspense } from '@/lib/services/products/use-product-detail';
import { ProductDescriptionFocusEditor } from './product-description-focus-editor';
import { ProductDescriptionMarkdown } from './product-description-markdown';
import { shouldShowFloatingCollapse } from './product-description-floating-collapse';

type Props = { masterId: string; versionId: string | null };

type ContentProps = Props & {
  /** 접기 시 스크롤을 되돌릴 섹션 카드 ref */
  sectionRef: RefObject<HTMLDivElement | null>;
};

function LegacyHtmlPreview({
  html,
  canClear,
  onClear,
  pending,
}: {
  html: string;
  canClear: boolean;
  onClear: () => void;
  pending: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="text-xs font-medium text-muted-foreground">
          레거시 HTML 미리보기
        </div>
        {canClear ? (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={onClear}
          >
            <Trash2 data-icon="inline-start" />
            {pending ? '삭제 중...' : '레거시 HTML 비우기'}
          </Button>
        ) : null}
      </div>
      <div
        className="p-3 prose-sm prose border rounded-md max-w-none bg-muted/20"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

function ProductDetailDescriptionContent({
  masterId,
  versionId,
  sectionRef,
}: ContentProps) {
  const { data } = useProductDetailSuspense(masterId, versionId);
  const updateVersion = useUpdateMasterVersion();
  const contentRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const canEdit =
    data.source === 'version' &&
    data.status === 'draft' &&
    Boolean(data.versionId);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const hasContent =
    (data.description ?? '').trim().length > 0 || Boolean(data.descriptionHtml);
  const [open, setOpen] = useState(!hasContent);

  // 펼쳐진 본문은 화면에 있는데 하단 실제 접기 버튼은 화면 밖일 때만 floating 버튼을 띄운다.
  const contentVisible = useInViewport(contentRef, { enabled: open });
  const triggerFullyVisible = useInViewport(triggerRef, { threshold: 1 });
  const showFloatingCollapse = shouldShowFloatingCollapse({
    open,
    contentVisible,
    triggerFullyVisible,
  });

  // createPortal 은 클라이언트에서만 — SSR 가드
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const handleFloatingCollapse = () => {
    setOpen(false);
    sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleSave = (value: string) => {
    if (!data.versionId) return;
    updateVersion.mutate(
      {
        masterId,
        versionId: data.versionId,
        dto: { description: value.trim().length > 0 ? value : null },
      },
      {
        onSuccess: () => toast.success('상품 상세설명을 저장했습니다.'),
        onError: (err) =>
          toast.error(
            err instanceof Error
              ? err.message
              : '상품 상세설명 저장에 실패했습니다.'
          ),
      }
    );
  };

  const handleClearLegacy = () => {
    if (!data.versionId) return;
    updateVersion.mutate(
      {
        masterId,
        versionId: data.versionId,
        dto: { descriptionHtml: null },
      },
      {
        onSuccess: () => toast.success('레거시 HTML을 비웠습니다.'),
        onError: (err) =>
          toast.error(
            err instanceof Error
              ? err.message
              : '레거시 HTML 삭제에 실패했습니다.'
          ),
      }
    );
  };

  // 카드는 항상 '저장된' 값을 읽기전용으로 보여준다.
  const previewValue = data.description ?? '';

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="p-4">
      {canEdit ? (
        <div className="flex justify-end mb-3">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setOverlayOpen(true)}
          >
            <Pencil data-icon="inline-start" />
            편집
          </Button>
        </div>
      ) : null}

      <CollapsibleContent
        ref={contentRef}
        className="flex flex-col gap-4 data-[state=closed]:hidden"
      >
        {!canEdit ? (
          <div className="px-3 py-2 text-sm border rounded-md bg-muted/20 text-muted-foreground">
            상품 상세설명은 draft version에서만 수정할 수 있습니다.
          </div>
        ) : null}

        {previewValue.trim().length > 0 ? (
          <ProductDescriptionMarkdown value={previewValue} />
        ) : (
          <div className="px-3 py-6 text-sm text-center border border-dashed rounded-md text-muted-foreground">
            Markdown 상세설명이 비어 있습니다.
          </div>
        )}

        {!data.description && data.descriptionHtml ? (
          <LegacyHtmlPreview
            html={data.descriptionHtml}
            canClear={canEdit}
            onClear={handleClearLegacy}
            pending={updateVersion.isPending}
          />
        ) : null}
      </CollapsibleContent>

      {!open && hasContent ? (
        // 상품 상세 설명 접힌 상태 미리보기
        <div className="relative overflow-hidden max-h-48">
          {previewValue.trim().length > 0 ? (
            <ProductDescriptionMarkdown value={previewValue} />
          ) : data.descriptionHtml ? (
            <div
              className="prose-sm prose max-w-none"
              dangerouslySetInnerHTML={{ __html: data.descriptionHtml }}
            />
          ) : null}
          <div className="absolute inset-x-0 bottom-0 h-16 pointer-events-none bg-gradient-to-t from-background to-transparent" />
        </div>
      ) : null}

      <div ref={triggerRef} className="mt-4">
        <CollapsibleTrigger asChild>
          <Button variant="outline" className="justify-center w-full gap-1">
            {open ? '상품설명 접기' : '상품설명 더보기'}
            <ChevronDown
              className="transition-transform duration-200 size-4"
              style={{ transform: open ? 'rotate(180deg)' : undefined }}
            />
          </Button>
        </CollapsibleTrigger>
      </div>

      {mounted && showFloatingCollapse
        ? createPortal(
            <div className="fixed z-40 -translate-x-1/2 duration-200 bottom-6 left-1/2 animate-in fade-in slide-in-from-bottom-4">
              <Button
                variant="outline"
                onClick={handleFloatingCollapse}
                className="gap-1 shadow-lg"
              >
                <ChevronUp className="size-4" />
                상품설명 접기
              </Button>
            </div>,
            document.body
          )
        : null}

      {canEdit ? (
        <ProductDescriptionFocusEditor
          open={overlayOpen}
          onOpenChange={setOverlayOpen}
          initialValue={data.description ?? ''}
          onSave={handleSave}
          pending={updateVersion.isPending}
        />
      ) : null}
    </Collapsible>
  );
}

export function ProductDetailDescription({ masterId, versionId }: Props) {
  const sectionRef = useRef<HTMLDivElement>(null);
  return (
    <Container ref={sectionRef} className="scroll-mt-4">
      <Header title="상품 상세설명" />
      <CardErrorBoundary>
        <Suspense
          fallback={
            <div className="flex justify-center p-4">
              <Spinner />
            </div>
          }
        >
          <ProductDetailDescriptionContent
            masterId={masterId}
            versionId={versionId}
            sectionRef={sectionRef}
          />
        </Suspense>
      </CardErrorBoundary>
    </Container>
  );
}
```

- [ ] **Step 2: 타입체크 통과 확인**

Run: `npx tsc --noEmit -p apps/admin-web/tsconfig.json`
Expected: 에러 없음. (제거된 `Textarea`/`MarkdownImageUploadButton`/`Save`/
`insertAtCursor` 미사용 import 잔존 없음 — 위 코드에 이미 반영됨.)

- [ ] **Step 3: Lint 통과 확인**

Run: `npm run lint`
Expected: 이 파일들 관련 에러 없음.

- [ ] **Step 4: 커밋**

```bash
git add apps/admin-web/src/features/mall/products-detail/components/description/index.tsx
git commit -m "feat(mall): 상세설명 카드를 읽기전용 뷰어로 전환하고 집중 편집 오버레이 연결"
```

---

### Task 4: 최종 검증 (타입체크·유닛·수동 스모크)

전체 회귀를 확인한다. 자동 검증(타입체크/유닛/lint) + 실제 페이지 수동 스모크.

**Files:** (변경 없음 — 검증 전용)

- [ ] **Step 1: 유닛 테스트 재실행**

Run: `npx jest apps/admin-web/src/features/mall/products-detail/components/description/`
Expected: PASS — `product-description-insert.spec.ts` 포함 이 폴더 스펙 전부 통과
(기존 `product-description-floating-collapse.spec.ts` 등도 그대로 통과).

- [ ] **Step 2: 타입체크 + lint**

Run: `npx tsc --noEmit -p apps/admin-web/tsconfig.json && npm run lint`
Expected: 에러 없음.

- [ ] **Step 3: 개발 서버로 수동 스모크**

Run: `npm run start:admin-web:dev` 후 브라우저에서
`/mall/products-list/[masterId]?versionId=[draft versionId]` 열기.
아래를 확인:
  - 카드가 **저장된** 상세설명을 읽기전용으로 표시. `편집` 버튼(우측 상단) 노출.
  - `상품설명 더보기/접기` 토글, 길게 스크롤 시 플로팅 `상품설명 접기` 동작(기존 유지).
  - `편집` 클릭 → 전체화면 오버레이. 넓은 화면: 좌=미리보기 / 우=에디터.
    창 폭을 `lg` 미만으로 줄이면 위=에디터 / 아래=미리보기로 스택.
  - 에디터에 타이핑 → 왼쪽 미리보기 **실시간** 반영. `이미지` 업로드 → 커서 위치에
    directive 삽입되고 미리보기에 이미지 렌더.
  - `저장` → 성공 토스트, **오버레이 유지**. 오버레이 닫으면 카드가 새 값 반영.
  - 변경 후 X/ESC/바깥 클릭으로 닫기 시 `저장하지 않은 변경이 있습니다...` confirm.
    취소하면 열린 채 유지, 확인하면 닫힘. 변경 없을 땐 confirm 없이 즉시 닫힘.
  - 레거시 HTML만 있는 상품: 카드에 레거시 미리보기 + `레거시 HTML 비우기` 유지.
  - draft 아닌 버전(canEdit=false): `편집` 버튼 없음, "draft version에서만 수정"
    안내 표시, 오버레이 없음.

- [ ] **Step 4: (선택) verify 스킬로 최종 확인**

수동 스모크 대신/추가로 `verify` 스킬을 사용해 draft 편집 플로우를 구동·관찰해도 된다.

- [ ] **Step 5: 최종 커밋 (필요 시)**

검증 중 수정이 있었다면 커밋. 없으면 생략.
```bash
git add -A && git commit -m "test(mall): 상품 상세설명 집중 편집기 검증 반영"
```

---

## Self-Review

**Spec coverage:**
- 전체화면 오버레이(라우트/모달 아님) → Task 2 ✓
- 좌 미리보기 / 우 에디터, `lg` 미만 위=에디터·아래=미리보기 → Task 2(`order` 유틸) ✓
- 라이브 미리보기 → Task 2(`draft` 렌더) ✓
- 카드 읽기전용 + 펼치기/접기/플로팅/레거시 유지 → Task 3 ✓
- `편집` 버튼(canEdit only), textarea·인라인 저장 제거 → Task 3 ✓
- draft 오버레이 소유, 열릴 때 seed → Task 2 ✓
- 저장 후 유지 + 토스트 + invalidate로 카드 갱신 → Task 3 `handleSave`(닫지 않음) + 확인된 `versionDetail` invalidate ✓
- 닫기 시 dirty confirm → Task 2 `handleOpenChange` ✓
- `insertAtCursor` 추출 + 스펙 → Task 1 ✓
- DB/API 변경 없음 ✓
- 엣지: canEdit=false(버튼·오버레이 없음), 레거시-only(`initialValue=''`) → Task 3 ✓

**Placeholder scan:** TBD/TODO/"적절히 처리" 없음. 모든 코드 스텝에 완전한 코드 포함.

**Type consistency:** `insertAtCursor(current, insert, selection?)`(Task 1) ↔ 호출부(Task 2) 일치. `ProductDescriptionFocusEditor` props `{open, onOpenChange, initialValue, onSave, pending}`(Task 2) ↔ 사용부(Task 3) 일치. `onSave: (value: string) => void`(Task 2·3) 일치. `MarkdownImageUploadButton` props(`disabled`, `onInsert`)는 실제 컴포넌트 시그니처와 일치.

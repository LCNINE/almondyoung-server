# 상품 상세설명 집중 편집 오버레이 (Focus Editor)

- 날짜: 2026-07-07
- 대상: `apps/admin-web`
- 위치: `src/features/mall/products-detail/components/description/`
- 진입 페이지: `/mall/products-list/[masterId]?versionId=[versionId]` (draft 상품 편집)

## 배경 / 목표

draft 상품의 상세설명은 현재 상세 카드에 인라인 Markdown `<Textarea>` + 하단
스택 미리보기로 편집한다. 편집기와 미리보기가 위아래로 붙어 있어 긴 상세설명을
작성할 때 좁고 불편하다.

이를 **전체화면 오버레이 집중 편집기**로 승격한다:

- 왼쪽 = 실시간 미리보기, 오른쪽 = Markdown 에디터 (요청된 배치 그대로).
- 화면 폭이 좁으면(`lg` 미만) 위=에디터·아래=미리보기로 스택.
- 미리보기는 타이핑 즉시 반영(라이브).

상세설명 카드 자체는 **읽기전용 뷰어**로 남겨 "상세설명이 실제로 어떻게 되어
있는지"를 편집창을 열지 않고도 확인할 수 있게 한다.

## 범위 밖 (YAGNI)

이번 작업은 **실시간 미리보기까지**만 한다. 다음은 하지 않는다:

- WYSIWYG 서식 툴바(굵게/제목/리스트 버튼 등)
- 이미지 드래그앤드롭 (기존 `MarkdownImageUploadButton`만 재사용)
- 레거시 HTML 편집 (기존처럼 카드에서 미리보기 + '비우기'만)
- 자동저장 / 입력 디바운스

## 결정 사항

| 결정 | 선택 | 이유 |
|------|------|------|
| 편집 표면 형태 | 전체화면 `Dialog` 오버레이 (별도 라우트/모달 아님) | 풀뷰포트 폭 확보 + 같은 라우트 유지로 refetch·라우팅 오버헤드 없음. 공유 URL·대형 도구화 요구 없음(YAGNI). |
| 카드의 편집 textarea | 제거 | 편집기가 오버레이 하나로 단일화. 카드는 열람 전용. |
| 카드 버튼 명칭 | `편집` | (기존 '집중 편집'에서 변경) |
| 카드의 펼치기/접기 | 유지 | 편집창을 열지 않고 상세설명을 열람·접기 위함. |
| draft 상태 소유 | 오버레이가 소유 (열릴 때 seed) | 편집기가 하나뿐이라 상태 리프팅 불필요. 카드는 저장된 값만 표시. |
| 저장 후 동작 | 오버레이 **유지** (토스트로 확인, 계속 편집 가능) | |
| 닫기(X/ESC) 시 미저장 변경 | `window.confirm`으로 경고 후 닫기 | 작업 손실 방지. |

## 컴포넌트 설계

```
description/
  index.tsx                          # (수정) 카드 = 읽기전용 뷰어 + '편집' 버튼
  product-description-focus-editor.tsx   # (신규) 전체화면 오버레이 편집기
  product-description-insert.ts          # (신규) insertAtCursor 추출
  product-description-insert.spec.ts     # (신규) insertAtCursor 단위 테스트
  product-description-markdown.tsx       # (재사용) 미리보기 렌더러
  markdown-image-upload-button.tsx       # (재사용) 이미지 업로드 버튼
  ...
```

### 1. `index.tsx` — 카드 (읽기전용 뷰어)

`ProductDetailDescriptionContent`:

- **제거**: `draft`/`setDraft` state, 편집용 `<Textarea>`, Markdown 헤더 행, 인라인
  저장 버튼, 로컬 `insertAtCursor`/`insertMarkdown`.
- **표시값 단일화**: `previewValue`는 항상 **저장된** 값(`data.description`).
  기존 `canEdit ? draft : data.description` 분기 제거. → 카드는 서버 저장 상태만
  보여준다. 오버레이에서 저장 → React Query invalidate → 카드가 새 값 반영.
- **`편집` 버튼**: `canEdit`(= `source==='version' && status==='draft' && versionId`)
  일 때만 카드 헤더에 노출. 클릭 시 `overlayOpen` state를 true로.
- **유지**: `Collapsible` 펼치기/접기, 플로팅 접기 버튼(`shouldShowFloatingCollapse`),
  접힘 상태 그라데이션/`max-h-48` 미리보기, 레거시 HTML 미리보기 + `handleClearLegacy`.
- **저장 소유**: `useUpdateMasterVersion` 뮤테이션은 content가 소유. 오버레이엔
  `onSave(value: string)`와 `pending`를 props로 내려준다. `onSave`는 기존 규칙대로
  `value.trim().length > 0 ? value : null`로 매핑해 `description` 필드에 저장하고,
  성공 시 토스트, 실패 시 에러 토스트. **오버레이는 저장 후 닫지 않는다.**
- 빈 상태(상세설명 없음): 기존 "Markdown 상세설명이 비어 있습니다." 플레이스홀더
  유지. 헤더의 `편집` 버튼으로 작성 진입.

### 2. `product-description-focus-editor.tsx` — 오버레이 (신규, 유일한 편집기)

`ProductDescriptionFocusEditor`

Props:

```ts
type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialValue: string;              // = data.description ?? ''
  onSave: (value: string) => void;   // content의 뮤테이션 호출
  pending: boolean;                  // updateVersion.isPending
};
```

동작:

- 로컬 `draft` state. `open`이 false→true로 바뀔 때 `initialValue`로 seed
  (`useEffect([open])`). 저장 후에도 열려 있으므로 재-seed는 오픈 시점에만.
- shadcn `Dialog` / `DialogContent`를 전체화면 크기로 override:
  `className="w-[96vw] max-w-[1400px] h-[92vh] flex flex-col"` (+ 내부 패딩/gap 조정).
  기본 닫기 X 버튼(shadcn 제공)과 ESC/바깥 클릭은 `onOpenChange`로 흐른다.
- `DialogHeader`: 제목 "상품 상세설명 편집" + **저장** 버튼(`onSave(draft)`,
  `disabled={pending}`, 라벨 pending 시 "저장 중...").
- 본문: `grid grid-cols-1 lg:grid-cols-2 flex-1 min-h-0 gap-4`
  - **미리보기 pane**: `order-2 lg:order-1`, `min-h-0 overflow-y-auto`.
    `ProductDescriptionMarkdown value={draft}` (빈 값이면 플레이스홀더).
  - **에디터 pane**: `order-1 lg:order-2`, `flex flex-col min-h-0`.
    상단 툴바에 `MarkdownImageUploadButton onInsert={insertMarkdown}`,
    그 아래 높이를 채우는 `<Textarea>` (`flex-1 resize-none`, `ref=textareaRef`).
  - `order` 유틸로: 좁을 때(단일 컬럼) 에디터가 위, 넓을 때(2컬럼) 미리보기가 왼쪽·
    에디터가 오른쪽.
- `insertMarkdown`: `insertAtCursor(textareaRef.current, draft, markdown)` 결과로
  `setDraft`, 이어서 `textareaRef.current?.focus()`.
- **닫기 가드** `handleOpenChange(next)`:
  - `next === false && draft !== initialValue` 이면
    `window.confirm('저장하지 않은 변경이 있습니다. 편집을 닫을까요?')`가 true일 때만
    `onOpenChange(false)`. 아니면 무시(열림 유지).
  - 그 외에는 `onOpenChange(next)` 그대로 전달.

### 3. `product-description-insert.ts` + `.spec.ts` (신규)

현재 `index.tsx`의 module-local `insertAtCursor`를 이 파일로 추출해
오버레이가 import한다(순수 함수 → 단위 테스트 가능, 이 폴더의
`product-description-floating-collapse.ts` 패턴과 동일).

`insertAtCursor(textarea, current, insert)` 스펙 케이스:

- textarea null → 현재 문자열 끝에 개행 보정 후 append
- 커서가 문자열 중간 → prefix/suffix 사이 삽입, 앞뒤 개행 보정
- 커서가 시작(0) → 선행 개행 없음
- 커서가 끝 → 후행 개행 없음(뒤가 비어 있으면)
- 빈 문자열 → 개행 없이 삽입

## 데이터 흐름

```
카드(index.tsx)
  ├─ 저장값(data.description) 읽기전용 렌더 + 펼치기/접기
  ├─ overlayOpen state
  ├─ handleSave(value) → useUpdateMasterVersion → invalidate → 카드 갱신 (오버레이 유지)
  └─ ProductDescriptionFocusEditor
        open=overlayOpen, initialValue=data.description ?? '',
        onSave=handleSave, pending=updateVersion.isPending
        ├─ draft (open 시 seed)
        ├─ 좌: ProductDescriptionMarkdown(draft) / 우: Textarea + 이미지 업로드
        └─ 닫기 시 dirty면 confirm
```

## 엣지 케이스

- `canEdit === false` (published/main 등): `편집` 버튼 없음, 오버레이 없음. 카드는
  현재처럼 읽기전용.
- 레거시 HTML만 있고 markdown 상세설명이 없는 경우: 카드는 레거시 HTML 미리보기 +
  '비우기' 유지. `편집`은 빈 markdown(`''`)으로 오버레이를 열고, 저장하면 markdown
  `description`이 채워진다(기존처럼 markdown 우선).
- 오버레이가 열린 채로 남아 저장을 반복: 재-seed는 오픈 시점에만 하므로 저장 중
  draft가 리셋되지 않는다.

## 테스트 전략

- `product-description-insert.spec.ts`: `insertAtCursor` 단위 테스트(위 케이스).
- 오버레이는 대부분 presentational + 얇은 dirty 비교(`draft !== initialValue`).
  별도 로직 유닛은 없음. 필요 시 RTL로 open/seed/confirm 흐름 스모크 테스트(선택).
- 기존 `product-description-floating-collapse.spec.ts` 등 카드 로직 테스트는
  영향받지 않는다(편집 UI 제거는 순수 함수와 무관).

## 마이그레이션 / 리스크

- DB/스키마 변경 없음. `useUpdateMasterVersion` API 계약 그대로.
- 순수 프론트엔드 리팩터 + UI 추가. 위험도 낮음.
- 회귀 주의: 카드에서 편집 UI 제거 후에도 (1) 펼치기/접기, (2) 플로팅 접기,
  (3) 레거시 HTML 비우기가 그대로 동작하는지 수동 확인.

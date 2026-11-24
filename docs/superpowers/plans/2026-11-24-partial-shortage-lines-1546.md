# 부분출고·출고불가 내역 모자란 상품 표시 (#1546) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 출고 준비의 부분출고·출고불가 내역 상품 칸에서 모자란 상품과 모자란 개수가 바로 읽히게 한다.

**Architecture:** 줄 문구는 순수 함수(`preparation-model.ts`·`blocked-copy.ts`)에서 «모자란 개수 먼저»로 바꾸고, 모자란 줄 판정 함수 `isShortLine` 을 하나 둔다. `bucket-list.tsx` 의 상품 칸 두 갈래가 그 판정으로 모자란 줄은 빨강 굵게, 다 있는 줄은 회색 이름만 그린다.

**Tech Stack:** Next.js admin-web, React, Tailwind, Jest + Testing Library(jsdom).

**Spec:** `docs/superpowers/specs/2026-11-24-partial-shortage-lines-1546-design.md`

## Global Constraints

- 모자란 줄 판정은 `qty > reservedQty`. `stock` 칸은 판정에 쓰지 않는다(옛 응답에 없을 수 있음).
- 모자란 줄 색: `text-red-600 font-semibold` (이름·수량 줄 둘 다).
- 다 있는 줄: 이름만 `text-muted-foreground`, 수량 줄 없음.
- 부분출고 문구: `N개 모자람 · 주문 N · 지금 보낼 N`
- 출고불가 문구: `N개 모자람 · 주문 N · 이 창고 재고 N` 또는 `N개 모자람 · 주문 N · 이 창고 재고 N (다른 주문 몫 N)`
- 줄 순서는 지금 그대로. 확인 창(`split-confirm-dialog.tsx`)·결과 창(`split-result-dialog.tsx`)·사유 칸(`blockedReason`)은 건드리지 않는다.
- 출고불가에서 `stock` 있는 줄이 하나도 없으면 지금처럼 `itemSummary` 한 줄.
- 테스트는 `--maxWorkers=2`. E2E 스택이 떠 있으면 전체 jest·type-check 를 돌리지 않고 아래 범위 지정 명령만 쓴다.

## Review Focus

1. 부분출고 상자인데 모든 줄이 다 있는 경우(서버가 분류만 부분출고로 준 옛 데이터) — 빨간 줄 없이 이름만 회색으로 보이고 깨지지 않아야 한다. → Task 2 테스트 `부분출고에 모자란 줄이 없으면 이름만 흐리게 보인다`.
2. 출고불가에서 모자란 줄인데 `stock` 이 없는 줄(옛 응답 일부) — 이름은 빨강, 수량 줄은 없음. → Task 2 테스트 `출고불가에서 stock 없는 모자란 줄은 이름만 빨갛게 보인다`.
3. `reservedQty > qty`(과잉 예약) — 다 있는 줄로 본다(`isShortLine` false). → Task 1 테스트.
4. 상품 줄이 하나뿐인 상자 — 사유 칸은 이름 접두사가 없으니 상품 칸 빨강만으로 무엇이 모자란지 읽혀야 한다. 기존 동작 그대로라 별도 테스트 없음, 리뷰 때 눈으로 확인.
5. 결과 창의 `지금 보낼 2 · 기다릴 1`(`split-result-dialog.tsx`)은 `lineSplitText` 를 쓰지 않는다 — 문구가 바뀌지 않았는지 기존 템플릿 스펙(`OutboundPreparationTemplate.render.spec.tsx` 720줄 근처)이 그대로 통과하는지로 확인.

---

### Task 1: 줄 문구를 «모자란 개수 먼저»로, 모자란 줄 판정 함수

**Files:**
- Modify: `apps/admin-web/src/features/order/outbound-preparation/preparation-model.ts:163-182` (`LineQuantity`, `lineSplitText` 근처)
- Modify: `apps/admin-web/src/features/order/outbound-preparation/blocked-copy.ts:43-56` (`shortageLineText`)
- Test: `apps/admin-web/src/features/order/outbound-preparation/preparation-model.spec.ts`
- Test: `apps/admin-web/src/features/order/outbound-preparation/blocked-copy.spec.ts:30-45`
- Test(기대 문구만 갱신): `apps/admin-web/src/features/order/outbound-preparation/components/bucket-list.spec.tsx:259-261`, `apps/admin-web/src/features/order/outbound-preparation/template/OutboundPreparationTemplate.render.spec.tsx:729-731`

**Interfaces:**
- Produces:
  - `export function isShortLine(line: { qty: number; reservedQty: number }): boolean` — `qty > reservedQty`
  - `lineSplitText(line: LineQuantity): string` — 시그니처 그대로, 모자란 줄에만 부른다는 전제로 문구만 바뀜
  - `shortageLineText(...)` — 시그니처 그대로, 문구만 바뀜

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`preparation-model.spec.ts` 에 추가:

```ts
describe('isShortLine', () => {
  it('주문보다 잡은 재고가 적을 때만 모자란 줄이다', () => {
    expect(isShortLine({ qty: 3, reservedQty: 2 })).toBe(true);
    expect(isShortLine({ qty: 3, reservedQty: 3 })).toBe(false);
    expect(isShortLine({ qty: 3, reservedQty: 5 })).toBe(false);
  });
});

it('lineSplitText 는 모자란 개수를 앞에 둔다', () => {
  expect(lineSplitText({ qty: 5, reservedQty: 2 })).toBe(
    '3개 모자람 · 주문 5 · 지금 보낼 2'
  );
});
```

`blocked-copy.spec.ts` 의 `다른 주문 몫은 재고를 넘지 않게 보인다` 기대값을 바꾼다:
- `'주문 3 · 이 창고 재고 1 (다른 주문 몫 1) · 모자람 3'` → `'3개 모자람 · 주문 3 · 이 창고 재고 1 (다른 주문 몫 1)'`
- `'주문 3 · 이 창고 재고 0 · 모자람 3'` → `'3개 모자람 · 주문 3 · 이 창고 재고 0'`

렌더 스펙 두 곳의 기대 문구도 같이 바꾼다(문구 변경만으로 깨지므로):
- `bucket-list.spec.tsx` 260줄: `'주문 5 · 이 창고 재고 2 (다른 주문 몫 2) · 모자람 5'` → `'5개 모자람 · 주문 5 · 이 창고 재고 2 (다른 주문 몫 2)'`
- `OutboundPreparationTemplate.render.spec.tsx` 730줄: `'상품주문 3 · 지금 보낼 2 · 기다릴 1'` → `'상품1개 모자람 · 주문 3 · 지금 보낼 2'`

- [ ] **Step 2: 실패를 확인한다**

Run: `npm run test:admin-web -- --maxWorkers=2 outbound-preparation`
Expected: FAIL — `isShortLine is not a function`(또는 import 에러)와 바뀐 기대 문구 불일치.

- [ ] **Step 3: 구현한다**

- `preparation-model.ts`: `isShortLine` 을 export 하고, `lineSplitText` 가 `` `${wait}개 모자람 · 주문 ${line.qty} · 지금 보낼 ${now}` `` 를 돌려주게 한다. 함수 위 주석에 «모자란 줄(isShortLine)에만 부른다»를 적는다.
- `blocked-copy.ts`: `shortageLineText` 가 `` `${short}개 모자람 · 주문 ${line.qty} · ${stock}` `` 를 돌려주게 한다.

- [ ] **Step 4: 통과를 확인한다**

Run: `npm run test:admin-web -- --maxWorkers=2 outbound-preparation`
Expected: PASS (Review Focus 5 의 `지금 보낼 2 · 기다릴 1` 결과 창 테스트 포함)

- [ ] **Step 5: 커밋**

```bash
git add apps/admin-web/src/features/order/outbound-preparation
git commit -m "[admin-web] 부분출고·출고불가 상품 줄 문구가 모자란 개수부터 보인다 (#1546)"
```

---

### Task 2: 상품 칸에서 모자란 줄은 빨강, 다 있는 줄은 이름만 회색

**Files:**
- Modify: `apps/admin-web/src/features/order/outbound-preparation/components/bucket-list.tsx:248-280` (상품 칸 `partial`·`unavailable` 두 갈래)
- Test: `apps/admin-web/src/features/order/outbound-preparation/components/bucket-list.spec.tsx`

**Interfaces:**
- Consumes: Task 1 의 `isShortLine`, `lineSplitText`, `shortageLineText`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`bucket-list.spec.tsx` 에 추가(픽스처는 파일의 `list`·`shipment`·`awayStock` 헬퍼를 쓴다). 줄 요소는 `screen.getByText('<이름>')` 의 `className` 으로 판정한다.

```ts
it('부분출고는 모자란 상품 줄만 빨갛게 수량과 함께, 다 있는 줄은 이름만 흐리게 보인다', () => {
  // partial, lines: 상품 A {qty 1, reservedQty 1}, 상품 B {qty 3, reservedQty 1, stock: awayStock('sku-b', 6)}
  expect(screen.getByText('상품 A').className).toContain('text-muted-foreground');
  expect(screen.getByText('상품 B').className).toContain('text-red-600');
  expect(screen.getByText('2개 모자람 · 주문 3 · 지금 보낼 1').className).toContain('text-red-600');
  expect(screen.queryByText(/주문 1 ·/)).toBeNull();
});

it('부분출고에 모자란 줄이 없으면 이름만 흐리게 보인다', () => {
  // partial, lines: 상품 A {qty 2, reservedQty 2}
  expect(screen.getByText('상품 A').className).toContain('text-muted-foreground');
  expect(screen.queryByText(/모자람/)).toBeNull();
});

it('출고불가에서 stock 없는 모자란 줄은 이름만 빨갛게 보인다', () => {
  // unavailable, lines: 상품 A {qty 2, reservedQty 0, stock: awayStock('sku-a', 1)}, 상품 B {qty 1, reservedQty 0}
  expect(screen.getByText('상품 A').className).toContain('text-red-600');
  expect(screen.getByText('상품 B').className).toContain('text-red-600');
  expect(screen.getAllByText(/개 모자람 ·/)).toHaveLength(1);
});
```

기존 `출고불가 내역은 고를 칸 없이 …` 테스트에 한 줄 더한다:
`expect(screen.getByText('5개 모자람 · 주문 5 · 이 창고 재고 2 (다른 주문 몫 2)').className).toContain('text-red-600');`

- [ ] **Step 2: 실패를 확인한다**

Run: `npm run test:admin-web -- --maxWorkers=2 bucket-list`
Expected: FAIL — 이름 `className` 에 `text-red-600`/`text-muted-foreground` 없음, 다 있는 줄에 `주문 1 · …` 이 아직 보임.

- [ ] **Step 3: 구현한다**

`bucket-list.tsx` 상품 칸 두 갈래에서 줄마다 `const short = isShortLine(line)`:
- 이름 `<span>`: `short ? 'block font-semibold text-red-600' : 'block text-muted-foreground'`
- 부분출고 수량 줄: `short` 일 때만 `lineSplitText(line)`, 클래스 `block whitespace-nowrap text-xs font-semibold tabular-nums text-red-600`
- 출고불가 수량 줄: `short && line.stock` 일 때만 `shortageLineText`, 클래스 `block text-xs font-semibold tabular-nums text-red-600`
- 갈래 조건(`partial && lines?.length`, `unavailable && lines?.some(line => line.stock)`)은 그대로 둔다.

- [ ] **Step 4: 통과를 확인한다**

Run: `npm run test:admin-web -- --maxWorkers=2 outbound-preparation`
Expected: PASS

Run: `(cd apps/admin-web && npx tsc --noEmit)`
Expected: 에러 0

- [ ] **Step 5: 커밋**

```bash
git add apps/admin-web/src/features/order/outbound-preparation/components
git commit -m "[admin-web] 출고 준비 부분출고·출고불가 내역에서 모자란 상품 줄을 빨갛게, 다 있는 줄은 흐리게 보인다 (#1546)"
```

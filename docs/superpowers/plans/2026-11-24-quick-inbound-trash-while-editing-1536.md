# 간편입고 수정 중 휴지통 (#1536) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 간편입고에서 수량 수정이 열려 있어도 어느 줄이든 휴지통으로 지울 수 있고, 잠긴 버튼은 잠긴 티가 난다.

**Architecture:** `QuickInboundScreen.tsx` 한 파일. 삭제 버튼의 disabled 조건에서 `!!editing` 만 빼고, 삭제 저장이 성공한 뒤 지운 줄이 수정 중이던 줄이면 수정을 닫는다. 줄의 수량·삭제 버튼에 `disabled:opacity-40` 을 단다.

**Tech Stack:** React + Tailwind, vitest + Testing Library (`native/warehouse-app`).

**Spec:** `docs/superpowers/specs/2026-11-24-quick-inbound-trash-while-editing-1536-design.md`

## Global Constraints

- 휴지통의 나머지 잠금 조건(`!reconciled`·`!draft.ready`·`scanQueue.blocked()`·`submit.isPending`·`saving`)은 그대로 둔다.
- 수량 버튼은 `editing` 중 계속 잠근다.
- 다른 줄을 지울 때 열린 수정창과 입력값은 그대로 남아야 한다.
- 수정 흐름(자동 열림·수량 저장·수정 취소)은 바꾸지 않는다.

## Review Focus

1. 수정 중인 줄을 지운 뒤 `editing` 이 남으면 스캔·등록·검색이 전부 잠긴 채 화면에 수정창도 없다 → 반드시 `editing` 이 `null` 이 된다(Task 1 테스트 1 이 나머지 줄의 수량 버튼이 다시 눌리는지로 확인).
2. 삭제 저장이 실패하면 줄도 수정 상태도 그대로여야 한다 → `setEditing` 은 `setCart` 가 성공한 뒤에만 부른다(코드 리뷰로 확인, 저장 실패 주입 픽스처가 없다).
3. 다른 줄을 지울 때 입력하던 숫자가 사라지면 반목표 위반 → Task 1 테스트 2.
4. 수정을 닫은 뒤 스캔이 다시 받아져야 한다 → 테스트 1 끝에서 스캔이 담기는지 확인.

---

### Task 1: 수정 중에도 휴지통이 눌린다

**Files:**
- Modify: `native/warehouse-app/src/domains/inbound/QuickInboundScreen.tsx:683-735` (줄의 수량 버튼·삭제 버튼)
- Test: `native/warehouse-app/src/domains/inbound/QuickInboundScreen.test.tsx`

**Interfaces:**
- Consumes: 테스트 파일의 `renderScreen`, `ScanButton`, `BOX_SKU`, 목 `client.request`.
- Produces: 없음.

- [ ] **Step 1: 두 번째 SKU 픽스처를 테스트 파일에 더한다**

`BOX_SKU` 옆에 `SECOND_SKU` (id `s2`, code `PT-002`, name `면바지`, 바코드 `7701` 하나, `packingUnit: null`). 목 `request` 에서 `'/inventory/skus?barcode=7701'` 분기를 일반 `barcode=` 분기(빈 배열)보다 앞에 두고 `SECOND_SKU` 를 돌려준다. `indexRoute` 컴포넌트에 `<ScanButton code="7701" />` 를 더한다.

- [ ] **Step 2: 실패하는 테스트 두 개를 쓴다** (`describe('QuickInboundScreen')` 밖, 파일 최상위 `it`, 기존 «상품 검색과 키보드 수량 입력…» 테스트 뒤)

```tsx
it('상품을 고른 직후 수정이 열려 있어도 그 줄을 지우면 수정이 닫히고 다른 작업이 풀린다', async () => {
  await renderScreen([]);
  await screen.findByText('간편입고');
  await userEvent.click(screen.getByRole('button', { name: '스캔:7701' }));
  await screen.findByText('면바지');
  await userEvent.type(await screen.findByLabelText('상품명·코드 검색'), '셔츠{Enter}');
  await userEvent.click(await screen.findByRole('button', { name: '코튼셔츠 선택' }));
  await screen.findByLabelText(/입고 수량 직접 입력/);

  const trash = screen.getByRole('button', { name: '코튼셔츠 삭제' });
  expect(trash).toBeEnabled();
  await userEvent.click(trash);

  await waitFor(() => expect(screen.queryByText('코튼셔츠')).not.toBeInTheDocument());
  expect(screen.queryByLabelText(/입고 수량 직접 입력/)).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByLabelText('면바지 수량')).toBeEnabled());
  await userEvent.click(screen.getByRole('button', { name: '스캔:7701' }));
  await waitFor(() => expect(screen.getByLabelText('면바지 수량')).toHaveTextContent('2'));
});

it('한 줄을 수정하는 중에 다른 줄을 지워도 수정창과 입력한 숫자가 남는다', async () => {
  await renderScreen([]);
  await screen.findByText('간편입고');
  await userEvent.click(screen.getByRole('button', { name: '스캔:8801' }));
  await screen.findByText('코튼셔츠');
  await userEvent.click(screen.getByRole('button', { name: '스캔:7701' }));
  await screen.findByText('면바지');

  await userEvent.click(screen.getByLabelText('코튼셔츠 수량'));
  const input = await screen.findByLabelText(/입고 수량 직접 입력/);
  await userEvent.clear(input);
  await userEvent.type(input, '7');

  const otherQty = screen.getByLabelText('면바지 수량');
  expect(otherQty).toBeDisabled();
  expect(otherQty).toHaveClass('disabled:opacity-40');
  expect(screen.getByRole('button', { name: '면바지 삭제' })).toHaveClass('disabled:opacity-40');

  await userEvent.click(screen.getByRole('button', { name: '면바지 삭제' }));

  await waitFor(() => expect(screen.queryByText('면바지')).not.toBeInTheDocument());
  expect(screen.getByLabelText(/입고 수량 직접 입력/)).toHaveValue('7');
});
```

- [ ] **Step 3: 실패를 확인한다**

Run: `cd native/warehouse-app && npx vitest run src/domains/inbound/QuickInboundScreen.test.tsx -t "지우"`
Expected: 두 테스트 FAIL. 테스트 1 은 `toBeEnabled` 에서, 테스트 2 는 `toHaveClass('disabled:opacity-40')` 에서 실패한다.

- [ ] **Step 4: 화면을 고친다** (`QuickInboundScreen.tsx`)

- 삭제 버튼 `disabled` 에서 `!!editing` 줄을 뺀다.
- 삭제 `onClick` 에서 `await setCart(...)` 가 성공한 바로 뒤(같은 `try` 안)에서 `setEditing((cur) => (cur === row.skuId ? null : cur))` 를 부른다. `catch` 로 가면 부르지 않는다.
- 수량 버튼과 삭제 버튼의 `className` 끝에 `disabled:opacity-40` 을 더한다.

- [ ] **Step 5: 이 파일 테스트를 통과시킨다**

Run: `cd native/warehouse-app && npx vitest run src/domains/inbound/QuickInboundScreen.test.tsx`
Expected: 전부 PASS(새 두 개 포함).

- [ ] **Step 6: warehouse-app 게이트**

Run: `cd native/warehouse-app && npx tsc -b && npx vitest run`
Expected: tsc 에러 0, vitest 실패 0.

- [ ] **Step 7: 커밋**

```bash
git add native/warehouse-app/src/domains/inbound/QuickInboundScreen.tsx native/warehouse-app/src/domains/inbound/QuickInboundScreen.test.tsx
git commit -m "[warehouse-app] 간편입고에서 수량 수정 중에도 휴지통으로 줄을 지우고, 잠긴 버튼은 흐리게 보인다 (#1536)"
```

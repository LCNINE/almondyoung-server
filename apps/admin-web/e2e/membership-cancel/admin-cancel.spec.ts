/**
 * 관리자 해지·환불 UI E2E (실제 브라우저).
 *
 * 멤버십 회원 목록 → 상세 모달 → "해지 · 환불" 탭에서 CS 가 실제로 하는 조작을 검증한다.
 * 백엔드는 e2e/membership-cancel/stub-backend.mjs 로 대체한다.
 *
 * 실행: npm run test:e2e:membership-cancel
 */
import { expect, test } from 'playwright/test';

const SCENARIO = process.env.SCENARIO ?? 'annual';
const STUB = `http://localhost:${process.env.STUB_PORT ?? 4801}`;

type StubCall = { path: string; body: Record<string, unknown> };

async function stubCalls(request: import('playwright/test').APIRequestContext) {
  const res = await request.get(`${STUB}/__calls`);
  return (await res.json()).data as StubCall[];
}

async function resetStub(request: import('playwright/test').APIRequestContext) {
  await request.get(`${STUB}/__reset`);
}

/** 목록에서 상세 모달을 열고 해지·환불 탭으로 이동 */
async function openCancelTab(page: import('playwright/test').Page) {
  await page.goto('/membership/members');
  // 행의 상세 진입 버튼은 '수정' 이다('관리' 는 컬럼 헤더 — 사이드바의 '멤버십 관리' 와도 겹친다).
  await page.getByRole('button', { name: '수정', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('tab', { name: '해지 · 환불' }).click();
  return dialog;
}

test.describe(`관리자 해지·환불 UI (${SCENARIO})`, () => {
  test.beforeEach(async ({ request }) => {
    await resetStub(request);
  });

  test('해지 · 환불 탭이 결제 방식과 이용 종료일을 보여준다', async ({ page }) => {
    const dialog = await openCancelTab(page);

    await expect(dialog.getByText('현재 플랜')).toBeVisible();
    if (SCENARIO === 'scheduled') {
      await expect(dialog.getByText('정기결제 (해지 예약됨)')).toBeVisible();
    } else if (SCENARIO === 'one-time' || SCENARIO === 'one-time-scheduled' || SCENARIO === 'annual') {
      await expect(dialog.getByText('일시결제 (자동갱신 없음)')).toBeVisible();
    } else {
      await expect(dialog.getByText('정기결제 (자동갱신)')).toBeVisible();
    }
  });

  test('해지 예약은 사유 없이는 확정할 수 없다', async ({ page, request }) => {
    test.skip(!['monthly-cms'].includes(SCENARIO), '정기결제 계약에만 해지예약 카드가 뜬다');

    const dialog = await openCancelTab(page);
    await dialog.getByRole('button', { name: '해지 예약하기' }).click();
    await dialog.getByRole('button', { name: '해지 예약 확정' }).click();

    // 사유가 비면 토스트로 막고 요청은 보내지 않는다.
    await expect(page.getByText('해지 사유를 입력해주세요.')).toBeVisible();
    expect((await stubCalls(request)).filter((c) => c.path === 'schedule-cancel')).toHaveLength(0);

    await dialog.getByPlaceholder('고객 요청 내용 등').fill('고객 요청');
    await dialog.getByRole('button', { name: '해지 예약 확정' }).click();

    // 해지 사유·해지 시각·자동이체 약정 종료까지 처리하는 전용 API 로 나가야 한다
    // (auto-renewal 토글은 청구만 멈춘다).
    await expect
      .poll(async () => (await stubCalls(request)).filter((c) => c.path === 'schedule-cancel').length)
      .toBe(1);
    const call = (await stubCalls(request)).find((c) => c.path === 'schedule-cancel')!;
    expect(call.body.reason).toBe('고객 요청');
  });

  test('해지 예약 상태는 해지일·사유·환불 미완료를 드러내고 철회할 수 있다', async ({ page, request }) => {
    test.skip(SCENARIO !== 'scheduled', '해지 예약 시나리오만');

    const dialog = await openCancelTab(page);

    await expect(dialog.getByText('해지 예약됨', { exact: true })).toBeVisible();
    await expect(dialog.getByText(/해지 신청/)).toBeVisible();
    await expect(dialog.getByText(/사유: NOT_USING/)).toBeVisible();
    // 자격은 회수됐는데 돈이 안 나간 건을 놓치지 않게 강조돼야 한다.
    await expect(dialog.getByText(/미완료 — 4,990원 처리 필요/)).toBeVisible();
    // 해지 예약 상태에서는 다시 예약할 수 없다.
    await expect(dialog.getByRole('button', { name: '해지 예약하기' })).toHaveCount(0);

    // 계좌 송금이 남은 건은 '어디로 보낼지'가 같은 화면에 있어야 실제로 끝낼 수 있다.
    // (효성 CMS 는 wallet 에 환불 행이 없어 결제관리 화면에도 이 건이 나타나지 않는다)
    const account = dialog.getByTestId('manual-refund-account');
    await expect(account).toContainText('110123456789');
    await expect(account).toContainText('테스트고객');

    await dialog.getByRole('button', { name: /해지 예약 철회/ }).click();
    await expect
      .poll(async () => (await stubCalls(request)).filter((c) => c.path === 'auto-renewal').length)
      .toBe(1);
    expect((await stubCalls(request))[0].body.autoRenewal).toBe(true);
  });

  // 철회는 wallet 자동이체 약정을 새로 만든다. 1회 결제 고객에게 열어주면 동의한 적 없는 정기결제가
  // 시작되므로, 서버 판정(canUndoCancellation=false)에 따라 버튼 자체가 없어야 한다.
  test('1회 결제의 해지 예약은 철회 버튼을 열지 않는다 (동의 없는 정기결제 전환 차단)', async ({ page, request }) => {
    test.skip(SCENARIO !== 'one-time-scheduled', '1회 결제 해지 예약 시나리오만');

    const dialog = await openCancelTab(page);

    await expect(dialog.getByText('해지 예약됨', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /해지 예약 철회/ })).toHaveCount(0);
    await expect(dialog.getByText(/되살릴 자동결제가 없습니다/)).toBeVisible();
    expect((await stubCalls(request)).filter((c) => c.path === 'auto-renewal')).toHaveLength(0);
  });

  test('1회 결제는 예약 해지가 필요 없다고 안내한다', async ({ page }) => {
    test.skip(SCENARIO !== 'one-time', '1회 결제 시나리오만');

    const dialog = await openCancelTab(page);
    await expect(dialog.getByText('자동 결제 없음')).toBeVisible();
    await expect(dialog.getByText(/예약 해지가 필요하지 않습니다/)).toBeVisible();
    await expect(dialog.getByRole('button', { name: '해지 예약하기' })).toHaveCount(0);
    // 즉시 종료·환불 경로는 여전히 있어야 한다.
    await expect(dialog.getByRole('button', { name: '즉시 해지 + 환불 처리' })).toBeVisible();
  });

  test('즉시 해지 다이얼로그가 정책 견적과 산출 내역을 먼저 보여준다', async ({ page }) => {
    test.skip(SCENARIO === 'scheduled', '해지 예약 상태는 견적 확인만 별도로 다룬다');

    const dialog = await openCancelTab(page);
    await dialog.getByRole('button', { name: '즉시 해지 + 환불 처리' }).click();

    const modal = page.getByRole('dialog', { name: '즉시 해지 + 환불' });
    await expect(modal.getByText('정책 기준 환불액')).toBeVisible();

    if (SCENARIO === 'annual') {
      await expect(modal.getByText('34,930원')).toBeVisible();
      await expect(modal.getByText('(연간 중도해지 정산)')).toBeVisible();
      await expect(modal.getByText(/이용 3개월 × 월 정가 4,990원 = -14,970원/)).toBeVisible();
      await expect(modal.getByText('환불 수단: PG 자동환불 가능')).toBeVisible();
    }
    if (SCENARIO === 'monthly-cms') {
      await expect(modal.getByText('(7일 내 청약철회 · 전액)')).toBeVisible();
      await expect(modal.getByText(/자동환불 불가 — 계좌 송금 필요/)).toBeVisible();
    }
  });

  test('연간 전액 환불을 고르면 정책 초과 경고가 뜬다', async ({ page }) => {
    test.skip(SCENARIO !== 'annual', '연간 시나리오만');

    const dialog = await openCancelTab(page);
    await dialog.getByRole('button', { name: '즉시 해지 + 환불 처리' }).click();
    const modal = page.getByRole('dialog', { name: '즉시 해지 + 환불' });

    await modal.getByLabel('전액 환불 (연간 전액 — 주의)').click();
    await expect(modal.getByText(/정책 정산\(34,930원\)보다 큽니다/)).toBeVisible();
  });

  test('"정책 금액" 버튼이 견적 금액을 그대로 채운다', async ({ page, request }) => {
    test.skip(SCENARIO !== 'annual', '연간 시나리오만');

    const dialog = await openCancelTab(page);
    await dialog.getByRole('button', { name: '즉시 해지 + 환불 처리' }).click();
    const modal = page.getByRole('dialog', { name: '즉시 해지 + 환불' });

    await modal.getByLabel('정책 금액/직접 입력').click();
    const amount = modal.getByPlaceholder('환불 금액 입력');
    // 선택하는 순간 정책 금액이 기본값으로 채워져 오타·짐작을 줄인다.
    await expect(amount).toHaveValue('34930');

    await amount.fill('1000');
    await modal.getByRole('button', { name: '정책 금액' }).click();
    await expect(amount).toHaveValue('34930');

    await modal.getByPlaceholder('취소 사유를 입력해주세요').fill('고객 요청');
    await modal.getByRole('button', { name: '즉시 해지 확인' }).click();

    await expect
      .poll(async () => (await stubCalls(request)).filter((c) => c.path === 'force-cancel').length)
      .toBe(1);
    const call = (await stubCalls(request)).find((c) => c.path === 'force-cancel')!;
    expect(call.body).toMatchObject({ refundType: 'PARTIAL', refundAmount: 34930, reason: '고객 요청' });
    // 해지 안내 메일 수신 주소가 함께 전달돼야 한다(멤버십은 사용자 조회를 하지 않는다).
    expect(call.body.customerEmail).toBe('customer@example.com');
  });

  test('사유 없이 즉시 해지를 확인하면 막힌다', async ({ page, request }) => {
    test.skip(SCENARIO !== 'annual', '대표 시나리오 하나로 확인');

    const dialog = await openCancelTab(page);
    await dialog.getByRole('button', { name: '즉시 해지 + 환불 처리' }).click();
    const modal = page.getByRole('dialog', { name: '즉시 해지 + 환불' });

    await modal.getByRole('button', { name: '즉시 해지 확인' }).click();
    await expect(page.getByText('취소 사유를 입력해주세요.')).toBeVisible();
    expect((await stubCalls(request)).filter((c) => c.path === 'force-cancel')).toHaveLength(0);
  });

  test('자동환불 불가 수단은 은행을 선택하게 하고 계좌 없이는 못 넘어간다', async ({ page, request }) => {
    test.skip(SCENARIO !== 'monthly-cms', '자동이체 시나리오만');

    const dialog = await openCancelTab(page);
    await dialog.getByRole('button', { name: '즉시 해지 + 환불 처리' }).click();
    const modal = page.getByRole('dialog', { name: '즉시 해지 + 환불' });

    await modal.getByLabel('정책 금액/직접 입력').click();
    await modal.getByPlaceholder('취소 사유를 입력해주세요').fill('청약철회');

    // 계좌 미입력으로는 실행되지 않는다.
    await modal.getByRole('button', { name: '즉시 해지 확인' }).click();
    await expect(page.getByText(/환불 송금 계좌.*입력해주세요/)).toBeVisible();
    expect((await stubCalls(request)).filter((c) => c.path === 'force-cancel')).toHaveLength(0);

    // 은행은 코드 직접 입력이 아니라 선택이어야 한다(오타 송금 방지).
    const bank = modal.getByLabel('환불 은행');
    await expect(bank).toBeVisible();
    await bank.selectOption({ index: 1 });
    await modal.getByLabel('계좌번호').fill('110123456789');
    await modal.getByLabel('예금주명').fill('홍길동');

    await modal.getByRole('button', { name: '즉시 해지 확인' }).click();
    await expect
      .poll(async () => (await stubCalls(request)).filter((c) => c.path === 'force-cancel').length)
      .toBe(1);
    const call = (await stubCalls(request)).find((c) => c.path === 'force-cancel')!;
    expect(call.body.refundReceiveAccount).toMatchObject({ accountNumber: '110123456789', holderName: '홍길동' });
  });

  // 고객관리 상세창(멤버십 탭)은 동일한 MembershipDetailPanel 을 allowAdminActions 기본값(=true)으로
  // 렌더한다. 그 화면을 브라우저로 검증하려면 customers 페이지와 core API 스택까지 스텁해야 해서
  // 이 스펙 범위를 넘는다 — 여기서는 멤버십 메뉴 경로만 검증한다.
});

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
    } else if (
      ['one-time', 'one-time-scheduled', 'annual', 'pg-settled', 'pg-pending', 'no-payment', 'no-payment-active', 'legacy-detail'].includes(
        SCENARIO
      )
    ) {
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

  // 결제한 적 없는 계약(관리자 지급·이관)에 환불 요청이 걸린 잔재. 보낼 돈도 보낼 곳도 없는데
  // "미완료 — N원 처리 필요" 만 뜨면 CS 가 송금할 계좌를 찾아 헤맨다.
  test('결제 내역이 없는 계약은 환불할 대상이 없음을 알리고 송금 버튼을 열지 않는다', async ({ page }) => {
    test.skip(SCENARIO !== 'no-payment', '결제 내역 없는 잔재 시나리오만');

    const dialog = await openCancelTab(page);

    await expect(dialog.getByText('환불 대상 결제 없음')).toBeVisible();
    await expect(dialog.getByTestId('refund-impossible-notice')).toContainText(/받은 돈이 없어/);
    await expect(dialog.getByTestId('complete-manual-refund')).toHaveCount(0);
    await expect(dialog.getByText(/미완료 — 4,990원 처리 필요/)).toHaveCount(0);
  });

  // 결제 내역이 없는 계약에는 서버가 환불 유형을 400 으로 거부한다. 다이얼로그가 그걸 모르면
  // 관리자가 사유·금액·계좌를 다 채운 뒤에야 막히고, 왜 막혔는지도 그때서야 안다.
  test('결제 내역이 없는 계약은 환불 유형을 아예 고를 수 없다', async ({ page }) => {
    test.skip(SCENARIO !== 'no-payment-active', '결제 없는 활성 계약 시나리오만');

    const dialog = await openCancelTab(page);
    await dialog.getByRole('button', { name: '즉시 해지 + 환불 처리' }).click();
    const confirm = page.getByRole('dialog').filter({ hasText: '즉시 해지 + 환불' }).last();

    await expect(confirm.getByTestId('refund-blocked-notice')).toContainText(/환불할 대상이 없습니다/);
    await expect(confirm.getByRole('radio', { name: /전액 환불/ })).toBeDisabled();
  });

  // 배포 과도기: admin-web 이 membership 보다 먼저 뜨면 hasPaymentIntent 가 오지 않는다. 그때
  // "값이 없다" 를 "결제가 없다" 로 읽으면 정상 수동 송금 건의 완료 창구가 통째로 사라진다.
  test('옛 membership 응답(새 필드 없음)에서도 송금 완료 창구가 살아있다', async ({ page }) => {
    test.skip(SCENARIO !== 'legacy-detail', '배포 과도기 시나리오만');

    const dialog = await openCancelTab(page);

    await expect(dialog.getByText(/미완료 — 4,990원 처리 필요/)).toBeVisible();
    await expect(dialog.getByTestId('complete-manual-refund')).toBeVisible();
    await expect(dialog.getByTestId('refund-impossible-notice')).toHaveCount(0);
    await expect(dialog.getByText('환불 대상 결제 없음')).toHaveCount(0);
    // 어디로 보낼지도 그대로 보여야 송금을 끝낼 수 있다.
    await expect(dialog.getByTestId('manual-refund-account')).toBeVisible();
  });

  // 자동환불이 실패로 기록됐어도 PG 로는 이미 나갔을 수 있다(타임아웃 등). 그 상태에서 관리자가
  // 계좌로 또 보내면 돈이 두 번 나간다 — 송금 버튼을 누르기 전에 화면이 사실을 알려야 한다.
  test('PG 로 이미 환불된 건은 추가 송금이 필요 없다고 알린다', async ({ page }) => {
    test.skip(SCENARIO !== 'pg-settled', 'PG 정산 완료 시나리오만');

    const dialog = await openCancelTab(page);

    await expect(dialog.getByTestId('refund-settlement-notice')).toContainText(
      /이미 4,990원이 환불되었습니다/
    );
    // 보낼 곳을 띄우면 '아직 보내야 한다' 로 읽힌다 — 계좌는 감춘다.
    await expect(dialog.getByTestId('manual-refund-account')).toHaveCount(0);
    // 버튼은 송금 확인이 아니라 기록 정리로 바뀐다.
    await expect(dialog.getByTestId('complete-manual-refund')).toHaveText('완료로 정리');
  });

  test('결제관리가 닫아야 하는 환불에는 송금 완료 버튼을 열지 않는다 (이중 송금 차단)', async ({
    page,
  }) => {
    test.skip(SCENARIO !== 'pg-pending', '확정 대기 시나리오만');

    const dialog = await openCancelTab(page);

    await expect(dialog.getByTestId('refund-settlement-notice')).toContainText(
      /결제관리에서 완료 처리하세요/
    );
    await expect(dialog.getByTestId('complete-manual-refund')).toHaveCount(0);
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
    test.skip(
      SCENARIO === 'scheduled' || SCENARIO === 'no-payment' || SCENARIO === 'legacy-detail',
      '해지 예약 상태는 견적 확인만 별도로 다루고, 이미 해지된 건에는 즉시해지 카드가 없다'
    );

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

  // 고객관리 상세창(회원정보조회)의 멤버십 탭은 같은 MembershipDetailPanel 을 렌더하고 같은 해지·환불
  // 액션을 쓴다. CS 가 실제로 여기서 처리하므로 이 경로도 브라우저로 확인한다 — 다른 탭(주문·장바구니)이
  // 쓰는 Medusa/core API 는 스텁에 없어 404 로 떨어지지만, 그건 이 화면의 렌더를 막지 않아야 한다.
  test('고객관리 상세창의 멤버십 탭도 같은 해지·환불 화면을 연다', async ({ page }) => {
    test.skip(!['monthly-cms', 'scheduled'].includes(SCENARIO), '대표 시나리오 두 개로만 확인한다');

    await page.goto('/customer-window/e2e-user');
    await page.getByRole('button', { name: '멤버십', exact: true }).click();

    const panel = page.getByRole('tabpanel');
    await page.getByRole('tab', { name: '해지 · 환불' }).click();
    await expect(panel.getByText('현재 플랜')).toBeVisible();

    if (SCENARIO === 'scheduled') {
      // 해지 예약 배너와 철회 버튼이 멤버십 메뉴와 똑같이 떠야 한다.
      await expect(panel.getByText('해지 예약됨', { exact: true })).toBeVisible();
      await expect(panel.getByRole('button', { name: /해지 예약 철회/ })).toBeVisible();
      // 수동 송금 계좌도 같은 자리에 있어야 CS 가 여기서 환불을 끝낼 수 있다.
      await expect(panel.getByTestId('manual-refund-account')).toBeVisible();
      await expect(panel.getByTestId('complete-manual-refund')).toBeVisible();
    } else {
      await expect(panel.getByRole('button', { name: '해지 예약하기' })).toBeVisible();
    }

    // 즉시 해지 다이얼로그(견적 포함)까지 같은 동작이어야 한다.
    await panel.getByRole('button', { name: '즉시 해지 + 환불 처리' }).click();
    const modal = page.getByRole('dialog', { name: '즉시 해지 + 환불' });
    await expect(modal.getByText('정책 기준 환불액')).toBeVisible();
  });
});

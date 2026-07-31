/**
 * 멤버십 해지 UI E2E (실제 브라우저).
 *
 * 실제 화면을 크로미움으로 띄워 고객이 보는 것과 누르는 것을 검증한다. 백엔드는 e2e/stub-backend.mjs
 * 로 대체하고(스토어프론트 로컬 모드가 붙는 3000/3001/5001), 시나리오는 SCENARIO 로 바꿔 띄운다.
 *
 * 실행: npm run test:e2e:membership-cancel
 */
import { expect, test } from 'playwright/test';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:8000';
const MEMBERSHIP_URL = `${BASE}/kr/mypage/membership`;

type StubCall = { path: string; body: Record<string, unknown> };

/** 스텁이 받은 요청 기록 — "화면에서 누른 결과가 어떤 payload 로 갔는지" 확인용 */
async function stubCalls(request: import('playwright/test').APIRequestContext) {
  const res = await request.get('http://localhost:3001/__calls');
  return (await res.json()).data as StubCall[];
}

/** 테스트 간 기록이 누적되면 이전 테스트의 호출을 잘못 집는다 */
async function resetStub(request: import('playwright/test').APIRequestContext) {
  await request.get('http://localhost:3001/__reset');
}

/** 마지막으로 나간 해지 요청 */
async function lastCancelCall(request: import('playwright/test').APIRequestContext) {
  const calls = await stubCalls(request);
  return calls.filter((c) => c.path === '/subscriptions/cancel').at(-1);
}

const SCENARIO = process.env.SCENARIO ?? 'recurring-withdrawal';

test.describe(`멤버십 해지 UI (${SCENARIO})`, () => {
  test.beforeEach(async ({ page, request }) => {
    await resetStub(request);
    await page.goto(MEMBERSHIP_URL);
    await expect(page.getByRole('heading', { name: '멤버십 관리' })).toBeVisible();
  });

  test('가입자 화면이 정상 렌더되고 해지 진입점이 보인다', async ({ page }) => {
    if (SCENARIO === 'scheduled' || SCENARIO === 'one-time-scheduled') {
      // 해지 예약 상태에서는 해지 버튼을 감추고 배너를 보여준다(중복 해지 차단이 UI 에서 먼저 일어난다).
      await expect(page.getByText('해지 예약됨')).toBeVisible();
      await expect(page.getByRole('button', { name: '멤버십 해지하기' })).toHaveCount(0);
      return;
    }
    await expect(page.getByRole('button', { name: '멤버십 해지하기' })).toBeVisible();
    await expect(page.getByText('해지 예약됨')).toHaveCount(0);
  });

  test('해지 모달 흐름', async ({ page, request }) => {
    test.skip(SCENARIO.includes('scheduled'), '해지 예약 상태는 해지 진입점이 없다');

    await page.getByRole('button', { name: '멤버십 해지하기' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const immediateAvailable = ['recurring-withdrawal', 'annual-proration', 'cms-manual'].includes(SCENARIO);

    if (immediateAvailable) {
      // 1단계: 해지 방식 선택. 두 선택지가 금액/종료일과 함께 보여야 한다.
      await expect(dialog.getByText('해지 방법을 선택해 주세요')).toBeVisible();
      const expectedAmount = SCENARIO === 'annual-proration' ? '34,930' : '4,990';
      await expect(dialog.getByText(new RegExp(`지금 해지하고 ${expectedAmount}원 환불`))).toBeVisible();

      if (SCENARIO === 'annual-proration') {
        // 연간 정산 근거를 그대로 보여준다 — 왜 이 금액인지 고객이 확인할 수 있어야 한다.
        await expect(dialog.getByText(/결제액 49,900원/)).toBeVisible();
        await expect(dialog.getByText(/이용 3개월 × 월 정가 4,990원 = -14,970원/)).toBeVisible();
      }
      if (SCENARIO === 'cms-manual') {
        await expect(dialog.getByText(/자동이체 결제는 즉시 환불이 불가/)).toBeVisible();
      }

      await dialog.getByRole('button', { name: '다음' }).click();
    } else {
      // 즉시해지가 불가하면 방식 선택 단계를 건너뛰고, 그 사유를 숨기지 않는다.
      await expect(dialog.getByText('해지 방법을 선택해 주세요')).toHaveCount(0);
      await expect(dialog.getByText(/환불이 불가/)).toBeVisible();
    }

    // 2단계: 사유 선택 — 고르기 전에는 진행 버튼이 비활성이어야 한다.
    await expect(dialog.getByText('멤버십 취소 이유 (하나 선택)')).toBeVisible();
    const proceed = dialog.getByRole('button', { name: /완료|다음/ });
    await expect(proceed).toBeDisabled();

    await dialog.getByText('이용하지 않아요').click();
    await expect(proceed).toBeEnabled();
    await proceed.click();

    if (SCENARIO === 'cms-manual') {
      // 3단계: 수동 송금 계좌. 미입력 상태로는 완료할 수 없다.
      await expect(dialog.getByText('환불받을 계좌')).toBeVisible();
      const done = dialog.getByRole('button', { name: '완료' });
      await expect(done).toBeDisabled();

      await dialog.getByRole('combobox').click();
      await page.getByRole('option').first().click();
      // 라벨(aria-label)로 찾는다 — placeholder 문구가 바뀌어도 테스트가 깨지지 않는다.
      await dialog.getByLabel(/숫자만 입력/).fill('110123456789');
      await dialog.getByLabel(/예금주 실명/).fill('홍길동');
      await expect(done).toBeEnabled();
      await done.click();
    }

    // 서버로 나간 payload 검증 — 화면 선택이 그대로 전달돼야 한다.
    await expect
      .poll(async () => (await stubCalls(request)).filter((c) => c.path === '/subscriptions/cancel').length)
      .toBeGreaterThan(0);

    const cancelCall = (await lastCancelCall(request))!;
    expect(cancelCall.body.reasonCode).toBe('NOT_USING');
    expect(cancelCall.body.cancelType).toBe(immediateAvailable ? 'IMMEDIATE_REFUND' : 'AT_PERIOD_END');
    if (SCENARIO === 'cms-manual') {
      expect(cancelCall.body.refundReceiveAccount).toMatchObject({ holderName: '홍길동' });
      // 자동이체 환불은 돈이 아직 나가지 않았다(PENDING). "환불되었습니다" 로 알리면 고객은
      // 계좌를 확인하고 사고로 받아들인다 — 언제 어떻게 들어오는지를 알려야 한다.
      await expect(page.getByText(/영업일 3일 내 송금됩니다/)).toBeVisible();
      await expect(page.getByText(/원이 환불되었습니다/)).toHaveCount(0);
    }
  });

  test('해지 방식을 바꿔 고를 수 있다 (즉시해지 자격이 있어도 잔여기간 이용 가능)', async ({ page, request }) => {
    test.skip(!['recurring-withdrawal', 'annual-proration'].includes(SCENARIO), '방식 선택 단계가 있는 시나리오만');

    await page.getByRole('button', { name: '멤버십 해지하기' }).click();
    const dialog = page.getByRole('dialog');

    // 권장값(즉시해지)이 아니라 해지예약을 골라도 진행되어야 한다.
    await dialog.getByText(/이용 기간까지 사용하고 해지|추가 결제 없이 해지/).click();
    await dialog.getByRole('button', { name: '다음' }).click();
    await dialog.getByText('이용하지 않아요').click();
    await dialog.getByRole('button', { name: '완료' }).click();

    await expect
      .poll(async () => (await stubCalls(request)).filter((c) => c.path === '/subscriptions/cancel').length)
      .toBeGreaterThan(0);
    const call = (await lastCancelCall(request))!;
    expect(call.body.cancelType).toBe('AT_PERIOD_END');
  });

  test('모달을 닫으면 아무 요청도 나가지 않는다', async ({ page, request }) => {
    test.skip(SCENARIO.includes('scheduled'), '해지 진입점이 없다');

    const before = (await stubCalls(request)).length;
    await page.getByRole('button', { name: '멤버십 해지하기' }).click();
    await page.getByRole('dialog').getByRole('button', { name: '취소' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await stubCalls(request)).length).toBe(before);
  });

  test('해지 예약 상태는 해지일·종료일을 명시하고 철회할 수 있다', async ({ page, request }) => {
    test.skip(SCENARIO !== 'scheduled', '해지 예약 시나리오만');

    // "언제 해지했는지 / 언제까지 이용 가능한지" 가 화면에 있어야 한다.
    await expect(page.getByText(/해지 신청하셨습니다/)).toBeVisible();
    await expect(page.getByText(/까지 멤버십 혜택을 이용하실 수 있으며/)).toBeVisible();
    await expect(page.getByText(/이후 자동 결제는 청구되지 않습니다/)).toBeVisible();

    await page.getByRole('button', { name: '해지 취소하고 계속 이용하기' }).click();

    await expect
      .poll(async () => (await stubCalls(request)).filter((c) => c.path === '/subscriptions/cancel/undo').length)
      .toBeGreaterThan(0);
  });

  // 철회 버튼만 사라지면 고객은 "왜 안 되는지·무엇을 하면 되는지" 를 알 수 없다.
  test('1회 결제의 해지 예약은 철회가 불가능한 이유를 알려준다', async ({ page, request }) => {
    test.skip(SCENARIO !== 'one-time-scheduled', '1회 결제 해지 예약 시나리오만');

    await expect(page.getByText('해지 예약됨')).toBeVisible();
    await expect(page.getByRole('button', { name: /해지 취소하고 계속 이용하기/ })).toHaveCount(0);
    await expect(page.getByText(/되돌릴 자동결제가 없습니다/)).toBeVisible();
    expect((await stubCalls(request)).filter((c) => c.path === '/subscriptions/cancel/undo')).toHaveLength(0);
  });

  test('1회 결제는 정기결제와 다른 문구로 안내한다', async ({ page }) => {
    test.skip(SCENARIO !== 'one-time', '1회 결제 시나리오만');

    // 다음 결제일이 아니라 이용 종료일을 안내해야 한다.
    await expect(page.getByText(/까지 이용 후 자동 종료됩니다/)).toBeVisible();
    await expect(page.getByText(/다음 결제 예정일/)).toHaveCount(0);
  });

  test('키보드만으로 해지 모달을 조작할 수 있다 (접근성)', async ({ page }) => {
    test.skip(SCENARIO !== 'recurring-withdrawal', '대표 시나리오 하나로 확인');

    await page.getByRole('button', { name: '멤버십 해지하기' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // 열린 직후 포커스가 모달 안에 있어야 한다(포커스 트랩).
    const focusedInDialog = await dialog.evaluate((el) => el.contains(document.activeElement));
    expect(focusedInDialog).toBe(true);

    // Esc 로 닫힌다.
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });
});

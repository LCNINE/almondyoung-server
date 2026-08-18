/**
 * 개별 배송비 그룹 표시 E2E (#661) — 실제 브라우저 + 실제 로컬 Medusa.
 *
 * 시드(apps/medusa/src/scripts/seed-e2e-shipping-notice.ts)가 넣는 데이터를 전제한다:
 *   - 그룹: e2e-flat(플랫 3,000) / e2e-perqty(개당 5,000) / e2e-cond(조건부 4,000·30,000 무료)
 *   - 상품: e2e-ship-{default,flat,perqty,cond,digital} (variant 1개, manage_inventory=false)
 *
 * 실행: npm run test:e2e:shipping-group-notice
 */
import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from 'playwright/test';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:8000';
const MEDUSA = process.env.E2E_MEDUSA_URL ?? 'http://localhost:9000';
const PUBLISHABLE_KEY = process.env.E2E_PUBLISHABLE_KEY ?? '';

const NOTICE = {
  flat: 'E2E개별플랫 배송비 3,000원 별도',
  perQuantity: 'E2E개별개당 배송비 개당 5,000원 별도',
  conditionalFree: 'E2E개별조건부 배송비 4,000원 별도 · 30,000원 이상 무료',
};

/** 렌더된 개별 배송비 안내 줄("… 배송비 … 별도")만 집는다. RSC payload 의 i18n 문자열은 안 걸린다. */
const noticeLines = (page: Page) =>
  page.locator('p', { hasText: /배송비 .*별도/ });

/**
 * 같은 문구가 모바일/데스크톱 레이아웃에 중복 렌더되고 한쪽은 CSS 로 숨겨진다.
 * `.first()` 는 DOM 순서상 숨은 쪽을 집을 수 있으므로 보이는 인스턴스만 고른다.
 */
const visibleText = (page: Page, text: string | RegExp) =>
  page.getByText(text).locator('visible=true').first();

/**
 * 테스트마다 새 고객을 만든다 — 고객 카트가 테스트 사이에 새면 시나리오(그룹 조합)가 오염된다.
 * register 가 고객 레코드까지 만들어 주지만, 환경에 따라 /store/customers 생성이 필요할 수
 * 있어 시도만 하고 실패는 무시한다. 로그인 토큰이 최종 검증이다.
 */
async function freshCustomerToken(request: APIRequestContext, tag: string) {
  const email = `e2e-ship-${tag}-${Date.now()}@test.local`;
  const password = 'e2e-password-1';
  const reg = await request.post(`${MEDUSA}/auth/customer/emailpass/register`, {
    data: { email, password },
  });
  const { token: regToken } = (await reg.json()) as { token?: string };
  await request
    .post(`${MEDUSA}/store/customers`, {
      headers: {
        'x-publishable-api-key': PUBLISHABLE_KEY,
        authorization: `Bearer ${regToken}`,
      },
      data: { email },
    })
    .catch(() => null);
  const login = await request.post(`${MEDUSA}/auth/customer/emailpass`, {
    data: { email, password },
  });
  const { token } = (await login.json()) as { token?: string };
  expect(token, '로컬 Medusa 고객 로그인 실패').toBeTruthy();
  return token!;
}

async function authedContext(browser: Browser, token: string) {
  const context = await browser.newContext();
  await context.addCookies(
    ['_medusa_jwt', 'accessToken'].map((name) => ({
      name,
      value: token,
      domain: 'localhost',
      path: '/',
      expires: Math.floor(Date.now() / 1000) + 3600,
      httpOnly: false,
      secure: false,
      sameSite: 'Lax' as const,
    })),
  );
  return context;
}

/** PDP 에서 담기 버튼으로 장바구니에 넣는다. 담기 모달은 ESC 로 닫는다. */
async function addToCart(page: Page, handle: string) {
  await page.goto(`${BASE}/kr/products/${handle}`, { waitUntil: 'domcontentloaded' });
  const button = page.locator('[data-testid="add-product-button"]').first();
  await button.click();
  // 서버 액션이 카트 쿠키를 심을 때까지 모달이 열려 있는 동안 잠깐 기다린다.
  await page.waitForTimeout(2_500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
}

test.describe('상품 상세 — 담기 전에 개별 배송비를 알린다', () => {
  test('개별 그룹 3종은 정책별 문구가 보인다', async ({ page }) => {
    await page.goto(`${BASE}/kr/products/e2e-ship-flat`, { waitUntil: 'domcontentloaded' });
    await expect(visibleText(page, NOTICE.flat)).toBeVisible();

    await page.goto(`${BASE}/kr/products/e2e-ship-perqty`, { waitUntil: 'domcontentloaded' });
    await expect(visibleText(page, NOTICE.perQuantity)).toBeVisible();

    await page.goto(`${BASE}/kr/products/e2e-ship-cond`, { waitUntil: 'domcontentloaded' });
    await expect(visibleText(page, NOTICE.conditionalFree)).toBeVisible();
  });

  // 기본 그룹까지 안내를 달면 잡음이 되어 오히려 문의가 는다.
  test('기본 그룹 상품에는 안 뜬다', async ({ page }) => {
    await page.goto(`${BASE}/kr/products/e2e-ship-default`, { waitUntil: 'domcontentloaded' });
    await expect(visibleText(page, 'E2E 기본그룹 상품')).toBeVisible();
    expect(await noticeLines(page).count()).toBe(0);
  });

  test('배송 없는 디지털 상품에는 안 뜬다', async ({ page }) => {
    await page.goto(`${BASE}/kr/products/e2e-ship-digital`, { waitUntil: 'domcontentloaded' });
    await expect(visibleText(page, 'E2E 디지털 상품')).toBeVisible();
    expect(await noticeLines(page).count()).toBe(0);
  });
});

test.describe('장바구니 — 개별 그룹 라인에만 안내가 붙는다', () => {
  let context: BrowserContext;

  test.beforeAll(async ({ browser, request }) => {
    const token = await freshCustomerToken(request, 'cart');
    context = await authedContext(browser, token);
    const page = await context.newPage();
    page.setDefaultTimeout(120_000);
    await addToCart(page, 'e2e-ship-flat');
    await addToCart(page, 'e2e-ship-default');
    await page.close();
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('데스크톱: 개별 그룹 라인 1곳에만 뜬다', async () => {
    const page = await context.newPage();
    await page.goto(`${BASE}/kr/cart`, { waitUntil: 'domcontentloaded' });
    await expect(visibleText(page, 'E2E 플랫그룹 상품')).toBeVisible();
    await expect(visibleText(page, NOTICE.flat)).toBeVisible();
    // 기본 그룹 라인에는 안 붙는다 — 보이는 안내 줄은 플랫 라인 하나뿐이어야 한다.
    expect(await noticeLines(page).locator('visible=true').count()).toBe(1);
    await page.close();
  });

  test('모바일 뷰포트에서도 라인 안내가 그려진다', async () => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/kr/cart`, { waitUntil: 'domcontentloaded' });
    await expect(visibleText(page, 'E2E 플랫그룹 상품')).toBeVisible();
    await expect(visibleText(page, NOTICE.flat)).toBeVisible();
    expect(await noticeLines(page).locator('visible=true').count()).toBe(1);
    await page.close();
  });
});

test.describe('체크아웃 — 배송비 그룹별 분해', () => {
  test('그룹이 2개면 분해 줄이 나오고 합이 배송비 행과 일치한다', async ({ browser, request }) => {
    const token = await freshCustomerToken(request, 'multi');
    const context = await authedContext(browser, token);
    const page = await context.newPage();
    page.setDefaultTimeout(120_000);
    await addToCart(page, 'e2e-ship-flat');
    await addToCart(page, 'e2e-ship-default');

    await page.goto(`${BASE}/kr/checkout`, { waitUntil: 'domcontentloaded' });
    await expect(visibleText(page, 'E2E 플랫그룹 상품')).toBeVisible();

    // 주문 상품 카드: 그룹별 금액 줄 + 합계
    await expect(visibleText(page, 'E2E개별플랫 3,000원')).toBeVisible();
    await expect(visibleText(page, '기본배송 2,500원')).toBeVisible();
    await expect(visibleText(page, '배송비 5,500원')).toBeVisible();

    // 주문 상품 카드의 라인 안내도 같은 문구다
    await expect(visibleText(page, NOTICE.flat)).toBeVisible();

    // 결제 정보 섹션: 배송비 행 아래 분해, 합계 일치 (2,500 + 3,000 = 5,500)
    await expect(visibleText(page, '₩5,500')).toBeVisible();
    await expect(visibleText(page, '₩3,000')).toBeVisible();
    await expect(visibleText(page, '₩2,500')).toBeVisible();

    await context.close();
  });

  test('그룹 3개(조건부 미달 포함)도 분해 합이 맞는다', async ({ browser, request }) => {
    const token = await freshCustomerToken(request, 'triple');
    const context = await authedContext(browser, token);
    const page = await context.newPage();
    page.setDefaultTimeout(120_000);
    await addToCart(page, 'e2e-ship-flat');
    await addToCart(page, 'e2e-ship-cond');
    await addToCart(page, 'e2e-ship-default');

    await page.goto(`${BASE}/kr/checkout`, { waitUntil: 'domcontentloaded' });
    await expect(visibleText(page, 'E2E 조건부그룹 상품')).toBeVisible();

    // 조건부 그룹은 9,000원 담아 30,000원 미달 → 4,000원 부과. 2,500+3,000+4,000 = 9,500
    await expect(visibleText(page, 'E2E개별플랫 3,000원')).toBeVisible();
    await expect(visibleText(page, 'E2E개별조건부 4,000원')).toBeVisible();
    await expect(visibleText(page, '기본배송 2,500원')).toBeVisible();
    await expect(visibleText(page, '배송비 9,500원')).toBeVisible();

    await context.close();
  });

  test('그룹이 1개면 분해 줄이 안 나온다', async ({ browser, request }) => {
    const token = await freshCustomerToken(request, 'single');
    const context = await authedContext(browser, token);
    const page = await context.newPage();
    page.setDefaultTimeout(120_000);
    await addToCart(page, 'e2e-ship-default');

    await page.goto(`${BASE}/kr/checkout`, { waitUntil: 'domcontentloaded' });
    await expect(visibleText(page, 'E2E 기본그룹 상품')).toBeVisible();

    // 합계 한 줄은 그대로, 그룹 이름이 붙은 분해 줄은 없어야 한다.
    await expect(visibleText(page, '배송비 2,500원')).toBeVisible();
    expect(await page.getByText('기본배송 2,500원').count()).toBe(0);

    await context.close();
  });

  test('디지털 단독 카트는 분해 없이 렌더된다', async ({ browser, request }) => {
    const token = await freshCustomerToken(request, 'digital');
    const context = await authedContext(browser, token);
    const page = await context.newPage();
    page.setDefaultTimeout(120_000);
    await addToCart(page, 'e2e-ship-digital');

    await page.goto(`${BASE}/kr/checkout`, { waitUntil: 'domcontentloaded' });
    await expect(visibleText(page, 'E2E 디지털 상품')).toBeVisible();
    expect(await noticeLines(page).count()).toBe(0);
    expect(await page.getByText(/기본배송 [\d,]+원/).count()).toBe(0);

    await context.close();
  });
});

import { expect, test, type Browser } from 'playwright/test'

/**
 * 스토어프론트와 Medusa 의 세그먼트 시크릿이 어긋난 구간.
 *
 * 두 서버를 따로 배포하니 한쪽만 새 값인 창이 생기고, 시크릿을 교체할 때도 같은 창이 생긴다.
 * 그때 Medusa 는 세그먼트 주장을 400 으로 막는다. 스토어프론트가 그걸 장애로 취급하면
 * 카탈로그를 그리는 페이지가 통째로 깨지고, 반대로 응답을 그냥 믿으면 비회원가가 회원 칸에
 * 캐시된다. 어느 쪽도 아니고 **개인 토큰으로 떨어져 정확한 가격을 보여야** 한다.
 *
 * 러너가 스토어프론트만 틀린 시크릿으로 다시 띄운 뒤 이 스펙을 돌린다.
 */

const HANDLE = process.env.E2E_PRODUCT_HANDLE!
const MEMBER_TOKEN = process.env.E2E_MEMBER_TOKEN!
const BASE_PRICE = process.env.E2E_BASE_PRICE!
const MEMBER_PRICE = process.env.E2E_MEMBER_PRICE!

const url = `/kr/products/${HANDLE}`
const digits = (n: string) => String(Number(n))

const visit = async (browser: Browser, token?: string) => {
  const context = await browser.newContext()
  if (token) {
    await context.addCookies(
      ['_medusa_jwt', 'accessToken'].map((name) => ({
        name,
        value: token,
        domain: 'localhost',
        path: '/',
        expires: -1,
        httpOnly: false,
        secure: false,
        sameSite: 'Lax' as const,
      }))
    )
  }

  const page = await context.newPage()
  const response = await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle')
  const body = (await page.locator('body').innerText()).replace(/[,\s]/g, '')
  const status = response?.status()
  await context.close()
  return { body, status }
}

test.describe('시크릿이 어긋나도 가격이 정확하다', () => {
  test('회원은 여전히 회원가를 본다', async ({ browser }) => {
    const { body, status } = await visit(browser, MEMBER_TOKEN)

    expect(status).toBe(200)
    expect(body).toContain(digits(MEMBER_PRICE))
  })

  test('비회원은 비회원가를 본다', async ({ browser }) => {
    const { body, status } = await visit(browser)

    expect(status).toBe(200)
    expect(body).toContain(digits(BASE_PRICE))
    expect(body).not.toContain(digits(MEMBER_PRICE))
  })
})

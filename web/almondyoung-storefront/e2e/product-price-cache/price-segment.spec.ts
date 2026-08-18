import { expect, test, type Browser } from 'playwright/test'
import { execFileSync } from 'child_process'

const HANDLE = process.env.E2E_PRODUCT_HANDLE!
const MEMBER_TOKEN = process.env.E2E_MEMBER_TOKEN!
const CUSTOMER_ID = process.env.E2E_CUSTOMER_ID!
const GROUP_ID = process.env.E2E_GROUP_ID!
const BASE_PRICE = process.env.E2E_BASE_PRICE!
const MEMBER_PRICE = process.env.E2E_MEMBER_PRICE!

const url = `/kr/products/${HANDLE}`

const psql = (sql: string) =>
  execFileSync(
    'docker',
    ['compose', '-f', process.env.E2E_COMPOSE_FILE!, 'exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', 'medusa', '-c', sql],
    { encoding: 'utf8' }
  )

const joinMembership = () =>
  psql(
    `insert into customer_group_customer (id, customer_id, customer_group_id, created_at, updated_at) values ('cgc_e2e_member', '${CUSTOMER_ID}', '${GROUP_ID}', now(), now()) on conflict do nothing`
  )

const leaveMembership = () => psql(`delete from customer_group_customer where id = 'cgc_e2e_member'`)

/** 상품 상세에 실제로 그려진 가격 숫자들. */
const shownPrices = async (browser: Browser, token?: string) => {
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
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle')
  const body = (await page.locator('body').innerText()).replace(/[,\s]/g, '')
  await context.close()
  return body
}

/** 본문에서 콤마·공백을 지우고 비교하므로 기대값도 숫자만 남긴다. */
const digits = (n: string) => String(Number(n))

test.describe('멤버십 가격이 세그먼트를 넘어 새지 않는다', () => {
  test.beforeAll(() => joinMembership())
  test.afterAll(() => joinMembership())

  test('비회원 먼저 본 뒤 회원이 봐도 회원가가 나온다', async ({ browser }) => {
    const anon = await shownPrices(browser)
    expect(anon).toContain(digits(BASE_PRICE))
    expect(anon).not.toContain(digits(MEMBER_PRICE))

    const member = await shownPrices(browser, MEMBER_TOKEN)
    expect(member).toContain(digits(MEMBER_PRICE))
  })

  test('회원 먼저 본 뒤 비회원이 봐도 비회원가가 나온다', async ({ browser }) => {
    const member = await shownPrices(browser, MEMBER_TOKEN)
    expect(member).toContain(digits(MEMBER_PRICE))

    const anon = await shownPrices(browser)
    expect(anon).toContain(digits(BASE_PRICE))
    expect(anon).not.toContain(digits(MEMBER_PRICE))
  })

  test('멤버십을 해지하면 다음 조회부터 비회원가가 나온다', async ({ browser }) => {
    const before = await shownPrices(browser, MEMBER_TOKEN)
    expect(before).toContain(digits(MEMBER_PRICE))

    leaveMembership()

    const after = await shownPrices(browser, MEMBER_TOKEN)
    expect(after).toContain(digits(BASE_PRICE))
    expect(after).not.toContain(digits(MEMBER_PRICE))
  })

  test('멤버십에 가입하면 다음 조회부터 회원가가 나온다', async ({ browser }) => {
    leaveMembership()
    const before = await shownPrices(browser, MEMBER_TOKEN)
    expect(before).toContain(digits(BASE_PRICE))

    joinMembership()

    const after = await shownPrices(browser, MEMBER_TOKEN)
    expect(after).toContain(digits(MEMBER_PRICE))
  })
})

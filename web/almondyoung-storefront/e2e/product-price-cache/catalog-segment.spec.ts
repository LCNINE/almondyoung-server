import { expect, test, type APIRequestContext } from 'playwright/test'

/**
 * 세그먼트 계약을 Medusa 에 직접 물어본다.
 *
 * 브라우저 스펙(price-segment.spec.ts)은 "가격이 새지 않는다" 는 결과를 보고, 이 스펙은 그
 * 결과를 떠받치는 계약 자체를 본다 — 적용한 세그먼트를 에코하는지, 이상 요청을 막는지,
 * 비회원에게 멤버십가가 안 나가는지. 스토어프론트를 거치지 않으므로 캐시가 끼어들지 않는다.
 */

const MEDUSA = process.env.E2E_MEDUSA_URL ?? 'http://localhost:9000'
const KEY = process.env.E2E_PUBLISHABLE_KEY!
const SECRET = process.env.CATALOG_SEGMENT_SECRET!
const BASE_PRICE = Number(process.env.E2E_BASE_PRICE!)
const MEMBER_PRICE = Number(process.env.E2E_MEMBER_PRICE!)
const HANDLE = process.env.E2E_PRODUCT_HANDLE!

const segmentHeaders = (segment: string, key: string = SECRET) => ({
  'x-catalog-segment': segment,
  'x-catalog-segment-key': key,
})

let regionId: string

test.beforeAll(async ({ playwright }) => {
  const api = await playwright.request.newContext({ baseURL: MEDUSA })
  const res = await api.get('/store/regions', { headers: { 'x-publishable-api-key': KEY } })
  const { regions } = await res.json()
  regionId = regions[0].id
  await api.dispose()
})

const fetchCatalog = async (
  api: APIRequestContext,
  path: string,
  headers: Record<string, string>
) => {
  // products-sorted 는 handle 필터를 안 받는다. 넉넉히 받아와 handle 로 골라낸다.
  const query =
    path === '/store/products-sorted'
      ? `?limit=50&currency_code=krw&region_id=${regionId}`
      : `?limit=1&region_id=${regionId}&handle=${HANDLE}&fields=*variants.calculated_price`

  // 절대 URL 로 부른다. 상대 경로는 playwright baseURL(스토어프론트)로 붙어 HTML 이 온다.
  const res = await api.get(`${MEDUSA}${path}${query}`, {
    headers: { 'x-publishable-api-key': KEY, ...headers },
  })

  return { status: res.status(), body: await res.json() }
}

/** 대상 상품 첫 variant 의 계산가. 상품을 못 찾으면 undefined 라 단언이 실패한다. */
const priceOf = (body: any): number | undefined =>
  body.products?.find((p: { handle?: string }) => p.handle === HANDLE)?.variants?.[0]
    ?.calculated_price?.calculated_amount

for (const path of ['/store/products', '/store/products-sorted']) {
  test.describe(`${path} 세그먼트 계약`, () => {
    test('mem 은 회원가를 주고 적용 사실을 에코한다', async ({ request }) => {
      const { status, body } = await fetchCatalog(request, path, segmentHeaders('mem'))

      expect(status).toBe(200)
      expect(body.catalog_segment).toBe('mem')
      expect(priceOf(body)).toBe(MEMBER_PRICE)
    })

    test('reg 은 비회원가를 주고 적용 사실을 에코한다', async ({ request }) => {
      const { status, body } = await fetchCatalog(request, path, segmentHeaders('reg'))

      expect(status).toBe(200)
      expect(body.catalog_segment).toBe('reg')
      expect(priceOf(body)).toBe(BASE_PRICE)
    })

    test('비회원에게 멤버십가가 새지 않는다', async ({ request }) => {
      // products-sorted 는 pricing context 에 region 이 빠져 익명·비회원 전원에게
      // 멤버십가가 나가던 적이 있다. 그 회귀를 여기서 잡는다.
      const anon = await fetchCatalog(request, path, {})

      expect(priceOf(anon.body)).toBe(BASE_PRICE)
      expect(priceOf(anon.body)).not.toBe(MEMBER_PRICE)
    })

    test('세그먼트를 안 보내면 에코도 없다', async ({ request }) => {
      // 에코는 적용의 증명이다. 적용한 게 없으면 실리지 않아야, 스토어프론트가
      // "주장했는데 에코가 없다" 를 실패로 판정할 수 있다.
      const { body } = await fetchCatalog(request, path, {})

      expect(body.catalog_segment).toBeUndefined()
    })

    test('시크릿이 틀리면 400 으로 막는다', async ({ request }) => {
      const { status } = await fetchCatalog(request, path, segmentHeaders('mem', 'forged'))

      expect(status).toBe(400)
    })

    test('토큰과 세그먼트를 같이 보내면 400 으로 막는다', async ({ request }) => {
      const { status } = await fetchCatalog(request, path, {
        ...segmentHeaders('mem'),
        authorization: 'Bearer whatever',
      })

      expect(status).toBe(400)
    })

    test('키 없이 세그먼트만 주장하면 무시하고 비회원가를 준다', async ({ request }) => {
      const { status, body } = await fetchCatalog(request, path, { 'x-catalog-segment': 'mem' })

      expect(status).toBe(200)
      expect(body.catalog_segment).toBeUndefined()
      expect(priceOf(body)).toBe(BASE_PRICE)
    })
  })
}

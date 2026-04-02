핵심 아이디어
Product에 직접 컬럼을 추가하는 게 아니라, 별도 product-sorting 모듈을 만들어서 정렬용 인덱스 테이블을 관리하고, Product와 link로 연결하는 방식이야. 가격이나 주문수가 변경될 때마다 subscriber/workflow로 동기화해주는 구조.
전체 구조
src/modules/product-sorting/
├── models/
│ └── product-sort-index.ts ← 데이터 모델 (정렬용 테이블)
├── service.ts ← MedusaService + 커스텀 메서드
└── index.ts ← 모듈 정의

src/links/
└── product-sort-index.ts ← Product ↔ ProductSortIndex 링크

src/subscribers/
├── product-price-updated.ts ← 가격 변경 시 min_price 동기화
└── order-placed.ts ← 주문 발생 시 sales_count 동기화

src/workflows/
└── sync-sort-index.ts ← 인덱스 동기화 워크플로우

src/api/store/products-sorted/
└── route.ts ← 정렬된 상품 조회 커스텀 API

1. 데이터 모델
   ts// src/modules/product-sorting/models/product-sort-index.ts
   import { model } from "@medusajs/framework/utils"

const ProductSortIndex = model.define("product_sort_index", {
id: model.id().primaryKey(),
product_id: model.text(), // Product ID 참조
min_price: model.bigNumber() // 최저 variant 가격 (amount 기준)
.default(0),
max_price: model.bigNumber() // 최고 variant 가격
.default(0),
sales_count: model.number() // 총 판매 수량 (인기순)
.default(0),
view_count: model.number() // 조회수 (선택)
.default(0),
currency_code: model.text() // 어떤 통화 기준인지
.default("krw"),
})
.indexes([
{
on: ["min_price"], // 가격순 정렬 인덱스
name: "idx_sort_min_price",
},
{
on: ["sales_count"], // 인기순 정렬 인덱스
name: "idx_sort_sales_count",
},
{
on: ["product_id", "currency_code"], // 유니크 제약
name: "idx_sort_product_currency",
unique: true,
},
])

export default ProductSortIndex

2. 서비스
   ts// src/modules/product-sorting/service.ts
   import { MedusaService } from "@medusajs/framework/utils"
   import ProductSortIndex from "./models/product-sort-index"

class ProductSortingModuleService extends MedusaService({
ProductSortIndex,
}) {
// 필요하면 커스텀 메서드 추가
async upsertSortIndex(data: {
product_id: string
currency_code: string
min_price?: number
max_price?: number
sales_count?: number
}) {
// 이미 존재하면 업데이트, 없으면 생성
const existing = await this.listProductSortIndexes({
product_id: data.product_id,
currency_code: data.currency_code,
})

    if (existing.length > 0) {
      return await this.updateProductSortIndexes({
        id: existing[0].id,
        ...data,
      })
    }

    return await this.createProductSortIndexes(data)

}
}

export default ProductSortingModuleService

3. 모듈 정의 + 등록
   ts// src/modules/product-sorting/index.ts
   import ProductSortingModuleService from "./service"
   import { Module } from "@medusajs/framework/utils"

export const PRODUCT_SORTING_MODULE = "productSorting"

export default Module(PRODUCT_SORTING_MODULE, {
service: ProductSortingModuleService,
})
ts// medusa-config.ts 에 등록
modules: [
{
resolve: "./src/modules/product-sorting",
},
]

4. Product와 링크 정의
   ts// src/links/product-sort-index.ts
   import ProductSortingModule from "../modules/product-sorting"
   import ProductModule from "@medusajs/medusa/product"
   import { defineLink } from "@medusajs/framework/utils"

export default defineLink(
ProductModule.linkable.product,
ProductSortingModule.linkable.productSortIndex
)

5. Subscriber로 동기화
   ts// src/subscribers/product-price-updated.ts
   import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
   import { syncPriceSortIndexWorkflow } from "../workflows/sync-sort-index"

export default async function handlePriceUpdate({
event: { data },
container,
}: SubscriberArgs<{ id: string }>) {
await syncPriceSortIndexWorkflow(container).run({
input: { product_id: data.id },
})
}

export const config: SubscriberConfig = {
event: [
"product.updated",
"product.created",
// variant/price 관련 이벤트도 필요하면 추가
],
}
ts// src/subscribers/order-placed.ts
import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { PRODUCT_SORTING_MODULE } from "../modules/product-sorting"

export default async function handleOrderPlaced({
event: { data },
container,
}: SubscriberArgs<{ id: string }>) {
const query = container.resolve("query")
const sortingService = container.resolve(PRODUCT_SORTING_MODULE)

// 주문에서 상품 ID들 가져오기
const { data: [order] } = await query.graph({
entity: "order",
fields: ["items.*"],
filters: { id: data.id },
})

for (const item of order.items) {
// sales_count 증가
await sortingService.upsertSortIndex({
product_id: item.product_id,
currency_code: "krw",
sales_count: /_ 기존 count + item.quantity _/,
})
}
}

export const config: SubscriberConfig = {
event: "order.placed",
}

6. 커스텀 API 라우트
   ts// src/api/store/products-sorted/route.ts
   import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
   import { PRODUCT_SORTING_MODULE } from "../../../modules/product-sorting"

export async function GET(
req: MedusaRequest,
res: MedusaResponse
) {
const sortingService = req.scope.resolve(PRODUCT_SORTING_MODULE)
const query = req.scope.resolve("query")

const sortBy = (req.query.sort_by as string) || "min_price"
const order = (req.query.order as string) || "asc"
const limit = parseInt(req.query.limit as string) || 20
const offset = parseInt(req.query.offset as string) || 0
const currencyCode = (req.query.currency_code as string) || "krw"

// 정렬 인덱스에서 product_id 목록 조회
const sortIndexes = await sortingService.listProductSortIndexes(
{ currency_code: currencyCode },
{
order: { [sortBy]: order === "desc" ? "DESC" : "ASC" },
take: limit,
skip: offset,
}
)

const productIds = sortIndexes.map((s) => s.product_id)

if (productIds.length === 0) {
return res.json({ products: [], count: 0 })
}

// Query로 실제 Product 데이터 조회
const { data: products } = await query.graph({
entity: "product",
fields: [
"*",
"variants.*",
"variants.calculated_price.*",
"images.*",
],
filters: { id: productIds },
})

// 정렬 순서 유지
const sorted = productIds
.map((id) => products.find((p) => p.id === id))
.filter(Boolean)

res.json({ products: sorted, count: sorted.length })
}

7. 마이그레이션 실행
   bashnpx medusa db:generate productSorting
   npx medusa db:migrate

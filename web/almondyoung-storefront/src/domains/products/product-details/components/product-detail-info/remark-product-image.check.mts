/**
 * 실행: node src/domains/products/product-details/components/product-detail-info/remark-product-image.check.mts
 * ponytail: 테스트 러너 없는 앱이라 assert 기반 self-check 하나로 대체
 */
import assert from "node:assert/strict"
import remarkDirective from "remark-directive"
import remarkParse from "remark-parse"
import remarkStringify from "remark-stringify"
import { unified } from "unified"
import { remarkProductImageDirective } from "./remark-product-image.ts"

const run = (md: string) =>
  unified()
    .use(remarkParse)
    .use(remarkDirective)
    .use(remarkProductImageDirective((id) => `https://files.test/${id}`))
    .use(remarkStringify)
    .process(md)
    .then(String)

const ok = await run(
  '::product-image{fileId="019f890e-dec0-7060-a32e-024c3e47c6be" alt="상세컷"}'
)
assert.match(
  ok,
  /!\[상세컷\]\(https:\/\/files\.test\/019f890e-dec0-7060-a32e-024c3e47c6be\)/
)

const broken = await run('::product-image{alt="fileId 없음"}')
assert.doesNotMatch(broken, /product-image/)

const plain = await run("일반 **마크다운** 문단")
assert.match(plain, /일반 \*\*마크다운\*\* 문단/)

console.log("ok")

// 검색 0건 키워드 시중 판매 확인 — 2단계.
// ego-browser 로 네이버쇼핑을 돌며 상위 상품/카테고리를 모은다.
//   ego-browser nodejs < naver.js
// out/naver.json 에 증분 저장하므로 중단돼도 다시 실행하면 이어서 진행한다.
import fs from 'node:fs'
import path from 'node:path'

const DIR = '/Users/jeongjungsig/github/almondyoung-server/scripts/ops/search-zero-hit'
const OUT = path.join(DIR, 'out/naver.json')
const LIMIT = 120 // 한 번에 처리할 개수 — 길게 돌리면 페이지 로딩이 멈추는 일이 있다

await useOrCreateTaskSpace('검색0건 시중판매 확인')

const queue = JSON.parse(fs.readFileSync(path.join(DIR, 'out/queue.json'), 'utf8'))
let done = {}
try { done = JSON.parse(fs.readFileSync(OUT, 'utf8')) } catch (e) {}

// 네이버쇼핑은 상품 목록을 __NEXT_DATA__ 에 실어 보낸다. depth 20 — 얕게 잡으면 일부 레이아웃을 놓친다.
const EXTRACT = String.raw`(() => {
  const el = document.getElementById('__NEXT_DATA__')
  if (!el) return { err: document.title.slice(0,40) }
  const d = JSON.parse(el.textContent)
  const out = [], seen = new Set()
  const walk = (o, depth) => {
    if (!o || typeof o !== 'object' || depth > 20) return
    if (Array.isArray(o)) { o.forEach(x => walk(x, depth+1)); return }
    const n = o.productTitle || o.productName
    if (n && !seen.has(n)) {
      seen.add(n)
      out.push({ n: n.slice(0,70), c: [o.category1Name,o.category2Name,o.category3Name].filter(Boolean).join('>') })
    }
    Object.values(o).forEach(x => walk(x, depth+1))
  }
  walk(d, 0)
  return { items: out.slice(0, 5) }
})()`

const cap = (p, sec) => Promise.race([p, new Promise((_, rj) => setTimeout(() => rj(new Error('timeout')), sec * 1000))])

let n = 0
for (const kw of queue) {
  if (done[kw] || n >= LIMIT) continue
  let r = null
  try {
    await cap(gotoAndWait('https://search.shopping.naver.com/search/all?query=' + encodeURIComponent(kw), { timeout: 20 }), 25)
    await wait(1.6)
    r = await cap(js(EXTRACT), 15)
  } catch (e) {
    r = { err: String(e.message || e).slice(0, 40) }
  }
  done[kw] = r || { err: 'null' }
  n++
  if (n % 10 === 0) {
    fs.writeFileSync(OUT, JSON.stringify(done))
    cliLog(`  ${Object.keys(done).length}/${queue.length}`)
  }
}
fs.writeFileSync(OUT, JSON.stringify(done))
cliLog(`done ${Object.keys(done).length}/${queue.length}`)

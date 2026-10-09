# 타임세일을 Medusa 모듈로 옮기고 2026-10-09 사고를 복구한다

- 날짜: 2026-10-09
- 상태: 설계 승인, 구현 계획 전
- 관련: #769(타임세일 최초 구현), 커밋 `ea869b8e3`(스토어프론트 제목 비노출)

## 1. 배경 — 오늘 무슨 일이 있었나

운영자가 10-07~10-08 에 타임세일 6개(옵션 약 2,300개)를 등록하고 10-09 00:00 에 열었다.
열자마자 내부용 이름이 스토어프론트에 노출됐고, 이름을 고치려다 세일이 둘로 갈라지고
가격이 사라진 것처럼 보여서 00:23~00:48 에 전부 삭제했다.

라이브 Medusa DB 실측(읽기 전용, 10-09)으로 확인한 원인은 셋이다.

1. **수정 저장이 브라우저에서 API 를 순서대로 여러 번 부른다.** 일반용 리스트 제목·기간 변경 →
   일반용 가격 교체 → 멤버십용 제목·기간 변경 → 멤버십용 가격 교체. 사이를 묶는 트랜잭션이 없어
   중간에서 멈추면 일반용만 바뀐다. 짝은 «(멤버십) 접미사를 뗀 제목 + 시작 시각» 으로만 맞추므로
   그 순간 세일이 둘로 보인다. 실측: 10-07 20:45 에 1초 차로 만든 짝이
   「창고 대방출 타임 세일」(일반용, 종료 10-09 00:30)과
   「3개월 미판매 재고 타임 세일 (멤버십)」(종료 10-16 23:59)로 갈려 있다.
2. **가격 교체가 옛 가격을 지우지 못하고 덧붙였다.** 지울 id 를 브라우저가
   `GET /admin/price-lists/:id?fields=…*prices.price_set.variant` 응답에서 얻는데 큰 리스트에서
   빈 채로 왔다(원인 미확정 — 같은 날 3·148품목 리스트에서는 정상 삭제됐다). 741품목 리스트에
   가격 5,187행(7벌)이 쌓였다. **매 묶음의 금액이 직전과 100% 같아서** 고객 가격 피해는 없다.
3. **같은 제목·같은 시작 시각의 리스트가 어드민에서 하나로 합쳐진다.** 「아몬드영 타임 세일」
   (10-09 00:00 시작)이 일반용 3·멤버십용 4개였고, 어드민은 첫 짝의 가격만 보여줬다.
   「세팅해 둔 가격이 사라졌다」의 정체다.

일괄수정(core → channel-adapter → Medusa variant 재생성) 가설은 기각됐다 — 세일가가 붙은
variant 중 삭제된 것 0건.

`/time-sale`(«더보기») 가 세일 상품 전체를 못 보여주는 것은 별개 결함이다. 홈과 같은
컴포넌트를 써서 세일마다 10개, 합계 100개 상품까지만 나온다.

## 2. 목표와 비목표

**목표**
- 세일 하나의 저장(생성·수정·삭제·공개 전환)이 Medusa 서버에서 한 워크플로로 끝나고, 실패하면
  되돌아간다.
- 일반용·멤버십용 짝을 제목이 아닌 **데이터 관계**로 묶는다. 제목 기반 짝 맞추기 코드를 남기지
  않는다.
- 세일 이름이 고객 쪽 응답에 실리지 않는다.
- 스토어프론트는 세일을 하나로 합쳐 보여주고, `/time-sale` 에서 세일 상품 전체를 본다.
- 10-09 사고로 삭제된 6개 세일을 원래 가격 그대로 **비공개(draft)** 로 복구한다. 유실되는
  가격 정보가 없다.

**비목표**
- 세일가 ≥ 정가 같은 입력 검증의 서버 이전. 지금처럼 어드민 화면에 둔다.
- 가격 조회가 비어 온 원인(§1-2)의 확정. 새 경로는 그 조회를 쓰지 않는다. 로그 조사는 별도로 한다.
- 원래 세일 제목의 복원. Medusa 는 제목 이력을 남기지 않아 수정 전 제목은 어디에도 없다.

## 3. 데이터 모델

새 Medusa 모듈 `apps/medusa/src/modules/time-sale` (모듈명 `timeSale`).

```ts
TimeSale = model.define({ name: 'TimeSale', tableName: 'time_sale' }, {
  id: model.id({ prefix: 'tsale' }).primaryKey(),
  title: model.text(),            // 어드민 전용. 고객 응답에 싣지 않는다.
  starts_at: model.dateTime(),
  ends_at: model.dateTime(),
  status: model.enum(['draft', 'active']).default('draft'),
})
```

링크 `apps/medusa/src/links/time-sale-price-list.ts`:
`defineLink(TimeSaleModule.linkable.timeSale, { linkable: PricingModule.linkable.priceList, isList: true })`.
세일 하나에 price list 1~2개(일반용 필수, 멤버십용 선택).

- 일반용/멤버십용 구분은 지금처럼 리스트 규칙으로 한다 — `customer.groups.id` 규칙이 있으면
  멤버십용. 별도 컬럼을 두지 않는다(같은 사실을 두 곳에 적지 않는다).
- **기간·상태의 정본은 `time_sale` 행**이다. 가격 엔진은 price list 를 읽으므로 워크플로가 같은
  값(`starts_at`·`ends_at`·`status`)을 연결된 리스트에 함께 맞춘다. price list 의 `title` 에는
  세일 제목을, `description` 에는 지금처럼 사람이 읽는 설명을 둔다(키로 쓰지 않는다).
- `status: draft` 는 price list `status: 'draft'` 로 내려가 가격 계산에서 빠진다.
- 마이그레이션은 Medusa 컨테이너 CMD 의 `medusa db:migrate --execute-safe-links` 가 부팅 시 적용한다.
  테이블·링크 테이블 신규 추가뿐이라 옛 태스크에 무해하다.

## 4. 쓰기 경로 — 워크플로 3개

`apps/medusa/src/workflows/time-sale/`. core-flows 2.13.4 의 price list 워크플로·스텝을 조합해
보상(compensation)을 상속한다. 각 스텝의 보상이 실제로 있는지는 구현 계획 단계에서
`node_modules/@medusajs/core-flows/dist/price-list/steps/*.js` 로 확인하고, 없는 스텝은 직접 보상을 단다.

입력(세 워크플로 공통 조각):
```ts
{ title, starts_at, ends_at, status,
  general_prices: { variant_id, amount }[],     // 1개 이상
  membership_prices: { variant_id, amount }[] } // 0개 가능
```

- **`createTimeSaleWorkflow`**: 검증 스텝 → `time_sale` 생성 → price list 생성(일반용, 멤버십 가격이
  있으면 멤버십용) → 링크 생성.
- **`updateTimeSaleWorkflow`**: 검증 스텝 → `time_sale` 갱신 → 연결된 리스트의 제목·기간·상태 갱신 →
  가격 교체. 옛 가격 id 는 **서버에서** `getExistingPriceListsPriceIdsStep` 으로 얻어
  `batchPriceListPricesWorkflow` 한 번에 create + delete 한다. (구현: 옛 가격 id 는 `loadLinkedLists` 가
  DB 에서 직접 읽고, **새 가격 만들기 → 옛 가격 지우기** 순서로 두 워크플로를 부른다 — 반대 순서는 진행 중
  세일에 가격 공백을 만든다. 품목→금액이 그대로인 리스트는 가격을 건드리지 않는다.) 멤버십 가격이 새로 생기면 리스트를
  만들어 링크하고, 0개가 되면 리스트를 지우고 링크를 해제한다.
- **`deleteTimeSaleWorkflow`**: 연결된 리스트 삭제 → 링크 해제 → `time_sale` 삭제.

**검증 스텝(서버)**: `ends_at > starts_at`, 금액 > 0 의 유한수, 한 리스트 안 variant 중복 없음,
멤버십 가격의 variant ⊂ 일반 가격의 variant, 그리고 **기간이 겹치는 다른 세일(draft 제외)과
같은 variant 를 공유하지 않음**. 마지막 것은 지금 브라우저가 하는 검사를 서버로 옮기는 것이다 —
두 사람이 동시에 저장하면 브라우저 검사는 뚫린다. draft 세일은 가격에 영향이 없으므로 겹침
판정에서 빼되, draft → active 전환 때 같은 검사를 한다.

## 5. 라우트

| 메서드 | 경로 | 용도 |
|---|---|---|
| GET | `/admin/time-sales` | 목록. `time_sale` + 링크된 리스트의 variant 별 가격 |
| POST | `/admin/time-sales` | 생성 |
| GET | `/admin/time-sales/:id` | 상세(편집 화면) |
| POST | `/admin/time-sales/:id` | 수정. 공개/비공개 전환도 이 경로(`status`) |
| DELETE | `/admin/time-sales/:id` | 삭제 |
| GET | `/store/time-sale` | 진행 중 세일 합본(§7) |

어드민 쓰기(POST·DELETE) 성공 뒤에는 영향받은 상품과 `time-sale` 태그의 스토어프론트 캐시를 비운다 —
경계 크론은 «시각이 경계를 지날 때» 만 비우므로, 진행 기간 안에서 공개·수정·삭제하면 최대 1시간 옛 화면이 남는다.
무효화 호출은 지금 `jobs/time-sale-cache-boundary.ts` 안의 것을 `utils/` 로 빼서 둘이 같이 쓴다.

본문은 zod + `validateAndTransformBody` 미들웨어로 검증한다. 가격 → variant 매핑은 지금
`utils/time-sale.ts` 가 하는 `product_variant_price_set` 조인을 그대로 쓴다(Admin API 로는 갈 수 없다).

## 6. 어드민 (`apps/admin-web`)

- `lib/services/time-sale.ts`: 생성·수정·삭제 훅이 새 라우트를 **한 번** 부른다. 브라우저 다단계
  호출, 제목 짝 맞추기, `MEMBERSHIP_LIST_TITLE_SUFFIX` 의존, 브라우저 겹침 차단을 지운다.
  `lib/api/domains/medusa/price-lists.ts` 의 `get`(문제의 `*prices.price_set.variant` 조회)·
  `batchPrices`·`create`·`update`·`remove` 중 타임세일만 쓰던 것은 함께 지운다.
- 목록: 상태에 **「비공개」** 추가, 행마다 공개/비공개 전환 버튼(공개 시 기간을 보여주는 확인창).
  행 key 와 편집 경로는 **세일 id**.
- 등록·수정 폼: 그대로. 「이미 다른 세일에 걸린 품목」 표시는 선택 편의로 남기고, 최종 차단은 서버.
- 판정 로직은 순수 함수로 두고 그걸 테스트한다(admin-web 은 컴포넌트 테스트를 돌리지 않는다).

## 7. 스토어프론트 (`web/almondyoung-storefront`)

**`GET /store/time-sale` 응답**(Medusa):
```ts
{
  timeSales: { id: string, startsAt: string, endsAt: string,
               priceListIds: string[], productIds: string[] }[],   // 종료 빠른 순. title 은 없다
  products: { id: string, categoryIds: string[] }[]                 // 진행 중 세일 상품 전체, 중복 없이
                                                                     // 판매순 → 리뷰순 → 최신순
}
```
`timeSales` 는 지금 응답과 같은 모양에서 **`title` 을 빼고 `id` 를 더한** 것이다. 카트 안내·카드 뱃지·
상세의 「이 가격이 어느 세일에서 나왔나」(`priceListIds`)가 이미 세일 단위로 동작하므로 그대로 둔다.
진행 중 판정은 `time_sale.status = 'active'` 이고 현재 시각이 기간 안. 상품별 종료 시각은 그 상품이 든
세일 중 가장 이른 `endsAt` 으로 스토어프론트가 파생한다.

- **홈**: 「타임세일」 섹션 하나. 제목 옆 카운트다운 = 응답 `endsAt`(가장 먼저 끝나는 세일 —
  실제보다 길게 보이면 CS 가 되므로 짧은 쪽). 카드 카운트다운 = 그 상품의 `endsAt`. 상위 10개.
- **`/time-sale`**: 세일 상품 전체. 카테고리 탭은 `categoryIds` 로 만들고, 탭으로 거른 id 를
  **40개씩 페이지로** `/store/products?id=…` 에서 받는다 — 멤버십가 은닉 미들웨어·가격 계산이 다른
  목록과 똑같이 걸린다. 카드마다 남은 시간. 페이지 안의 「더보기」(자기 자신 링크)는 없앤다.
- 세일이 없을 때 404 로 보내지 않는 지금 동작은 유지한다.

## 8. 복구

**정본 입력**: 10-09 11:50 KST 에 뜬 백업 JSON(최근 14일 sale price list 19개, 가격 16,407행,
리스트 규칙 19행, 가격별 variant·product 조인 포함). 라이브 DB 를 다시 읽지 않으므로 이후 변동과
무관하게 결과가 같다. 백업 파일은 저장소에 커밋하지 않는다(라이브 데이터). 보관 위치는 운영자가 정한다.

**재구성 규칙**
- 리스트마다 **마지막 저장 묶음**(같은 `created_at` 분)의 가격을 쓴다. 모든 묶음의 금액이 같음을
  실측했으므로 모호함이 없다 — 스크립트는 그래도 묶음 간 금액이 다르면 멈춘다.
- 짝은 **생성 시각**으로 맞춘다(제목은 수정으로 바뀌었다). 10-07 20:45 일반용 리스트에는
  멤버십 리스트가 둘(20:45 원본, 21:18 수정 중 생성) 붙어 있고 금액이 같다 — 같지 않으면 멈춘다.

**대상**

| 복구 이름(임시) | 일반용 리스트 | 멤버십용 리스트 | 품목 |
|---|---|---|---|
| 복구 ① | `plist_01M4B2Y5X9NR2VY2CSSDEDQ88J` | `plist_01M4B2Y76621BA5XXCNY3JTQ1Z` | 741 |
| 복구 ② | `plist_01M4CKCFD3GQR19EF4QKS8MH0D` | `plist_01M4CKCGD13VQBGPF7WRMXM5F8` | 642 |
| 복구 ③ | `plist_01M4B9MY88N7TJD8HSN1QCBNEN` | `plist_01M4B9MYZWX2QH4BQ7K8A7K78P` | 400 |
| 복구 ④ | `plist_01M4CH5TRSDSSACGT9ZKBQDG9P` | `plist_01M4CH5VG16XN7PBJANGG4Y4HC` | 322 |
| 복구 ⑤ | `plist_01M4DSVM1PEP2TBSD1WZ4RHGYY` | `plist_01M4DSVMJ2HJDY57Y0BCW4WA88` | 87 |
| 인기 상품 | `plist_01M4DPPRWYA5FZ7RNPD2QHAD3K` | `plist_01M4DPPSEFVFZYFZ4BRA32EYKS` | 148 |

제외: 「테스트」(10-02), 10-07 21:04 의 642품목 짝(10-08 10:52 의 ②와 금액까지 동일 — 운영자가
다시 만들고 지운 것).

**노몬드**(진행 중, 3품목, 10-16 23:59 종료): 새 경로로 같은 기간·같은 가격의 active 세일을 만든
뒤 옛 리스트 두 개를 지운다. 겹치는 몇 초 동안 두 리스트의 금액이 같아 가격이 흔들리지 않는다.
옛 리스트는 `time_sale` 에 연결돼 있지 않아 서버 겹침 검사에 걸리지 않는다. 끝난 인기 상품의 옛
리스트 두 개도 함께 지운다. 이로써 `time_sale` 에 연결되지 않은 기간형 sale 리스트가 0이 된다.

**실행 방식**: 독립 node 스크립트(`scripts/ops/time-sale-recovery-2026-10-09/`)가 백업을 읽어
**새 `POST /admin/time-sales` 를 호출**한다 — 복구가 정상 저장과 같은 워크플로·같은 검증을 탄다.
DB 에 직접 쓰지 않는다. 복구 세일은 전부 `status: draft`, 기간은 원래 값(10-09 00:00 ~ 10-16 23:59 KST)을
넣어 두고 운영자가 공개 전에 고친다(인기 상품과 ①의 일반용은 운영자가 종료 시각을 당겨 끝냈으므로
원래 종료 시각이 남아 있지 않다 — 10-16 23:59 로 통일한다). 인증은 Medusa secret API key(`sk_…`)를 환경변수 `MEDUSA_ADMIN_API_KEY` 로 받아 Basic 인증(키를 사용자명, 비밀번호 비움)으로 보낸다.
- 기본은 `--dry-run`: 세일별 품목 수·가격 합계·멤버십 가격 수를 출력해 백업과 대조한다.
- `--apply` 일 때만 호출한다. 이미 같은 이름의 복구 세일이 있으면 건너뛴다(재실행 안전).

## 9. 배포와 혼합 창

`sst deploy --stage live` 한 번이 Medusa(ECS)·AdminWeb·Storefront(Lambda)를 함께 롤리며
**순서를 지정할 수 없다**. Lambda 가 먼저 바뀌는 경향이 있다. 그래서 «먼저 배포» 대신 각 조합의
저하를 정한다.

| 조합 | 결과 | 판정 |
|---|---|---|
| 새 어드민 + 옛 Medusa | 새 라우트 404 → 저장이 깔끔히 실패(부분 반영 없음). 목록 응답 형태가 달라 목록이 비거나 깨져 보임 | 운영자 작업 중지로 흡수 |
| 옛 어드민 + 새 Medusa | 옛 어드민이 price list 를 직접 만들면 `time_sale` 없는 고아 리스트가 생긴다 | 운영자 작업 중지로 흡수 |
| 새 스토어프론트 + 옛 Medusa | `products` 가 없음 → `timeSales[].productIds` 를 이어 붙여 순서를 만들고 탭 없이 보여준다. 예외로 번지지 않게 한다 | 스토어프론트 코드가 흡수 |
| 옛 스토어프론트 + 새 Medusa | `timeSales` 모양이 같고 `title` 만 없다 → 옛 홈은 제목 자리에 기본 문구 「타임세일」을 쓴다(`title ?? 기본`) | Medusa 응답이 흡수 |

**운영 절차**
1. 담당자에게 배포 완료 알림까지 타임세일 등록·수정 중지를 요청한다.
2. `sst deploy --stage live` (사람이 실행).
3. 복구 스크립트 `--dry-run` → 대조 → `--apply`.
4. 노몬드 이전·옛 리스트 정리(같은 스크립트).
5. 어드민에서 복구 세일 6개가 비공개로 보이는지, 스토어프론트 노몬드 섹션이 정상인지 확인.
6. 담당자에게 공개를 넘긴다.

## 10. 테스트

- Medusa 단위: 검증 스텝(겹침·중복·부분집합·기간), 복구 재구성 규칙(묶음 선택, 묶음 간 금액
  불일치 시 중단, 생성 시각 짝 맞추기). 스크립트의 재구성 로직은 순수 함수로 분리한다.
- Medusa 통합(`scripts/local/run-medusa-integration.sh`): 생성 → 수정(가격 교체 후 옛 가격 0행,
  리스트당 가격 행 수 = 품목 수) → 멤버십 추가/제거 → 공개 전환 → 삭제. **중간 스텝 실패 시 보상으로
  `time_sale`·리스트·가격이 원상태**인지 확인하는 케이스 포함. 741품목 규모 한 케이스.
- 스토어프론트: 합본 파생(가장 이른 종료, 상품별 종료, 두 세일 겹침), `products` 없는 옛 응답 폴백.
- 어드민: 순수 함수(상태 판정에 draft 추가 등).
- 로컬 E2E 에서 어드민으로 생성·수정·공개 후 스토어프론트 확인(브라우저 로그인은 사용자).

# F1 (후보) — 배송비 쿠폰 생성 복구 + 페이로드 축 전수

**출처**: 쿠폰 개통 리허설 1차(2026-08-30)에서 나온 유일한 ❌.
**SoT**: #488 「리허설 1차 실행 기록」 절.
**번호**: 로드맵의 `P1~P9` 와 별개다. `P8`·`P9` 는 웨이브 D 에 이미 있으므로
**리허설이 찾아낸 결함 수정**은 `F` 계열로 센다. 순서상 `P4` **앞**에 온다.

**상태**: ✅ **실행 완료 (2026-08-30)** — 브랜치 `fix/coupon-shipping-allocation`.

| Task | 결과 |
|---|---|
| 1. 빌더 한 줄 + 스펙 | ✅ TDD — 유닛 3건 추가, RED(1 실패) 확인 후 GREEN(18/18) |
| 2. 축 전수 가드 | ✅ `build-create-promotion-payload.integration.spec.ts` — 24발(3×2×4), env 없으면 skip |
| 3. 배송비가 실제로 깎이는지 | ✅ 수정된 빌더가 만든 쿠폰으로 `shipping_total` 2,500 → 0 |

**가드가 이 버그를 잡는지 증명했다** — 수정을 되돌리자 `shipping_methods` 8건이 정확히
실패하고 나머지 16건은 통과했다(red-green 검증). 게이트: `admin-web tsc` 0 · 루트
`type-check` 0 · 루트 `jest` 513 suite / 4,495 테스트 전량 통과.
수동 확인 1건도 완료 — 어드민 화면에서 「배송비 할인」 쿠폰이 실제로 생성된다.

## 무엇이 깨져 있나

어드민 쿠폰 생성 폼에서 「쿠폰 적용 대상 → 배송비 할인」을 고르면 **저장이 100% 실패한다.**

```
POST /admin/promotions → 400
application_method.allocation should be either 'across OR each OR once'
when application_method.target_type is either 'shipping_methods OR items'
```

원인은 한 줄이다 — `apps/admin-web/src/features/mall/marketing/coupons/lib/build-create-promotion-payload.ts:113`

```ts
...(form.targetType === 'items' ? { allocation: 'across' as const } : {}),
```

Medusa 는 `shipping_methods` **에도** `allocation` 을 요구하는데 `items` 일 때만 붙인다.
`coupon-create-dialog.tsx:325` 가 `shipping_methods` 를 선택 가능한 옵션으로 노출하므로,
**관리자에게 보이는 기능이 전부 실패하는 상태**다.

## 왜 유닛이 못 잡았나 — 이게 이 플랜의 진짜 주제다

빌더는 순수 `.ts` 이고 테스트도 있다. 그런데 테스트가 검사하는 것은 **「우리 타입에 맞는 객체가
나오는가」**까지다. 엔진 검증기(`.strict()` + refine)가 요구하는 것은 타입에 없다.

리허설의 R7 이 정확히 이 위험을 겨냥해 실물 3발을 쐈지만 **셋 다 `target_type: order`** 라
이 축을 지나가지 않았다. 결함은 R7 이 아니라 「4종을 다 만들어 본다」는 R1a 가 잡았다.

## 할 일

### Task 1 — 수정 (한 줄 + 테스트)

`allocation` 을 `items` 와 `shipping_methods` 양쪽에 붙인다.

```ts
...(form.targetType === 'items' || form.targetType === 'shipping_methods'
  ? { allocation: 'across' as const } : {}),
```

**`across` 가 유일한 선택지다 — 실측으로 확정했다(2026-08-30, 로컬 Medusa 2.13.4).**
세 값을 전부 발사한 결과:

| allocation | 결과 |
|---|---|
| `across` | **200** — `target_type=shipping_methods, allocation=across` 로 저장 |
| `each` | 400 `application_method.max_quantity is required when allocation is 'each OR once'` |
| `once` | 400 (동일) |

즉 «어느 쪽이 의미상 맞는가»를 고민할 필요가 없다. `each`/`once` 는 **폼에 없는 입력**
(`max_quantity`, #488 `N5` 의 미개봉 축)을 추가로 요구하므로 현재 폼으로는 도달 불가다.
주석에 이 근거를 남길 것 — 나중에 `max_quantity` 입력란이 생기면 선택지가 열린다.

빌더 스펙에 `target_type: 'shipping_methods'` 케이스를 추가한다.

### Task 2 — 축 전수 가드 (이 플랜의 핵심)

조합을 늘리는 게 아니라 **폼이 만들어낼 수 있는 값의 축을 전부** 실물로 발사하는 가드를 만든다.

- 축: `targetType` 3값(`order`·`items`·`shipping_methods`) × `discountType` 2값(`fixed`·`percentage`)
  = 최소 6발. 여기에 한도 축(전역·1인당·총할인금액)을 곱하면 더 늘어난다
- 실행 위치: **로컬 Medusa 를 띄운 통합 스펙**. 기존 `describeIfDb` / `REQUIRE_*_DB=1` 컨벤션을
  따라 기본 게이트에서는 자동 skip 되게 한다(가드 없이 두면 CI 가 빨개진다)
- 판정: 각 발사가 HTTP 200 인가 + 저장된 `application_method` 가 보낸 값과 일치하는가

이게 없으면 **다음에 폼에 축을 하나 더 추가할 때 같은 사고가 다시 난다.**
(엔진이 요구하는 필드는 우리 타입에 없으므로 컴파일러도 유닛도 영원히 못 잡는다.)

### Task 3 — 배송비 쿠폰이 실제로 배송비를 깎는지 — ✅ 선검증 완료

Task 1 이 생성만 통과시킨다는 우려가 있었으나, **동작까지 실측 확인했다(2026-08-30).**
`allocation: across` 로 만든 배송비 100% 쿠폰을 카트에 적용:

```
적용 전: item_total=10000  shipping_total=2500  discount_total=0     total=12500
적용 후: item_total=10000  shipping_total=0     discount_total=2500  total=10000
         배송 adjustments: [('R1SHIPACROSS', 2500)]
```

배송비만 정확히 0 이 되고 상품가는 그대로다. **따라서 Task 1 은 순수한 한 줄 수정이고
동작 리스크가 없다.** 이 태스크는 회귀 방지용 스펙 1개로 축소해도 된다.

## 검증

```bash
cd apps/admin-web && npx tsc --noEmit     # 루트 type-check 는 admin-web 을 제외한다
npx jest --maxWorkers=2 build-create-promotion-payload
# 통합 축 전수는 로컬 Medusa 필요 — docs/local-dev.md 「전체 스택 로컬 구동」
```

수동 확인 1건: 어드민에서 「배송비 할인」 쿠폰을 만들어 **목록에 나타나는지** 본다.
리허설에서 이 확인이 결함을 잡았다.

## 범위 밖

- `allocation: 'each'` / `max_quantity` 등 폼에 없는 축(#488 `N5`) — 미개봉 기능이지 부채가 아니다
- A4(정률 최대 할인금액) — 엔진이 개념을 지원하지 않는다. 상품 결정 사안

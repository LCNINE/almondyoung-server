# 발주 종결 파생 — `items → plan → PO` (#724 항목 7)

> 상태의 정본은 **이슈 #724** 다. 사실·근거는 진단 문서
> [`docs/inventory-procurement-audit-2026-08.md`](../../inventory-procurement-audit-2026-08.md) 가 소유한다.
> 이 문서는 **설계**만 소유한다. 실행 계획은 `docs/superpowers/plans/` 로 따로 나간다.
>
> 선행 결정: [ADR-0032](../../adr/0032-procurement-inbound-transfer-boundaries.md) ·
> [항목 9 스펙](2026-08-25-purchase-order-line-lifecycle-design.md)

## 1. 무엇이 문제인가

파생 사슬이 3층인데 **2층이 통째로 비어 있다.** 2026-08-27 실측:

| 층 | 현재 | 근거 |
|---|---|---|
| `inbound_plan_items.status` | ✅ 입고 시점 파생 | `inbound.service.ts:875` — `newReceived >= expectedQty ? 'confirmed' : 'pending'` |
| `inbound_plans.status` | ❌ **쓰기가 0곳** | `inbound.service.ts:700` 의 insert 뿐. drizzle·raw SQL 통틀어 `update` 없음 |
| `purchase_orders.status` | ❌ 수동 전용 | `refreshHeaderStatus`(`purchase-order.manager.ts:382`)에 `received` 분기 자체가 없다 |

> ⚠️ 이슈 #724 본문은 2층의 쓰기가 *"`voided` 하나뿐"* 이라고 적었으나 부정확하다. 그
> `voided` 쓰기(`inbound.service.ts:1147`)는 `inbound_plans` 가 아니라 **`inbound_receipts`** 다.
> 2층은 서술보다 한 칸 더 비어 있다 — 쓰기가 아예 없다.

**결과 1.** `GET /inbound/pending` 은 계획을 `status='pending'` 으로, 아이템을 `status='pending'` 으로
각각 거른다(`inbound.service.ts:327`·`:396`). 계획 헤더가 얼어붙어 있으므로 **전량 입고된 계획이
빈 아이템 목록을 단 유령 행으로 목록에 영구히 남는다.**

**결과 2.** 취소 경로가 없다. `po_status` 에 `cancelled` 가 없어 잘못 만든 발주를 닫을 방법이 없다
(진단 ⑦). 항목 9 스펙이 남긴 인계문도 같은 곳을 가리킨다 — *"전 라인이 `unavailable` 인 발주가
`confirmed` 로 보이는 건 어색하지만 오늘보다 나쁘지 않다. 제대로 된 종결 상태는 항목 7 이 다룬다."*

## 2. 결정

### 2.1 종결 = 자동 파생 + **잎 종결**

발주 수량보다 적게 들어오고 나머지가 끝내 안 오는 경우(8/10)를 무엇이 닫는가에 대한 결정이다.

**"전량 도착했다" 와 "이만 포기한다" 는 서로 다른 사실이고, 다른 사실은 다른 자리에 적는다.**
`expectedQty=10, receivedQty=8` 은 영구히 참으로 남고, 그 위에 "누가·언제·왜 그만 기다리기로
했는지" 가 얹힌다.

사람의 쓰기는 **잎(아이템)에서만** 일어난다. 계획 헤더를 사람이 직접 닫게 하면 *"헤더는
아이템에서 파생된다"* 가 깨져 파생 경로가 둘이 된다 — 이슈가 PO 에 대해 금지한 바로 그 패턴이다.

**기각한 대안**

| 대안 | 기각 사유 |
|---|---|
| 자동 파생만 (수동 종결 없음) | 미달 계획이 **영원히 안 닫힌다.** 진단 ⑦ 이 지적한 유령 행이 형태만 바뀌어 남고, 닫는 조건 3(라이브 완주)은 첫 발주가 미달로 오는 순간 못 넘는다 |
| 라인 `unavailable` 재사용 + `expectedQty` 축소 | 두 가지를 부순다. ① `unavailable` 은 "끝내 **발주 못 함**" 이라 `ordered_qty`/`unit_price`/`expected_arrival` 이 확정된 라인과 공존할 수 없다 ② `expectedQty` 사후 축소는 **미달 사실을 데이터에서 지운다** — 공급처 평가·클레임 근거가 사라지고 `inbound-pipeline.reader.ts` 의 입고예정 시계열이 조용히 바뀐다. 게다가 #742 가 세운 *"종결된 라인은 실행 기록과 어긋나므로 못 고친다"*(`purchase-order.manager.ts:408`)에 구멍을 내야 한다 |

### 2.2 `cancelled` 은 **수동 취소만**

파생은 `created ↔ confirmed` 만 오간다. 종결 2개는 파생의 위가 아니라 **밖**에 있고, 각각 소유자가
진입시킨다 — `received` 는 입고 경로가, `cancelled` 는 사람이.

**전 라인이 `unavailable` 인 발주는 자동으로 `cancelled` 이 되지 않는다.** 오늘처럼 `confirmed` 로
둔다. 그 상태에서 "다시 알아보고 라인을 추가" 하는 길이 살아 있어야 하고, 자동 종결은 그 길을
가드로 막는다. 닫을지는 사람이 정한다.

### 2.3 admin-web 을 같은 범위에 넣는다

수동 경로 2개는 버튼이 없으면 사람이 눈으로 검증할 수 없다. 항목 12(라인 실행 UI) 선례대로
core 와 한 세트로 간다. 배포 순서 제약이 없다는 것은 §7 에서 따로 논증한다.

### 2.4 모듈 경계 = **포트 역전**

이 설계의 유일한 어려운 지점이다. 3층 파생은 **입고 시점에** 일어나야 하는데
`procurement.module.ts` 가 못박아 놨다:

> `inbound/` 로 나가는 호출은 `ensurePlanForPurchaseOrder` · `addInboundPlanItems` **둘뿐**이다.
> 역방향(입고 완료가 발주를 미는) 경로는 만들지 않는다.

**호출 방향과 의존 방향을 분리한다.** 호출은 `inbound → procurement` 로 흐르되, 컴파일·모듈
의존은 `procurement → inbound` 한 방향으로 유지한다. 입고는 자기가 필요한 최소한의 모양만
선언하고, 조달이 그걸 구현한다. 상세는 §5.

**기각한 대안**

| 대안 | 기각 사유 |
|---|---|
| (b) `inbound` 가 `purchase_orders` 를 직접 UPDATE | ① `received` 진입 규칙이 두 모듈로 갈라진다 — 이번 PR 안에서 이미 갈라진다(취소된 발주를 입고가 되살리지 않게 하는 가드를 양쪽이 각자 들어야 한다) ② **잠금 취득 지점이 4번째로 늘어난다.** *PO 행 → 라인 행* 불변식은 테스트 없이 주석만이 방어선이고, 어기면 `40P01` 이 도메인 예외가 아니라 **500** 으로 나간다 ③ ADR-0032 결정 4(경계는 *누가 쓰나*)를 첫 후속 PR 이 뒤집는 그림이 된다 |
| (c) 판정 규칙만 `shared/` 순수 함수로 뽑고 UPDATE 는 각자 | 규칙 중복은 사라지지만 잠금 지점은 여전히 늘어난다. (b)의 ①만 고치고 ②를 남긴다 |

**정직한 비용**: `apps/core/src` 전체에 포트/어댑터 선례가 **0건**이다. 다음 사람이 처음 보는
모양이므로 포트 파일이 "왜 이렇게 했는가" 를 들고 있어야 한다.

### 2.5 수동 종결 라우트 `PUT /:id/status` 를 제거한다

파생이 생기면 이 라우트는 **기록 없는 지름길**이 된다 — 계획 아이템이 아직 `pending` 인
발주를 사유 한 줄 없이 `received` 로 닫을 수 있고, 그건 §2.1 이 잎 종결을 도입하며 거부한
바로 그 모양이다. 제거 비용은 0이다: 2026-08-27 실측 기준 **제품 코드 소비자 0곳**
(admin-web·Tauri 앱·스크립트 어디에도 없고, core 자신과 스펙, 스코프 커버리지 표뿐).

같이 사라지는 것: `UpdatePurchaseOrderStatusDto` · `updatePurchaseOrderStatus`
(controller → service → manager) · `assertReceivedTransition` 과 그 스펙.
`PurchaseOrderStatus` enum 자체는 응답 계약이므로 남는다.

## 3. 상태 모델

```
inbound_plan_items.status
    pending ──입고 누계가 expectedQty 도달──> confirmed        (기존, 유지)
          └──사람이 잔량 포기──────────────> short_closed      (신설)

inbound_plans.status
    pending ──pending 아이템 0개──────────> confirmed          (신설, 2상태)

purchase_orders.status
    created <────파생────> confirmed                            (기존 refreshHeaderStatus)
                               │
                ┌──────────────┴──────────────┐
          계획이 confirmed                사람이 취소
          + requested 라인 0            (입고 0건일 때만)
                ↓                              ↓
            received                       cancelled            ← 둘 다 종결, 되돌림 없음
```

**`applied`/`receiving` 는 되살리지 않는다.** 두 값은 `inbound_status` enum 에 있으나 inventory
전체에서 코드 참조 **0건**이다. 그대로 둔다 — 죽은 값을 옛 뜻과 다르게 재활용하는 것은 값 하나를
새로 추가하는 것보다 나쁘다. 부분 진행은 아이템의 `receivedQty` 가 이미 표현한다. (enum 값 `DROP`
은 이 PR 의 일이 아니다 — #663·#735 선례대로 코드에서 걷어내는 것과 DROP 은 다른 PR.)

**미달 종결도 `received` 다.** 8/10 로 끝난 발주는 "받을 만큼 받고 끝났다" 이지 취소가 아니다.
미달 사실은 아이템에 남고, `short_closed` 가 그 판단의 출처를 들고 있다.

## 4. 파생 규칙

단방향이다. 아래 술어 외에 상태를 바꾸는 경로는 없다.

| 층 | 술어 | 트리거 |
|---|---|---|
| item | `receivedQty >= expectedQty` → `confirmed` | 입고 (기존 `inbound.service.ts:875`) |
| item | 사람의 잔량 포기 → `short_closed` | 신설 라우트 |
| plan | `pending` 아이템이 0개 → `confirmed` | 위 둘 직후, **같은 트랜잭션** |
| PO | 계획이 `confirmed` **AND** `requested` 라인 0개 → `received` | 포트 통보, **같은 트랜잭션** |

`confirmed` 와 `short_closed` 는 아이템의 종결 상태다. 계획 판정은 "종결 아닌 아이템이 있는가" 로
읽는다.

**되돌림이 없다.** `refreshHeaderStatus` 는 현재 `header.status === 'received'` 면 일찍 반환하는데
(`:388`), 여기에 `cancelled` 을 더해 **종결 2개 모두**에서 반환하게 한다. 같은 이유로
`lockPurchaseOrderForLineExecution`(`:338`)의 `received` 거부도 `cancelled` 을 포함해야 한다(기존 가드가 `BadRequestError` = 400 이므로 새 값도 400 으로 맞춘다 — 신설 라우트의 409 와 다른 것은 여기가 "라인 실행 거부" 이지 "종결 재시도" 가 아니기 때문이다) —
빠뜨리면 취소된 발주에 라인 실행이 들어가 계획에 아이템이 붙고 `inbound_pending_qty` 가 부푼다.

**계획이 없는 발주는 `received` 로 가지 않는다.** 계획은 첫 라인 실행에서 생기고
(`ensurePlanForPurchaseOrder`), `unavailable` 라인은 아이템을 만들지 않는다. 따라서 전 라인이
`unavailable` 인 발주에는 계획 자체가 없다 → `confirmed` 로 남는다(§2.2). 이건 버그가 아니라 결정이다.

**한 발주에 계획은 하나뿐이다.** `ensurePlanForPurchaseOrder` 가 `ConflictError` 로 강제한다
(스펙 §3.1). PO↔plan 은 1:1(라인 실행 전엔 1:0)이므로 3층 판정에 "계획들" 을 순회할 필요가 없다.

## 5. 모듈 경계 — 포트

### 계약 (`inventory/shared/` — 중립 지대. 양쪽 다 이미 `SharedModule` 을 import 한다)

```ts
// inventory/shared/ports/purchase-order-closure.port.ts
export const PURCHASE_ORDER_CLOSURE = Symbol('PurchaseOrderClosurePort');

export interface PurchaseOrderClosurePort {
  /** 이 발주에 붙은 입고 계획이 닫혔다. 발주를 종결할지는 조달이 판단한다. */
  onPlanClosed(poId: string, tx: DbTx): Promise<void>;
}
```

입고가 아는 것은 이 여덟 줄이 전부다. `PurchaseOrderManager` 도, `refreshHeaderStatus` 도,
`po_status` 값이 무엇인지도 모른다.

### 사용 (`inbound`)

```ts
@Inject(PURCHASE_ORDER_CLOSURE) private readonly poClosure: PurchaseOrderClosurePort

// 아이템 상태를 갱신한 직후 (receiveFromPlan / 잎 종결 양쪽에서 같은 헬퍼)
if (종결 아닌 아이템 0개) {
  await trx.update(inboundPlans).set({ status: 'confirmed' })…;
  await this.poClosure.onPlanClosed(plan.linkedPurchaseOrderId, trx);   // 사실만 통보
}
```

### 구현 (`procurement`)

`PurchaseOrderClosureAdapter implements PurchaseOrderClosurePort`. §4 의 PO 술어를 소유한다.

### 배선

`inbound.module.ts` 가 어댑터 클래스를 provider 로 등록한다. **모듈 순환은 생기지 않는다** —
`InboundModule` 이 가리키는 것은 `ProcurementModule` 이 아니라 어댑터 클래스 파일 하나이고,
`forwardRef` 도 필요 없다. 파일 수준에서 입고가 조달 쪽을 한 번 가리키는 것이 이 구조의
유일한 흠이며, 계약이 `shared/` 에 있으므로 **의존하는 대상은 여전히 추상**이다.

### 경계를 테스트로 잠근다

`inventory-write-boundary.arch.spec.ts` 는 이미 `stockEvents`/`stockLedgers` 직접 쓰기를 파일
스캔으로 막고 있다. 여기에 **`purchaseOrders` 쓰기는 `procurement/` 밖에서 금지** 를 더한다.
진단 ⑦·잠금 불변식이 반복해서 지적한 *"주석만이 방어선"* 을 여기서 되풀이하지 않는다.

## 6. API 표면

```
POST /inbound/plans/:planId/items/:itemId/close      scope: inventory.manage
  body: { reason: string }
  → item.status='short_closed', closed_at/closed_by/closed_reason 기록
  → 이어서 계획 파생 → 포트 → 발주 파생 (같은 트랜잭션)
  409 if item.status !== 'pending'          — 재실행 금지 = 자연 멱등 (항목 9 선례)
  404 if 아이템/계획 없음
  400 if reason 이 빈 문자열

POST /purchase-orders/:id/cancel                      scope: inventory.manage
  body: { reason: string }
  → status='cancelled', cancelled_at/by/reason 기록
  409 if 이미 종결 (received | cancelled)
  409 if 입고가 한 건이라도 있음 (계획 아이템 중 received_qty > 0)
  404 if 발주 없음
```

### 제거

```
PUT /purchase-orders/:id/status      — §2.5. 소비자 0곳. 파생이 대체한다.
```

**스코프**: 발주 컨트롤러 14개 라우트가 전부 `INVENTORY_SCOPE.MANAGE` 이므로 취소도 `MANAGE`.
잎 종결은 입고 컨트롤러(`OPERATE`) 에 얹히지만 **현장 작업이 아니라 관리 판단**이라 `MANAGE` 로
올린다 — 창고 작업자가 물건이 안 온다고 발주를 닫을 수는 없어야 한다. #551(PR #716, MERGED)이
부여한 스코프 체계를 그대로 따른다.

**멱등성**: 발주 쓰기에 멱등키는 없다(진단 ⑧, #745 로 이관). 두 라우트 모두 상태 전이가 단방향이고
재실행이 409 이므로 **자연 멱등**이다. 키를 도입하지 않는다.

## 7. 스키마와 마이그레이션

| 대상 | 변경 |
|---|---|
| `inbound_status` enum | `+ 'short_closed'` |
| `po_status` enum | `+ 'cancelled'` |
| `inbound_plan_items` | `+ closed_reason text` · `closed_at timestamptz` · `closed_by uuid` — 전부 nullable |
| `purchase_orders` | `+ cancelled_reason text` · `cancelled_at timestamptz` · `cancelled_by uuid` — 전부 nullable |
| 백필 | 이미 전량 입고된 계획 → `confirmed`, 그에 딸린 발주 → `received` |

전부 additive 다. 파괴적 변경이 없으므로 **expand phase** 이고, 순서는 CLAUDE.md 가 경고한 방향의
반대인 **`migrate → deploy`** 다.

> 🔴 **`ALTER TYPE … ADD VALUE` 는 같은 트랜잭션에서 그 값을 쓸 수 없다.** drizzle 은 마이그레이션
> 파일을 트랜잭션으로 감싸므로, 백필이 새 값을 쓰면 그 자리에서 죽는다. 위 백필은 기존 값
> (`confirmed`/`received`)만 쓰므로 한 파일로 간다. **`short_closed` 백필을 여기에 얹지 말 것** —
> 얹으려면 마이그레이션을 둘로 쪼개야 한다.

**라이브 영향**: `purchase_orders` 라이브 행은 2026-08-26 실측 기준 **0행**이다. 백필은 dev·스테이징
정합성을 위한 것이며 라이브에서는 no-op 이다.

## 8. 에러 처리

`@app/shared` 도메인 예외만 쓴다. `GlobalExceptionFilter` 가 상태 코드로 옮긴다.

- `NotFoundError` → 404 · `ConflictError` → 409 · `BadRequestError` → 400
- 컨트롤러는 서비스 호출을 `try/catch` 로 감싸지 않는다. 컨트롤러 경계의 입력 가드만 Nest 예외.
- ⚠️ `inbound.service.ts` 는 아직 `@nestjs/common` 예외를 섞어 쓴다(예: `:759`
  `NotFoundException`). **신설 코드는 `@app/shared` 로 쓰고, 기존 줄은 건드리지 않는다** — 옮기는
  것과 고치는 것을 한 PR 에 섞으면 리뷰가 diff 로 못 본다(항목 5 (e) 와 같은 판단).

## 9. 잠금

🔴 **불변식: PO 행 → 라인 행.** 어느 경로든 이 순서로만 잠근다.

2026-08-27 실측으로 **ABBA 는 발생하지 않는다**:

- 라인 실행 경로는 `PO(FOR UPDATE)` → 라인 → 새 아이템 **insert** 순이다.
- 입고·잎 종결 경로는 기존 아이템 → 계획 → `PO(UPDATE)` 순이다.
- 두 경로가 공유하는 자원은 **PO 행 하나뿐**이다. 라인 실행은 `addInboundPlanItems` 가
  **insert 전용**(`inbound.service.ts:761`)이라 기존 아이템 행을 결코 잠그지 않기 때문에
  대기 사이클이 닫히지 않는다.

> ⚠️ **다음 사람에게**: `addInboundPlanItems` 를 upsert 로 바꾸는 순간 위 논증이 무너지고
> ABBA 가 실재하게 된다(`40P01` → 500). 바꾸려면 입고 경로가 아이템을 건드리기 전에 PO 행을
> 먼저 잠그도록 같이 고칠 것.

발주 취소는 PO 를 잠그고 아이템을 **읽기만** 한다(MVCC 스냅샷 읽기라 행 잠금을 기다리지 않는다).

## 10. 검증

- **유닛**: §4 의 술어를 순수 함수로 뽑아 직접 테스트한다(계획 판정·PO 판정). 종결 상태에서의
  early return, 계획 없는 발주, 취소된 발주에 입고가 들어오는 경우를 포함한다.
- **아키텍처**: `inventory-write-boundary.arch.spec.ts` 에 `purchaseOrders` 쓰기 경계 한 줄.
- **통합** (`npm run test:core:integration:local`): 생성 → 라인 실행 → 입고 → `received` 완주 1건,
  미달 → 잎 종결 → `received` 1건, 취소 409(입고 있음) 1건. **8 suite / 12 test 는 develop 부터
  RED 인 기준선이므로 새 실패로 오인하지 않는다.**
- **게이트 4종**: `npm run type-check` · `cd apps/admin-web && npx tsc --noEmit` ·
  `npx jest --maxWorkers=2` · 통합. 전부 0 이 기준선이다.
  (루트 `type-check` 는 admin-web 을 제외하므로 두 번째 명령이 별도로 필요하다.)
- **dev 스모크**: 자동 파생 완주 · 잎 종결 · 발주 취소 · 취소 409 · 유령 행 소멸(입고 대기
  목록에서 완결 계획이 빠지는지) — admin-web 화면으로 확인한다.

## 11. 범위 밖

| 항목 | 어디로 |
|---|---|
| 발주 도메인 이벤트 0건 · 멱등키 · 카트 유니크 · N+1 | #745 |
| `applied`/`receiving` enum 값 `DROP` | 별도 contract phase PR |
| `parentPlanId`/`isLinkedPlan` 이 영구히 비는 화면 정리 | #745 |
| 미달 사유 집계 · 공급처 평가 | 제품 결정 없음 |
| 통화·발주서 전달 (진단 ⑨) | 범위 밖 — 리팩터링이 아니라 없는 기능 |

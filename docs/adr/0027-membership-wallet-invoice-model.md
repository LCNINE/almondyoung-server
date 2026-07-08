# ADR-0027: 멤버십 정기결제 — 인보이스(미수금) 모델로 재설계

- 상태: Proposed
- 작성일: 2026-07-07
- 관련: ADR-0025(single-transaction-runner), 브랜치 `fix/membership-billing-review-followups`(보안·금전 후속 수정)

## 0. 요약(TL;DR)

정기결제 한 건의 상태(청구 스케줄·재시도·더닝·락)가 지금 **membership과 wallet에 흩어져** 있고, 동기화를 단발 Kafka 이벤트에 의존한다. 이를 **wallet이 소유하는 인보이스(Invoice=미수금) 엔티티**로 옮겨, wallet이 "돈에 관한 모든 상태(얼마 받아야 하나 / 뺐나 / 재시도 / 미수)"를 단일 소유하고, membership은 "구독 자격 생명주기"만 남긴다. 결과적으로:

- membership은 CMS 승인상태(PENDING/REGISTERED)를 **몰라도 된다**. 인보이스 결과 이벤트(paid/failed/uncollectible)만 구독.
- **선(先)적용**: 구독 신청 즉시 30일 자격을 부여하고, wallet 인보이스가 승인 후 알아서 출금.
- 더닝·락·reconcile이 wallet 인보이스 상태머신으로 흡수되어 두 서비스의 상태 어긋남 경로가 사라진다.

### 라이브 실측(2026-07-07, 읽기 전용 조회)

- `cms_members`: REGISTERED 12 · PENDING 6 · FAILED 5 · DELETED 7 → **터미널 실패율 ≈ 29%(5/17)**.
- 실패 사유: `Q201 생년월일/사업자번호 불일치` ×3(**전부 10자리 = 사업자번호**), `Q101 계좌번호오류` ×2(6자리 = 개인 생년월일).
- `cms_agreements`: 27건 전부 `확인` — 동의자료 업로드는 문제없음.
- **`billing_agreements` 0건, `cms_withdrawals` 0건** → 정기결제 출금이 **프로덕션에서 한 번도 실행된 적 없음**. 즉 이 재설계는 **실데이터 마이그레이션 리스크가 없는 그린필드**다. 라이브 구독자는 전원 one_time.

→ 사업자번호(10자리) **체크섬 사전검증**이 실측상 최대 실패군(Q201)을 직접 겨냥한다.

---

## 1. 현재 구조와 문제

### 1-1. 현재 책임 분포

| 데이터 | 소유 | 위치 |
|---|---|---|
| payment_intent(charge 라이프사이클), charges, cms_members, cms_withdrawals, billing_agreements, billing_methods | wallet | `apps/wallet/src/schema.ts` |
| subscription_contracts(청구일·자동갱신·`billingInProgress` 락), subscription_entitlement(자격), billing_events, membership_dunning_queue | membership | `apps/membership/src/shared/schemas/entities/schema.ts` |

정기결제 한 건의 청구는 **membership이 스케줄·더닝·락을 직접 관리**하고, wallet에 `BillingCharge` Kafka 커맨드를 던져 charge만 시키는 구조다.

### 1-2. 근본 문제 (동영님 최초 제기 + 이번 세션 6-에이전트 검토로 실증)

1. **상태 이원화** — "돈에 관한 상태"인 재시도·더닝·미수가 SoT(wallet)가 아니라 membership에 있다. wallet 결제 결과 이벤트가 유실되면 membership이 영원히 모르고 락이 stuck. (이번 브랜치에서 reconcile 크론으로 **땜빵**했으나, 이는 구조가 아니라 안전망.)
2. **경계 침범** — wallet 이벤트 payload에 `subscriberRef/Type`를 실어 membership 라우팅을 대신해주는 안티패턴. wallet이 "membership에 정확히 배달할 책임"을 떠안음.
3. **CMS 타이밍이 membership까지 샌다** — 현재는 계좌가 `REGISTERED`(D+1 심사 통과) 되기 전엔 정기결제 수단으로 **선택조차 불가**(`billing-method.service.ts:235`, controller가 필터). 즉 "선승인-후가입". 이사님 방향("등록 신청 즉시 적용")과 정반대.
4. **얕은 이관 계층** — membership `BillingManager`/`BillingOutcomeHandler`가 결제 상태머신 지식을 상당량 들고 있어야 함(더닝 72h×3, 락 선점/해제, intent 상태 해석). wallet과 중복된 상태 해석.

### 1-3. 현재 CMS 흐름 (사실 확인)

- **계좌 등록(회원등록)** = 효성에 자동이체 신청. 비동기: 영업일 12시 마감 → **D+1 심사**(신청완료→REGISTERED / 신청실패→FAILED). `cms-member-poller.service.ts:38` 크론이 폴링.
- **동의자료(서면) 업로드** = 별도 Phase 2. 상위기관 확인 후 `등록`/`확인`.
- **개별 출금 정산** = 또 별개. 출금신청(전영업일 17시 마감) → **출금일 D+1 정산**. `cms-settlement-poller.service.ts:37` 30분 크론.
- **CMS는 환불 API가 없다**(`cms-batch.provider.ts` refund 미지원) → 이미 나간 돈은 수동 보상.
- **CMS FAILED → membership 통지 경로 없음**(`cms-member-poller.service.ts:60-67`은 DB status만 갱신). = 선적용 모델의 유일한 치명 갭.

---

## 2. 목표 아키텍처 — 인보이스(AR) 모델

### 2-1. 경계 재정의

```
membership  =  구독 생명주기 + 자격(entitlement)
               "이 사람 구독 중인가 / 언제까지인가 / 해지됐나"
               인보이스에 '청구해달라'고 요청하고, 결과 이벤트만 듣는다.

wallet      =  인보이스(미수금) + charge(집행) + 정산 + 재시도 + 결제수단
               "얼마 받아야 하나 / 실제 뺐나 / 재시도 중인가 / 미수인가"
               CMS 승인/출금 타이밍을 내부에서 전부 흡수한다.
```

핵심: **membership은 CMS도 charge도 모른다. 인보이스 하나만 안다.** membership이 아는 건 "invoice X를 이 계약에 걸었다 → 그게 paid/failed/uncollectible로 끝났다"뿐.

### 2-2. 왜 이게 더 MSA스럽고 깊은 모듈인가

- **깊은 모듈(deep module)**: 인보이스가 "재시도 스케줄 · CMS D+1 심사 대기 · 정산 지연 · 백업결제수단 폴백 · 미수 판정"이라는 큰 복잡도를 `invoice.status` + `invoice.settle()`이라는 얇은 인터페이스 뒤로 숨긴다. membership은 그 내부를 몰라도 된다.
- **membership이 얕아진다(의도된 것)**: `dunning_queue`·`billingInProgress` 락·intent 상태 해석이 전부 사라지고 "자격 부여/연장/회수"만 남는다.
- **경계 안티패턴 제거**: wallet이 이벤트에 `subscriberRef`를 실어 라우팅해주던 걸, 인보이스가 자기 `subscriberRef`를 갖고 결과를 발행 → membership은 자기 인보이스ID로 매핑. (동영님이 지목한 correlationId 방향과 동일.)

---

## 3. 엔티티 설계 (wallet 신설/변경)

### 3-1. `invoice` (신설) — 미수금 = 청구 1건의 진실 원천

```
invoice
  id                uuid pk
  subscriber_type   varchar(64)     -- 'MEMBERSHIP' (문자열 태그, 결합도↓)
  subscriber_ref    varchar(255)    -- membership contractId
  billing_method_id uuid            -- 청구 대상 결제수단(현재 primary)
  amount_due        integer         -- 청구 금액
  currency          varchar(3)
  period_start      date            -- 이 인보이스가 커버하는 구독 주기
  period_end        date
  due_date          date            -- 최초 출금 예정일
  status            invoice_status  -- 아래 상태머신
  attempt_count     integer  default 0
  next_attempt_at   timestamptz     -- 다음 charge 시도 시각(NULL=대기 안 함)
  finalized_at      timestamptz     -- 터미널 도달 시각
  idempotency_key   text unique     -- membership이 만든 자연 키(주기당 1)
  created_at / updated_at
  -- 인덱스: (subscriber_type, subscriber_ref), (status, next_attempt_at) partial
```

**`invoice_status` 상태머신** (핵심: "승인 대기"와 "진짜 실패"를 분리):

```
             ┌──────────────────────────────────────────────┐
             │                                              ▼
DRAFT ─▶ OPEN ─▶ MANDATE_PENDING ─▶ ATTEMPTING ─▶ PAID (terminal)
             │        │  ▲               │  │
             │        │  └───(승인 전 재시도, 더닝 아님)
             │        ▼                  ▼
             │   MANDATE_REJECTED    PAST_DUE ─▶ (재시도 소진) ─▶ UNCOLLECTIBLE (terminal)
             │     (terminal)                          
             └─▶ VOID (terminal; 구독 취소/무효화)
```

- `OPEN`: 생성됨, 아직 첫 시도 전.
- `MANDATE_PENDING`: 결제수단이 CMS 심사 중(PENDING). 이 상태의 charge 실패는 **더닝/미수로 세지 않는다** — `attempt_count` 안 올리고 `next_attempt_at`만 뒤로 민다. (선적용 1~2일 대기 창을 정상 처리하는 핵심.)
- `ATTEMPTING`: 결제수단 승인 완료, 실제 출금 시도 중(효성 REQUESTED → D+1 정산 대기 포함).
- `PAST_DUE`: 진짜 결제 실패(잔액부족 등). 여기서만 더닝 카운트 증가.
- `PAID` / `UNCOLLECTIBLE` / `MANDATE_REJECTED` / `VOID`: 터미널.

### 3-2. `charge`(기존 재사용) ↔ invoice 연결

- 기존 `payment_intents`/`charges`는 그대로 두되, **payment_intent에 `invoice_id` FK를 추가**한다. 인보이스 1 : intent(=charge 시도) 다.
- 각 출금 시도 = intent 1건. 실패하면 새 intent로 재시도(멱등키 = `invoice.idempotency_key + attempt_count`).
- 이렇게 하면 "인보이스는 여러 charge를 가진다"는 이사님 모델이 그대로 성립하고, 기존 intent 상태머신/정산 폴러를 재활용한다.

### 3-3. `subscription_billing_method` (신설) — 결제수단 1:다 + 백업

지금은 `billing_agreements`가 (subscriberType, subscriberRef) **유니크**라 구독당 결제수단 1개만 가능. 이를 1:다로 확장:

```
subscription_billing_method
  id                uuid pk
  subscriber_type   varchar(64)
  subscriber_ref    varchar(255)
  billing_method_id uuid
  role              varchar(16)   -- 'PRIMARY' | 'BACKUP'
  status            varchar(16)   -- 'ACTIVE' | 'PENDING_MANDATE' | 'REVOKED' | 'FAILED'
  priority          integer       -- 폴백 순서
  created_at / revoked_at
  -- 부분 유니크: (subscriber_type, subscriber_ref) WHERE role='PRIMARY' AND status='ACTIVE'
```

- **replace가 아니라 append + soft-revoke**: 결제수단 변경 = 옛 것 `REVOKED`, 새 것 추가. 이력 보존 → 관리자 조회/감사.
- **백업결제**: PRIMARY 실패 시 `priority` 순으로 BACKUP 시도. (Phase 4)
- `billing_agreements`는 이 테이블로 대체하거나, 당분간 병존 후 흡수.

### 3-4. membership 쪽 변경 (제거가 핵심)

- `subscription_contracts.billingInProgress` / `billingStartedAt` / `billingIdempotencyKey` **제거** → wallet 인보이스가 진행상태를 소유.
- `membership_dunning_queue` **제거** → wallet 인보이스 `attempt_count`/`next_attempt_at`로 이관.
- `subscription_contracts`는 자격 상태(status·autoRenewal·nextBillingDate·endsAt)만 남긴다. `nextBillingDate`는 "다음 인보이스를 언제 만들지"의 트리거로만 사용.
- `billing_events`는 감사/멱등 마커로 유지 가능(선택).

> 이번 브랜치에서 만든 reconcile 크론·retry 가드·replay 차단·internal 인증은 **그대로 유효**하다. reconcile은 "인보이스 결과 이벤트 유실 시 wallet 인보이스를 되묻는 안전망"으로 자연스럽게 이어진다.

---

## 4. 이벤트/커맨드 계약 초안 (membership ↔ wallet)

방향: **명령은 커맨드(멱등키 포함), 결과는 이벤트(best-effort + 인보이스 조회 API가 권위)**.

### 4-1. membership → wallet (커맨드, `wallet.commands.v1`)

**`CreateInvoice`** — 구독 주기마다 인보이스 생성 요청.
```json
{
  "messageType": "CreateInvoice",
  "payload": {
    "subscriberType": "MEMBERSHIP",
    "subscriberRef": "<contractId>",
    "billingMethodId": "<billing_method uuid>",
    "amount": 9900,
    "currency": "KRW",
    "periodStart": "2026-07-07",
    "periodEnd": "2026-08-06",
    "dueDate": "2026-07-07",
    "idempotencyKey": "membership:invoice:<contractId>:<periodStart>"
  }
}
```
- wallet이 인보이스를 생성하고 이후 집행(승인 대기·출금·재시도·정산)을 전담. membership은 이 커맨드 이후 관여하지 않는다.

**`VoidInvoice`** — 구독 취소/해지 시 열린 인보이스 무효화.
```json
{ "messageType": "VoidInvoice", "payload": { "subscriberType": "MEMBERSHIP", "subscriberRef": "<contractId>", "reason": "SUBSCRIPTION_CANCELLED" } }
```

### 4-2. wallet → membership (이벤트, `payments.events.v1`)

인보이스가 자기 `subscriberRef`로 결과를 발행(라우팅 대신 상관키).

**`invoice.paid`** — 출금 성공(정산 확정).
```json
{ "eventType": "invoice.paid", "payload": { "invoiceId": "...", "subscriberType": "MEMBERSHIP", "subscriberRef": "<contractId>", "periodStart": "...", "periodEnd": "...", "paidAt": "..." } }
```
→ membership: 자격 `endsAt`을 `periodEnd`로 연장.

**`invoice.payment_failed`** — 재시도 중인 실패(아직 터미널 아님).
```json
{ "eventType": "invoice.payment_failed", "payload": { "invoiceId":"...", "subscriberRef":"<contractId>", "attemptCount":1, "maxAttempts":3, "nextAttemptAt":"...", "errorCode":"..." } }
→ membership: 고객에게 "결제 확인 필요" 표시(현 paymentActionNeeded 배너 재사용). 자격은 유지.
```

**`invoice.uncollectible`** — 재시도 소진, 최종 미수. (터미널)
→ membership: 자격 종료(회수/만료).

**`mandate.rejected`** — CMS 계좌 심사 최종 거절. (터미널, 선적용 회수 트리거)
```json
{ "eventType": "mandate.rejected", "payload": { "billingMethodId":"...", "subscriberRef":"<contractId>", "reasonCode":"Q201", "reason":"생년월일/사업자번호 불일치" } }
→ membership: 선적용한 30일 자격을 정지/만료. (§7의 회수 훅)
```

**`mandate.registered`**(선택) — 심사 통과. membership이 별도 처리는 없어도, 관리자 가시성/알림용으로 발행 가치 있음.

### 4-3. 권위 조회(폴링/reconcile) — wallet HTTP

- `GET /v1/invoices/by-idempotency-key?key=...` (서버 간 API-key) — 이벤트 유실 시 membership이 인보이스 권위 상태를 되묻는 경로. 이번 브랜치의 `by-idempotency-key` 패턴을 인보이스로 확장.

---

## 5. CMS 등록 실패 최소화 + 실패 UX (실측 기반)

라이브 실패 실측: Q201 생년월일/사업자번호 불일치(사업자 10자리 ×3, 개인 생년월일 6자리 포함), Q101 계좌오류 ×2. **Q201(불일치)이 최대 실패군.**

### 5-0. 사전확인 API 결론 — 무비용 실명조회는 없음, 유료 미도입

효성 배치CMS API(`apps/wallet/docs/FMS-TE-0046`) 전수 확인 결과, 제공 API는 **회원관리(등록/수정/삭제/조회)·동의자료관리·출금관리뿐**이다. **별도의 계좌 실명조회/1원인증/사전확인 엔드포인트가 없다.** 계좌주 실명대사는 회원등록의 D+1 처리에 묶여 Q201/Q202로 **사후에만** 나온다 — 제출 전 검증 불가.

- 외부 실명조회(금결원 계좌실명조회, 1원인증, KCB 등)는 **호출당 비용 발생** → 정책상 **도입하지 않는다.**
- 따라서 근본 예방은 "유료 API"가 아니라 **입력 전 안내문구 + 입력 형식검증 + 실패 후 명확한 사유 UX**의 3종으로 간다.

### 5-1. 입력 전 안내문구 (핵심 — 비용 0)

제출 폼(스토어프론트 계좌 등록 위저드)에 **제출 직전 확인 안내**를 배치:

> **등록 전에 꼭 확인하세요.** 자동이체는 은행에 등록된 **계좌주 본인 정보로만** 등록됩니다.
> - **예금주 성함**이 신청하는 계좌의 실제 예금주와 같아야 합니다.
> - **생년월일**(개인) 또는 **사업자등록번호**(사업자)가 그 계좌에 등록된 정보와 일치해야 합니다.
> - 본인 명의가 아닌 계좌(가족 계좌 등)로는 등록되지 않습니다.
> 정보가 다르면 은행 확인 단계에서 **등록이 거절**되며, 다시 등록하셔야 합니다.

- 근거: 실측 최대 실패군 Q201이 정확히 이 "본인정보 ↔ 계좌등록정보 불일치"다. 라이브 유태림 케이스(생년월일 불일치, 로그 확정)도 동일. 대부분은 **타인 계좌 / 오타 / 본인정보 착오**라 안내만으로도 상당수 예방된다.
- 위저드 계좌정보 입력 단계 + 최종 제출 버튼 위 두 곳에 노출.

### 5-2. 입력 형식검증 (비용 0)

- **사업자등록번호(10자리) 체크섬 검증** — 오타성 Q201 차단. 표준 알고리즘:
  ```
  weights = [1,3,7,1,3,7,1,3,5]           // d1..d9
  sum = Σ(dᵢ × weightᵢ)  for i in 1..9
  sum += floor((d9 × 5) / 10)
  check = (10 - (sum mod 10)) mod 10
  valid ⟺ check === d10
  ```
- **개인 생년월일(6자리 YYMMDD)** — 체크섬 없음 → 월(01–12)·일(01–말일) 범위 검증. (형식은 맞고 값만 다른 케이스는 못 잡음 → 5-1 안내가 담당.)
- **은행코드**(3자리) 화이트리스트, **예금주명** 공백/특수문자, **계좌번호** 숫자/길이 검증 — Q101 오타성 일부 차단.

> 한계 명시: 형식검증은 "형식 오류"만 잡고, "형식은 맞는데 실제 예금주와 불일치"(유태림 케이스)는 못 잡는다. 그 영역은 무비용으론 사전차단 불가이므로 **5-1 안내 + 5-3 실패 UX**로 대응한다.

### 5-3. 실패 후 UX — 사유 명확화 + 재등록 유도 (라이브 사고의 직접 원인)

라이브 유태림 케이스(로그 확정): 고객은 효성의 **"자동이체 등록되었습니다" 접수 안내 SMS**를 **승인 완료로 오해**했고, 우리 화면은 실패 사유·재등록 경로를 명확히 안 알려줬다. 그 혼란이 결제수단 삭제(→ 효성 약정까지 삭제)로 이어졌다. 수정 방향:

1. **"접수"와 "최종 결과"를 분리 표기.** 등록 직후엔 "은행 확인 중(1~2일)"로 명시하고, 효성 접수 SMS가 승인이 아님을 안내. D+1 결과가 나오면 그때 성공/실패를 확정 표기.
2. **실패 시 사유를 사용자 언어로.** CMS Q-코드를 그대로 노출하지 말고 매핑:

   | Q-코드 | 내부 사유 | 고객 표시 문구(예) |
   |---|---|---|
   | Q201 | 생년월일/사업자번호 불일치 | "계좌주 정보(성함·생년월일/사업자번호)가 은행 등록정보와 달라 등록되지 않았습니다. 본인 명의 계좌인지, 정보가 정확한지 확인 후 다시 등록해주세요." |
   | Q202 | 실명미확인계좌 | "실명확인이 안 된 계좌입니다. 은행에서 실명확인 후 다시 등록해주세요." |
   | Q101/Q122 | 계좌번호 오류 | "계좌번호를 다시 확인해주세요." |
   | Q102/Q108/Q114/Q121 | 해지·출금불가·유형오류 | "자동이체로 사용할 수 없는 계좌입니다. 다른 계좌로 등록해주세요." |
   | 그 외 | 기타 | "계좌 등록에 실패했습니다. 계좌 정보를 확인 후 다시 시도해주세요." |

3. **재등록 CTA를 실패 화면에 바로.** "다시 등록" 버튼 → 계좌 입력 위저드로. (지금은 실패를 방치하거나 삭제로 흐름이 끊김.)
4. **관리자 화면 동일 매핑** — "심사 실패(확정)"과 "은행 확인 중"을 구분, 사유 문구 노출. 승인 오인으로 인한 CS를 줄인다.

### 5-4. 삭제 가드 (부수 방지책)

CMS_BATCH 결제수단 삭제는 효성 `deleteMember`를 호출해 **약정 자체를 지운다.** 승인/확인 중 상태를 오삭제하면 복구가 어려우므로, 삭제 직전 CMS 현재 상태를 재조회하고 REGISTERED/처리중이면 경고·차단. (유태림 케이스는 실패건 삭제라 무해했으나, 성공건이었으면 사고.)

> 실패해도 선적용이라 **한 달 자격은 손해**로 감수하되, §7 회수 훅으로 그 이상 새는 걸 막는다. 사전검증은 그 손해 빈도를 줄이는 1차 방어선.

---

## 6. 미수금(신용) 게이팅

- **원칙**: 미납(=UNCOLLECTIBLE 또는 PAST_DUE) 인보이스가 있는 subscriber는 **새 인보이스 생성/새 구독을 차단**. 빚이 쌓이지 않게.
- **조회**: wallet이 인보이스를 소유하므로 `GET /v1/invoices?subscriberRef=...&status=open|uncollectible`로 미수 조회. 관리자·가입 플로우가 이걸 게이트로 사용.
- **transient 구분(중요)**: `MANDATE_PENDING`/`ATTEMPTING`은 **미수가 아니다**(정상 대기). 게이팅은 `PAST_DUE`/`UNCOLLECTIBLE`에만 건다. 안 그러면 정상 1~2일 승인 대기 고객이 신용불량으로 오분류.

---

## 7. 실패 시 자격 회수 훅 (선적용 모델의 필수 조각)

현재 없음 → 신설:
- `cms-member-poller`가 `PENDING → FAILED` 전이 시 **`mandate.rejected` 이벤트 발행** + 해당 인보이스를 `MANDATE_REJECTED`로.
- membership이 `mandate.rejected`/`invoice.uncollectible` 구독 → 선적용한 자격을 **정지/만료**(기존 `voidSubscription`/만료 경로 재사용).
- CMS 환불 불가이므로, 자격 회수는 "이미 나간 돈 환불"이 아니라 "더 이상 혜택 연장 안 함". (돈은 애초에 안 나갔으니 정산 이슈 없음 — 실측상 출금 0건.)

---

## 8. 고객/관리자 UX

### 8-1. 고객(스토어프론트)

| 상황 | 현재 | 목표 |
|---|---|---|
| 정기결제 신청 | 계좌 REGISTERED 전엔 수단 선택 불가("심사 중") | **즉시 멤버십 활성** + "결제수단 승인 확인 중(1~2일)" 안내 |
| 승인 대기 중 | 노출 안 됨 | 자격은 활성, 배너로 "은행 확인 중(1~2일)" — 효성 접수 SMS가 승인이 아님을 명시 |
| 승인 실패 | 없음 | Q-코드 매핑 사유(§5-3) + 재등록 CTA. 접수 SMS 오인 방지 |
| 결제 실패(진짜) | dunning 배너(이번 브랜치) | invoice.payment_failed → "결제 확인 필요" + 결제수단 변경 CTA |
| 결제수단 변경 | replace | 추가/교체(옛 것 이력 보존), 백업수단 등록 |

### 8-2. 관리자(admin-web)

- **인보이스(미수금) 뷰 신설**: subscriber별 open/past_due/uncollectible 인보이스, 다음 시도 시각, 시도 횟수. (지금 membership dunning 뷰가 하던 걸 wallet 인보이스 기준으로 통합.)
- **결제수단 이력 뷰**: 1:다 이력(등록/거절/변경/해지), CMS 상태(심사중/사용가능/심사실패).
- **미수금 조회**: 신용 게이팅 대상 명단.
- 기존 "수동 재시도"(이번 브랜치에서 가드 추가)는 인보이스 `retry`로 재해석 — due·미수 상태에서만.

---

## 9. 단계별 마이그레이션 (expand-contract, ADR-0005 준수)

> 실데이터가 없으므로(출금 0건) 그린필드에 가깝지만, 무중단·단계 배포 원칙은 지킨다.

**Phase 0 — 독립 선행(현 코드에 바로, 인보이스 모델과 무관하게 즉시 착수 가능)**
- 입력 전 안내문구(§5-1) + 형식검증(§5-2, 사업자번호 체크섬·생년월일 범위·은행코드) 추가.
- 실패 후 사유 UX(§5-3): 접수/최종 분리 표기, Q-코드→사용자 문구 매핑, 재등록 CTA. 고객·관리자 화면 공통.
- 삭제 가드(§5-4): CMS_BATCH 삭제 전 상태 재조회.
- (효성 실명조회 API 없음 확정 — 유료 외부 미도입.)
> 이 Phase 0은 라이브 CS(유태림류 승인 오인)를 즉시 줄이는 값싼 조치라 다른 Phase와 독립 배포한다.

**Phase 1 — wallet 인보이스 엔티티 신설(additive)**
- `invoice`, `subscription_billing_method` 테이블 + `payment_intents.invoice_id` FK. 코드 경로는 아직 미사용(shadow). 배포만.

**Phase 2 — 신규 정기결제 플로우 병행(dual-path)**
- membership: 정기 가입 시 (a) 자격 즉시 부여(선적용) (b) `CreateInvoice` 커맨드 발행. 기존 `BillingCharge` 경로와 분기(feature flag).
- wallet: 인보이스 집행기(MANDATE_PENDING 대기 → 승인 후 ATTEMPTING → 정산). `invoice.*` 이벤트 발행.
- membership: `invoice.paid/failed/uncollectible`, `mandate.rejected` 구독 + 자격 연장/회수.
- 신규 가입만 이 경로로. 라이브 recurring 데이터가 없으니 병행 리스크 최소.

**Phase 3 — 더닝/락 이관(contract)**
- membership `membership_dunning_queue`·`billingInProgress`·`billingIdempotencyKey` 제거. 더닝을 wallet 인보이스 재시도로 완전 이관.
- 이 단계는 Phase 2 배포가 안정화된 뒤(적어도 한 번의 deploy 완료 후) 진행 — destructive이므로 별도 PR.

**Phase 4 — 백업 결제수단(fallback) + 미수 게이팅 고도화**
- PRIMARY 실패 시 BACKUP 폴백, 미수금 신용 게이팅.

각 Phase 사이 **최소 한 번의 deploy 완료**를 두어 expand/contract race를 회피(ADR-0005 §5).

---

## 10. 리스크 · 미결 질문

1. **더닝 소유 이동**: 더닝 정책(72h×3)이 membership→wallet로 옮겨간다. wallet이 subscriber별 더닝 정책을 알아야 하나? → 인보이스 생성 시 membership이 재시도 정책(maxAttempts·intervalHours)을 파라미터로 실어주면 wallet은 정책 무지 유지 가능. (경계 보존)
2. **MANDATE_PENDING 재시도 상한**: 승인이 영영 안 나면(효성 무응답) 무한 대기 방지 위해 mandate 대기 타임아웃(예: 5영업일) → `MANDATE_REJECTED` 강등 규칙 필요.
3. **실명조회 API 부재 시**: Q201/Q101의 "형식은 맞는데 불일치"는 사전검증만으로 못 막음 → 선적용 한 달 손해 일부 잔존(수용 범위, 실측 실패 절대량 작음).
4. **membership이 여전히 가벼운 오케스트레이터인가**: 인보이스 생성 타이밍(주기 크론)은 membership에 남는다. 이건 "언제 청구할지=구독 스케줄" 이라 membership 책임이 맞다. 집행(어떻게 받아낼지)만 wallet.

---

## 11. 이번 브랜치 수정과의 관계 (버리는 것 없음)

- 보안/금전 수정(무결제 구독 차단, intent replay 차단, internal 라우트 인증, pause 만료 제외, 수동 재시도 가드): **그대로 유효**. 인보이스 모델과 직교.
- reconcile 크론: 인보이스 결과 이벤트 유실 시 wallet 인보이스를 되묻는 **안전망**으로 승계.
- `by-idempotency-key` 조회: 인보이스 조회 API로 확장.
- membership dunning/락 관련 코드만 Phase 3에서 제거 대상.

---

## 부록 A. 라이브 케이스 스터디 — dbxofla0323(유태림) 승인 오인 (2026-07-05~07)

Loki 로그 + wallet DB 읽기전용 조회로 확정한 실사례. §5-3(실패 UX)·§5-4(삭제 가드)의 근거.

**타임라인**
- 07-05 09:42 — CMS 회원등록 + 동의자료 등록(동의자료 `확인` 정상). cms_member `2D3693491E42C8C5E3F1`, 카카오뱅크(090), 생년월일 `000326`.
- 07-06 15:16경 — 고객이 효성 **"자동이체 등록되었습니다" 접수 안내 SMS** 수신 → **승인으로 오해**.
- 07-06 15:00 — 우리 폴: `CMS member query failed ... 500 점검시간` (효성 점검, 일시 장애 → 다음 폴 재시도, 정상 동작).
- 07-07 09:00 — 우리 폴: `registration failed: 생년월일/사업자번호 불일치`(Q201) → FAILED. **은행 실명대사 최종 결과 = 진짜 실패.**
- 07-07 09:31 — 결제수단 삭제 → `deleteMember`로 효성 약정까지 삭제.

**결론**: CMS가 실패→승인한 게 아니다. 접수 SMS를 승인으로 오해했을 뿐, 실제 은행 대사는 생년월일 불일치로 정상 실패했고 우리 기록도 정확했다. 즉 **시스템 판정 버그가 아니라, (a) 접수/승인 구분 부재 (b) 실패 사유 미표기 (c) 삭제가 약정까지 지움**의 UX·안전장치 결함이 겹친 사고.

**교훈 → 반영**: §5-1 안내문구(본인정보↔계좌등록정보 일치), §5-3 접수/최종 분리 + Q-코드 사유 매핑 + 재등록 CTA, §5-4 삭제 가드. Q201이 실측 최대 실패군인 것과 정확히 일치.

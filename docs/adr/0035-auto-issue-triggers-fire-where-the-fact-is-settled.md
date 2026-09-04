# 자동발급 트리거는 사실이 확정되는 시스템에서 발화한다 — 그리고 발행자 없는 구독자는 가드가 막는다

2026-09-01 리허설 2차에서 `customer_registered` 자동발급이 **발화할 수 없다**는 것이 드러났다(#775).
user-service 의 `UserEmailVerified` 를 기다렸는데, 그 이벤트를 내는 유일한 코드가 도달 불가였다 —
가입이 사용자를 이미 인증된 상태로 넣고, 인증 처리기는 미인증 사용자만 찾는다. 2026-04-22 부터 그랬고,
각 층의 테스트는 전부 초록이었다. 같은 모양이 Medusa 의 `user.updated`·`user.deleted` subscriber 에도
있다(`users.events.v1` 을 내는 곳이 없다).

[[0033-coupons-are-owned-by-the-sales-channel]] 을 뒤집지 않는다 — 쿠폰은 Medusa 안에 산다.
이 ADR 은 그 쿠폰을 «누가 언제» 자동으로 주는지, 그리고 그 배선이 끊겨 있음을 «무엇이» 잡는지를 정한다.
[[0034-coupon-issuance-writes-go-through-workflows]] 의 쓰기 경로는 그대로다.

## 측정 — 소스로 확인한 것 (재조사 금지)

전문은 `docs/superpowers/specs/2026-09-05-coupon-customer-registered-trigger-design.md` §2. 결정을 정한 것만:

1. Medusa 코어가 고객 생성 워크플로 끝에 `customer.created` 를 낸다. 우리 가입 경로가 그 워크플로를 지난다.
2. 그 이벤트는 어드민이 만든 고객(`has_account=false`)에도 뜬다. 게스트 결제 고객은 오늘은 이벤트 없이 생긴다.
3. Redis 이벤트버스 재시도 기본값은 `attempts: 1`, 우리 설정은 안 바꿨다.
4. Medusa 에 Prometheus `/metrics` 가 없었다. Alloy 의 OTLP 수신기는 trace·log 만 전달한다.
5. Medusa 의 BullMQ 큐에 밖에서 넣는 코드 0곳, 우리 소스의 커스텀 emit 0개 — `users.events.v1` 의 사망은 정적 증명.
6. 발급 키 `trigger:<trigger>` + `idx_coupon_grant_issue_key`(파셜 유니크) 가 재발급을 막는다.

## Decision

### 1. `customer_registered` := Medusa `customer.created` ∧ `has_account`

트리거는 **그 사실이 확정되는 시스템**에서 발화한다. 「고객이 생겼다」는 Medusa 가 아는 사실이다.
user-service 의 이메일 인증은 다른 사실이고(제품 결정이며 지금 꺼져 있다), 그것을 기다리면 Medusa 고객이
아직 없는 시점에 발화해 최대 1시간 백오프를 타야 했다. `has_account` 는 «회원가입» 의 정의다 — 어드민이
만든 고객·게스트에겐 주지 않는다.

`membership_activated` 는 그대로다 — 「멤버십이 활성화됐다」는 membership 앱이 아는 사실이고, Kafka →
channel-adapter inbox → Medusa 라우트 경로가 리허설에서 통과했다.

### 2. 메트릭은 발화시킨 쪽이 센다

`coupon_auto_issue_total{trigger,outcome}` · `coupon_auto_issue_failures_total{trigger,kind}` 를
channel-adapter(`membership_activated`)와 Medusa(`customer_registered`)가 **같은 이름·같은 라벨**로 낸다.
Medusa 는 `:PORT+10000/metrics` 를 열고 Alloy 가 긁는다 — #613 이 9개 앱에 깐 것과 같은 모양이라
대시보드·알림의 PromQL 이 job 구분 없이 합산한다. 라우트 안에서 세지 않는다(세면 전자가 두 번).

### 3. subscriber 에 재시도는 없다

같은 프로세스·같은 DB 다. channel-adapter 가 재시도를 5단 둔 이유(다른 서비스를 HTTP 로 부른다)가 없다.
실패는 `failures_total{kind="permanent"}` 와 error 로그로 **보이고**, 복구는 사람이
`POST /admin/customers/:id/issue-coupons {trigger: customer_registered}` 를 한 번 부른다 — 발급 키가
결정적이라 멱등하다. 전역 `attempts` 는 subscriber 8개 전부의 동작을 바꾸고, 스윕 잡은 「가입 20시간 뒤
새 쿠폰 소급 발급」이라는 의미 변경을 낳는다 — 둘 다 기각.

### 4. 재발급 불가의 근거는 인덱스다

멤버십을 가입·해지 반복해도 같은 쿠폰은 두 번 안 나간다 — `trigger:membership_activated` 키가 고객·프로모션당
고정이고 파셜 유니크가 막는다(`already_issued`). 사용한 장·만료된 장도 행이 남아 계속 막는다. 유일한 재발급
경로는 어드민이 미사용 장을 회수(soft delete)한 뒤이고 의도된 것이다. 나중에 새로 만든 트리거 쿠폰은
재활성화 때 한 장 나간다 — 「프로모션당 한 장」이 정의다.

### 5. 가드 규칙 — 층 사이의 전제를 기계가 검사한다

- **A. 트리거 어휘의 모든 값은 등록된 살아 있는 발행자를 가진다.**
  `packages/domain-types/coupon-trigger-sources.ts`(등록부, `Record<AutoIssueTrigger, …>`) +
  `coupon-trigger-producers.spec.ts`(루트 jest). 어휘에 값을 더하고 발행자를 안 적으면 type-check 와 jest 가 막는다.
- **B. Medusa subscriber 가 듣는 이벤트는 emit 하는 곳이 있다.**
  `apps/medusa/src/subscribers/__tests__/subscriber-events-have-emitters.unit.spec.ts`. 예외 목록엔 이슈 번호가
  필수이고, 고쳐진 뒤 안 지우면 stale 로 빨개진다.

한계: 둘 다 「발행 코드가 존재한다」까지 본다. 존재하되 도달 불가한 것(이번 결함)은 정적으로 못 잡는다 —
그것은 리허설(런타임)의 몫이고, 가드는 「발행자가 아예 없다」·「이름이 어긋났다」·「다음 사람이 발행자를 안
적었다」를 잡는다.

## 하지 않는 것

- user-service 의 이메일 인증 흐름 수정 — 제품 결정(#775 안 1).
- `UserEmailVerified` 이벤트 계약 삭제 — user-service 의 것이다. channel-adapter 의 소비 경로만 지웠다.
- Medusa `user.updated`·`user.deleted` 수정 — 후속 이슈(가드 B 예외 목록의 번호).
- A5 플립 — 리허설 3차 뒤.

## 결과

`customer_registered` 가 처음으로 발화할 수 있다. 두 트리거의 발급 결과가 한 대시보드에 보인다. 죽은
소비 경로 하나가 사라지고, 남은 둘은 이슈 번호를 달고 가드 안에 있다. 다음 트리거를 붙이는 사람은
발행자를 적지 않고는 컴파일도 테스트도 통과하지 못한다.

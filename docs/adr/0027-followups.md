# ADR-0027 인보이스 모델 — 머지 후 후속 백로그

---

## P2 — 다음 스프린트 권장 (자금 안전엔 영향 없음)

### P2-A. 환불발 구독 회수(voidByPaymentIntent)가 인보이스를 void 하지 않음 · CONFIRMED
- `apps/membership/src/services/subscription.service.ts:266-272`, `services/subscription/subscription.manager.ts:178-217`
- INVOICE 계약의 결제가 wallet 에서 환불되면 계약은 CANCELLED + 자격 회수되지만 VoidInvoice 미발행 →
  진행 중(PAST_DUE 재시도) 인보이스가 계속 출금 시도. cancelImmediately/forceCancel 경로는 void 하는데
  이 제3의 종료 경로만 누락.
- 수정: `voidSubscription`/`voidByPaymentIntent` 에서 `billingPath==='INVOICE'` 면 `voidInvoicesForContract`
  + `revokeBillingAgreement` 호출. (머지 전 P1-2 로 wallet 쪽 재출금은 이미 봉합됐으나, 커맨드 발행이 정공.)

### P2-B. 명시 취소 → 인보이스 VOID 반영까지 최대 ~2h10m 간극 · CONFIRMED
- `apps/wallet/src/payment-intents/payment-intents.service.ts:33-41` → 반영은 `invoice-executor.service.ts`
  reconcile(`voidAfterExplicitCancel`)뿐. `ATTEMPTING_STALE_HOURS=2` + 10분 크론.
- 취소는 동기인데 인보이스 반영만 비동기 안전망에 위임 → 그동안 관리자 뷰 "집행 중", 자격 회수/표시 지연.
- 수정: cancel 경로에서 `intent.invoiceId` 있으면 `voidAfterExplicitCancel` 즉시 호출, reconcile 은 안전망 유지.

### P2-C. Server Action 에러가 prod 에서 마스킹돼 409 등이 영문 generic 토스트 · PLAUSIBLE
- `web/almondyoung-storefront/.../subscribe/payment/components.tsx:248-251` 외 신규 플로우 전반
- Next 15 prod 는 커스텀 에러 message 를 마스킹(digest 만 생존, 현재 UNAUTHORIZED 만 digest 설정).
  `ActiveSubscriptionExists` 등이 instanceof/message 판별에 의존 → 의미불명 영문 노출.
- 수정: server action 이 `{ok:false, code, message}` 판별 유니온을 반환하거나 HttpApiError 에
  `digest=HTTP_${status}:${message}` 를 실어 클라이언트에서 파싱. 최소 ActiveSubscriptionExists 는 i18n 안내.

### P2-D. 미수 지표 카드 딥링크가 인보이스 탭 내부에서 무동작 · CONFIRMED
- `apps/admin-web/.../recurring-billing/components/table/invoices-view.tsx:48-52`, `summary-cards/index.tsx:57-73`
- 상태 필터를 URL 에서 마운트 시 1회만 state 로 복사 → 이미 인보이스 탭에 있을 때 카드 클릭하면 URL 만 바뀌고
  목록 미갱신. 카드 숫자와 목록이 발산해 미수 건을 지나칠 수 있음.
- 수정: `status` 를 searchParams 에서 직접 파생하거나 `useEffect` 로 URL→state 동기화.

### P2-E. 회원상세 재시도/정합화 버튼이 billingPath 로 분기 안 됨 · CONFIRMED
- `apps/admin-web/.../members/components/detail-dialog/index.tsx:651-672`,
  `lib/api/domains/membership/index.ts:55-74`(`AdminMemberDetail` 에 billingPath 없음)
- INVOICE 계약에 "수동 재시도" 버튼 노출 → 409 를 맞아야만 아는 UX(이중청구는 서버가 차단하므로 안전).
- 수정: member detail 응답에 `billingPath` 추가, CHARGE→재시도·INVOICE→정합화만 표시(또는 비활성+툴팁).

---

## P3 — 정리 대상 (기회 될 때)

### wallet
- **rejectMandate 단건이 ATTEMPTING 을 전이 대상에 포함** — `invoice-outcome.service.ts:19-20,153-158`.
  레이스 시 돈 빠졌는데 거절 종결 가능. `lockNonTerminal` 집합에서 ATTEMPTING 제외
  (`rejectMandateForBillingMethod:177` 은 이미 제외). PLAUSIBLE.
- **revertToSchedulable 이 stale attempt_count 스냅샷으로 오라벨** — `invoice-executor.service.ts:622-628`.
  claim 시점 스냅샷으로 OPEN/PAST_DUE 판정 → PAST_DUE 를 OPEN 으로 오라벨해 미수 은닉 가능.
  `SET status = CASE WHEN attempt_count>0 THEN 'PAST_DUE' ELSE 'OPEN' END` 로 DB 현재값 기준. CONFIRMED.
- **/v1/me/invoices 가 API-key 폴백 인증 시 500** — `my-invoice.controller.ts:36,47`(`req.jwtUserId!`) +
  `wallet.module.ts:205-214`. IDOR 아님(유출 없음). `isApiKeyAuth && !jwtUserId` → 403. CONFIRMED.
- **mandate.rejected(무인보이스) dedupe 가 outbox 보존+seq scan 의존** — `invoice-command.consumer.ts:129-141`.
  추후 outbox purge 시 dedupe 무력화·성능 저하. expression index 또는 전용 멱등 마커 테이블. CONFIRMED.
- **PENDING_SETTLEMENT 무한 대기(정산 타임아웃 없음)** — `cms-settlement-poller.service.ts:98-108`,
  `invoice-executor.service.ts` reconcile default. MANDATE_PENDING 엔 7일 타임아웃 있으나 정산 대기엔 상한 없음.
  paymentDate+N영업일 초과 시 관리자 알림/강제 판정 훅. CONFIRMED.
- **DRAFT 는 죽은 enum 상태** — 항상 OPEN 생성. 표기용이면 무해, 아니면 제거 검토.
- **run-due 가 항상 "completed" 응답** — `recurring-billing-admin.controller.ts`, `invoice-executor.service.ts:83-97`.
  부분 실패 불가시 + 1클릭 20건(BATCH_LIMIT) 한도 미표기. `{claimed,succeeded,failed}` 반환 + UI 표시.

### membership
- **reconcile 의 PAST_DUE 분기가 isPastDue 배너를 안 세움** — `recurring-billing.service.ts:190-193` vs
  `invoice-outcome.handler.ts:127-132`. 이벤트 유실 + reconcile 로 PAST_DUE 확인 시 연체 배너가 터미널까지 안 뜸.
  `handlePaymentFailed` 위임으로 통일(멱등 마커가 중복 흡수). CONFIRMED.
- **자격 선연장 스킵돼도 CreateInvoice 는 발행** — `invoice-billing.manager.ts:54-72,112-115`. grant 스킵
  (활성 자격 없음) 시 발행도 중단하고 실패 결과 반환. CONFIRMED(발생 빈도 낮음).
- **outcome 핸들러 billingPath 가드 비대칭** — `invoice-outcome.handler.ts:36-39`(handlePaid 만 검사). 현재 무해
  (발행측이 인보이스 기반), 향후 방어선. failed/uncollectible/voided/mandateRejected 에도 warn+skip 추가.
- **신규 코드가 DbService.run 대신 db.transaction 직접 호출** — `invoice-billing.manager.ts:103`,
  `invoice-outcome.handler.ts:33,118,172`. 전부 root-of-transaction 이라 실해 없음(ADR-0025 §Follow-ups).
- **UTC/로컬 날짜 혼용** — `entitlement.manager.ts:44-45`(toISOString) vs `invoice-billing.manager.ts:52,120`(format).
  서버 TZ 가 UTC 아니면 자정 부근 하루 오차. 기존 패턴 답습.

### storefront / wallet-web
- **신규 선적용 카피 4곳 한국어 하드코딩** — `subscribe/payment/components.tsx:458,589,611,766`. ja/en 파리티 위반
  (같은 PR 의 invoices 섹션은 3로케일 완비). mypage 네임스페이스 키로 이동 후 ko/en/ja 추가.
- **getMyInvoices 가 에러를 [] 로 삼킴** — `lib/api/wallet/index.ts:204-217`. 장애 시 미납 섹션이 조용히 소실.
  에러 시 null 반환해 "불러오기 실패" 상태로 구분(빈 배열=숨김 유지). CONFIRMED.
- **"은행 확인 중" 배너가 임의 PENDING 계좌에도 발화** — `member-details.tsx:38-47,109-113`. 기결제 구독자가
  예비 계좌 등록 시 "첫 결제가 출금됩니다" 오표기. agreement 의 billingMethodId 와 매칭된 PENDING 만 배너. CONFIRMED.
- **셀프해지 후 갱신 재개 경로 전무 + 해지 버튼 잔존** — `subscriber-section.tsx:166-195`,
  `subscription.service.ts:423-424`. un-cancel 미구현. 단기: autoRenewal===false 면 해지 버튼 숨기고
  "재개는 만료 후 재가입/고객센터" 안내. 장기: 재개 엔드포인트 + CTA. CONFIRMED.
- **강등(심사거절/미수) 고객이 홈에서 사유를 못 봄** — `non-subscriber/index.tsx`. 사유+재등록 CTA 는 결제수단
  페이지에만. non-subscriber 뷰에 회수 사유+재등록 배너. PLAUSIBLE.
- **복귀 자동가입 otherMethods[0] 임의 폴백 잔존** — `payment-method/page.tsx:334-335`. 우선순위 뒤로만 밀림.
  `registeredMethodId ?? pendingCandidate` 없으면 자동가입 포기하고 수동 선택 UI 로. 폴백 삭제.
- **onboardHmsBnpl 검증 실패 메시지 한국어 하드코딩** — `lib/api/wallet/index.ts:375-380`(deprecated 위저드).

### admin
- **DLQ 재구동·직접등록 UI 미배선(curl 전용)** — 백엔드 존재(`admin-operations.controller.ts:1010-1036, 665-677`),
  UI grep 0건. DLQ 재구동은 최소 정기결제 관리 화면에 버튼+결과(succeeded/failed) 표시.
- **인보이스 탭 사유에 Q코드 매핑 미적용** — `invoices-view.tsx:250-258`(raw). members 뷰/상세엔 적용됨.
  `cmsFailureReason()` 를 invoices-view 사유 셀에도.
- **단건 집행 409 메시지 영문 원문 + 문자열 매칭 취약** — `recurring-billing-admin.controller.ts:47-56`.
  전용 예외 클래스(ConflictError)로 상태 타입 결정 + 한국어 메시지.
- **wallet 관리자 mutation 서버측 멱등 저장 부재** — membership 은 `@IdempotentAdminOp` 완비, wallet execute/
  run-due 는 미적용. 자연 멱등(DB 계층)이라 이중출금은 없으나 재시도 시 409 오인 가능. 서버측 멱등 replay 권장.
- **발산(자격≠결제) 확인에 2화면 조합 필요** — 인보이스 row 에 membership 계약 상태 join 표시
  (`getRecurringContractsByIds` 재활용).
- **DLQ reprocess topic 자유입력** — `admin-operations.controller.ts:reprocessDlq`. RBAC 는 클래스
  `@MembershipAdminAuth`(admin/master)로 걸려 있음(확인됨). 남은 건 `topic` allowlist(payments.events.v1,
  wallet.commands.v1) 하드닝뿐.

### 이벤트 / 인프라
- **DLQ 재발행이 원본 파티션 키를 잃음** — `dlq-handler.service.ts:171`. 순서 역전 가능(멱등 마커로 완화).
  DLQMessage 에 원본 kafka key 보존.
- **reprocess-count 헤더를 아무도 안 읽어 포이즌 메시지 비수렴** — `dlq-handler.service.ts:177`. 재발행 시
  count 계승 + 상한 초과 시 `resolveDLQ`(park).
- **validateOnConsume 전 서비스 OFF** — `app.module.ts:99`, `wallet.module.ts:384`, notification, channel-adapter.
  invoice.* 스키마의 런타임 집행 지점은 membership→wallet 발행 검증 한 곳뿐. 계약 실효성 한계(버그 아님).
- **gateway.charge/refund.* 소비되는데 계약 미선언** — `payment-events.consumer.ts:120+`,
  `membership-refund.consumer.ts:26`. payment.intent.* 와 동일 관대 스키마로 5종 선언.
- **correlationId 홉마다 재발급** — `wallet-command.publisher.ts:26-30`, `invoice-command.consumer.ts:36`,
  `outbox-dispatcher.service.ts:160`. 자연키 체인으로 추적 가능(실영향 낮음). 커맨드→결과 correlation 전파.
- **라이브 allowlist 에 http://localhost:8001 무분기 포함** — `services.ts` WALLET_ALLOWED_RETURN_ORIGINS.
  `isDev ? ['http://localhost:8001'] : []`.
- **invoice.paid 재발행 intentId '' 가 소비측 ?? undefined 통과** — `invoice-outcome.service.ts:307`,
  `invoice-result.consumer.ts:61`. `|| undefined`(falsy) 로 처리.

---

## 아키텍처 부채 (Phase 3+ 로 예정된 것)

- **CHARGE/INVOICE 이중 스택 near-중복** — wallet `billing-charge.consumer.handleAuthorizeResult` ≈
  `invoice-executor` 동명 메서드, 정산 폴러의 `invoiceId ?` 분기 봉합선, membership 의 manager/outcome-handler/
  consumer 3쌍. 플래그 전환 안정화 후 CHARGE 스택(BillingCharge 커맨드·billing-charge.consumer·
  billing-result.consumer·dunning queue) 통째 제거가 수렴 경로(레거시 CHARGE = maxAttempts=1 인보이스로 표현 가능).
- **레거시 payment.intent.* subscriberRef 라우팅 확장** — cancel.service/expiration.job 에 subscriberExtra 추가.
  듀얼패스 브리지로는 타당하나 CHARGE 경로와 함께 소멸시킬 부채.
- **subscription_billing_methods 는 shadow(미배선)** — Phase 4(백업 결제수단) 과제. ADR §3-3 정정과 일치.

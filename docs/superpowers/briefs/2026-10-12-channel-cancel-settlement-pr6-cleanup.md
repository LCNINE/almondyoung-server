# 새 세션 지시문 — 채널 취소 정산 재설계 PR 6 (정리) 계획·구현

## 너의 임무

승인된 스펙 `docs/superpowers/specs/2026-10-11-channel-cancel-settlement-design.md` 의 **PR 6 «정리»**(§9.2 의 6) 구현 계획을 쓰고,
사용자가 실행 방식을 고르면 구현한다. `superpowers:writing-plans` 로 시작한다. 사용자는 한국어로 응답받기를 원한다.

**스펙의 결정(S1~S11)을 다시 묻지 마라** — 2026-10-11 사용자가 승인했다. 계획 중 스펙과 코드가 어긋나면 스펙을 정본으로 판정하고 기록한다.
단 아래 «먼저 판정할 것»은 스펙이 말하지 않았거나, 앞 PR 이 스펙과 다르게 정해 넘긴 자리다 — 계획 머리에서 판정하고 근거·비용을 적는다.

**이 문서들은 develop 에 없다.** 스펙·계획·지시문은 브랜치 `docs/1016-36-channel-cancel-settlement` 에 있다(워크트리
`.claude/worktrees/docs-1016-36-settlement`, origin 보다 앞선 커밋은 push 안 됨). 읽기는 그 워크트리에서, 이 PR 의 계획도 그 브랜치에 커밋한다.

**PR 6 은 «한 PR»이 아닐 수 있다.** 여러 앱(core·channel-adapter·Medusa·스토어프론트·wallet·admin-web·계약)에 걸치고, 일부는 **배포 순서**가 묶여 있고
일부는 **라이브 조건**(옛 행 0)을 기다린다. 판정 1(어떻게 나누나)부터 한다. 사용자는 PR 5 때 «나누지 않는 게 좋겠다»고 했다 — 이번에 나눠야 한다면
그 이유는 «배포 순서·라이브 조건» 같은 강제여야 하고, 계획 머리에 그대로 적는다.

## 먼저 읽을 것

1. `CLAUDE.md`(특히 Destructive changes — **contract phase 는 `deploy → migrate` 순서·expand 와 반대**, 크론, 이벤트), `apps/channel-adapter/CLAUDE.md`, `apps/medusa` 규칙(확장점은 문서에서 —
   `https://docs.medusajs.com/llms.txt`), 스토어프론트 `web/almondyoung-storefront/CLAUDE.md`(i18n 세 언어 규칙 등)
2. 스펙 **§6.6**(미들웨어), **§7.1**(옛 사실·`REFUND_FAILED` 정리), **§7.2**(ack), **§7.3** 리컨실러 규칙, **§8.2**(다시 읽기 삭제), §9.2·§9.3, §10 해당 테스트
3. **앞 PR 들이 넘긴 것 — 이 PR 의 범위다** (각 계획의 «PR 6 에 넘길 것» 절):
   - PR 5 계획 `plans/2026-10-12-channel-cancel-settlement-pr5-core-admin.md` «PR 6 에 넘길 것» 6개 + **PR #1052 본문**(«스펙과 다른 점» D1~D13, «PR 6 에 넘길 것», «배포» 6·7단계)
   - PR 3 계획 `…-pr3-adapter.md` «PR 6 에 넘길 것» 3개 + 판정 1·2(옛 사실 병행·일시 실패 던짐의 근거)
   - PR 4 계획 `…-pr4-storefront.md` «PR 6 에 넘길 것»(다시 읽기 삭제 때 함께 지울 것 목록)
   - PR 2 계획 `…-pr2-medusa.md` 끝 «범위 밖»(미들웨어가 닫는 경합)
4. 메모리 `channel-cancel-settlement-redesign.md`, `reconciler-row12-design.md`(관찰→실행 전환 관례, 🔴EXPLAIN 5초 게이트), `event-contract-runtime-validation.md`(enum·타입 제거 순서),
   `sst-single-stack-no-deploy-order.md`, `deploy-ships-other-merged-prs-migrations.md`, `medusa-route-override-is-per-method.md`, `framework-extension-points-need-docs.md`,
   `cloudwatch-logs-query-traps.md`·`grafana-cloud-query-access.md`(관찰 로그 조회), `subagent-worktree-contamination.md`, `admin-web-no-component-tests.md`

## 지금 상태 (2026-10-12)

- PR 0 #1047 · PR 1 #1048 · PR 2 #1049 · PR 3 #1050 · PR 4 #1051 · **PR 5 #1052 MERGED·라이브**(develop `a92310a24`, 10-12 사용자 배포)
- 라이브 core 는 새 흐름: 채널 취소는 요청 순간 확정(`settling`), 정산 실패는 `metadata.settlement`(`in_progress`·`refused`, `delayed` 는 확정 + 30분 계산), 운영자 [다시 시도]·[계좌 송금으로 환불],
  리컨실러 `retry-channel-settlement`(#36) 는 **관찰 모드**(`rules/retry-channel-settlement.rule.ts:18` `mode = 'observe'`)
- 라이브 channel-adapter(PR 3): `SettlementFailed` 와 **옛 사실(`Rejected`·`Stalled`)을 같은 트랜잭션에 병행**, 일시 실패는 사실을 낸 뒤 **던진다**(Kafka 3회·1/2/4초 → DLQ)
- 🔴 **PR 5 의 확인 안 된 것 — 사용자에게 먼저 묻는다:** 로컬 스모크 S1~S4 **미실행**, 배포 뒤 점검 SQL(PR #1052 «배포» 6단계 — 롤링 중 `settling` 에 갇힌 행)·관찰 로그(7단계) 결과 미확인.
  옛 `requested` 행 수(1단계)도 사용자 실측값을 받는다. 이 셋이 판정 1·2·3 의 입력이다
- 사용자 결정: 기존 결제·환불 건은 이미 처리된 것으로 간주 — 소급 환급·대조를 제안하지 말 것

## PR 6 범위 (넘겨받은 것 전부 — 묶음은 판정 1 이 정한다)

| 묶음(후보) | 앱 | 내용 | 조건 |
| --- | --- | --- | --- |
| A 실행 전환 | core + channel-adapter | 리컨실러 `retry-channel-settlement` 를 `act` 로 · adapter `fail()` 의 일시 실패 `throw` 삭제(ack, `channel-order-cancel.manager.ts:164-167`) — **같은 배포** · 백오프 재판정(PR 5 판정 3·D3) · Medusa 가 이미 정산한 `settling` 행의 탈출구 | 관찰 로그로 거짓 양성 확인 뒤 |
| B 미들웨어 | Medusa | §6.6 — 기본 `POST /admin/orders/:id/cancel`(캡처 − 환불 > 0 이면 400), `POST /admin/payments/:id/refund`(취소된 주문이면 400). `apps/medusa/src/api/middlewares.ts` | PR 3 라이브 — 충족 |
| C 스토어프론트 | 스토어프론트 | 다시 읽기(`src/lib/orders/cancel-outcome.ts`·`waitForCancelOutcome`) 삭제 + PR 4 목록(`cancelOutcomeOf`·`CancelOutcome`·`rejected` 갈래·i18n `cancelRequested`·`cancelRejected`·`cancelStillProcessing` 세 언어·`order-actions.tsx` 하드코딩 토스트) · Medusa 직접 읽기 넷(PR 5 판정 6: 상세 «결제 상태» 줄 `order-details-{desktop,mobile}.tsx`, «구매확정» 버튼 조건 `order-actions.tsx`, 마이페이지 홈 카드 필터 `shipping-status-wrapper.tsx`, `showTrack`) | 옛 `requested` 행 0 이면 `rejected` 갈래까지, 아니면 판정 |
| D 송금 대기 | wallet + admin-web | 관리자 환불 «목록»의 `manualConfirmable`(`apps/wallet/src/admin/payment-intent-admin.service.ts:385` 가 `false` 고정 — `execution = MANUAL` 행은 조인 없이 판정 가능) → «환불 내역» 목록에 [완료 처리] · 결제 상세 사이드바 토스트(`payment-detail-sidebar.tsx:160`, 없는 버튼을 가리킴) · admin-web `RefundDto`(`src/lib/types/dto/wallet.ts:89`)에 `failureCode`·`retryable` · PR 5 확인 창 문구(D7)가 가리키는 화면 이름 정정 | 없음 |
| E 옛 흐름 걷기 | channel-adapter → core → 계약 | adapter 옛 사실 생산(`legacy`·`LegacyCancelFact`, `rejected()`·`stalled()`) 중단 → core `resend`·`withdraw`·보류 관문(`fulfillment/hold/cancel-request-hold.ts`)·settler 옛 `requested` 분기·`reject`·`markStalled`·`handleChannelOrderCancelRejected`/`…Stalled`·보드 옛 상태(`cancel_requested`·`cancel_edited`)와 버튼·admin-web 옛 버튼 → 계약(`packages/event-contracts/streams/orders.stream.ts` 의 `REFUND_FAILED`·`ChannelOrderCancelRejected`·`ChannelOrderCancelStalled`) | 🔴 **라이브 옛 `requested` 행 0** + **생산자 먼저 멈춤** |

범위 밖: PR 2 D8(장부 없는 자동 PENDING → 일시 실패 반복)·T5-5(부분취소 `edited` 재시도의 외부 환불 재검사 없음)·PR 1 `PROVIDER_EXCEPTION` 이중 송금, 공휴일 영업일,
`SettlementFailed` 금액 칸, admin-web 주문 내역이 «최악»이 아니라 «최근» 요청을 보이는 것 — 판정 중 A 와 얽히면(예: D8 이 실행 모드에서 무한 재시도) 그 얽힘만 다룬다.

## 먼저 판정할 것 (계획 머리에 판정·근거·비용을 적는다)

1. **어떻게 나누나.** 위 A~E 는 서로 독립인 것과 묶인 것이 섞여 있다.
   - **A 는 한 배포여야 한다**(PR 3 판정 2): ack 만 먼저면 일시 실패를 아무도 다시 부르지 않고, 실행만 먼저면 adapter 재시도와 리컨실러 재발행이 겹친다(멱등이라 돈은 안전 — 확인).
     core 와 channel-adapter 가 같은 SST 스택(`deployments/lcnine/services`)이면 «한 배포»는 자동이지만 롤링 순서는 없다(메모리 `sst-single-stack-no-deploy-order`)
   - **E 는 contract phase 다** — 생산자(adapter) 중단 배포 → 소비자(core) 제거 배포 → 계약 제거. 한 PR 에 묶으면 한 배포 안에서 옛 core 가 사실을 못 받는 창이 생기는지 따진다.
     옛 `requested` 행이 0 이 아니면 E 는 이 세션에서 계획만 하고 착수하지 않는다
   - B·C·D 는 서로·A 와 독립이다. 스토어프론트는 `--target Storefront` 단독 배포가 가능했다(PR 4)
2. **실행 모드로 바꿔도 되는가 — 관찰 결과로 판정.** 관례(12번)는 «관찰 로그에서 거짓 양성(정산이 끝났는데 `would_act`)이 없음을 보고 전환». 라이브 로그
   `retry-channel-settlement(#36, observe)` 의 `would_act`·`gated` 를 사용자에게 받거나 조회 명령을 준다(CloudWatch Insights `@timestamp` 는 UTC). 라이브 `settling` 건수가 너무 적어
   판단 근거가 없으면 그렇게 적고, 로컬 S4(실행 모드 — 일시 장애 뒤 스스로 회복)로 갈음할지 정한다
3. **Medusa 가 이미 정산한 `settling` 행의 탈출구.** PR #1052 본문: «Medusa 는 이미 정산함 — 재발급은 멱등 성공이라 사실을 내지 않는다 → 자동 탈출구 없음». 실행 모드에선
   리컨실러가 그 행에 명령을 계속 재발행한다(백오프 뒤 «자동 멈춤»). 🔴 그 주장을 코드로 확인한다: adapter 성공 경로는 `syncOrder(..., { force: true })` 로 재수집한다
   (`channel-order-cancel.manager.ts:51`) — `force` 재수집이 이미 취소된 주문에 `OrderCancelled` 를 다시 내는지, core 가 그걸로 `applied` 를 닫는지. 안 닫히면 고칠 자리
   (adapter 성공 사실 / core 가 재수집 스냅샷으로 닫기 / 리컨실러 검사가 Medusa 상태를 봄)를 정한다. **A 의 선행조건이다**
4. **백오프를 바꾸나.** PR 5 는 틀 그대로(1·4·16·64·256분, 5회 뒤 «자동 멈춤», 1024분 재확인 — `order-reconcile.state.ts:5-10`) 두고 «실행 전환 때 실측으로 다시 본다»고 넘겼다.
   스펙은 1·5·15분 → 이후 1시간, 포기 없음. 틀을 바꾸면 라이브 12번(`act`)·25번(관찰)에 닿는다
5. **미들웨어(B)의 정확한 조건.** «캡처 − 환불 > 0»을 Medusa 에서 어떻게 읽나(결제 모듈 조회 — 문서의 미들웨어 확장점·`req.scope` 사용법 먼저), 우리 정산 라우트(`channel-cancel`·`partial-cancel`)가
   워크플로를 직접 불러 미들웨어를 안 지나가는지(스펙 §6.6), admin-web·스크립트·다른 앱이 기본 `/cancel`·`/payments/:id/refund` 를 HTTP 로 부르는 곳이 남았는지 grep.
   `medusa-route-override-is-per-method` 함정(메서드 단위) 확인
6. **스토어프론트 Medusa 직접 읽기 넷(C)을 무엇으로 바꾸나.** core actions 데이터(`orderStatus`·`refundStatus`)가 있으면 그걸 우선, 없으면(비채널 주문·actions 실패) 지금 동작 유지가
   기본안. «구매확정» 버튼은 사용자 확인으로 «중요하지 않다»(결제 확정은 체크아웃에서 끝남, 사실상 리뷰 자격 버튼) — 최소 변경으로
7. **E 의 core 쪽 제거 경계.** 옛 사실 핸들러를 지울 때 `ChannelOrderSettlementFailed` 의 «옛 `requested` 행에 오면 로그만»(PR 5 D12)도 함께 정리되는지, `uq_sales_order_amendments_open_cancel_request`
   (`WHERE status='requested'`)·`requested` 상태값·`findOpen` 을 남길지(값 제거는 check 제약 축소 = destructive → 별도 phase). 데이터에 `requested`·`rejected` 행이 역사로 남는 것은 그대로 둔다

## 테스트·게이트

- 루트 `npm run type-check` 0 · `npx jest` 0 · `npm run audit:event-handlers` · `npm run audit:event-publishers` · `npm run audit:consume-validation -- --gate`(E 가 들어가면 핸들러·발행자 수가 줄어든다 — 기준선을 계획에 적는다)
- admin-web 이 바뀌면 `cd apps/admin-web && npx tsc --noEmit` 0(CI 가 안 돈다). 순수함수(`*.shape.ts`) + 스펙으로 판정
- Medusa 가 바뀌면 `apps/medusa` 유닛 + `scripts/local/run-medusa-integration.sh`(postgres·redis 둘 다) — 미들웨어: 결제 있는 주문의 기본 `/cancel` 400, 취소된 주문의 기본 환불 400, 정산 라우트 통과(스펙 §10)
- 스토어프론트가 바뀌면 `web/almondyoung-storefront` vitest·tsc — 🔴 기준선이 0 이 아니다(vitest 2 실패 `locale-parity`·tsc 46, PR 4 실측 — 다시 잰다). 루트 게이트·CI 밖
- core 통합(`describeIfDb`, `npm run test:core:integration:local`, 워크트리에선 `COMPOSE_PROJECT_NAME` 필수) — 🔴 공식 러너가 공유 postgres 컨테이너를 재생성한 적이 있다(PR 5, 볼륨 무사). 임시 DB 로 돌린다
- 리컨실러 후보 SQL 이 바뀌면 배포 전 라이브 EXPLAIN 5초 게이트
- 로컬 스모크: PR 5 의 S1~S4 가 미실행이다 — A 가 들어가면 **실행 모드 S4**(일시 장애 → 리컨실러가 스스로 정산 완료)를 포함해 사용자와 함께 돈다(`bootstrap:e2e:local` → `start:all:local` → `preflight:e2e:local`,
  브라우저 로그인은 사람, 스토어프론트는 메인 체크아웃에서)

## 배포

- A·B·C·D 는 마이그레이션이 없을 것으로 보인다(계획에서 확인). E 에 check 제약 축소가 들어가면 **contract phase — `deploy → migrate`**, 그리고 별도 PR·별도 배포
- 배포 전 대기 마이그레이션 대조(남이 머지한 마이그도 함께 실린다 — 10-10 사고), `npm ci` 세 트리(스토어프론트 `yarn.lock` 은 되돌린다), 떠 있는 `next dev` 끄기
- A 배포 뒤 관찰: Core 로그의 `retry-channel-settlement(#36, act)` 실행·결과, adapter 일시 실패가 더는 DLQ 로 안 가는지
- 머지는 사용자가 `! gh pr merge <번호> --squash`. 배포는 사용자가 `! cd deployments/lcnine/services && npx sst deploy --stage live`

## 지켜야 할 제약

- 서브에이전트는 반드시 워크트리에서 — 메인 체크아웃 오염 재발 이력. 메인 `git status` 와 `git rev-parse develop origin/develop` 로 확인
- **워크트리 만든 직후 `node_modules` 심볼링크 넷**: 루트, `apps/admin-web`, `native/warehouse-app`, `web/almondyoung-storefront`
- Medusa 확장은 문서의 확장점으로(미들웨어 = 권장 순서 3번째). 코어 라우트 override·모듈 서비스 교체 결론은 오답 신호
- 계약 제거는 «생산자 중단 → 소비자 제거 → 계약 제거» 순서. 한 배포에 두 phase 를 묶지 않는다
- CLAUDE.md 트랜잭션 규칙(`dbService.run`, `tx?: DbTx` 전파)·Inventory Query Rules, 크론은 `@CronOnce`
- 스토어프론트 새 문자열은 i18n 세 언어, `"use server"` 파일엔 타입만 export, `Object.hasOwn` 대신 `Object.prototype.hasOwnProperty.call`
- `gh pr merge` 는 권한 분류기가 막는다 — 머지는 사용자. push·PR 생성은 된다
- #1016 본문·코멘트는 사용자 확인 없이 고치지 않는다

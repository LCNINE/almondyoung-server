# 새 세션 지시문 — 채널 취소 정산 재설계 PR 4 (스토어프론트) 계획·구현

## 너의 임무

승인된 스펙 `docs/superpowers/specs/2026-10-11-channel-cancel-settlement-design.md` 의 **PR 4(스토어프론트)** 구현 계획을 쓰고,
사용자가 실행 방식을 고르면 구현한다. `superpowers:writing-plans` 로 시작한다. 사용자는 한국어로 응답받기를 원한다.

**스펙의 결정(S1~S11)을 다시 묻지 마라** — 2026-10-11 사용자가 승인했다. 계획 중 스펙과 코드가 어긋나면 스펙을 정본으로 판정하고 기록한다.
단 아래 «먼저 판정할 것»은 스펙이 말하지 않은 **이행 기간의 문제**다 — 계획에서 판정하고 근거·비용을 적는다.

**이 문서들은 develop 에 없다.** 스펙·계획·지시문은 브랜치 `docs/1016-36-channel-cancel-settlement` 에 있다(워크트리
`.claude/worktrees/docs-1016-36-settlement`, origin 에 push 안 됨). 읽기는 그 워크트리에서, 이 PR 의 계획도 그 브랜치에 커밋한다.

## 먼저 읽을 것

1. `CLAUDE.md`, `web/almondyoung-storefront/CLAUDE.md`·`DESIGN.md`(UI 를 건드리면 필독)
2. 스펙 **§8.2**(스토어프론트 — 이 PR 의 본문), §5.2(상태별 고객 화면 — «고객에게는 지연과 거절을 구분하지 않는다»), **§9.2 의 4·§9.3 넷째 줄**(이 PR 이 왜 core 보다 먼저인가),
   §7.3(PR 5 core 가 무엇을 낼지)
3. PR 3 계획 `docs/superpowers/plans/2026-10-12-channel-cancel-settlement-pr3-adapter.md` 의 «PR 5 에 넘길 것» — PR 5 가 actions API 를 어떻게 바꿀지 짐작할 근거
4. 메모리 `channel-cancel-settlement-redesign.md`, `medusa-storefront-gate-topology.md`(🔴 `web/**` 은 루트 게이트·CI 밖), `ui-minimal-text.md`,
   `channel-order-cancel-35.md`(35번 §7.5 다시 읽기의 유래), `subagent-worktree-contamination.md`, `sst-single-stack-no-deploy-order.md`, `shop-listings-ugc-pr1.md`(배포 빌드가 로컬 node_modules 를 쓴다)
5. 전례: `docs/superpowers/plans/2026-10-12-channel-cancel-settlement-pr3-adapter.md`(판정 절·Global Constraints·Review Focus·실행 준비의 관례)

## 지금 상태 (2026-10-12)

- PR 0 #1047 · PR 1 #1048 · PR 2 #1049 **MERGED·라이브.** PR 3 #1050 **MERGED**(develop `070c2a535`) — **배포 여부는 이 세션 시작 때 확인할 것**(사용자에게 묻거나 ECS task def 로)
- 라이브 core 는 옛 것이다(PR 5 전): 새 값(`delayed`·`transfer_pending`)을 **아직 아무도 내지 않는다** — 이 PR 은 «혼자 나가도 휴면»이어야 한다
- 사용자 결정: 기존 결제·환불 건은 이미 처리된 것으로 간주 — 소급 환급·대조를 제안하지 말 것
- 남은 PR: 5(core+admin-web) · 6(정리) — 이 세션 범위 밖

## PR 4 범위 (스펙 §8.2·§9.2 의 4)

| 변경 | 요지 |
| --- | --- |
| 환불 배지 값 둘 | `delayed` «환불이 늦어지고 있어요 · 영업일 3일 안에 처리해 드릴게요», `transfer_pending` «환불 진행 중 · 계좌로 송금해 드릴 예정이에요»(스펙 §8.2 표 문구 그대로) |
| 모르는 값 대비 | **모르는 `refundStatus` 는 «환불 처리 중»(`pending`)으로 보인다** — 다음에 core 가 값을 또 늘려도 화면이 깨지지 않게 |
| 판정은 순수함수 | 스펙 §10 «admin-web·스토어프론트 — 상태 라벨·배지 순수함수». 배지·i18n 키를 고르는 일을 `src/lib/orders/` 의 순수함수로 빼고 vitest 로 지킨다(`cancel-outcome.ts`·`.test.ts` 가 그 모양) |
| 범위 밖 | 2초×30초 다시 읽기(`cancel-outcome.ts`) **삭제는 PR 6**(스펙 §8.2). core·admin-web 은 PR 5 |

### 코드 지도 (develop `070c2a535` 기준 — 계획에서 다시 확인할 것)

- 타입: `web/almondyoung-storefront/src/lib/api/orders/store-orders.ts:51` `StoreRefundStatus` = `none|pending|manual_pending|succeeded|failed`, `:74` `RefundSummary.status`,
  `:88` `StoreOrderActionsResponse.refundStatus`, `:93` `cancelRequestStatus?: 'requested' | 'rejected'`
- 배지 맵: `src/components/orders/order-status-badges.tsx:62` `REFUND_STATUS_MAP: Record<StoreRefundStatus, …>` → `:157` `REFUND_STATUS_MAP[actions.refundStatus]`
  (모르는 값이면 `undefined` 라 배지가 **조용히 사라진다**)
- 주문 상세: `src/domains/order/details/components/order-details-{desktop,mobile}.tsx` — `refundSummary?.status ?? coreActions?.refundStatus ?? 'none'` 을
  `tRefundInfo(\`statusLabels.${refundStatus}\`)`·`guidance.${…}` 로 그대로 넣는다 (**모르는 값이면 next-intl 이 키 문자열 `mypage.refundInfo.statusLabels.delayed` 를 그대로 화면에 낸다**
  — `src/i18n/request.ts` 에 `getMessageFallback`·`onError` 없음, 실측해 확인할 것). 색은 `=== 'succeeded' ? … : === 'pending' ? …` 삼항 사슬
- 문구: `src/i18n/messages/{ko,en,ja}/mypage.json` 의 `refundInfo.statusLabels`·`refundInfo.guidance` — **세 언어 다** 키가 있어야 한다
- 취소 직후 다시 읽기: `src/lib/orders/cancel-outcome.ts`(`cancelOutcomeOf`·`waitForCancelOutcome`), 호출자 셋 — `components/orders/order-card/order-actions.tsx:171`, `order-details-{desktop,mobile}.tsx`
- core 쪽 생산자(참고만 — PR 5 가 바꾼다): `apps/core/src/modules/sales-order/services/store-sales-orders.service.ts` `buildActionsView`(:545~) — `cancelRequestStatus` 는
  `requested`·`rejected` 행만 싣고 그 밖은 `undefined`. core DTO `apps/core/src/modules/sales-order/dto/store-order-actions.dto.ts:13` 의 `StoreRefundStatus` 는 **스토어프론트와 별도 복사본**이다

## 먼저 판정할 것 (계획 머리에 판정·근거·비용을 적는다)

1. **모르는 값을 어디서 접나.** 후보: API 경계(`store-orders.ts` 의 응답을 받는 곳)에서 한 번 정규화 vs 표시 순수함수에서. 경계에서 접으면 세 화면(배지·상세 둘)이 한 번에
   고쳐지지만 `refundSummary.status` 와 `actions.refundStatus` 두 경로를 다 지나야 한다(상세는 둘 중 하나를 고른다). 타입을 `StoreRefundStatus | (string & {})` 처럼 열지,
   닫힌 유니온 + 정규화로 둘지도 정한다 — 닫힌 `Record<StoreRefundStatus, …>` 가 «새 값 누락 = 컴파일 에러»를 주는 성질은 지킬 것
2. **🔴 `cancelRequestStatus` 와 취소 직후 안내 — 새 core 와 옛 스토어프론트의 조합.** 스펙은 배지 값만 적었다. 그런데 PR 5 의 core 는 취소를 **동기로 확정**한다(§7.3 확정 트랜잭션):
   - 전체취소: 판매주문이 그 자리에서 `cancelled` → `cancelOutcomeOf` 가 즉시 `cancelled` → «주문이 취소되었습니다» — 옛 스토어프론트도 맞다
   - **부분취소:** 판매주문은 취소되지 않고 요청 행은 `settling` 이다. 지금 core 는 `requested`·`rejected` 만 `cancelRequestStatus` 에 실으므로 PR 5 가 아무것도 안 바꾸면 `undefined` →
     `pending` → 30초 다시 읽기 → «취소 처리 중입니다. 잠시 뒤 주문 상세에서 확인해 주세요» — 이미 확정된 취소를 «처리 중»이라 말한다(§8.2 «취소 응답이 곧 취소 완료» 위반)
   - 그리고 PR 5 가 `settling` 같은 새 값을 실으면 옛 스토어프론트의 타입 밖 값이 된다(지금 코드는 `=== 'rejected'` 만 보므로 깨지진 않고 `pending` 으로 떨어진다)
   - 판정할 것: 이 PR 이 «부분취소 확정»을 읽을 신호를 미리 정하고 받을 준비를 할지(예: `cancelRequestStatus: 'settling'` → `cancelled` 쪽 결과로, 안내 문구는 «취소되었어요 · 환불은 진행 중»),
     아니면 PR 5 가 기존 신호만으로 맞추게 넘길지. **정하면 PR 5 의 계약이 된다** — 계획의 «PR 5 에 넘길 것»에 정확한 값·의미를 적는다. 스토어프론트에서 고객이 부분취소를 실제로
     할 수 있는지(취소 대화상자가 품목을 고르는지)부터 확인하면 판정이 쉬워진다
3. **`failed`·`manual_pending` 의 운명.** 스펙 §8.2 표엔 이 둘이 없다. 이 둘은 **core 직접 주문**의 환불 배지(스펙 §2.4 `retry-refund`·`manual-refund-complete`)라 그대로 둔다 —
   지우지 말 것. 다만 같은 «고객은 지연·거절을 구분하지 않는다»(§5.2) 원칙이 core 직접 주문의 `failed`(«환불 확인 필요»)와 어긋나는지 한 줄로 기록만 하고 고치지는 않는다(범위 밖)
4. **배지 색·문구 길이.** 상세 화면 배지에 §8.2 의 문구 전체를 넣으면 길다. 배지 라벨(짧게)과 안내(`guidance`, 긴 문장)를 나눌지 정한다 — `ui-minimal-text` 메모리(필요한 것만, 정상 상태는 숨김)와
   DESIGN.md 를 따른다. `delayed` 를 빨강(실패)으로 칠하지 말 것 — 고객에게 «거절»로 읽힌다(§8.2 마지막 줄의 이유와 같다)

## 테스트·게이트 (🔴 `web/**` 은 루트 게이트와 CI 밖이다)

- 루트 `npm run type-check`·`npx jest` 는 스토어프론트를 **한 줄도 안 본다**(`tsconfig.json:exclude` 에 `web`). CI 워크플로도 `web/**` 을 덮지 않는다 — **로컬 실행이 유일한 방어선**
- 스토어프론트 게이트: `cd web/almondyoung-storefront && npx vitest run` 과 `npx tsc --noEmit`. tsc 는 **선재 에러가 있다**(2026-08-30 실측 49건 — 낡았으니 develop 에서 다시 재서 기준선을 계획에 적는다).
  개수만 세지 말고 **건드린 파일의 에러가 0인지** grep 한다
- 순수함수 테스트: 알려진 값 다섯 + 새 값 둘 + 모르는 값(`'something_new'`, `''`, `undefined`) → `pending` 쪽, 세 언어 i18n 키가 새 값마다 있는지(JSON 을 읽는 테스트)
- 판정 2 를 택하면 `cancelOutcomeOf` 의 새 값 테스트를 `cancel-outcome.test.ts` 에 더한다
- 루트 게이트도 돌린다(스토어프론트만 바꾸면 영향 없음을 확인하는 용도)
- 브라우저 확인은 사람 몫이다 — 워크트리의 `node_modules` 심볼링크를 Turbopack 이 거부한다(메모리 `channel-cancel-refund-refusal-36`). 화면을 보려면 메인 체크아웃에서 띄운다.
  core 가 새 값을 아직 안 내므로, 확인하려면 순수함수 테스트로 갈음하거나 로컬 core 응답을 손으로 바꿔야 한다 — 계획에서 방법을 정한다

## 배포

- 스토어프론트는 `lcnine-services` 스택의 `sst.aws.Nextjs('Storefront')` — core 와 **같은 스택**이다. SST 한 스택엔 배포 순서가 없다(메모리 `sst-single-stack-no-deploy-order`) →
  «PR 4 가 PR 5 보다 먼저»는 **PR 4 머지 → 배포 → 그 뒤에 PR 5 머지**로만 지켜진다. PR 본문에 적는다
- 배포 빌드는 로컬 `node_modules` 를 쓴다 — 배포 전 `npm ci --prefix web/almondyoung-storefront`(메모리 `shop-listings-ugc-pr1`)
- 마이그레이션 없음. 배포 전 develop 의 대기 마이그레이션 대조는 평소대로(`deploy-ships-other-merged-prs-migrations`) — 같은 배포에 PR 3 이 아직 안 실렸으면 함께 실린다

## 지켜야 할 제약

- 서브에이전트는 반드시 워크트리에서 — 메인 체크아웃 오염 6회 재발. 메인 `git status` 로 확인
- **워크트리 만든 직후 `node_modules` 심볼링크**: 루트, `apps/admin-web`, `native/warehouse-app`, **`web/almondyoung-storefront`**(이 PR 의 vitest·tsc 가 쓴다)
- **`gh pr merge` 는 권한 분류기가 막는다** — 머지는 사용자가 `! gh pr merge <번호> --squash`. push·PR 생성은 된다
- core·admin-web·Medusa 는 바꾸지 않는다 — 바꿔야 한다는 결론이 나오면 멈추고 «PR 5 에 넘길 것»에 적는다
- #1016 본문·코멘트는 사용자 확인 없이 고치지 않는다

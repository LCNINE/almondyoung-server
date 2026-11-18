# 비상 출고 경로 — 앱 없이 송장을 뽑고 나간 상자를 발송 처리한다 (#1249)

상위: #1233(셀메이트 컷오버 1단계) · 런북: #1251 · 드레인 중 셀메이트 상자: #1412/#1428

## 왜

컷오버 뒤엔 셀메이트 폴백이 없다. 창고 앱(warehouse-app·스테이션) 출고 경로가 막힌 날에도 그날 물건은 나가야 한다.
#1233 의 결정: **비상시 출고는 Claude 의 도움으로 송장을 뽑아 내보낸다. 한진 API 장애는 자연재해로 받아들인다 — 대신
장애의 대가가 «늦게 보낸다»에서 끝나고 상태가 꼬이지 않게 한다.** 그 길이 당일 처음 쓰이면 느리고 틀리니 미리 만들고
리허설에서 한 번 돈다.

## 범위

- **대비하는 날:** 창고 앱의 출고 경로(배치 피킹·검수·송장 출력 중 어디든)가 막혔다. core·한진 API 는 살아 있다.
  앱이 아예 안 뜨는 날과 한 단계만 막힌 날을 같은 길로 처리한다(2026-11-18 결정 — 따로 만들면 덜 쓰는 쪽이 당일 처음 돈다).
- **안 하는 것:** 한진 API 장애 대비(자연재해 — 기다린다. 멈춘 송장은 #914·#1241 로 푼다), 한진 포털·수기 운송장 등록
  (`waybills/manual`) — #1249 본문의 «포털 출력 + 수기 등록»은 #1233 결정과 어긋난 초안이었고 이 문서가 대체한다.
  마켓 채널 반영(1단계에서 마켓 주문은 셀메이트가 낸다 — 2단계 #1306).
- **안티골:** 안 나간 상자가 «발송됨»이 되는 것(재고가 SHIP 으로 빠지고 고객에게 송장번호가 간다). 정식 경로와 원장·
  Medusa 결과가 달라지는 것. 셀메이트에 넘긴 주문의 상자를 앱 쪽이 내보내는 것(이중 출고).

## 접근

| 안 | 내용 | 판단 |
|---|---|---|
| **A. core HTTP API 를 운영자 토큰으로 부른다 (채택)** | 어드민 출고 준비 화면·창고 앱이 부르는 라우트를 스크립트가 그대로 부른다 | 권한 가드·멱등 키·작업자 기록·셀메이트 상자 거절(409)이 화면과 같다. 한진 키는 core 만 들고 있으니 송장 발급은 어차피 core 를 거쳐야 한다 |
| B. DB 에 직접 붙어 core 서비스를 조립(`move-stock-to-shelf` 꼴) | 터널 + 서비스 인스턴스 직접 생성 | 한진 게이트웨이·설정까지 스크립트가 조립해야 하고, 권한·작업자 기록을 우회한다. 정식 경로와 «같은 결과»를 보장하기 어렵다 |
| C. 한진 포털 + 수기 운송장 | 포털 엑셀 업로드로 번호 받고 사후 등록 | 한진 API 장애 대비용인데 그건 범위 밖(자연재해). 포털 계약·양식도 확인된 적 없다 |

## 결정된 것 (사용자, 2026-11-18)

1. 한진 API 는 살아 있다고 본다. 포털·수기 운송장 없음.
2. ① 스크립트가 배치 밖 상자를 **낱개 피킹(discrete) 배치로 묶고 시작한다.** dry-run 으로 대상을 먼저 보이고 `--apply` 에서 만든다.
3. 못 나간 상자는 **작업자가 목록 파일에서 그 줄을 지운다.** ② 는 남은 줄만 발송 처리하고, 끝에 «목록에서 빠진 상자»를 보여 준다.
   일부만 담긴 상자도 지운다(강제 발송은 상자 전체를 보낸 것으로 기록한다) — 다음 날 정식 경로로 간다.
   지운 상자의 송장은 남은 채 `registered` 로 둔다(다음 날 앱이 그 송장을 그대로 쓰거나 정식 경로에서 정리).
4. 실행은 **스크립트를 돌리는 운영자 본인 계정**으로 한다(작업자 기록이 그 사람으로 남는다). 강제 발송 사유는 «앱 출고 경로 장애 — 비상 출고»로 고정.
5. 라벨은 **ZPL 파일**로 뽑는다. 스테이션 PC 에서 `copy /b <파일>.zpl \\localhost\<공유 이름>` 한 줄로 찍는다.
   송장 프린터를 미리 Windows «공유»로 한 번 설정해 두고 리허설에서 찍어 본다.

## 지금 코드가 하는 것 (설계의 근거)

- 출고 준비 API(`apps/core/src/modules/fulfillment/outbound-preparation/`): `GET outbound-preparation`(목록 — 셀메이트 상자는 이미 뺀다, #1428),
  `POST outbound-preparation/plans`(계획 확정), `POST outbound-preparation/waybills`(한진 API 로 송장 일괄 발급),
  `POST outbound-preparation/batches/:batchId/shipments`(배치에 넣기). 배치 만들기 `POST outbound-batches/v2`(`pickingMethod`),
  시작 `POST picking/v2/starts` — 시작이 재고 위치 배정을 한다.
- 라벨: `GET shipments/:shipmentId/waybill/label`(렌더, #913 렌더러) · `POST shipments/:shipmentId/waybill/label-prints`(출력 확인 기록, `fingerprint`).
  보내는 분·출고지는 발급 때 상자의 배송 프로필에서 나와 `waybills.sender_snapshot` 에 남는다(#1366) — 스크립트가 따로 할 일 없음.
- 앱 없이 발송: `POST shipments/:id/location-outbound-forces`(`fulfillment.dispatch.force`) — **시작된 낱개 피킹 배치 안의 상자**를
  선반 위치에서 꺼낸 것으로 기록하고 강제 발송까지 한 번에 한다(`SimpleOutboundService.prepare` → `pickScanned` → `completeAndForceDispatch`).
  배치가 시작 전이면 `BATCH_NOT_STARTED`, 낱개 피킹이 아니면 `SIMPLE_OUTBOUND_METHOD_UNSUPPORTED`.
- 이미 피킹이 끝나 포장 중(`ready_to_pack`/`packing`)인 상자: `POST shipments/:id/force-dispatch`.
- 두 발송 모두 같은 발송 커널(`dispatchLocked` → `dispatch-effects.ts`)을 지난다 — 원장 SHIP·FOI 발송 수량·이벤트(ShipmentShipped 등)가
  정식 검수 발송과 같다. Medusa 반영은 그 이벤트의 하류다. 발송 전 `waybills.assertDispatchable` 이 활성 송장을 요구한다.

## 설계

### ① 아침 — `emergency-outbound prepare`

1. 인증(아래 «인증») → 창고 지정(`--warehouse`). 그 창고의 `supportedPickingStrategies` 에 낱개 피킹이 없으면
   (`OUTBOUND_BATCH_METHOD_NOT_SUPPORTED`, 피킹 방식 값 `individual`) dry-run 이 첫 줄에서 알리고 멈춘다 — 라이브 설정은 리허설 전에 이걸로 확인한다.
2. 대상 고르기 — 두 곳에서 읽는다(출고 준비 목록은 활성 작업 항목이 있는 상자를 아예 빼기 때문, `outbound-preparation-classify.ts:18`):
   - `GET outbound-preparation`(배치 밖 상자, 셀메이트 상자는 이미 빠짐): `ready` → 대상(`draft` 는 계획 확정부터, `resume`=`planned` 는 송장부터).
     `partial`·`unavailable`·`needs_info` → 빼고 사유 보고. `mergeable`(합칠 수 있는 상자) → **빼고 보고**(빌더 콜 아님 — 아래 «내 콜» 참고).
   - 배치·작업 항목 목록(`GET outbound-batches/v2` + 작업 항목): **시작된 낱개 배치** 안 피킹 전 상자 → 포함(② 에서 `location-outbound-forces`).
     어느 배치든 `ready_to_pack`/`packing` → 포함(② 에서 `force-dispatch`, 피킹 리스트엔 «이미 피킹됨»).
     다른 피킹 방식 배치에서 `queued`/`picking` → **빼고 보고**(`force-dispatch` 가 `SHIPMENT_NOT_INSPECTION_READY` 로 거절하고, 시작된 배치에서
     빼는 `withdrawing` 은 보관 처리가 얽혀 비상 경로에 넣지 않는다).
3. dry-run(기본): 위 분류표만 출력. 아무것도 안 바꾼다.
4. `--apply`, 어드민 출고 준비 화면과 같은 순서(`apps/admin-web/src/lib/services/orders/outbound-preparation-runner.ts`) + 시작:
   계획 확정 → **송장 일괄 발급** → 낱개 피킹 배치 생성 → 배치에 넣기 → 시작(위치 배정) → 라벨 렌더 → 출력 확인 기록.
   송장이 시작보다 먼저다 — 시작이 상자마다 `assertDispatchable` 을 본다(`picking/allocation/allocation.locks.ts:221`).
   라벨은 시작 뒤다 — 시작된 배치가 아니면 렌더되지 않는다(`waybill-label-content.assembler.ts:37`).
   출력 확인 기록은 빠뜨리면 안 된다 — 위치 피킹이 현재 라벨과 같은 출력 기록을 요구한다.
   **시작은 전부 아니면 전무다.** 막힌 상자(위치 재고 부족·송장 문제)가 나오면 그 상자들을 배치에서 빼고 다시 시작한다. 뺀 상자는 사유와 함께
   보고하고 다음 정식 경로로 간다(«일부만 낼 수 있으면 다음 날» 결정과 같은 규칙).
   멱등 키는 실행 id(`<날짜>-<시각>`) 기준으로 결정적(`emergency:<실행>:<단계>:<상자>`)이라 중간에 죽으면 `--resume <실행>` 으로 같은 키를 다시 쓴다.
   멱등 해시에 작업자 id 가 들어가므로(`fulfillment-command.service.ts:117`) **이어 돌리기는 같은 사람만** 된다 — 다른 사람이면 새 실행으로 시작한다.
5. 산출물(`.scratch/emergency-outbound/<실행>/` — 하루 두 번 돌리면 실행마다 따로 남는다):
   - `labels.zpl` — 모든 상자 라벨을 피킹 리스트 순서로 이어 붙인 한 파일,
   - `pick-list.html`(A4 인쇄용) — 상자마다 출고번호·받는 분(마스킹)·송장번호·SKU·수량·**선반 위치**,
   - `shipments.csv` — ② 의 입력. 한 줄 = 한 상자(상자 id·출고번호·송장번호·발송 방법). 작업자는 못 나간 줄을 지운다.

### ② 저녁 — `emergency-outbound dispatch <shipments.csv>`

1. 각 줄의 상자를 다시 읽어 상태 확인: 이미 발송됨 → 건너뜀(멱등) · 송장이 파일 값과 다름 → 멈추고 보고.
2. dry-run(기본): 상자마다 «발송 방법·건너뜀·거절 사유» 표 + «그 실행의 ① 산출물엔 있었는데 파일에서 빠진 상자» 목록.
   빠진 상자는 비상 낱개 배치에 남는다 — 다음 날 정식 경로(앱)나 다음 비상 실행이 그 배치의 상자로 이어 받는다(① 대상 고르기 2번째 갈래).
3. `--apply`: 시작된 낱개 배치 안 상자는 `location-outbound-forces`(배정된 위치·수량 그대로), 포장 중은 `force-dispatch`.
   사유 고정, 멱등 키 `emergency:<날짜>:dispatch:<상자>`.
4. 끝에 요약: 발송 n · 건너뜀 n · 거절 n(사유별) · 빠진 상자 n.

### 인증

실행하는 사람 본인 계정의 액세스 토큰을 `Authorization: Bearer` 로 보낸다. 그 계정에 `fulfillment.warehouse.operate` +
`fulfillment.dispatch.force` 가 있어야 한다 — 없으면 dry-run 첫 줄에서 알린다. 액세스 토큰 수명은 기본 15분(`JWT_ACCESS_TOKEN_EXPIRATION`)이라
한 번 받은 토큰으로 ① 끝까지 못 간다 — 토큰을 다시 받는 길이 필요하다.

**받는 방법(사용자 결정 2026-11-18):** `scripts/tenancy/staff-token.ts` 의 `tokenForUser` 로 받는다 — user-service 내부 secret 으로 코드 발급 →
클라이언트 secret 으로 PKCE 교환(auth-web 로그인과 같은 길, 토큰 테넌트는 `redirectUri` 호스트로 정해진다). secret 은 SSM 에서 읽으므로
AWS 로그인이 필요하다(당일엔 어차피 되어 있다). 만료가 가까우면 호출 전에 다시 받는다.
이 secret 은 비밀번호 없이 아무 계정의 토큰이나 받는 열쇠라 **실행하는 사람 본인 계정에만** 쓴다 — 라이브는 기존
`scripts/tenancy/operator-session.ts` 의 `operatorSession('live')` 를 그대로 쓴다(아이디·비밀번호를 화면에 안 보이게 받아 `signInStaff`,
10분마다 다시 받음, 테넌트 1 토큰인지 확인). 스크립트가 계정 id 를 직접 넣는 길은 두지 않는다. 토큰·secret·비밀번호는 파일·로그에 쓰지 않는다.

## 확인 (완료 조건)

로컬 E2E 스택(`bootstrap:e2e:local` → `start:all:local`)에서 자사몰 주문 몇 건으로:
- 상자 몇 개는 정식 경로(창고 앱 배치 피킹·검수), 몇 개는 이 경로(①→②)로 낸다. 포장 중 상자 한 개는 `force-dispatch` 갈래로.
- 두 경로 상자의 `stock_events`(SHIP 행·수량·위치), FOI 발송 수량, outbox 이벤트, Medusa 주문의 fulfillment·송장번호가 같은 꼴인지 대조한다.
- ② 를 두 번 돌려 두 번째가 전부 «건너뜀»인지, 파일에서 지운 상자가 발송되지 않고 «빠진 상자»로 나오는지 본다.
- 셀메이트에 넘긴 주문의 상자가 ① 대상에 안 나오는지 본다(`sellmate_handed_over_orders` 에 한 줄 넣고).
- ZPL 은 로컬에선 파일 내용만 확인(실물 출력은 리허설).

## 런북(#1251)에 넣을 절차 — PR 본문에 적는다

언제 쓰나(판단 기준 — 단말·앱 쪽이 막혔고 core 는 응답한다) → 아침: 인증 · `prepare` dry-run → `--apply` → 스테이션에서 `copy /b` 로 라벨 출력 →
피킹 리스트로 꺼내 포장·한진 기사 인계 → 저녁: 못 나간 줄 지우기 → `dispatch` dry-run → `--apply` → 요약 확인. 실패 시 할 일
(중간에 죽음 → 같은 명령 재실행, 송장 발급 멈춤 → #914 화면, 한진 API 장애 → 기다림). 사전 준비: 송장 프린터 공유 설정 · 운영자 계정 권한 확인.

## 내 콜 (Claude 가 정함 — 사용자가 뒤집을 수 있다)

- **합칠 수 있는 상자(`mergeable`)는 비상 경로에서 뺀다.** 비상 날 합포장까지 하면 상태가 꼬일 여지가 커진다. 대가: 그 고객은 하루 늦는다.
- **다른 피킹 방식 배치에서 피킹 중인 상자는 뺀다**(위 2번). 배치에서 빼는 일은 비상 경로에 넣지 않는다.
- **막힌 «원인이 core 라우트»인 날은 범위 밖.** 스크립트는 앱과 같은 core 라우트를 부르므로 그 라우트가 고장 나면 같이 막힌다 — 그날은 고쳐서 배포한다.
- 못 나간 상자의 송장은 `registered` 로 두고 비상 배치에 남긴다(다음 날 그대로 쓴다).
- 피킹 리스트는 A4 HTML, 받는 분은 마스킹. 산출물은 실행마다 따로 폴더.

## 빌더에게 남긴 것

스크립트 위치·파일 구성(`scripts/ops/emergency-outbound/` 권장), 출고 준비 목록 페이지 넘기기, 피킹 리스트 정렬(위치 순),
라벨 렌더 응답에서 ZPL 꺼내는 법, 로컬 확인 스크립트의 대조 SQL.

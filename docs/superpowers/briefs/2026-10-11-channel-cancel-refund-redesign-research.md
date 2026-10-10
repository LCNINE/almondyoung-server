# 새 세션 지시문 — 채널 주문 취소·환불 구조 재설계 조사 (#1016 36번 후속)

## 너의 임무

채널(Medusa) 주문의 **취소·환불 구조가 고객과 관리자에게 상식적이고 견고하게 작동하는지**를 조사하고, 가장 좋은 설계를
제안하라. 서비스 초기라 **첫 단추를 잘 꿰는 것이 최우선**이다 — 땜질(몽키 패치)을 쌓지 말고, 필요하면 지금까지의 구현
(아래 PR 3개, 전부 미머지)을 **폐기하고 다시 설계하는 안까지** 비교하라.

**이 세션의 산출물은 «조사 + 설계 제안»이다. 구현하지 마라.** `superpowers:brainstorming` 스킬을 먼저 불러
아키텍처 경로로 진행하고(질문은 한 번에 하나), 사용자 승인 뒤 스펙을 쓴다. 사용자는 한국어로 응답받기를 원한다.

## 먼저 읽을 것 (순서대로)

1. `CLAUDE.md` — 특히 «Medusa — 확장은 소스가 아니라 문서에서 시작한다», 레이어 규칙, expand-contract, 이슈 트래커 규칙
2. 메모리: `~/.claude/projects/-home-pauseb-workspace-almondyoung-server/memory/` 의 `channel-cancel-refund-refusal-36.md`,
   `channel-order-cancel-35.md`, `refund-model-adr-0043-row37.md`, `order-lifecycle-audit-2026-10-05.md`, `framework-extension-points-need-docs.md`
3. ADR: `docs/adr/0042-channel-order-cancel-is-initiated-by-the-channel.md`, `docs/adr/0043-refund-is-classified-by-what-it-reverses.md`, ADR-0040(§5.4·§5.5·§5.6)
4. 스펙: `docs/superpowers/specs/2026-10-07-channel-order-cancel-design.md`(35번), `docs/superpowers/specs/2026-10-10-external-refund-partial-cancel-design.md`(37번),
   `docs/superpowers/specs/2026-10-10-channel-cancel-refund-refusal-design.md`(36번 — 단, 이 파일의 최신판은 PR #1044 브랜치 `feat/1016-36-refund-refusal-receive` 에 있다)
5. 트래킹 이슈 #1016 본문(`gh issue view 1016`) — 코멘트 금지, 본문 수정만
6. Medusa 문서 `https://docs.medusajs.com/llms.txt` 에서 주문 취소·환불·결제·order change·credit line·workflow hook 관련 페이지

## 지금 상태 (사실)

- **PR #1044**(계약+core+admin-web), **#1045**(Medusa), **#1046**(channel-adapter) — 전부 OPEN·미머지·미배포. 폐기 후보다.
  요지: wallet 영구 환불 거절을 «환불 불가 / 장부 불일치»로 분류해 core 취소 요청을 열어 둔 채(출고 보류) 보드·주문 상세에 보이고,
  전체취소는 새 Medusa 라우트 `POST /admin/orders/:id/channel-cancel`(환불 먼저 → 거절이면 취소 안 함 → 기본 cancelOrderWorkflow)로 간다.
- **🔴 발견: Medusa 2.13.4 기본 `POST /admin/orders/:id/cancel` 은 `refundPaymentsStep` 의 `.catch(logger.error)` 로 환불 오류를 삼킨다**
  (`@medusajs/core-flows/dist/payment/steps/refund-payments.js`). wallet 이 거절해도(영구·일시) 주문은 canceled, 환불 0. 35번의
  «취소가 환불 단계에서 롤백» 전제는 틀렸다. 현재 라이브의 채널 전체취소는 이 기본 라우트를 탄다.
- **라이브 피해(10-11 읽기 전용):** 환불 없이 취소된 주문 0건. 2026-06 일부 환불 4건(Medusa #14·#40·#321·#459, 차이 18,156원, 각 wallet FAILED 환불 1건) 원인 미확인.
- 부분취소는 «Medusa 주문 수정 확정 → 환불» 순서라, 환불이 막히면 **고객 화면엔 상품은 빠졌는데 돈은 안 돌아온 주문**이 보인다.
- 선환불 + 기본 취소는 크레딧 라인이 한 번만 붙는다(빈 필터 = 0, 실측). `order_credit_line` 은 주문 버전마다 복사되니 합계로 판단하지 말 것.

## 해결해야 할 고객·관리자 문제 (36번 구현 뒤에도 남는 것)

1. **관리자 막다른 길** — «환불 불가»·«장부 불일치»는 사유만 보이고 끝낼 길이 없다. 운영자가 원하는 «환불 없이 취소 완료(수동 환불함 / 이미 환불됨)»
   버튼이 없어, 남는 선택은 «영원히 보류» 또는 «[요청 접기] = 출고». 부분취소 거절은 접기도 409(«다시 보내기로 환불을 마치라» — 다시 보내면 또 거절)로
   안내끼리 모순. 결국 운영자는 Medusa 대시보드 기본 취소(환불 삼킴)를 비공식 출구로 쓰게 될 위험 — ADR-0040 은 대시보드를 진단 전용으로 정했다.
2. **고객 무응답** — 스토어프론트는 «취소 처리 중»을 30초만 다시 읽고 멈춘다. 거절·접기 통지 없음. 접으면 취소한 고객에게 물건이 간다(장부 불일치면 환불+물건 둘 다).
3. **PG 거절(200 + FAILED 환불 행)** — 카드사 영구 거절(환불 기간 경과 등)이 일시 장애와 구분되지 않아 재시도 → DLQ → 사유 없는 정체. 실제로 가장 흔할 영구 거절 경로.
4. **포인트 환불 결함 의심** — 로컬에서 포인트 환불이 `NO_CAPTURED_REDEEM` 로 실패: REDEEM `leg_id` 는 AUTHORIZE 결제분 id, intent 환불은 CAPTURE id 로 조회
   (`apps/wallet/src/providers/points/points-ledger.service.ts` `readPointLegTotals`). 라이브 동일 여부 미확인(라이브 피해 0건으로 보아 로컬 설정 문제일 가능성).
   라이브 DB 조회는 권한 분류기가 막으니 **사용자에게 `! …sst shell --stage live -- node <스크립트>` 로 실행을 부탁**하라(전례: 메모리 36번 파일).
5. **문구** — «장부 불일치 · wallet 환불 내역 대조»는 개발자 용어. 운영자가 어디서 무엇을 확인하는지 모른다.

## 조사 질문 (최소한 이것들에 근거 있는 답을 내라)

- **취소와 환불을 하나의 원자적 행위로 묶는 게 맞나, 분리된 수명주기로 다루는 게 맞나?** 대안 예: «취소는 항상 성립(재고·출고 정지) + 환불은 별도로 추적되는
  의무(환불 대기·실패·수동 처리 완료)». Medusa 자체 모델(취소와 환불 분리, `pending_difference`·`payment_status`)과 Shopify 등 일반 커머스의 관행을 문서로 확인하라.
- **«환불 의무»의 정본은 누구인가** — Medusa 장부, wallet, core 중 어디에 «아직 못 돌려준 돈»이 남고, 운영자의 «수동 환불함/이미 환불됨» 확정은 어디에 기록되나.
  ADR-0042 원칙(환불을 시작하는 쪽은 주문마다 하나, Medusa 장부에 모든 환불이 남는다)·ADR-0043(환불은 무엇을 되돌리는지로 분류)과 충돌 없이.
- **부분취소 순서** — «수정 확정 → 환불»이 맞나, «환불 → 수정»이나 «수정 + 환불 의무»가 맞나.
- **운영자 출구의 최소 집합** — 다시 시도 / 환불 없이 취소 완료(근거 기록) / 장부 맞추기(투영 안 된 wallet 환불을 Medusa 장부에 넣기, 36번 E6) / 출고 재개 — 각각 누가 실행하고 무엇을 기록하나.
- **고객 통지·스토어프론트 상태** — 어떤 상태를 고객에게 어떤 말로 보여야 상식적인가.
- **실패 분류의 정본** — wallet 의 400 코드와 PG 실패 행을 영구/일시로 가르는 일은 wallet·Medusa·channel-adapter 중 어디 책임이 맞나.
- **36번 구현(#1044·#1045·#1046)에서 살릴 것과 버릴 것** — 예: 새 `channel-cancel` 라우트와 기본 취소 특성 테스트, 분류표, «REFUND_FAILED 면 닫지 않음», 보드 상태 — 새 설계에 맞는지 하나씩.

## 지켜야 할 제약

- Medusa 확장: 문서로 확장점 목록 → 소스로 커버리지. 권장 순서 additional_data → 워크플로 훅 → 미들웨어 → 이벤트 구독 → 라우트 «복제»(override 아님). 모듈 서비스 교체는 오답 신호. 워크플로 훅은 워크플로당 핸들러 하나
- core 는 channel-adapter 를 직접 부르지 않는다(명령 스트림 `channel-orders.commands.v1`). core 는 문지기(판정·보류·명령), 확정은 수집
- 한 SST 스택이라 배포 순서를 통제 못 한다 — 계약 변경은 소비자가 먼저 깨지지 않게(enum 추가 = 소비자 선배포 필요)
- destructive 스키마 변경은 expand-contract
- 이슈 본문에 코드에서 도출되는 수치를 적지 말 것

## 산출물

1. 대안 2~3개(«36번 확장» vs «취소·환불 분리 재설계» 포함)와 장단점, 추천 — 고객 경험·운영자 경험·돈의 안전성·장부 정합성·구현/이행 비용 기준
2. 추천안의 상태 모델(취소 요청·환불 의무의 상태와 전이, 각 상태에서 고객·운영자가 보는 것과 할 수 있는 것)
3. PR #1044·#1045·#1046 처분 제안(머지 / 수정 / 닫기)과 이유
4. 사용자 승인 뒤: 스펙 `docs/superpowers/specs/<날짜>-<주제>-design.md`, #1016 에 반영할 행(사용자에게 확인 후)

## 참고: 로컬 환경 (이전 세션이 남긴 것)

- 워크트리 `.claude/worktrees/feat-1016-36-refund-refusal`(PR1·2), `…-medusa`(PR3), `…/smoke-1016-36`(세 PR 합친 스모크용)
- 임시 DB `core_1016_36`(이 브랜치 마이그 전부 적용, 로컬 `dev_core` 는 타 브랜치 잔재로 migrate 가 조용히 실패)
- 로컬 E2E 함정: 스토어프론트 개발모드는 `BACKEND_DOMAIN=almondyoung.com` 프로세스 env 필요(히어로 라이브 이미지), ugc-service(:3030) 필요,
  워크트리 node_modules 심링크를 Turbopack 이 거부. 어드민 주문 내역 기본 필터가 매칭 대기 주문을 숨기고 주문번호 클릭 시 에러 페이지
- 스모크 재현법: 로컬 wallet `refunds` 에 SUCCEEDED 행 주입(장부 불일치), `payment_methods.type='CMS_BATCH'`(환불 불가)

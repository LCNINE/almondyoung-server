import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(__dirname, '..', '..');

type Verdict = 'SAFE' | 'VULN' | 'N/A' | 'UNCLEAR';

/** 미해결(VULN/UNCLEAR) 판정 목록. 전부 해소하면 []로 바꿔 회귀를 막는다. */
const EXPECTED_OPEN: string[] = [
  'membership POST /subscriptions/confirm-checkout-intent [VULN] 소유권 검사 없음. 핸들러(subscription.controller.ts:163-167)가 호출자 신원을 전혀 받지 않고 바디의 intentId 만 받으며, 서비스가 userId 를 intent 메타데이터에서 뽑는다. 재현: 인증된 A 가 B 의 intentId 로 호출하면 B 명의 구독이 생성된다. 영향 제한적 — intent 가 AUTHORIZED/CAPTURED 여야 하므로 B 가 이미 결제한 건이고 A 는 이득이 없다. 오케스트레이터 직접 확인 (조사 에이전트는 N/A 로 오판, 자기 observations 와 모순이었음).',
];

/**
 * IDOR 검사 대상 97건의 판정 명단. 2026-08 감사 P1 (`docs/api-authz-audit-2026-08.md`).
 *
 * 키는 `<app> <VERB> <route>` 다. app 을 빼면 search·analytics 의 `GET /health` 가 충돌해
 * 97건이 96개로 뭉개진다.
 *
 * ⚠️ 이 테스트가 막는 것은 **새 구멍**이지 **기존 방어의 퇴행**이 아니다.
 * 누군가 `eq(reviews.userId, userId)` 를 지워도 여기는 초록이다. IDOR 은 의미론이라
 * AST 로 판정할 수 없다. 초록불을 "IDOR 이 없다" 로 읽지 마라.
 *
 * 새 라우트를 추가했다면: 소유권 검사를 확인하고, 그 근거(file:line 과 술어 원문)를 적어
 * 여기 추가한다. 근거 없이 키만 추가하는 것은 이 장치를 무력화하는 것이다.
 */
const IDOR_REVIEWED: Record<string, { verdict: Verdict; evidence: string; predicate: string; note?: string }> = {
  'analytics GET /best-product': {
    verdict: 'N/A',
    evidence: 'apps/analytics/src/features/analytics-api/analytics.controller.ts:48',
    predicate: '',
    note: "무인증(컨트롤러에 @UseGuards 없음). ProductRankingQuery.getProductRanking(product-ranking.query.ts:21-58)은 최근 90일 전체 주문을 masterId 로 group by 해 주문수/판매수량을 합산한 플랫폼 전역 집계 — 특정 고객 식별자로 필터하지 않으므로 '남의 데이터'를 특정 식별자로 찾아가는 IDOR 은 성립하지 않는다. 같은 컨트롤러의 /frequently-purchased(개인 구매내역)에는 JwtAuthGuard 를 명시적으로 붙였는데(controller.ts:74) /best-product 에는 안 붙어있어, '베스트상품' 랭킹은 공개 노출을 의도하고 개인 구매내역만 보호한 것으로 보인다(스토어의 '인기상품' 위젯류와 유사). 다만 주문수·판매수량 자체는 매출과 직결된 지표라 단순 상품명/가격 카탈로그보다 민감도가 높음 — IDOR 은 아니지만 무인증 노출이 의도인지 재확인이 필요한 정보노출 소지로 observations 에 별도 기록.",
  },
  'analytics GET /frequently-purchased': {
    verdict: 'SAFE',
    evidence: 'apps/analytics/src/features/user-purchase/read-model/user-purchase.query.ts:39',
    predicate: '.where(eq(aggUserProductPurchase.customerId, customerId))',
    note: '인증 있음 — @UseGuards(JwtAuthGuard)(analytics.controller.ts:74). 호출자 식별자는 @User() user.userId(controller.ts:86,90)로, JwtAuthGuard가 위임하는 JwtAccessStrategy.validate()(jwt-access.strategy.ts:108-123)에서 서명 검증된 JWT payload 로부터만 채워져 클라이언트가 다른 사용자ID를 지정할 방법이 없다. 쿼리도 customerId=user.userId 로 좁혀짐(user-purchase.query.ts:39,46).',
  },
  'analytics GET /health': {
    verdict: 'N/A',
    evidence: 'apps/analytics/src/features/analytics-api/analytics.controller.ts:20',
    predicate: '',
    note: '무인증 — 헬스체크. AnalyticsController.getHealth 에 @UseGuards 없음. analytics.module.ts 는 AuthorizationModule.forRoot 로 JwtAuthGuard 등 provider 만 등록할 뿐 APP_GUARD 로 전역 등록하지 않음(authorization README 가 권장하는 APP_GUARD 패턴, libs/authorization/README.md:158-196, 이 앱엔 적용 안 됨) — 라우트별로 개별 @UseGuards 를 붙이지 않으면 전부 공개.',
  },
  'analytics GET /summary': {
    verdict: 'N/A',
    evidence: 'apps/analytics/src/features/analytics-api/analytics.controller.ts:35',
    predicate: '@UseGuards(JwtAuthGuard)',
    note: '대시보드 요약(오늘/어제 전사 매출 + 활성 멤버십 수) — 사용자 소유 리소스 파라미터가 없어 IDOR 대상 아님. JwtAuthGuard 로 인증 요구. 응답이 전사 매출 수치라 관리자 스코프 제한은 analytics 전반 스코프 도입과 함께 별도 검토.',
  },
  'analytics GET /statistics/sales': {
    verdict: 'N/A',
    evidence: 'apps/analytics/src/features/statistics/api/statistics.controller.ts:15',
    predicate: '@UseGuards(JwtAuthGuard)',
    note: '기간별 전사 매출 집계 — 쿼리 파라미터가 날짜/채널뿐이라 IDOR 대상 아님. 컨트롤러 클래스에 JwtAuthGuard. 관리자 스코프는 위 /summary 와 같은 별도 검토 항목.',
  },
  'analytics GET /statistics/products': {
    verdict: 'N/A',
    evidence: 'apps/analytics/src/features/statistics/api/statistics.controller.ts:15',
    predicate: '@UseGuards(JwtAuthGuard)',
    note: '상품별 전사 집계 — 사용자 소유 리소스 파라미터 없음. 컨트롤러 클래스에 JwtAuthGuard.',
  },
  'analytics GET /statistics/customers': {
    verdict: 'N/A',
    evidence: 'apps/analytics/src/features/statistics/api/statistics.controller.ts:15',
    predicate: '@UseGuards(JwtAuthGuard)',
    note: '고객·멤버십 전사 집계 — 개별 고객 식별자를 받지 않고 등급/버킷 단위로만 반환. 컨트롤러 클래스에 JwtAuthGuard.',
  },
  'core GET /library/ownerships': {
    verdict: 'SAFE',
    evidence: 'apps/core/src/modules/library/services/ownership.service.ts:56',
    predicate: 'eq(digitalAssetOwnerships.customerId, customerId),',
    note: 'OwnershipController.list -> service.listForCustomer(customerId, ...); customerId 는 컨트롤러의 _requireUserId(req) 로 획득.',
  },
  'core GET /library/ownerships/:id/download': {
    verdict: 'SAFE',
    evidence: 'apps/core/src/modules/library/services/ownership.service.ts:365',
    predicate: 'if (row.ownership.customerId !== customerId) {',
    note: 'OwnershipController.download -> service.getDownloadable(id, customerId) -> _loadOwnedOrThrow(138줄)에서 동일 검증.',
  },
  'core GET /store/orders/:id/actions': {
    verdict: 'SAFE',
    evidence: 'apps/core/src/modules/sales-order/services/store-sales-orders.service.ts:488',
    predicate: 'if (customerId !== undefined && so.customerId !== customerId)',
    note: 'getActions(81-84줄) -> findSoOrThrow({id: orderId}, customerId) 호출(82줄), 실제 소유권 검증은 468-491줄 findSoOrThrow 내부 488줄.',
  },
  'core GET /store/orders/:id/tracking': {
    verdict: 'SAFE',
    evidence: 'apps/core/src/modules/sales-order/services/store-sales-orders.service.ts:488',
    predicate: 'if (customerId !== undefined && so.customerId !== customerId)',
    note: 'getTracking(1081-1084줄) -> findSoOrThrow({id: orderId}, customerId)(1082줄).',
  },
  'core GET /store/orders/:orderId/exchange-requests/:exchangeRequestId': {
    verdict: 'SAFE',
    evidence: 'apps/core/src/modules/sales-order/services/store-return-exchange.service.ts:259',
    predicate: 'this.assertOwnership(so, customerId);',
    note: 'getExchangeRequest.',
  },
  'core GET /store/orders/:orderId/return-eligibility': {
    verdict: 'SAFE',
    evidence: 'apps/core/src/modules/sales-order/services/store-return-exchange.service.ts:299',
    predicate: 'this.assertOwnership(so, customerId);',
    note: 'getReturnEligibility.',
  },
  'core GET /store/orders/:orderId/return-requests/:returnRequestId': {
    verdict: 'SAFE',
    evidence: 'apps/core/src/modules/sales-order/services/store-return-exchange.service.ts:238',
    predicate: 'this.assertOwnership(so, customerId);',
    note: 'getReturnRequest; returnRequestId로 조회한 row의 salesOrderId 로 SO를 다시 찾아 소유권 검증.',
  },
  'core GET /store/orders/by-channel-order/:channelOrderId/actions': {
    verdict: 'SAFE',
    evidence: 'apps/core/src/modules/sales-order/services/store-sales-orders.service.ts:488',
    predicate: 'if (customerId !== undefined && so.customerId !== customerId)',
    note: "getActionsByChannelOrder(427-430줄) -> findSoOrThrow({channelOrderId, salesChannel:'medusa'}, customerId)(428줄).",
  },
  'core GET /store/orders/by-channel-order/:channelOrderId/exchange-requests/:exchangeRequestId': {
    verdict: 'SAFE',
    evidence: 'apps/core/src/modules/sales-order/services/store-return-exchange.service.ts:500',
    predicate: 'this.assertOwnership(so, customerId);',
    note: 'getExchangeRequestByChannelOrder; 이중 검증 (500줄 + getExchangeRequest 259줄).',
  },
  'core GET /store/orders/by-channel-order/:channelOrderId/lines': {
    verdict: 'SAFE',
    evidence: 'apps/core/src/modules/sales-order/services/store-return-exchange.service.ts:273',
    predicate: 'this.assertOwnership(so, customerId);',
    note: 'getOrderLinesByChannelOrder.',
  },
  'core GET /store/orders/by-channel-order/:channelOrderId/return-eligibility': {
    verdict: 'SAFE',
    evidence: 'apps/core/src/modules/sales-order/services/store-return-exchange.service.ts:299',
    predicate: 'this.assertOwnership(so, customerId);',
    note: 'getReturnEligibilityByChannelOrder(458-464줄) -> findSoByChannelOrderOrThrow 후 this.getReturnEligibility(so.id, customerId) 로 위임, 실제 검증은 299줄에서 수행.',
  },
  'core GET /store/orders/by-channel-order/:channelOrderId/return-requests/:returnRequestId': {
    verdict: 'SAFE',
    evidence: 'apps/core/src/modules/sales-order/services/store-return-exchange.service.ts:490',
    predicate: 'this.assertOwnership(so, customerId);',
    note: 'getReturnRequestByChannelOrder; channelOrderId로 찾은 SO에 대해 검증 후 getReturnRequest(238줄)에서 반품요청 자체의 SO로도 재검증 (이중 검증).',
  },
  'core GET /store/orders/by-channel-order/:channelOrderId/tracking': {
    verdict: 'SAFE',
    evidence: 'apps/core/src/modules/sales-order/services/store-sales-orders.service.ts:488',
    predicate: 'if (customerId !== undefined && so.customerId !== customerId)',
    note: "getTrackingByChannelOrder(1076-1079줄) -> findSoOrThrow({channelOrderId, salesChannel:'medusa'}, customerId)(1077줄).",
  },
  'core GET /store/orders/by-wallet-intent/:walletIntentId/digital-exercised': {
    verdict: 'SAFE',
    evidence: 'apps/core/src/modules/sales-order/services/store-sales-orders.service.ts:97',
    predicate: 'eq(inventoryTables.salesOrders.customerId, customerId),',
    note: 'hasExercisedDigitalByWalletIntent; walletIntentId+customerId 복합 조건으로 직접 조회, 못찾으면 false 반환(존재 노출 없음).',
  },
  'core POST /library/ownerships/:id/exercise': {
    verdict: 'SAFE',
    evidence: 'apps/core/src/modules/library/services/ownership.service.ts:365',
    predicate: 'if (row.ownership.customerId !== customerId) {',
    note: 'OwnershipController.exercise -> service.exercise(id, customerId) -> _loadOwnedOrThrow(113줄)에서 소유자 불일치 시 NotFoundError. 이후 118-119줄 UPDATE 는 id만으로 필터하지만 같은 트랜잭션 내에서 소유권 검증이 선행됨(observations 참고).',
  },
  'core POST /store/orders/:id/cancel-request': {
    verdict: 'SAFE',
    evidence: 'apps/core/src/modules/sales-order/services/store-sales-orders.service.ts:488',
    predicate: 'if (customerId !== undefined && so.customerId !== customerId)',
    note: 'cancelRequest(106-114줄) -> findSoOrThrow({id: orderId}, customerId)(112줄) -> processCancelRequest 는 이미 소유권 검증된 so 만 사용.',
  },
  'core POST /store/orders/:orderId/exchange-requests': {
    verdict: 'SAFE',
    evidence: 'apps/core/src/modules/sales-order/services/store-return-exchange.service.ts:178',
    predicate: 'this.assertOwnership(so, customerId);',
    note: 'createExchangeRequest.',
  },
  'core POST /store/orders/:orderId/return-requests': {
    verdict: 'SAFE',
    evidence: 'apps/core/src/modules/sales-order/services/store-return-exchange.service.ts:90',
    predicate: 'this.assertOwnership(so, customerId);',
    note: 'createReturnRequest; assertOwnership 정의는 1264-1268줄 (if (so.customerId !== customerId) throw ForbiddenException).',
  },
  'core POST /store/orders/by-channel-order/:channelOrderId/cancel-request': {
    verdict: 'SAFE',
    evidence: 'apps/core/src/modules/sales-order/services/store-sales-orders.service.ts:488',
    predicate: 'if (customerId !== undefined && so.customerId !== customerId)',
    note: "cancelRequestByChannelOrder(456-464줄) -> findSoOrThrow({channelOrderId, salesChannel:'medusa'}, customerId)(462줄).",
  },
  'core POST /store/orders/by-channel-order/:channelOrderId/exchange-requests': {
    verdict: 'SAFE',
    evidence: 'apps/core/src/modules/sales-order/services/store-return-exchange.service.ts:178',
    predicate: 'this.assertOwnership(so, customerId);',
    note: 'createExchangeRequestByChannelOrder(475-482줄) -> this.createExchangeRequest(so.id, customerId, dto) 로 위임, 실제 검증은 178줄.',
  },
  'core POST /store/orders/by-channel-order/:channelOrderId/return-requests': {
    verdict: 'SAFE',
    evidence: 'apps/core/src/modules/sales-order/services/store-return-exchange.service.ts:90',
    predicate: 'this.assertOwnership(so, customerId);',
    note: 'createReturnRequestByChannelOrder(466-473줄) -> findSoByChannelOrderOrThrow 후 this.createReturnRequest(so.id, customerId, dto) 로 위임, 실제 검증은 90줄.',
  },
  'core POST /store/orders/by-channel-order/actions/batch': {
    verdict: 'SAFE',
    evidence: 'apps/core/src/modules/sales-order/services/store-sales-orders.service.ts:448',
    predicate: 'eq(inventoryTables.salesOrders.customerId, customerId),',
    note: 'getActionsByChannelOrderBatch; channelOrderIds IN + customerId 조건으로 직접 필터 (타인 주문은 결과셋에서 조용히 제외됨, DTO에 @ArrayMaxSize(100)).',
  },
  'file-service DELETE /files/:fileId': {
    verdict: 'SAFE',
    evidence: 'apps/file-service/src/access/file-access.ts:68',
    predicate: 'if (file.uploadedBy === user.userId) return true;',
    note: 'LifecycleController.deleteFile -> FileAccess.delete(fileId, user) (file-access.ts:51) -> isMasterOrOwner(file, user) at file-access.ts:56 gates the softDelete call on the same file.uploadedBy === user.userId check; repo.softDelete(id) itself (file.repository.ts:44) only filters by eq(uploads.id, id), so all ownership enforcement lives in this application-layer check. Delete is NOT widened by the STAFF_READABLE_CONTEXT_IDS path added in 235197151 — that path lives in loadReadable only.',
  },
  'file-service GET /files/:fileId/download': {
    verdict: 'SAFE',
    evidence: 'apps/file-service/src/access/file-access.ts:68',
    predicate: 'if (file.uploadedBy === user.userId) return true;',
    note: "DownloadController.getSignedUrl -> DownloadService.getSignedUrl (apps/file-service/src/download/download.service.ts:21) -> FileAccess.loadReadable(fileId, user) (file-access.ts:26) -> isMasterOrOwner (file-access.ts:67-77) compares file.uploadedBy against caller's own userId before returning the row. 235197151 added a fourth allow path at file-access.ts:37 — a STAFF_ROLES caller may read any file whose contextId is in STAFF_READABLE_CONTEXT_IDS (digital-asset only). That is an intentional role-based grant for admin review, not an IDOR: it is scoped by context, not by object id, and file-access.spec.ts asserts admin still cannot read a business-license file. Everything else throws ForbiddenError.",
  },
  'file-service GET /files/:fileId/metadata': {
    verdict: 'SAFE',
    evidence: 'apps/file-service/src/access/file-access.ts:68',
    predicate: 'if (file.uploadedBy === user.userId) return true;',
    note: 'DownloadController.getMetadata -> DownloadService.getMetadata (download.service.ts:50) -> FileAccess.loadReadable(fileId, user) -> same isMasterOrOwner ownership check as the download route, and the same STAFF_READABLE_CONTEXT_IDS allow path at file-access.ts:37.',
  },
  'file-service POST /files/batch-upload': {
    verdict: 'N/A',
    evidence: 'apps/file-service/src/upload/upload.service.ts:118-135',
    predicate: '',
    note: 'batchUploadFiles() just fans out to the same uploadFile() creation path per file (upload.service.ts:127); same reasoning as POST /files/upload - no pre-existing per-user object is looked up or mutated by client-supplied id.',
  },
  'file-service POST /files/upload': {
    verdict: 'N/A',
    evidence: 'apps/file-service/src/upload/upload.service.ts:83-98',
    predicate: '',
    note: 'Pure creation route: uploadFile() always inserts a brand-new row (id: uuidv7(), uploadedBy: userId) via fileRepository.create(...); there is no client-supplied file/object id that resolves to an existing row owned by someone else. dto.contextId only looks up a shared file_contexts config entry (fileContextRepository.findById via loadActiveContext, upload.service.ts:235-251), not a per-user object, so no IDOR target exists.',
  },
  'file-service POST /files/upload/confirm': {
    verdict: 'SAFE',
    evidence: 'apps/file-service/src/upload/upload.service.ts:173',
    predicate: 'if (file.uploadedBy !== userId) {',
    note: 'UploadController.confirmUpload -> UploadService.confirmUpload(dto.fileId, user.userId). 바디의 fileId 가 기존 pending 행을 가리키는 client-supplied id 지만, 행을 읽자마자 file.uploadedBy 를 호출자 userId 와 대조해 다르면 ForbiddenError — 타인의 pending 업로드를 대신 activate 하거나 존재 여부를 활성화로 확인할 수 없다. upload.service.spec.ts 가 발급자 불일치 거부를 고정한다.',
  },
  'file-service POST /files/upload/presign': {
    verdict: 'N/A',
    evidence: 'apps/file-service/src/upload/upload.service.ts:140-154',
    predicate: '',
    note: 'Pure creation route: presignUpload() always inserts a brand-new pending row (id: uuidv7(), uploadedBy: userId); POST /files/upload 과 같은 이유로 client-supplied id 가 기존 타인 소유 행으로 해석되는 경로가 없다. dto.contextId 는 공유 설정(file_contexts) 조회일 뿐이다.',
  },
  'membership GET /membership/benefits/current': {
    verdict: 'SAFE',
    evidence: 'apps/membership/src/services/benefit/benefit.reader.ts:77',
    predicate: 'eq(schema.membershipCycleBenefits.userId, userId),',
    note: 'BenefitTrackingController.getCurrentCycleBenefit -> BenefitTrackingService.getCurrentCycleBenefit(userId) -> BenefitReader.findCurrentCycleBenefit(userId,...) 의 where 절에 userId가 들어간다.',
  },
  'membership GET /membership/benefits/history': {
    verdict: 'SAFE',
    evidence: 'apps/membership/src/services/benefit/benefit.reader.ts:121',
    predicate: '.where(eq(schema.membershipCycleBenefits.userId, userId))',
    note: 'getCycleBenefitHistory -> BenefitReader.findCycleBenefitHistory(userId, limit) 의 where 절에 userId가 들어간다.',
  },
  'membership GET /membership/savings/current-month': {
    verdict: 'SAFE',
    evidence: 'apps/membership/src/services/savings/savings.reader.ts:63',
    predicate: 'eq(schema.membershipDiscountEvents.userId, userId),',
    note: 'getCurrentMonthSavings -> SavingsService.getMonthSavings(userId, yearMonth) -> SavingsReader.getMonthSavings(userId, yearMonth) 의 where 절에 userId가 들어간다.',
  },
  'membership GET /membership/savings/month/:yearMonth': {
    verdict: 'SAFE',
    evidence: 'apps/membership/src/services/savings/savings.reader.ts:63',
    predicate: 'eq(schema.membershipDiscountEvents.userId, userId),',
    note: 'getMonthSavings -> 동일하게 SavingsReader.getMonthSavings(userId, yearMonth) 의 where 절에 userId가 들어간다. yearMonth 는 카탈로그성 파라미터가 아니라 자기 데이터 내 기간 필터일 뿐이다.',
  },
  'membership GET /membership/savings/overview': {
    verdict: 'SAFE',
    evidence: 'apps/membership/src/services/subscription/subscription-contract.reader.ts:518',
    predicate: '.where(eq(schema.subscriptionContracts.userId, userId))',
    note: 'SavingsController.getOverview -> SavingsService.getOverview(userId) -> resolvePeriods(userId) -> SubscriptionContractReader.findContractsByUserIdWithPlan(userId) 의 where 절에 userId가 들어간다. 이후 절약액 집계도 같은 userId로 BenefitReader.findDiscountEventsBetween(userId,...)을 호출한다.',
  },
  'membership GET /membership/savings/periods/:periodId': {
    verdict: 'SAFE',
    evidence: 'apps/membership/src/services/benefit/benefit.reader.ts:186',
    predicate: 'eq(schema.membershipDiscountEvents.userId, userId),',
    note: "SavingsController.getPeriodDetail -> SavingsService.getPeriodDetail(userId, periodId). periodId 는 먼저 resolvePeriods(userId)가 만든 '이 userId 소유 주기 목록'에서만 매칭되고(다른 사용자의 periodId를 넣으면 목록에 없어 BadRequestError), 매칭된 주기의 주문 상세도 findDiscountEventsBetween(userId,...) 의 where 절에 userId가 들어간다.",
  },
  'membership GET /membership/savings/range': {
    verdict: 'SAFE',
    evidence: 'apps/membership/src/services/savings/savings.reader.ts:97',
    predicate: 'eq(schema.membershipDiscountEvents.userId, userId),',
    note: 'getRangeSavings -> SavingsService.getRangeSavings(userId, startDate, endDate) -> SavingsReader.getRangeSavings(userId,...) 의 where 절에 userId가 들어간다(합계·월별 breakdown 쿼리 모두 동일).',
  },
  'membership GET /pause/history': {
    verdict: 'SAFE',
    evidence: 'apps/membership/src/services/pause/pause.reader.ts:87',
    predicate: '.where(eq(schema.pauseEvents.userId, userId))',
    note: 'getPauseHistory -> PauseService.getPauseHistory(userId) -> PauseReader.findPauseHistory(userId) 의 where 절에 userId가 들어간다.',
  },
  'membership GET /plans/:planId': {
    verdict: 'N/A',
    evidence: 'apps/membership/src/services/plan/plan.reader.ts:52',
    predicate: '',
    note: 'PlanController.getPlanDetails -> PlanService.getPlanDetails(planId) -> PlanReader.findPlanById(planId). plan/tier 는 사용자 소유 개념이 없는 전역 카탈로그 데이터(모든 로그인 사용자에게 동일하게 공개)라 IDOR 대상 객체가 성립하지 않는다. 컨트롤러도 userId를 받지 않는다.',
  },
  'membership GET /subscriptions/cancel-preview': {
    verdict: 'SAFE',
    evidence: 'apps/membership/src/services/subscription/subscription-contract.reader.ts:66',
    predicate:
      ".where(and(eq(schema.subscriptionContracts.userId, userId), eq(schema.subscriptionContracts.status, 'ACTIVE')))",
    note: 'previewCancellation -> loadContextForUser(userId) -> findContractWithPlan(userId) -> findActiveContract(userId) 의 where 절에 userId가 들어간다.',
  },
  'membership GET /subscriptions/cancellation-reasons': {
    verdict: 'N/A',
    evidence: 'apps/membership/src/services/subscription/cancellation-reason.reader.ts:35',
    predicate: '',
    note: "getCancellationReasons -> CancellationReasonReader.findActiveReasons() 는 isActive 로만 필터하는 전역 마스터 데이터(취소 이유 목록)라 사용자 소유 개념이 없다. 컨트롤러가 @User('userId') userId 를 받지만 서비스에 전달되지 않는 죽은 코드다 — 실제 데이터가 사용자 무관이라 VULN은 아니다.",
  },
  'membership GET /subscriptions/current': {
    verdict: 'SAFE',
    evidence: 'apps/membership/src/services/entitlement/entitlement.reader.ts:77',
    predicate: 'eq(schema.subscriptionEntitlement.userId, userId),',
    note: 'SubscriptionController.getCurrentSubscriptionDetails -> SubscriptionService.getCurrentSubscriptionDetails(userId) -> EntitlementService.getUserEntitlement(userId) -> EntitlementReader.getUserEntitlementDetails(userId) 의 where 절에 userId가 들어간다.',
  },
  'membership GET /subscriptions/history': {
    verdict: 'SAFE',
    evidence: 'apps/membership/src/services/subscription/subscription-contract.reader.ts:518',
    predicate: '.where(eq(schema.subscriptionContracts.userId, userId))',
    note: 'getSubscriptionHistory -> SubscriptionService.getSubscriptionHistory(userId) -> SubscriptionContractReader.findContractsByUserIdWithPlan(userId) 의 where 절에 userId가 들어간다.',
  },
  'membership GET /subscriptions/history/paged': {
    verdict: 'SAFE',
    evidence: 'apps/membership/src/services/subscription/subscription-contract.reader.ts:535',
    predicate: '.where(eq(schema.subscriptionContracts.userId, userId))',
    note: 'getSubscriptionHistoryPaged -> SubscriptionService.getSubscriptionHistoryPaged(userId, limit, offset) -> SubscriptionContractReader.findContractsByUserIdWithPlanPaged(userId, limit, offset) 의 where 절에 userId가 들어간다.',
  },
  'membership GET /subscriptions/refund-status': {
    verdict: 'SAFE',
    evidence: 'apps/membership/src/services/subscription/subscription-contract.reader.ts:411',
    predicate: 'eq(schema.subscriptionContracts.userId, userId),',
    note: 'getRefundStatus -> SubscriptionCancellationService.getRefundStatus(userId) -> SubscriptionContractReader.findLatestRefundRequestedContract(userId) 의 where 절에 userId가 들어간다.',
  },
  'membership GET /subscriptions/termination-notice': {
    verdict: 'SAFE',
    evidence: 'apps/membership/src/services/subscription/subscription-contract.reader.ts:501',
    predicate: '.where(eq(schema.subscriptionContracts.userId, userId))',
    note: 'getTerminationNotice -> SubscriptionCancellationService.getTerminationNotice(userId) -> findCurrentEntitlement(userId)(활성이면 null 반환) 이어서 SubscriptionContractReader.findContractsByUserId(userId) 의 where 절에 userId가 들어가고, 반환되는 latest 계약도 이 목록에서만 나온다.',
  },
  'membership GET /tiers': {
    verdict: 'N/A',
    evidence: 'apps/membership/src/services/plan/plan.reader.ts:69',
    predicate: '',
    note: 'PlanController.getAllTiers -> PlanService.getAllTiers -> PlanReader.findAllTiers(). 전체 티어 목록을 사용자 구분 없이 그대로 반환하는 카탈로그 조회라 IDOR 대상이 없다.',
  },
  'membership GET /tiers/:tierId/benefits': {
    verdict: 'N/A',
    evidence: 'apps/membership/src/services/plan/plan.reader.ts:87',
    predicate: '',
    note: 'PlanController.getTierBenefits -> PlanService.getTierWithPlans(tierId) -> PlanReader.findTierWithPlans(tierId). 마찬가지로 전역 카탈로그 조회.',
  },
  'membership GET /tiers/:tierId/plans': {
    verdict: 'N/A',
    evidence: 'apps/membership/src/services/plan/plan.reader.ts:76',
    predicate: '',
    note: 'PlanController.getPlansByTier -> PlanService.getPlansByTier(tierId) -> PlanReader.findPlansByTierId(tierId). tierId는 카탈로그 식별자이며 사용자 소유 리소스가 아니다.',
  },
  'membership POST /pause': {
    verdict: 'SAFE',
    evidence: 'apps/membership/src/services/pause/pause.reader.ts:141',
    predicate: 'eq(schema.subscriptionEntitlement.userId, userId),',
    note: 'PauseController.pauseSubscription -> PauseService.pauseSubscription(userId,...) -> PauseReader.findActiveNonPausedEntitlement(userId) 의 where 절에 userId가 들어간다. 정지 대상 entitlement 자체가 이 조회로만 정해진다.',
  },
  'membership POST /pause/resume': {
    verdict: 'SAFE',
    evidence: 'apps/membership/src/services/pause/pause.reader.ts:98',
    predicate:
      'where: and(eq(schema.subscriptionEntitlement.userId, userId), eq(schema.subscriptionEntitlement.isCurrent, true)),',
    note: 'resumeSubscription -> PauseService.resumeSubscription(userId,...) -> PauseReader.findPausedEntitlement(userId) 의 where 절에 userId가 들어간다.',
  },
  'membership POST /subscriptions/cancel': {
    verdict: 'SAFE',
    evidence: 'apps/membership/src/services/subscription/subscription-contract.reader.ts:66',
    predicate:
      ".where(and(eq(schema.subscriptionContracts.userId, userId), eq(schema.subscriptionContracts.status, 'ACTIVE')))",
    note: 'cancelSubscription -> SubscriptionCancellationService.cancelSubscription(userId,...) -> loadContextForUser(userId) -> SubscriptionContractReader.findContractWithPlan(userId) -> findActiveContract(userId) 의 where 절에 userId가 들어간다. 취소·환불 대상 계약이 이 조회로만 정해진다.',
  },
  'membership POST /subscriptions/cancel/undo': {
    verdict: 'SAFE',
    evidence: 'apps/membership/src/services/subscription/subscription-contract.reader.ts:66',
    predicate:
      ".where(and(eq(schema.subscriptionContracts.userId, userId), eq(schema.subscriptionContracts.status, 'ACTIVE')))",
    note: 'undoCancellation -> SubscriptionCancellationService.undoCancellation(userId,...) -> contractReader.findContractWithPlan(userId) -> findActiveContract(userId) 의 where 절에 userId가 들어간다(뒤이은 findCurrentEntitlement(userId) 도 동일하게 userId로 필터).',
  },
  'membership POST /subscriptions/checkout-intent': {
    verdict: 'N/A',
    evidence: 'apps/membership/src/controllers/subscription.controller.ts:118',
    predicate: '',
    note: 'createCheckoutIntent 는 신규 결제 intent 생성 라우트다. userId 는 오직 @User() 로 취한 호출자 자신의 JWT 값이고(바디로 override 불가), 아직 존재하지 않는 대상 객체를 만드는 것이므로 IDOR이 성립하지 않는다.',
  },
  'membership POST /subscriptions/confirm-checkout-intent': {
    verdict: 'VULN',
    evidence: 'apps/membership/src/services/subscription.service.ts:220',
    predicate: '',
    note: '소유권 검사 없음. 핸들러(subscription.controller.ts:163-167)가 호출자 신원을 전혀 받지 않고 바디의 intentId 만 받으며, 서비스가 userId 를 intent 메타데이터에서 뽑는다. 재현: 인증된 A 가 B 의 intentId 로 호출하면 B 명의 구독이 생성된다. 영향 제한적 — intent 가 AUTHORIZED/CAPTURED 여야 하므로 B 가 이미 결제한 건이고 A 는 이득이 없다. 오케스트레이터 직접 확인 (조사 에이전트는 N/A 로 오판, 자기 observations 와 모순이었음).',
  },
  'membership POST /subscriptions/subscribe-with-method': {
    verdict: 'N/A',
    evidence: 'apps/membership/src/services/subscription.service.ts:527',
    predicate: '',
    note: 'subscribeWithBillingMethod 는 신규 구독 생성 라우트다. userId 는 @User() 로 취한 호출자 자신의 JWT 값만 쓰이고(멤버십 계약은 그 userId로 새로 생성됨), 기존 소유 리소스를 조회/변경하는 경로가 아니라 IDOR이 성립하지 않는다. billingMethodId 소유권 검사는 wallet 쪽 책임이라 observations 참고.',
  },
  'notification DELETE /devices/fcm-token': {
    verdict: 'SAFE',
    evidence: 'apps/notification/src/device/services/device.service.ts:76',
    predicate: '.where(and(eq(fcmTokens.userId, userId), eq(fcmTokens.token, token)));',
    note: "DeviceController.deactivateToken -> DeviceService.deactivateToken(userId, dto.token) issues the update gated on both eq(fcmTokens.userId, userId) and eq(fcmTokens.token, token), so a caller can only deactivate a token row that is already theirs; supplying another user's token value matches zero rows.",
  },
  'notification POST /devices/fcm-token': {
    verdict: 'SAFE',
    evidence: 'apps/notification/src/device/services/device.service.ts:57',
    predicate:
      '.onConflictDoUpdate({ target: fcmTokens.token, set: updateSet, setWhere: eq(fcmTokens.userId, userId) })',
    note: "Fixed (task-7, 2026-08-08; observability added in fix round 1). The no-deviceId branch's onConflictDoUpdate carries setWhere: eq(fcmTokens.userId, userId) (device.service.ts:57), so when the globally-unique token column (idx_fcm_token) conflicts with a row owned by a different user, Postgres's ON CONFLICT ... DO UPDATE ... WHERE skips the update entirely (silent no-op, still 201 to the client - avoids a token-existence oracle) instead of overwriting it. updateSet still has no userId, so ownership can never transfer even on a self-match. The skip is not silent server-side: .returning({ userId: fcmTokens.userId }) (device.service.ts:58) detects the zero-row result and DeviceService.registerToken logs a warn ('FCM token registration skipped: token already owned by another user', { userId }) - never the token itself - then returns before the unconditional success log. Proven by apps/notification/src/device/services/__tests__/device.service.idor.spec.ts: one test asserts the exact setWhere predicate reaches onConflictDoUpdate (not just the return value), two more assert the skip path logs exactly { userId } (no token) and suppresses the success log, and the normal path logs no warning. Contrast with DELETE below, which carries the same kind of ownership predicate via a WHERE clause.",
  },
  'search GET /health': {
    verdict: 'N/A',
    evidence: 'apps/search/src/health.controller.ts:8',
    predicate: '',
    note: '무인증 — 헬스체크. OpenSearchService.ping() 결과만 반환, 사용자/식별자 무관. SearchModule(search.module.ts)은 AuthorizationModule 자체를 import 하지 않고, main.ts 에도 전역 가드/미들웨어 없음 — search 앱 전체가 인증 체계를 안 씀.',
  },
  'search GET /search/products': {
    verdict: 'N/A',
    evidence: 'apps/search/src/search.controller.ts:13',
    predicate: '',
    note: '무인증 — 공개 상품 카탈로그 검색(키워드/카테고리/브랜드/가격/정렬). ProductSearchQueryDto 에 사용자 식별자 없음, 응답도 상품 메타(이름/가격/썸네일 등)뿐. 근거: 공개 카탈로그로 판단 — status:active 상품만 노출(product-index.service.ts:440)하고 개인 데이터 필드 없음. 단, includeMembersOnly 플래그(product-search-query.dto.ts:69, product-index.service.ts:470)는 클라이언트가 임의로 true 를 보내면 멤버십 인증 없이 멤버십 전용 상품까지 결과에 포함되는 별개의 접근제어 이슈로 observations 에 기록.',
  },
  'search GET /search/products/suggestions': {
    verdict: 'N/A',
    evidence: 'apps/search/src/search.controller.ts:23',
    predicate: '',
    note: '무인증 — 검색어 자동완성 제안(SearchKeywordService.suggestKeywords), 사용자와 무관한 공개 키워드 인덱스 조회. q/size 외 파라미터 없음(suggest-keywords-query.dto.ts).',
  },
  'search GET /search/products/trending-keywords': {
    verdict: 'N/A',
    evidence: 'apps/search/src/search.controller.ts:18',
    predicate: '',
    note: '무인증 — 플랫폼 전체 인기 검색어 집계(SearchKeywordService.getTrendingKeywords), 사용자와 무관한 공개 통계. size 외 파라미터 없음(trending-keywords-query.dto.ts).',
  },
  'ugc-service DELETE /qna/questions/:id': {
    verdict: 'SAFE',
    evidence: 'apps/ugc-service/src/qna/qna.service.ts:209',
    predicate: '.where(and(eq(questions.id, id), eq(questions.userId, userId), isNull(questions.deletedAt)))',
    note: 'soft delete UPDATE 자체에 userId 조건 포함(분리 가드 없음, PATCH보다 더 견고).',
  },
  'ugc-service DELETE /reviews/:id': {
    verdict: 'SAFE',
    evidence: 'apps/ugc-service/src/reviews/services/reviews.service.ts:574',
    predicate: 'eq(reviews.userId, userId),',
    note: 'soft delete UPDATE의 WHERE절에 직접 userId 포함.',
  },
  'ugc-service GET /qna/questions': {
    verdict: 'SAFE',
    evidence: 'apps/ugc-service/src/qna/qna.service.ts:336',
    predicate: 'const shouldHide = q.isSecret && !isAdmin && q.userId !== currentUserId;',
    note: "currentUserId는 @OptionalAuth() 하의 @User('userId') 토큰값이며 쿼리로 스푸핑 불가(QuestionListQueryDto에 userId 필드 없음).",
  },
  'ugc-service GET /qna/questions/:id': {
    verdict: 'SAFE',
    evidence: 'apps/ugc-service/src/qna/qna.service.ts:254',
    predicate: 'if (question.isSecret && !isAdmin && question.userId !== currentUserId) {',
    note: 'DB WHERE절이 아닌 앱 레벨 체크지만 currentUserId(토큰)로 비밀글 접근을 실제로 차단(ForbiddenException). 비밀글이 아니면 원래 공개 자원이라 IDOR 대상 아님.',
  },
  'ugc-service GET /qna/questions/me': {
    verdict: 'SAFE',
    evidence: 'apps/ugc-service/src/qna/qna.service.ts:443',
    predicate: 'const conditions: SQL[] = [eq(questions.userId, userId), isNull(questions.deletedAt)];',
  },
  'ugc-service GET /reviews/eligibilities': {
    verdict: 'SAFE',
    evidence: 'apps/ugc-service/src/reviews/services/review-eligibility.service.ts:66',
    predicate: 'const conditions: SQL[] = [eq(reviewEligibilities.userId, userId)];',
    note: "userId는 컨트롤러의 @User('userId') 토큰값(review-eligibility.controller.ts:68), 쿼리 파라미터가 아님 — POST /reviews/eligibilities의 P0 패턴이 이 GET에는 없음.",
  },
  'ugc-service GET /reviews/me': {
    verdict: 'SAFE',
    evidence: 'apps/ugc-service/src/reviews/services/reviews.service.ts:698',
    predicate:
      "const conditions: SQL[] = [eq(reviews.userId, userId), eq(reviews.status, 'active'), isNull(reviews.deletedAt)];",
  },
  'ugc-service PATCH /qna/questions/:id': {
    verdict: 'SAFE',
    evidence: 'apps/ugc-service/src/qna/qna.service.ts:171',
    predicate: '.where(and(eq(questions.id, id), eq(questions.userId, userId), isNull(questions.deletedAt)));',
    note: '실제 UPDATE(183행)는 eq(questions.id, id)만 쓰지만 같은 트랜잭션 내 이 줄의 사전 SELECT 가드가 없으면 진행되지 않아(NotFoundException) 현재는 안전. 취약점은 아니나 observations에 리팩터링 위험 기록.',
  },
  'ugc-service PATCH /reviews/:id': {
    verdict: 'SAFE',
    evidence: 'apps/ugc-service/src/reviews/services/reviews.service.ts:524',
    predicate: '.where(and(eq(reviews.id, id), eq(reviews.userId, userId), eq(reviews.sourceSystem, SOURCE_SYSTEM)))',
    note: '표본으로 제시된 확인 항목.',
  },
  'ugc-service POST /qna/questions': {
    verdict: 'N/A',
    evidence: 'apps/ugc-service/src/qna/qna.service.ts:123',
    predicate: '',
    note: "생성 라우트, 대상 객체 없음. userId는 @User('userId') 데코레이터(토큰)에서 오고 CreateQuestionDto에는 userId 필드가 없어 바디로 덮어쓸 수 없음(P0 패턴 아님).",
  },
  'ugc-service POST /reviews': {
    verdict: 'SAFE',
    evidence: 'apps/ugc-service/src/reviews/services/reviews.service.ts:423',
    predicate: 'eq(reviewEligibilities.userId, userId),',
    note: '바디의 dto.eligibilityId(타인 것 추측 가능)를 그대로 믿지 않고, eq(reviewEligibilities.userId, userId)로 토큰 userId 소유 자격인지 검증 — 자격 도용 후 리뷰 생성/포인트 적립 체인 재현 불가.',
  },
  'ugc-service POST /reviews/:id/reactions': {
    verdict: 'SAFE',
    evidence: 'apps/ugc-service/src/reviews/services/reviews.service.ts:362',
    predicate: 'eq(reactions.userId, userId),',
    note: '존재확인/삭제/삽입 모두 reactions.userId를 토큰 userId로 스코프. ToggleReactionDto에 userId 필드 없음(바디로 덮어쓸 수 없음).',
  },
  'user-service DELETE //recent-views/:recentViewId': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/recent-views/recent-views.service.ts:51',
    predicate: '.where(and(eq(schema.userRecentViews.userId, userId), eq(schema.userRecentViews.id, recentViewId)));',
    note: '존재 확인(42행)과 실제 삭제(51행) 모두 userId AND id 로 스코프된다 — path 의 :recentViewId 단독으로는 삭제되지 않는다.',
  },
  'user-service GET //recent-views': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/recent-views/recent-views.service.ts:31',
    predicate: '.where(eq(schema.userRecentViews.userId, userId))',
  },
  'user-service GET /business-licenses//me': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/business-licenses/business-licenses.service.ts:242',
    predicate: '.where(eq(businessLicenses.userId, userId))',
  },
  'user-service GET /cafe24/link': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/cafe24-link/cafe24-link.service.ts:370',
    predicate: '.where(and(eq(cafe24Links.userId, userId), isNull(cafe24Links.unlinkedAt)))',
  },
  'user-service GET /cafe24/migration': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/cafe24-link/cafe24-link.service.ts:272',
    predicate: '.where(and(eq(cafe24Links.userId, userId), isNull(cafe24Links.unlinkedAt)))',
    note: 'getMigrationItems(userId) -> lookupMigrationItem(userId, key) -> getCafe24LinkByUserId(userId) 에서 위 predicate로 스코프. 사용자 데이터 조회(getUserAndProfile)도 512행 .where(eq(users.id, userId)) 로 스코프.',
  },
  'user-service GET /cafe24/migration/:key': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/cafe24-link/cafe24-link.service.ts:272',
    predicate: '.where(and(eq(cafe24Links.userId, userId), isNull(cafe24Links.unlinkedAt)))',
    note: 'path 의 :key 는 assertMigrationKey 로 email/name/birthday/phone 중 하나인지만 검증하는 필드명이고 리소스 식별자가 아니다. 실제 대상 스코프는 CurrentUser(JWT)의 user.id 로만 결정되며 위 predicate 를 그대로 통과한다.',
  },
  'user-service GET /email-verification/identity-status': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/email-verification/services/identity-verification.service.ts:29',
    predicate: '.where(eq(userServiceSchema.users.id, userId))',
    note: '이메일 인증 확인 경로는 41행 eq(emailVerifications.email, me.email) 로 본인 이메일에 스코프된다. SMS 인증 확인 경로(54-63행)는 DB where 절에 사용자 식별자가 없고 purpose/isVerified/verifiedAt 만으로 전체 phoneVerifications 를 읽어 애플리케이션 코드에서 last8(전화번호) 문자열 비교로 필터링한다 — 결과적으로 본인 전화번호와 일치하는 것만 true 가 되어 교차 사용자 접근은 없지만, DB predicate 로 스코프되지 않는 점은 observations 에 별도 기록.',
  },
  'user-service GET /users/me': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/users/users.service.ts:63',
    predicate: '.where(eq(schema.users.id, userId))',
  },
  'user-service GET /users/me/profile': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/users/users.service.ts:115',
    predicate: '.where(eq(schema.users.id, userId))',
    note: 'getUserDetails(userId) 는 getUserBaseInfo(userId)(63행 동일 predicate)와 getUserExtendedInfo(userId)(115행)를 병렬로 호출하며 둘 다 eq(schema.users.id, userId) 로 스코프된다.',
  },
  'user-service GET /wishlist': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/wishlist/wishlist.service.ts:51',
    predicate: '.where(eq(schema.wishlist.userId, userId))',
  },
  'user-service GET /wishlist/:productId': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/wishlist/wishlist.service.ts:61',
    predicate: '.where(and(eq(schema.wishlist.userId, userId), eq(schema.wishlist.productId, productId)));',
  },
  'user-service PATCH /business-licenses//me/business-number': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/business-licenses/business-licenses.service.ts:476',
    predicate: '.where(eq(businessLicenses.userId, userId))',
    note: 'fillMyBusinessNumberIfEmpty(userId, businessNumber) 는 findBusinessLicenseByUserId(userId) (476행 predicate) 로 먼저 소유권을 확인해 license 를 얻고, 그 결과의 license.id 로만 update(265행: .where(eq(businessLicenses.id, license.id)))한다. 즉 최종 update 자체는 id 키지만, id 는 userId 로 스코프된 조회에서만 얻어진다.',
  },
  'user-service POST //recent-views': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/recent-views/recent-views.service.ts:16',
    predicate: '',
    note: 'addToRecentViews(userId, {productId}) 는 조회 없이 insert().onConflictDoUpdate() 만 수행(16-22행) — 별도 WHERE 조회 predicate 가 없다. AddToRecentViewsDto 에는 productId 만 있고 userId 는 CurrentUser(JWT)에서만 오므로 다른 사용자의 행을 지정할 수 없다 — 생성/삽입 라우트라 IDOR 대상 기존 객체가 없음.',
  },
  'user-service POST /auth/payment-handoff': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/auth/auth.service.ts:127',
    predicate: '',
    note: 'issuePaymentHandoffToken(userId) 은 DB 조회/변경이 전혀 없고 jwtService.signAsync({ sub: userId, ... }) 로 토큰만 서명한다. userId는 CurrentUser(JWT)에서만 오고, 조회 대상 객체(row)가 없어 IDOR 이 성립하지 않는다.',
  },
  'user-service POST /cafe24/link': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/cafe24-link/cafe24-link.service.ts:167',
    predicate: 'target: [cafe24Links.userId, cafe24Links.mallId],',
    note: 'onConflictDoUpdate 의 target 이 (userId, mallId) unique 제약이라 caller 자신의 행만 갱신 가능. 또한 152행에서 동일 cafe24MemberId 가 이미 다른 userId 에 연결돼 있으면 명시적으로 막는다(existingByMember.userId !== userId).',
  },
  'user-service POST /cafe24/migration/:key': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/cafe24-link/cafe24-link.service.ts:606',
    predicate: '.where(eq(users.id, userId));',
    note: 'migrateItem(userId, key) 도 getCafe24LinkByUserId(userId)(272행)로 먼저 스코프한 뒤, applyMigration 에서 key 에 따라 users/profiles 를 userId 로 갱신한다(606/610행: users, 618행: profiles.userId onConflict, 629-635행: profiles.userId onConflict). 모두 userId(JWT) 기준.',
  },
  'user-service POST /cafe24/unlink': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/cafe24-link/cafe24-link.service.ts:301',
    predicate: '.where(and(eq(cafe24Links.userId, userId), isNull(cafe24Links.unlinkedAt)))',
    note: '이 predicate 로 조회된 link 만 존재하며, 이후 update(308행: .where(eq(cafe24Links.id, link.id)))는 그 link.id 를 그대로 쓴다 — 최종 write 자체에 userId 재확인은 없지만 id 가 userId 스코프 조회에서만 나온다.',
  },
  'user-service POST /email-verification/send-code': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/email-verification/services/send-email-code.service.ts:26',
    predicate: '.where(eq(userServiceSchema.users.id, userId))',
    note: 'SendEmailCodeDto 에는 purpose 만 있고 email 필드가 없어 body 로 타겟 이메일을 지정할 수 없다 — 발송 대상은 오직 userId 로 조회한 본인 이메일.',
  },
  'user-service POST /email-verification/verify-code': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/email-verification/services/verify-email-code.service.ts:20',
    predicate: '.where(eq(userServiceSchema.users.id, userId))',
    note: '이후 인증코드 조회(30행: eq(table.email, user.email))도 이 userId로 얻은 본인 email 로 스코프된다.',
  },
  'user-service POST /wishlist': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/wishlist/wishlist.service.ts:16',
    predicate: '.where(and(eq(schema.wishlist.userId, userId), eq(schema.wishlist.productId, productId)))',
  },
};

const AUDIT = join(__dirname, 'route-authz-audit.js');

interface AuditRow {
  app: string;
  verb: string;
  route: string;
  file: string;
  line: number;
  idorTarget: boolean;
}

const runAudit = (): AuditRow[] =>
  JSON.parse(execFileSync('node', [AUDIT, '--json'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })) as AuditRow[];

/** 판정 명단의 키. `<app> <VERB> <route>` — app 이 빠지면 안 된다 (아래 테스트가 이유를 설명한다). */
const keyOf = (r: AuditRow): string => `${r.app} ${r.verb} ${r.route}`;

describe('IDOR 검사 대상 집합', () => {
  it('감사 스크립트가 idorTarget 을 내보낸다', () => {
    const targets = runAudit().filter((r) => r.idorTarget);
    expect(targets).toHaveLength(100);
  });

  // search 와 analytics 가 둘 다 `GET /health` 다. `<VERB> <route>` 로 키를 만들면
  // 97건이 96개로 뭉개지고 스냅샷이 한 건을 조용히 잃는다.
  it('키에 app 이 들어가야 충돌하지 않는다', () => {
    const targets = runAudit().filter((r) => r.idorTarget);
    expect(new Set(targets.map(keyOf)).size).toBe(100);
    expect(new Set(targets.map((r) => `${r.verb} ${r.route}`)).size).toBe(99);
  });

  it('감사 스크립트의 대상 집합과 명단이 정확히 일치한다', () => {
    const actual = new Set(
      runAudit()
        .filter((r) => r.idorTarget)
        .map(keyOf),
    );
    const listed = new Set(Object.keys(IDOR_REVIEWED));

    const unlisted = [...actual].filter((k) => !listed.has(k)).sort();
    const stale = [...listed].filter((k) => !actual.has(k)).sort();

    // 새 라우트가 명단에 없다 → 소유권 검사를 확인하고 근거와 함께 추가할 것
    expect(unlisted).toEqual([]);
    // 사라진 라우트가 명단에 남았다 → 명단을 정리할 것
    expect(stale).toEqual([]);
  });

  it('SAFE 판정에는 반드시 증거와 술어 원문이 있다', () => {
    const missing = Object.entries(IDOR_REVIEWED)
      .filter(([, v]) => v.verdict === 'SAFE')
      .filter(([, v]) => !/:\d+$/.test(v.evidence) || v.predicate.trim() === '')
      .map(([k]) => k);

    expect(missing).toEqual([]);
  });

  // 이전엔 evidence 좌표가 `:\d+$` 형식인지만 봤다 — 그건 "숫자로 끝나는가"만 확인할 뿐,
  // 그 줄 근처에 predicate 원문이 실제로 있는지는 안 본다. notification DELETE
  // /devices/fcm-token 이 이 구멍으로 조용히 드리프트했다: 이전 커밋들이 device.service.ts
  // 위쪽에 ~15줄을 추가했지만 형제 POST 엔트리만 재조정되고 이 엔트리는 그대로 남아 있었다.
  // 여기서는 evidence 파일을 열어 그 줄 ±5줄 안에 predicate 문자열이 실제로 존재하는지 본다.
  it('predicate 원문이 evidence 좌표 ±5줄 안에 실제로 있다 (좌표 드리프트 감지)', () => {
    const WINDOW = 5;
    const drifted = Object.entries(IDOR_REVIEWED)
      .filter(([, v]) => v.predicate.trim() !== '')
      .map(([k, v]) => {
        const m = /^(.+):(\d+)$/.exec(v.evidence);
        if (!m) return `${k}: evidence 가 file:line 형식이 아님 (${v.evidence})`;
        const [, file, lineStr] = m;
        const targetLine = Number(lineStr);

        let lines: string[];
        try {
          lines = readFileSync(join(REPO, file), 'utf8').split('\n');
        } catch {
          return `${k}: evidence 파일을 찾을 수 없음 (${file})`;
        }

        const start = Math.max(0, targetLine - 1 - WINDOW);
        const end = Math.min(lines.length, targetLine - 1 + WINDOW + 1);
        const window = lines.slice(start, end).join('\n');

        return window.includes(v.predicate) ? null : `${k}: predicate 가 ${v.evidence} 주변 ±${WINDOW}줄에 없음`;
      })
      .filter((x): x is string => x !== null);

    expect(drifted).toEqual([]);
  });

  it('미해결(VULN·UNCLEAR)이 남아 있으면 그 목록이 여기 보인다', () => {
    const open = Object.entries(IDOR_REVIEWED)
      .filter(([, v]) => v.verdict === 'VULN' || v.verdict === 'UNCLEAR')
      .map(([k, v]) => `${k} [${v.verdict}] ${v.note ?? ''}`);

    // 미해결이 남은 상태로 머지할 수 있다. 다만 이 테스트가 목록을 계속 보여준다.
    // 전부 해소하면 이 기대값을 [] 로 바꾸고 회귀를 막는다.
    expect(open).toEqual(EXPECTED_OPEN);
  });
});

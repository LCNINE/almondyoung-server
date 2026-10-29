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
    predicate: '@UseGuards(JwtAuthGuard, PermissionGuard)',
    note: '대시보드 요약(오늘/어제 전사 매출 + 활성 멤버십 수) — 사용자 소유 리소스 파라미터가 없어 IDOR 대상 아님. JwtAuthGuard 로 인증 요구. 응답이 전사 매출 수치라 관리자 스코프 제한은 analytics 전반 스코프 도입과 함께 별도 검토.',
  },
  'analytics GET /statistics/sales': {
    verdict: 'N/A',
    evidence: 'apps/analytics/src/features/statistics/api/statistics.controller.ts:15',
    predicate: '@UseGuards(JwtAuthGuard, PermissionGuard)',
    note: '기간별 전사 매출 집계 — 쿼리 파라미터가 날짜/채널뿐이라 IDOR 대상 아님. 컨트롤러 클래스에 JwtAuthGuard. 관리자 스코프는 위 /summary 와 같은 별도 검토 항목.',
  },
  'analytics GET /statistics/products': {
    verdict: 'N/A',
    evidence: 'apps/analytics/src/features/statistics/api/statistics.controller.ts:15',
    predicate: '@UseGuards(JwtAuthGuard, PermissionGuard)',
    note: '상품별 전사 집계 — 사용자 소유 리소스 파라미터 없음. 컨트롤러 클래스에 JwtAuthGuard.',
  },
  'analytics GET /statistics/products/unsold': {
    verdict: 'N/A',
    evidence: 'apps/analytics/src/features/statistics/api/statistics.controller.ts:15',
    predicate: '@UseGuards(JwtAuthGuard, PermissionGuard)',
    note: '기간 내 무판매 활성 상품 목록 — 쿼리 파라미터가 날짜/채널/limit 뿐이라 IDOR 대상 아님. 컨트롤러 클래스에 JwtAuthGuard.',
  },
  'analytics GET /statistics/customers': {
    verdict: 'N/A',
    evidence: 'apps/analytics/src/features/statistics/api/statistics.controller.ts:15',
    predicate: '@UseGuards(JwtAuthGuard, PermissionGuard)',
    note: '고객·멤버십 전사 집계 — 개별 고객 식별자를 받지 않고 등급/버킷 단위로만 반환. 컨트롤러 클래스에 JwtAuthGuard.',
  },
  'analytics GET /statistics/customers/insights': {
    verdict: 'N/A',
    evidence: 'apps/analytics/src/features/statistics/api/customer-insights.controller.ts:15',
    predicate: '@UseGuards(JwtAuthGuard, PermissionGuard)',
    note: '구매 기반 고객 분석(코호트·RFM·재구매·등급전환) — 쿼리 파라미터가 날짜/limit/minBuyers 뿐이고 응답도 버킷·집계 단위(개별 고객 식별자 없음)라 IDOR 대상 아님. 컨트롤러 클래스에 JwtAuthGuard + PermissionGuard(권한 키로 판정).',
  },
  'analytics GET /statistics/profit': {
    verdict: 'N/A',
    evidence: 'apps/analytics/src/features/statistics/api/profit.controller.ts:13',
    predicate: '@UseGuards(JwtAuthGuard, PermissionGuard)',
    note: '이익(수익성) 통계 — 쿼리 파라미터가 날짜/채널/정렬/페이지 뿐이고 응답도 상품 단위 집계(개별 고객 식별자 없음)라 IDOR 대상 아님. 컨트롤러 클래스에 JwtAuthGuard + PermissionGuard(권한 키로 판정).',
  },
  'analytics GET /statistics/traffic': {
    verdict: 'N/A',
    evidence: 'apps/analytics/src/features/traffic/api/traffic.controller.ts:29',
    predicate: '@UseGuards(JwtAuthGuard, PermissionGuard)',
    note: 'GA4 유입 통계(세션·랜딩페이지·기기·국가) — 쿼리 파라미터가 날짜/채널그룹/limit 뿐이고 응답도 전사 집계라 IDOR 대상 아님. 컨트롤러 클래스에 JwtAuthGuard + PermissionGuard(권한 키로 판정).',
  },
  'analytics GET /statistics/traffic/realtime': {
    verdict: 'N/A',
    evidence: 'apps/analytics/src/features/traffic/api/traffic.controller.ts:29',
    predicate: '@UseGuards(JwtAuthGuard, PermissionGuard)',
    note: 'GA4 실시간 접속(최근 30분 활성 사용자·페이지·기기) — 쿼리 파라미터가 limit 뿐이고 응답은 전사 집계라 사용자별 자원을 지목할 수단이 없다. GA4 는 개별 식별자를 주지 않는다. 같은 컨트롤러 클래스의 JwtAuthGuard + PermissionGuard(권한 키로 판정)를 그대로 받는다.',
  },
  'analytics GET /statistics/operating-costs': {
    verdict: 'N/A',
    evidence: 'apps/analytics/src/features/statistics/api/operating-cost.controller.ts:36',
    predicate: '@UseGuards(JwtAuthGuard, PermissionGuard)',
    note: '월 고정비 설정 목록 — 전사 단일 설정이라 사용자·테넌트 소유 자원이 아니다. 파라미터도 없다. JwtAuthGuard + PermissionGuard(권한 키로 판정).',
  },
  'analytics POST /statistics/operating-costs': {
    verdict: 'N/A',
    evidence: 'apps/analytics/src/features/statistics/api/operating-cost.controller.ts:36',
    predicate: '@UseGuards(JwtAuthGuard, PermissionGuard)',
    note: '월 고정비 등록 — 전사 단일 설정이라 소유권 개념이 없다. 본문은 금액·적용일·메모뿐이고 식별자를 받지 않는다. JwtAuthGuard + PermissionGuard(권한 키로 판정).',
  },
  'analytics DELETE /statistics/operating-costs/:id': {
    verdict: 'N/A',
    evidence: 'apps/analytics/src/features/statistics/api/operating-cost.controller.ts:36',
    predicate: '@UseGuards(JwtAuthGuard, PermissionGuard)',
    note: ':id 를 받지만 전사 단일 설정 테이블의 행이라 사용자별 소유자가 없다 — staff 끼리는 같은 자원을 공유한다. 남의 자원을 넘겨다볼 경계 자체가 존재하지 않는다. JwtAuthGuard + PermissionGuard(권한 키로 판정).',
  },
  'analytics GET /statistics/growth': {
    verdict: 'N/A',
    evidence: 'apps/analytics/src/features/growth/api/growth.controller.ts:21',
    predicate: '@UseGuards(JwtAuthGuard, PermissionGuard)',
    note: '성장 분석 — 전사 자사몰 매출·회원 재구매 집계·GA4 리포트. 파라미터가 날짜·집계 단위뿐이고 고객 식별자를 받지도 내보내지도 않는다(건수·금액 집계만). JwtAuthGuard + PermissionGuard(권한 키로 판정).',
  },
  'analytics GET /statistics/growth/summary': {
    verdict: 'N/A',
    evidence: 'apps/analytics/src/features/growth/api/growth.controller.ts:21',
    predicate: '@UseGuards(JwtAuthGuard, PermissionGuard)',
    note: '성장 요약 — 올해 목표·일별 순매출·최근 고객 흐름 집계. 파라미터가 없고 응답에 고객 식별자가 없다. JwtAuthGuard + PermissionGuard(권한 키로 판정).',
  },
  'analytics GET /statistics/revenue-goals': {
    verdict: 'N/A',
    evidence: 'apps/analytics/src/features/growth/api/revenue-goal.controller.ts:122',
    predicate: '@UseGuards(JwtAuthGuard, PermissionGuard)',
    note: '연간 매출 목표 목록 — 전사 단일 설정이라 사용자·테넌트 소유 자원이 아니다. 파라미터는 연도뿐. JwtAuthGuard + PermissionGuard(권한 키로 판정).',
  },
  'analytics POST /statistics/revenue-goals': {
    verdict: 'N/A',
    evidence: 'apps/analytics/src/features/growth/api/revenue-goal.controller.ts:122',
    predicate: '@UseGuards(JwtAuthGuard, PermissionGuard)',
    note: '연간 매출 목표 등록 — 전사 단일 설정이라 소유권 개념이 없다. 본문은 연도·금액·월 배분·가정·메모뿐이고 식별자를 받지 않는다. JwtAuthGuard + PermissionGuard(권한 키로 판정).',
  },
  'analytics DELETE /statistics/revenue-goals/:id': {
    verdict: 'N/A',
    evidence: 'apps/analytics/src/features/growth/api/revenue-goal.controller.ts:122',
    predicate: '@UseGuards(JwtAuthGuard, PermissionGuard)',
    note: ':id 를 받지만 전사 단일 설정 표의 행이라 사용자별 소유자가 없다 — staff 끼리 같은 자원을 공유한다. JwtAuthGuard + PermissionGuard(권한 키로 판정).',
  },
  'analytics GET /statistics/behavior': {
    verdict: 'N/A',
    evidence: 'apps/analytics/src/features/traffic/api/behavior.controller.ts:15',
    predicate: '@UseGuards(JwtAuthGuard, PermissionGuard)',
    note: 'GA4 행동 통계(구매 퍼널·일별 전환율·상품별·기기별) — 쿼리 파라미터가 날짜/limit 뿐이고 응답도 전사 집계(개별 사용자 식별자 없음)라 IDOR 대상 아님. 컨트롤러 클래스에 JwtAuthGuard + PermissionGuard(권한 키로 판정).',
  },
  'core GET /library/ownerships': {
    verdict: 'SAFE',
    evidence: 'apps/core/src/modules/library/services/ownership.service.ts:79',
    predicate: 'eq(digitalAssetOwnerships.customerId, customerId),',
    note: 'OwnershipController.list -> service.listForCustomer(customerId, ...); customerId 는 컨트롤러의 _requireUserId(req) 로 획득.',
  },
  'core POST /library/ownerships/order-status': {
    verdict: 'SAFE',
    evidence: 'apps/core/src/modules/library/services/ownership.service.ts:47',
    predicate: 'eq(digitalAssetOwnerships.customerId, customerId),',
    note: 'OwnershipController.orderStatus -> service.grantedMedusaOrderIds(customerId, body.channelOrderIds); customerId 는 _requireUserId(req). 요청한 주문 ID 는 inArray 필터일 뿐이고 본인 소유·미회수 권한만 돌려주므로 남의 주문 ID 를 넣어도 빈 결과다.',
  },
  'core GET /library/ownerships/:id/download': {
    verdict: 'SAFE',
    evidence: 'apps/core/src/modules/library/services/ownership.service.ts:365',
    predicate: 'if (row.ownership.customerId !== customerId) {',
    note: 'OwnershipController.download -> service.getDownloadable(id, customerId) -> _loadOwnedOrThrow(138줄)에서 동일 검증.',
  },
  'core GET /store/orders/:id/actions': {
    verdict: 'SAFE',
    evidence: 'apps/core/src/modules/sales-order/services/store-sales-orders.service.ts:369',
    predicate: 'if (customerId !== undefined && so.customerId !== customerId)',
    note: 'getActions -> findSoOrThrow({id: orderId}, customerId) 호출, 실제 소유권 검증은 findSoOrThrow 내부.',
  },
  'core GET /store/orders/:id/tracking': {
    verdict: 'SAFE',
    evidence: 'apps/core/src/modules/sales-order/services/store-sales-orders.service.ts:369',
    predicate: 'if (customerId !== undefined && so.customerId !== customerId)',
    note: 'getTracking -> findSoOrThrow({id: orderId}, customerId).',
  },
  'core GET /store/orders/by-channel-order/:channelOrderId/actions': {
    verdict: 'SAFE',
    evidence: 'apps/core/src/modules/sales-order/services/store-sales-orders.service.ts:369',
    predicate: 'if (customerId !== undefined && so.customerId !== customerId)',
    note: "getActionsByChannelOrder -> findSoOrThrow({channelOrderId, salesChannel:'medusa'}, customerId).",
  },
  'core GET /store/orders/by-channel-order/:channelOrderId/tracking': {
    verdict: 'SAFE',
    evidence: 'apps/core/src/modules/sales-order/services/store-sales-orders.service.ts:369',
    predicate: 'if (customerId !== undefined && so.customerId !== customerId)',
    note: "getTrackingByChannelOrder -> findSoOrThrow({channelOrderId, salesChannel:'medusa'}, customerId).",
  },
  'core GET /store/orders/by-channel-order/:channelOrderId/returns/:channelReturnId/progress': {
    verdict: 'SAFE',
    evidence: 'apps/core/src/modules/sales-order/services/store-sales-orders.service.ts:784',
    predicate: "if (so.customerId !== customerId) throw new NotFoundException('반품을 찾을 수 없습니다.');",
    note: "getReturnProgressByChannelOrder: 주문을 channelOrderId 로 찾고 so.customerId 가 토큰의 userId 와 다르면 404(존재 여부를 흘리지 않는다). 반품은 그 주문의 salesOrderId 와 channelReturnId 둘 다로 좁힌다(같은 파일 789행) — 남의 주문 반품 id 를 넣어도 내 주문 아래에서만 찾는다.",
  },
  'core GET /store/orders/by-wallet-intent/:walletIntentId/digital-exercised': {
    verdict: 'SAFE',
    evidence: 'apps/core/src/modules/sales-order/services/store-sales-orders.service.ts:117',
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
    evidence: 'apps/core/src/modules/sales-order/services/store-sales-orders.service.ts:369',
    predicate: 'if (customerId !== undefined && so.customerId !== customerId)',
    note: 'cancelRequest -> findSoOrThrow({id: orderId}, customerId) -> processCancelRequest 는 이미 소유권 검증된 so 만 사용.',
  },
  'core POST /store/orders/by-channel-order/:channelOrderId/cancel-request': {
    verdict: 'SAFE',
    evidence: 'apps/core/src/modules/sales-order/services/store-sales-orders.service.ts:369',
    predicate: 'if (customerId !== undefined && so.customerId !== customerId)',
    note: "cancelRequestByChannelOrder -> findSoOrThrow({channelOrderId, salesChannel:'medusa'}, customerId).",
  },
  'core POST /store/orders/by-channel-order/actions/batch': {
    verdict: 'SAFE',
    evidence: 'apps/core/src/modules/sales-order/services/store-sales-orders.service.ts:318',
    predicate: 'eq(inventoryTables.salesOrders.customerId, customerId),',
    note: 'getActionsByChannelOrderBatch; channelOrderIds IN + customerId 조건으로 직접 필터 (타인 주문은 결과셋에서 조용히 제외됨, DTO에 @ArrayMaxSize(100)).',
  },
  'file-service DELETE /files/:fileId': {
    verdict: 'SAFE',
    evidence: 'apps/file-service/src/access/file-access.ts:87',
    predicate: 'if (file.uploadedBy === user.userId) return true;',
    note: 'LifecycleController.deleteFile -> FileAccess.delete(fileId, user) (file-access.ts:65) -> isOwnerOrFileManager(file, user) (file-access.ts:70) gates the softDelete call on file.uploadedBy === user.userId, else the checkpoint file.owner_exception (system.file.manage; core delegation token = system principal). repo.softDelete(id) itself (file.repository.ts:44) only filters by eq(uploads.id, id), so all ownership enforcement lives in this application-layer check. Delete is NOT widened by the staff-context path — that path lives in loadReadable only.',
  },
  'file-service GET /files/:fileId/download': {
    verdict: 'SAFE',
    evidence: 'apps/file-service/src/access/file-access.ts:87',
    predicate: 'if (file.uploadedBy === user.userId) return true;',
    note: "DownloadController.getSignedUrl -> DownloadService.getSignedUrl (apps/file-service/src/download/download.service.ts:21) -> FileAccess.loadReadable(fileId, user) (file-access.ts:36) -> isOwnerOrFileManager (file-access.ts:86) compares file.uploadedBy against caller's own userId, else requires system.file.manage. A further allow path (file-access.ts:47-50): a caller holding the screen permission of the file's context (STAFF_CONTEXT_PERMISSIONS: digital-asset-file -> catalog.product.read, archive-page-attachment -> archive.page.read) may read files of that context. That is an intentional permission grant for admin review, not an IDOR: it is scoped by context, not by object id, and file-access.spec.ts asserts admin still cannot read a business-license file. Everything else throws ForbiddenError.",
  },
  'file-service GET /files/:fileId/open': {
    verdict: 'SAFE',
    evidence: 'apps/file-service/src/access/file-access.ts:87',
    predicate: 'if (file.uploadedBy === user.userId) return true;',
    note: "DownloadController.openFile -> DownloadService.getSignedUrl (apps/file-service/src/download/download.service.ts:21) -> FileAccess.loadReadable(fileId, user) (file-access.ts:36) -> isOwnerOrFileManager (file-access.ts:86) compares file.uploadedBy against the caller's own userId before the row is returned; the route then 302s to a 5-minute signed URL for that same row. Same gate as GET /files/:fileId/download — this route only changes the response shape (redirect instead of JSON) so a plain anchor in archive body text can open a private attachment. The staff-context allow path (file-access.ts:47-50) covers archive-page-attachment via archive.page.read: an intentional permission grant scoped by context, not by object id, and file-access.spec.ts asserts a non-staff caller is still refused.",
  },
  'file-service GET /files/:fileId/metadata': {
    verdict: 'SAFE',
    evidence: 'apps/file-service/src/access/file-access.ts:87',
    predicate: 'if (file.uploadedBy === user.userId) return true;',
    note: 'DownloadController.getMetadata -> DownloadService.getMetadata (download.service.ts:50) -> FileAccess.loadReadable(fileId, user) -> same isOwnerOrFileManager ownership check as the download route, and the same staff-context permission path at file-access.ts:47-50.',
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
    evidence: 'apps/file-service/src/upload/upload.service.ts:187',
    predicate: 'if (file.uploadedBy !== userId) {',
    note: 'UploadController.confirmUpload -> UploadService.confirmUpload(dto.fileId, user.userId). 바디의 fileId 가 기존 pending 행을 가리키는 client-supplied id 지만, 행을 읽자마자 file.uploadedBy 를 호출자 userId 와 대조해 다르면 ForbiddenError — 타인의 pending 업로드를 대신 activate 하거나 존재 여부를 활성화로 확인할 수 없다. upload.service.spec.ts 가 발급자 불일치 거부를 고정한다.',
  },
  'file-service POST /files/upload/presign': {
    verdict: 'N/A',
    evidence: 'apps/file-service/src/upload/upload.service.ts:140-154',
    predicate: '',
    note: 'Pure creation route: presignUpload() always inserts a brand-new pending row (id: uuidv7(), uploadedBy: userId); POST /files/upload 과 같은 이유로 client-supplied id 가 기존 타인 소유 행으로 해석되는 경로가 없다. dto.contextId 는 공유 설정(file_contexts) 조회일 뿐이다.',
  },
  'membership GET /me/arrears': {
    verdict: 'SAFE',
    evidence: 'apps/membership/src/services/arrears/arrears.reader.ts:72',
    predicate: "and(eq(schema.membershipArrears.userId, userId), eq(schema.membershipArrears.status, 'OUTSTANDING'))",
    note: "조회 대상 식별자를 경로·쿼리·본문 어디서도 받지 않는다. 컨트롤러가 @User('userId')(me-arrears.controller.ts:23)로 JWT 에서만 userId 를 얻어 ArrearsRepaymentService.getMine 에 넘기고, 그 아래 두 조회(findOutstandingByUserId: arrears.reader.ts:72, outstandingSummary: arrears.reader.ts:105)가 모두 userId 로 좁힌다. 같은 원장의 관리자 조회는 /admin/arrears/:userId 로 분리돼 있고 권한 membership.member.read 로 판정한다.",
  },
  'membership POST /me/arrears/checkout': {
    verdict: 'SAFE',
    evidence: 'apps/membership/src/services/arrears/arrears-repayment.service.ts:124',
    predicate: 'const items = await this.arrearsReader.findOutstandingByUserId(userId);',
    note: '결제 금액과 청산 대상 원장 id 를 «서버가» 호출자 본인의 미청산 줄에서만 만든다(arrears-repayment.service.ts:124-155). 본문은 returnUrl 만 받고 금액·arrearsId·userId 를 받지 않으므로 남의 미수를 지목할 파라미터 자체가 없다. 실제 청산도 소유자 조건이 걸린 한 문장으로만 일어난다(ArrearsManager.settleMany: arrears.manager.ts:155 eq(schema.membershipArrears.userId, userId)).',
  },
  'membership POST /me/benefit-usages': {
    verdict: 'SAFE',
    evidence: 'apps/membership/src/services/benefit/benefit-usage.manager.ts:67',
    predicate: '.values({ userId, kind, contractId: contractWithPlan?.contract.id ?? null, periodStart })',
    note: "본문은 kind(화이트리스트)와 acknowledged 만 받고 userId·계약 id·주기 시작을 받지 않는다. 컨트롤러가 @User('userId') 로 JWT 에서만 userId 를 얻고, 매니저의 조회(getActiveUserIds([userId]) · findCurrentEntitlement(userId) · findContractWithPlan(userId) · hasBenefitUsageSince(userId, …))와 쓰기가 모두 그 userId 로만 좁혀진다. 계약 id·주기 시작은 서버가 그 사용자의 현재 계약에서 계산한다.",
  },
  'membership POST /me/membership-terms-agreements': {
    verdict: 'N/A',
    evidence: 'apps/membership/src/services/terms/terms-agreement.manager.ts:55',
    predicate: '',
    note: "순수 생성 라우트: 호출자 JWT userId(@User('userId'), me-terms-agreement.controller.ts)로 새 동의 행을 insert 할 뿐이다. 바디는 termsVersion·billingMode·planId 인데 planId 는 공유 플랜 설정을 가리키지 사용자별 객체가 아니고, userId 는 받지 않는다. 기존 타인 소유 행으로 해석되는 id 가 없다.",
  },
  'membership GET /membership/benefits/current': {
    verdict: 'SAFE',
    evidence: 'apps/membership/src/services/benefit/benefit.reader.ts:80',
    predicate: 'eq(schema.membershipCycleBenefits.userId, userId),',
    note: 'BenefitTrackingController.getCurrentCycleBenefit -> BenefitTrackingService.getCurrentCycleBenefit(userId) -> BenefitReader.findCurrentCycleBenefit(userId,...) 의 where 절에 userId가 들어간다.',
  },
  'membership GET /membership/benefits/history': {
    verdict: 'SAFE',
    evidence: 'apps/membership/src/services/benefit/benefit.reader.ts:124',
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
    evidence: 'apps/membership/src/services/benefit/benefit.reader.ts:233',
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
  'membership GET /subscriptions/current/active': {
    verdict: 'SAFE',
    evidence: 'apps/membership/src/services/entitlement/entitlement.reader.ts:114',
    predicate: 'inArray(schema.subscriptionEntitlement.userId, userIds),',
    note: 'SubscriptionController.getCurrentActive(@User userId) -> SubscriptionService.isMembershipActive(userId) -> EntitlementService.getActiveUserIds([userId]). 호출자 JWT 의 userId 하나만 후보로 넘기고 결과도 boolean 만 돌려준다.',
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
    verdict: 'SAFE',
    evidence: 'apps/membership/src/services/terms/terms-agreement.manager.ts:94',
    predicate: 'eq(schema.membershipTermsAgreements.userId, userId),',
    note: '신규 결제 intent 생성 라우트이고 userId 는 @User() 로 취한 호출자 JWT 값뿐이다. 바디가 받는 기존 행 id 는 termsAgreementId(약관 동의 기록) 하나인데, TermsAgreementManager.resolveForSubscription 이 id + 호출자 userId 두 조건으로만 찾고(terms-agreement.manager.ts:94) 못 찾으면 400 — 남의 동의로 가입하거나 존재 여부를 알아낼 수 없다. 실 DB 통합 스펙(terms-agreement.manager.integration.spec.ts)이 남의 동의 거절을 고정한다.',
  },
  'membership POST /subscriptions/confirm-checkout-intent': {
    verdict: 'VULN',
    evidence: 'apps/membership/src/services/subscription.service.ts:220',
    predicate: '',
    note: '소유권 검사 없음. 핸들러(subscription.controller.ts:163-167)가 호출자 신원을 전혀 받지 않고 바디의 intentId 만 받으며, 서비스가 userId 를 intent 메타데이터에서 뽑는다. 재현: 인증된 A 가 B 의 intentId 로 호출하면 B 명의 구독이 생성된다. 영향 제한적 — intent 가 AUTHORIZED/CAPTURED 여야 하므로 B 가 이미 결제한 건이고 A 는 이득이 없다. 오케스트레이터 직접 확인 (조사 에이전트는 N/A 로 오판, 자기 observations 와 모순이었음).',
  },
  'membership POST /subscriptions/subscribe-with-method': {
    verdict: 'SAFE',
    evidence: 'apps/membership/src/services/terms/terms-agreement.manager.ts:94',
    predicate: 'eq(schema.membershipTermsAgreements.userId, userId),',
    note: '신규 구독 생성 라우트이고 userId 는 @User() 로 취한 호출자 JWT 값뿐이다(계약은 그 userId 로 새로 생성). 바디의 termsAgreementId 는 기존 행을 가리키지만 resolveForSubscription 이 id + 호출자 userId 로만 찾고(terms-agreement.manager.ts:94) 결제보다 먼저 검사한다. 가입 후 연결(linkContract)도 같은 소유자 조건을 건다(:118). billingMethodId 소유권 검사는 wallet 쪽 책임이라 observations 참고.',
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
    note: '무인증 — 헬스체크. OpenSearchService.ping() 결과만 반환, 사용자/식별자 무관. SearchModule 은 AuthorizationModule.forAuthOnly 로 인증만 등록하고(전역 가드 아님, 라우트별 @UseGuards), 이 라우트는 가드 없이 공개.',
  },
  'search GET /search/admin/keywords/statistics': {
    verdict: 'N/A',
    evidence: 'apps/search/src/admin-keyword.controller.ts:23',
    predicate: '@UseGuards(JwtAuthGuard, PermissionGuard)',
    note: '관리자 검색 키워드 통계 — 쿼리 파라미터가 날짜/limit 뿐이고 응답도 전사 키워드 집계라 IDOR 대상 아님. 컨트롤러 클래스에 JwtAuthGuard + PermissionGuard(권한 키로 판정).',
  },
  'search GET /search/admin/keywords/zero-hit': {
    verdict: 'N/A',
    evidence: 'apps/search/src/admin-keyword.controller.ts:23',
    predicate: '@UseGuards(JwtAuthGuard, PermissionGuard)',
    note: '관리자 0건 검색어 운영 목록 — 파라미터가 날짜/page/limit 뿐, 응답은 전사 키워드 집계 + 운영 상태(담당·메모)라 사용자 소유 리소스 식별자가 없어 IDOR 대상 아님. 컨트롤러 클래스에 JwtAuthGuard + PermissionGuard(권한 키로 판정).',
  },
  'search GET /search/admin/keywords/detail': {
    verdict: 'N/A',
    evidence: 'apps/search/src/admin-keyword.controller.ts:23',
    predicate: '@UseGuards(JwtAuthGuard, PermissionGuard)',
    note: '관리자 키워드 단건 드릴다운 — 파라미터가 keyword/날짜뿐이고 keyword 는 사용자 소유 리소스가 아니라 전사 검색 로그의 조회 축이라 IDOR 대상 아님. 컨트롤러 클래스에 JwtAuthGuard + PermissionGuard(권한 키로 판정).',
  },
  'search PATCH /search/admin/keywords/issues/:keywordNorm': {
    verdict: 'N/A',
    evidence: 'apps/search/src/admin-keyword.controller.ts:23',
    predicate: '@UseGuards(JwtAuthGuard, PermissionGuard)',
    note: '관리자 키워드 운영 상태 upsert — :keywordNorm 은 사용자 소유 리소스가 아니라 전사 검색 키워드 키다. 쓰기 대상(search_keyword_issues)도 운영 데이터라 소유권 개념이 없어 IDOR 대상 아님. staff 전체가 서로의 배정·메모를 수정하는 것은 의도(협업 도구). 컨트롤러 클래스에 JwtAuthGuard + PermissionGuard(권한 키로 판정).',
  },
  'search GET /search/products': {
    verdict: 'N/A',
    evidence: 'apps/search/src/search.controller.ts:13',
    predicate: '',
    note: '무인증 — 공개 상품 카탈로그 검색(키워드/카테고리/브랜드/가격/정렬). ProductSearchQueryDto 에 사용자 식별자 없음, 응답도 상품 메타(이름/가격/썸네일 등)뿐. 근거: 공개 카탈로그로 판단 — status:active 상품만 노출(product-index.service.ts:440)하고 개인 데이터 필드 없음. 단, includeMembersOnly 플래그(product-search-query.dto.ts:69, product-index.service.ts:470)는 클라이언트가 임의로 true 를 보내면 멤버십 인증 없이 멤버십 전용 상품까지 결과에 포함되는 별개의 접근제어 이슈로 observations 에 기록.',
  },
  'search POST /search/products/internal/sales-counts': {
    verdict: 'N/A',
    evidence: 'apps/search/src/internal-sales.controller.ts:40',
    predicate: 'authorization !== `Bearer ${this.internalKey}`',
    note: '서비스 간 내부 라우트 — Medusa 가 누적 판매 수량을 검색 색인에 밀어 넣는다. 사용자 토큰이 아니라 공유 시크릿(SEARCH_INTERNAL_KEY)으로 막으며(internal-sales.controller.ts:40-45), 키가 비어 있으면 라우트를 아예 잠근다(:40-42, fail-closed). 바디의 masterId 는 상품 마스터 ID 로 사용자 소유 리소스가 아니고 쓰기 대상(색인의 sales_count)도 전역 카탈로그 데이터라 소유권 개념이 없어 IDOR 대상 아님. 키가 새면 임의 상품의 판매량을 조작해 검색 랭킹을 흔들 수 있으므로(관련도 동점 구간 한정) 시크릿 취급은 결제 키에 준한다.',
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
    evidence: 'apps/ugc-service/src/qna/qna.service.ts:223',
    predicate: '.where(and(eq(questions.id, id), eq(questions.userId, userId), isNull(questions.deletedAt)))',
    note: 'soft delete UPDATE 자체에 userId 조건 포함(분리 가드 없음, PATCH보다 더 견고).',
  },
  'ugc-service DELETE /shop-listings/:id': {
    verdict: 'SAFE',
    evidence: 'apps/ugc-service/src/shop-listings/shop-listing.manager.ts:129',
    predicate: 'eq(shopListings.authorUserId, userId)',
    note: 'soft delete UPDATE 의 WHERE 에 작성자 조건. 0행이면 404(존재 은닉).',
  },
  'ugc-service GET /shop-listings/:id': {
    verdict: 'SAFE',
    evidence: 'apps/ugc-service/src/shop-listings/shop-listing.reader.ts:89',
    predicate: 'eq(shopListings.authorUserId, userId)',
    note: "findOwned — SELECT WHERE 에 작성자 조건. userId 는 @User('userId') 토큰값.",
  },
  'ugc-service GET /shop-listings/mine': {
    verdict: 'SAFE',
    evidence: 'apps/ugc-service/src/shop-listings/shop-listing.reader.ts:70',
    predicate: 'eq(shopListings.authorUserId, userId)',
  },
  'ugc-service GET /shop-listings/public/:slug/contact': {
    verdict: 'N/A',
    evidence: 'apps/ugc-service/src/shop-listings/shop-listing.reader.ts:44',
    predicate: '',
    note: '소유자 자원이 아니다 — 공개(published·closed) 매물의 연락처를 로그인 회원 누구에게나 보여주는 것이 설계다(spec §7.2). 비공개 상태는 404.',
  },
  'ugc-service POST /shop-listings': {
    verdict: 'N/A',
    evidence: 'apps/ugc-service/src/shop-listings/controllers/member-shop-listings.controller.ts:19',
    predicate: '',
    note: "생성 — 대상 id 가 없다. 작성자는 토큰(@User('userId'))에서만 오고 DTO 에 작성자 필드가 없다.",
  },
  'ugc-service POST /shop-listings/:id/close': {
    verdict: 'SAFE',
    evidence: 'apps/ugc-service/src/shop-listings/shop-listing.reader.ts:89',
    predicate: 'eq(shopListings.authorUserId, userId)',
    note: 'setDealStatusByMember 가 findOwned 로 먼저 소유권을 확인한다(남의 글 404).',
  },
  'ugc-service POST /shop-listings/:id/reopen': {
    verdict: 'SAFE',
    evidence: 'apps/ugc-service/src/shop-listings/shop-listing.reader.ts:89',
    predicate: 'eq(shopListings.authorUserId, userId)',
    note: 'close 와 같은 경로.',
  },
  'ugc-service PUT /shop-listings/:id': {
    verdict: 'SAFE',
    evidence: 'apps/ugc-service/src/shop-listings/shop-listing.reader.ts:89',
    predicate: 'eq(shopListings.authorUserId, userId)',
    note: 'updateByMember 가 findOwned 로 소유권 확인 후 상태 CAS UPDATE.',
  },
  'ugc-service DELETE /reviews/:id': {
    verdict: 'SAFE',
    evidence: 'apps/ugc-service/src/reviews/services/reviews.service.ts:705',
    predicate: 'eq(reviews.userId, userId),',
    note: 'soft delete UPDATE의 WHERE절에 직접 userId 포함.',
  },
  'ugc-service GET /qna/questions': {
    verdict: 'SAFE',
    evidence: 'apps/ugc-service/src/qna/qna.service.ts:350',
    predicate: 'const shouldHide = q.isSecret && !isAdmin && q.userId !== currentUserId;',
    note: "currentUserId는 @OptionalAuth() 하의 @User('userId') 토큰값이며 쿼리로 스푸핑 불가(QuestionListQueryDto에 userId 필드 없음).",
  },
  'ugc-service GET /qna/questions/:id': {
    verdict: 'SAFE',
    evidence: 'apps/ugc-service/src/qna/qna.service.ts:268',
    predicate: 'if (question.isSecret && !isAdmin && question.userId !== currentUserId) {',
    note: 'DB WHERE절이 아닌 앱 레벨 체크지만 currentUserId(토큰)로 비밀글 접근을 실제로 차단(ForbiddenException). 비밀글이 아니면 원래 공개 자원이라 IDOR 대상 아님.',
  },
  'ugc-service GET /qna/questions/me': {
    verdict: 'SAFE',
    evidence: 'apps/ugc-service/src/qna/qna.service.ts:489',
    predicate: 'const conditions: SQL[] = [eq(questions.userId, userId), isNull(questions.deletedAt)];',
  },
  'ugc-service GET /reviews/eligibilities': {
    verdict: 'SAFE',
    evidence: 'apps/ugc-service/src/review-permissions/review-permission.service.ts:89',
    predicate: 'const conditions: SQL[] = [eq(reviewEligibilities.userId, userId)];',
    note: "userId는 컨트롤러의 @User('userId') 토큰값(review-eligibility.controller.ts:68), 쿼리 파라미터가 아님 — POST /reviews/eligibilities의 P0 패턴이 이 GET에는 없음.",
  },
  'ugc-service GET /reviews/me': {
    verdict: 'SAFE',
    evidence: 'apps/ugc-service/src/reviews/services/reviews.service.ts:831',
    predicate:
      "const conditions: SQL[] = [eq(reviews.userId, userId), eq(reviews.status, 'active'), isNull(reviews.deletedAt)];",
  },
  'ugc-service DELETE /logo-contest/entries/:id': {
    verdict: 'SAFE',
    evidence: 'apps/ugc-service/src/logo-contest/services/logo-contest.service.ts:212',
    predicate: "if (entry.userId !== userId) throw new ForbiddenError('본인 출품작만 삭제할 수 있습니다.');",
    note: "같은 트랜잭션 안의 사전 SELECT 뒤 앱 레벨 체크다. userId 는 @User('userId') 토큰값이고 삭제 대상은 경로의 id 뿐 — 남의 출품작을 지우면 403 이다. 표 삭제도 같은 트랜잭션에서 그 entryId 로만 한정된다.",
  },
  'ugc-service GET /logo-contest/me': {
    verdict: 'SAFE',
    evidence: 'apps/ugc-service/src/logo-contest/services/logo-contest.service.ts:130',
    predicate: '.where(and(eq(logoContestEntries.userId, userId), isNull(logoContestEntries.deletedAt)));',
    note: '내 출품작과 내 표만 돌려준다. userId 는 토큰값이고 이 라우트는 쿼리 파라미터를 받지 않는다.',
  },
  'ugc-service POST /logo-contest/entries': {
    verdict: 'SAFE',
    evidence: 'apps/ugc-service/src/logo-contest/clients/file-owner.client.ts:38',
    predicate: 'if (file.uploadedBy !== userId) {',
    note: '생성 라우트라 대상 객체는 없지만(userId 는 토큰값, CreateLogoContestEntryDto 에 userId 필드 없음) 바디의 mediaFileIds 가 남의 fileId 일 수 있어 file-service 내부 조회로 업로더와 컨텍스트를 확인한다 — 리뷰의 normalizeMediaFileIds 는 개수·중복만 봐서 이 구멍이 열려 있다.',
  },
  'ugc-service DELETE /logo-contest/entries/:id/vote': {
    verdict: 'SAFE',
    evidence: 'apps/ugc-service/src/logo-contest/services/logo-contest.service.ts:256',
    predicate: '.where(and(eq(logoContestVotes.userId, userId), eq(logoContestVotes.entryId, entryId)));',
    note: '지우는 것은 내 표뿐이다. userId 는 토큰값이라 경로의 id 로 남의 표를 지울 수 없고, 그 출품작에 내 표가 없으면 아무 행도 지워지지 않는다.',
  },
  'ugc-service POST /logo-contest/entries/:id/vote': {
    verdict: 'N/A',
    evidence: 'apps/ugc-service/src/logo-contest/services/logo-contest.service.ts:234',
    predicate: '',
    note: '남의 출품작에 투표하는 것이 이 라우트의 목적이라 대상 객체의 소유권 검사가 성립하지 않는다. 투표자는 토큰 userId 로만 기록되고(바디 없음) 자기 작품 투표는 400, 한 사람 한 표라 다른 작품을 누르면 votes.userId 충돌로 표가 옮겨진다.',
  },
  'ugc-service GET /almond-designs/:id': {
    verdict: 'SAFE',
    evidence: 'apps/ugc-service/src/almond-template/services/almond-design.reader.ts:25',
    predicate: 'and(eq(almondDesigns.id, id), eq(almondDesigns.userId, userId))',
    note: "findOwned — SELECT WHERE 에 소유자 조건. 0행이면 404(존재 은닉). userId 는 @User('userId') 토큰값.",
  },
  'ugc-service POST /almond-designs': {
    verdict: 'N/A',
    evidence: 'apps/ugc-service/src/almond-template/services/almond-design.manager.ts:82',
    predicate: '',
    note: "생성 전용. userId 는 @User('userId') 토큰값으로만 채우고 바디로 받지 않는다. templateId 는 공개 시안 참조라 남의 자원이 아니다.",
  },
  'ugc-service DELETE /me/almond-saved-designs/:id': {
    verdict: 'SAFE',
    evidence: 'apps/ugc-service/src/almond-template/services/almond-saved-design.manager.ts:62',
    predicate: 'and(eq(almondSavedDesigns.id, id), eq(almondSavedDesigns.userId, userId))',
    note: "DELETE 의 WHERE 에 소유자 조건. 0행이면 404(존재 은닉). userId 는 @User('userId') 토큰값.",
  },
  'ugc-service GET /me/almond-saved-designs': {
    verdict: 'SAFE',
    evidence: 'apps/ugc-service/src/almond-template/services/almond-saved-design.reader.ts:30',
    predicate: 'eq(almondSavedDesigns.userId, userId)',
    note: 'listOwned — 첫 조건이 소유자. productId·size 는 거기에 덧붙는 좁히기 조건일 뿐이다.',
  },
  'ugc-service GET /me/almond-saved-designs/:id': {
    verdict: 'SAFE',
    evidence: 'apps/ugc-service/src/almond-template/services/almond-saved-design.reader.ts:50',
    predicate: 'and(eq(almondSavedDesigns.id, id), eq(almondSavedDesigns.userId, userId))',
    note: 'findOwned — SELECT WHERE 에 소유자 조건. 0행이면 404(존재 은닉).',
  },
  'ugc-service GET /me/almond-saved-designs/:id/thumbnail': {
    verdict: 'SAFE',
    evidence: 'apps/ugc-service/src/almond-template/services/almond-saved-design.reader.ts:50',
    predicate: 'and(eq(almondSavedDesigns.id, id), eq(almondSavedDesigns.userId, userId))',
    note: '상세와 같은 findOwned 를 거친다.',
  },
  'ugc-service PUT /me/almond-saved-designs': {
    verdict: 'SAFE',
    evidence: 'apps/ugc-service/src/almond-template/services/almond-saved-design.manager.ts:36',
    predicate: 'and(eq(almondSavedDesigns.id, id), eq(almondSavedDesigns.userId, userId))',
    note: 'id 가 있으면 UPDATE WHERE 에 소유자 조건(남의 id 는 0행 → 404). 없으면 새로 만들고 userId 는 토큰값으로만 채운다.',
  },
  'ugc-service PATCH /qna/questions/:id': {
    verdict: 'SAFE',
    evidence: 'apps/ugc-service/src/qna/qna.service.ts:185',
    predicate: '.where(and(eq(questions.id, id), eq(questions.userId, userId), isNull(questions.deletedAt)));',
    note: '실제 UPDATE(183행)는 eq(questions.id, id)만 쓰지만 같은 트랜잭션 내 이 줄의 사전 SELECT 가드가 없으면 진행되지 않아(NotFoundException) 현재는 안전. 취약점은 아니나 observations에 리팩터링 위험 기록.',
  },
  'ugc-service PATCH /reviews/:id': {
    verdict: 'SAFE',
    evidence: 'apps/ugc-service/src/reviews/services/reviews.service.ts:649',
    predicate:
      '.where(and(eq(reviews.id, id), eq(reviews.userId, userId), eq(reviews.sourceSystem, OWN_SOURCE_SYSTEM)))',
    note: '표본으로 제시된 확인 항목.',
  },
  'ugc-service POST /qna/questions': {
    verdict: 'N/A',
    evidence: 'apps/ugc-service/src/qna/qna.service.ts:129',
    predicate: '',
    note: "생성 라우트, 대상 객체 없음. userId는 @User('userId') 데코레이터(토큰)에서 오고 CreateQuestionDto에는 userId 필드가 없어 바디로 덮어쓸 수 없음(P0 패턴 아님).",
  },
  'ugc-service POST /reviews': {
    verdict: 'SAFE',
    evidence: 'apps/ugc-service/src/review-permissions/review-permission.service.ts:150',
    predicate: 'eq(reviewEligibilities.userId, input.userId),',
    note: '바디의 dto.eligibilityId(타인 것 추측 가능)를 그대로 믿지 않고, 권한 모듈의 consume 이 토큰 userId 소유 자격인지 검증 — 자격 도용 후 리뷰 생성/포인트 적립 체인 재현 불가. 소유권 술어는 확인과 소비를 합친 조건부 UPDATE 의 WHERE 에 그대로 남아 있다.',
  },
  'ugc-service POST /reviews/:id/reactions': {
    verdict: 'SAFE',
    evidence: 'apps/ugc-service/src/reviews/services/reviews.service.ts:431',
    predicate: 'eq(reactions.userId, userId),',
    note: '존재확인/삭제/삽입 모두 reactions.userId를 토큰 userId로 스코프. ToggleReactionDto에 userId 필드 없음(바디로 덮어쓸 수 없음).',
  },
  'user-service GET /attendance/me': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/attendance/controllers/attendance.controller.ts:58',
    predicate:
      'async (tx) => (await this.repo.findOpen(tx, user.id)) ?? (await this.repo.findDay(tx, user.id, today)),',
    note: '본인 세션·설정·휴가만 토큰 user.id 로 읽는다. 관리자 표시(isMaster)는 판정 지점이 정한다.',
  },
  'user-service POST /attendance/punch': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/attendance/controllers/attendance.controller.ts:84',
    predicate: 'return this.service.punch(user.id, dto);',
    note: '사람을 고르는 값은 토큰의 user.id 뿐이다(DTO 에 userId 필드 없음).',
  },
  'user-service GET /attendance/records': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/attendance/controllers/attendance.controller.ts:95',
    predicate: 'userId !== user.id &&',
    note: '쿼리 userId 가 본인이 아니면 판정 지점 attendance.staff_records(직원 근태 조회)를 통과해야 한다 — 못 하면 403.',
  },
  'user-service GET /attendance/calendar': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/attendance/controllers/attendance.controller.ts:106',
    predicate: '',
    note: '호출자가 대상 사람을 고르지 않는 직원 공용 목록 — 근태 직원 전원에게 다른 직원의 이름·휴가 일정을 같은 내용으로 보여 주는 설계(공유 달력 통합 테스트가 타인 일정 반환을 기대). 내 근태 권한을 주면 이 공유 조회도 함께 열린다.',
  },
  'user-service GET /attendance/overview': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/attendance/controllers/attendance.controller.ts:140',
    predicate: '',
    note: '호출자가 대상 사람을 고르지 않는 직원 공용 목록 — 근태 직원 전원에게 직원별 이름·근무 상태·휴가 시간을 같은 내용으로 보여 주는 설계. 내 근태 권한을 주면 이 공유 조회도 함께 열린다.',
  },
  'user-service PUT /attendance/settings': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/attendance/controllers/attendance.controller.ts:161',
    predicate: '.values({ userId: user.id, settings: dto })',
    note: '사람을 고르는 값은 토큰의 user.id 뿐이다(DTO 에 userId 필드 없음).',
  },
  'user-service GET /attendance/worksites': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/attendance/controllers/attendance.controller.ts:175',
    predicate: "this.checkpoints.check('attendance.worksite_inactive'",
    note: '근무지는 개인 소유가 아니다. 쉬는 근무지는 판정 지점 attendance.worksite_inactive 를 통과할 때만 보인다.',
  },
  'user-service GET /attendance/recommendations': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/attendance/services/attendance-calendar.service.ts:66',
    predicate: 'eq(attendanceLeaves.userId, userId),',
    note: '사람을 고르는 값은 토큰의 user.id 뿐이다(DTO 에 userId 필드 없음).',
  },
  'user-service POST /attendance/leaves': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/attendance/services/attendance-calendar.service.ts:150',
    predicate: '.where(and(eq(attendanceLeaves.userId, userId), isNull(attendanceLeaves.deletedAt)));',
    note: '사람을 고르는 값은 토큰의 user.id 뿐이다(DTO 에 userId 필드 없음).',
  },
  'user-service DELETE /attendance/leaves/:id': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/attendance/services/attendance-calendar.service.ts:206',
    predicate: 'assertLeaveOwner(row.userId, userId);',
    note: 'path 의 :id 행을 읽은 뒤 소유자가 토큰 userId 가 아니면 거부한다.',
  },
  'user-service PUT /attendance/leaves/:id': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/attendance/services/attendance-calendar.service.ts:231',
    predicate: 'assertLeaveOwner(row.userId, userId);',
    note: 'path 의 :id 행을 읽은 뒤 소유자가 토큰 userId 가 아니면 거부한다.',
  },
  'user-service GET /attendance/requests': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/attendance/services/attendance-request.manager.ts:88',
    predicate: '.where(master ? undefined : eq(attendanceRequests.userId, userId))',
    note: '이 라우트는 master=false 로 부른다(전체 목록은 /attendance/review, 검토 권한).',
  },
  'user-service GET /attendance/requests/:id/history': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/attendance/services/attendance-request.manager.ts:101',
    predicate:
      '.where(and(eq(attendanceRequests.id, id), canReadStaff ? undefined : eq(attendanceRequests.userId, userId)));',
    note: '직원 근태 조회 판정 지점을 통과하지 못하면 id AND 토큰 userId 로 좁힌다 — 남의 요청은 404.',
  },
  'user-service POST /attendance/requests': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/attendance/services/attendance-request.manager.ts:232',
    predicate: '.values({ ...input, userId, sessionId: session?.id ?? null, targetVersion: session?.version ?? null })',
    note: '생성 라우트. 사람을 고르는 값은 토큰의 user.id 뿐이다(DTO 에 userId 필드 없음).',
  },
  'user-service POST /attendance/requests/:id/cancel': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/attendance/services/attendance-request.manager.ts:143',
    predicate: '.where(and(eq(attendanceRequests.id, id), eq(attendanceRequests.userId, userId)))',
    note: 'id AND 토큰 userId — 남의 요청은 404.',
  },
  'user-service POST /attendance/requests/:id/resubmit': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/attendance/services/attendance-request.manager.ts:358',
    predicate: '.where(and(eq(attendanceRequests.id, id), eq(attendanceRequests.userId, userId)))',
    note: 'id AND 토큰 userId — 남의 요청은 404.',
  },
  'user-service GET /attendance/wage/me': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/attendance/wage/wage.repository.ts:126',
    predicate: 'filter.userId ? eq(attendanceWorkers.userId, filter.userId) : undefined',
    note: '경로·쿼리에 사람을 고르는 값이 없다 — 핸들러가 토큰의 user.id 만 넘기고(wage-me.controller.ts:18), 명단 조회가 SQL 에서 그 사람으로 좁혀 그 사람의 기록만 읽는다. 확정본도 jsonb_path_query_first 로 같은 userId 의 몫만 꺼낸다(wage.repository.ts confirmedShare).',
  },
  'user-service DELETE //recent-views/:recentViewId': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/recent-views/recent-views.service.ts:51',
    predicate: '.where(and(eq(schema.userRecentViews.userId, userId), eq(schema.userRecentViews.id, recentViewId)));',
    note: '존재 확인(42행)과 실제 삭제(51행) 모두 userId AND id 로 스코프된다 — path 의 :recentViewId 단독으로는 삭제되지 않는다.',
  },
  'user-service POST /iam/pii-access-logs': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/iam/pii-access/pii-access-record.controller.ts:25',
    predicate: 'actorUserId: actor.userId,',
    note: '행위자는 토큰에서만 정한다(본문 DTO 에 행위자 필드 없음, forbidNonWhitelisted). 기록 권한은 Manager 가 권한 사본으로 customer.pii.read 를 직접 본다.',
  },
  'user-service GET //recent-views': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/recent-views/recent-views.service.ts:31',
    predicate: '.where(eq(schema.userRecentViews.userId, userId))',
  },
  'user-service GET /business-licenses//me': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/business-licenses/business-licenses.service.ts:293',
    predicate: '.where(eq(businessLicenses.userId, userId))',
  },
  'user-service GET /me/permissions': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/iam/me-permissions.controller.ts:21',
    predicate: 'this.iamService.forRoles(user.roles ?? [])',
    note: '입력은 서명 검증된 토큰의 역할뿐이다. 다른 사용자를 지정하는 파라미터가 없고, 응답은 그 역할들의 권한 키 합집합과 역할 표시 이름이다.',
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
    evidence: 'apps/user-service/src/api/users/users.service.ts:93',
    predicate: '.where(eq(schema.users.id, userId))',
    note: 'getUserDetails(userId) 는 getUserBaseInfo(userId)(65행 동일 predicate)와 getUserExtendedInfo(userId)(93행)를 병렬로 호출하며 둘 다 eq(schema.users.id, userId) 로 스코프된다.',
  },
  'user-service GET /beautytop/growth-notes': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/beautytop-growth/growth-notes.repository.ts:30',
    predicate: 'eq(beautytopGrowthNotes.userId, userId),',
    note: 'JWT CurrentUser에서만 userId를 받는다. 조회는 사용자·샵 종류·샵 ID로 제한하고 개인 기록만 반환한다.',
  },
  'user-service POST /beautytop/growth-notes': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/beautytop-growth/growth-notes.repository.ts:45',
    predicate: 'eq(beautytopSavedShops.userId, userId),',
    note: 'JWT CurrentUser에서 userId를 받는다. 동일 트랜잭션에서 사용자 소유 MY_SHOP을 잠금 확인한 뒤 같은 userId로 기록한다.',
  },
  'user-service DELETE /beautytop/growth-notes/:id': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/beautytop-growth/growth-notes.repository.ts:75',
    predicate: 'eq(beautytopGrowthNotes.userId, userId),',
    note: '기록 ID뿐 아니라 JWT CurrentUser의 userId 및 샵 종류·ID를 함께 검사하므로 타인 기록을 삭제할 수 없다.',
  },
  'user-service GET /beautytop/shops': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/beautytop-shops/beautytop-shops.service.ts:42',
    predicate: '.where(eq(schema.beautytopSavedShops.userId, userId))',
  },
  'user-service PUT /beautytop/shops/my-shop': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/beautytop-shops/beautytop-shops.service.ts:52',
    predicate:
      ".where(and(eq(schema.beautytopSavedShops.userId, userId), eq(schema.beautytopSavedShops.role, 'MY_SHOP')));",
    note: '대상 사용자는 @CurrentUser 의 id 하나다. 지우기·넣기 모두 그 userId 로만 좁혀지고(넣기는 53행 values(userId, …)), 본문은 샵 정보만 받는다.',
  },
  'user-service POST /beautytop/shops/watch': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/beautytop-shops/beautytop-shops.service.ts:67',
    predicate: ".values(values(userId, 'WATCH', shop))",
    note: '본문은 뷰티탑 샵 정보만 받고 userId 는 받지 않는다. 상한 판정에 쓰는 목록도 같은 userId 로 읽는다(list).',
  },
  'user-service DELETE /beautytop/shops/watch/:shopKind/:shopId': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/beautytop-shops/beautytop-shops.service.ts:78',
    predicate: 'eq(schema.beautytopSavedShops.userId, userId),',
    note: '경로의 shopKind·shopId 는 «어느 샵을» 지울지일 뿐 «누구의» 것인지가 아니다 — 삭제 조건에 호출자 userId 가 함께 걸린다.',
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
    evidence: 'apps/user-service/src/api/business-licenses/business-licenses.service.ts:538',
    predicate: '.where(eq(businessLicenses.userId, userId))',
    note: 'fillMyBusinessNumberIfEmpty(userId, businessNumber) 는 findBusinessLicenseByUserId(userId) (538행 predicate) 로 먼저 소유권을 확인해 license 를 얻고, 그 결과의 license.id 로만 update(316행: .where(eq(businessLicenses.id, license.id)))한다. 즉 최종 update 자체는 id 키지만, id 는 userId 로 스코프된 조회에서만 얻어진다.',
  },
  'user-service POST //recent-views': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/recent-views/recent-views.service.ts:16',
    predicate: '',
    note: 'addToRecentViews(userId, {productId}) 는 조회 없이 insert().onConflictDoUpdate() 만 수행(16-22행) — 별도 WHERE 조회 predicate 가 없다. AddToRecentViewsDto 에는 productId 만 있고 userId 는 CurrentUser(JWT)에서만 오므로 다른 사용자의 행을 지정할 수 없다 — 생성/삽입 라우트라 IDOR 대상 기존 객체가 없음.',
  },
  'user-service POST /auth/change-password': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/auth/auth.service.ts:960',
    predicate: '.where(eq(userServiceSchema.users.id, userId))',
    note: 'changePassword(current, next, userId) 의 userId 는 CurrentUser(JWT)에서만 온다. 조회(960행)와 갱신(988행) 모두 같은 predicate 로 본인 행만 건드리고, 현재 비밀번호를 bcrypt 로 확인한다.',
  },
  'user-service POST /auth/verify-password-for-pin-reset': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/auth/auth.service.ts:1015',
    predicate: '.where(eq(userServiceSchema.users.id, userId))',
    note: 'verifyPasswordAndIssuePinResetToken(password, userId) 는 checkPassword(1015행)로 본인 행의 비밀번호만 확인하고 sub=userId 토큰을 서명한다. userId 는 CurrentUser(JWT)에서만 온다.',
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
  'user-service GET //admin/oauth-clients': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/admin/oauth-clients/oauth-clients.controller.ts:18',
    predicate: '',
    note: 'OAuth 클라이언트 관리 — 시스템 설정이라 회원 소유 리소스가 없다. 판정은 권한 키 system.oauth_client.write(첫 부여 없음 = master 만) 하나가 한다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service POST //admin/oauth-clients': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/admin/oauth-clients/oauth-clients.controller.ts:34',
    predicate: '',
    note: 'OAuth 클라이언트 관리 — 시스템 설정이라 회원 소유 리소스가 없다. 판정은 권한 키 system.oauth_client.write(첫 부여 없음 = master 만) 하나가 한다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service DELETE //admin/oauth-clients/:clientId': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/admin/oauth-clients/oauth-clients.controller.ts:69',
    predicate: '',
    note: 'OAuth 클라이언트 관리 — 시스템 설정이라 회원 소유 리소스가 없다. 판정은 권한 키 system.oauth_client.write(첫 부여 없음 = master 만) 하나가 한다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service GET //admin/oauth-clients/:clientId': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/admin/oauth-clients/oauth-clients.controller.ts:26',
    predicate: '',
    note: 'OAuth 클라이언트 관리 — 시스템 설정이라 회원 소유 리소스가 없다. 판정은 권한 키 system.oauth_client.write(첫 부여 없음 = master 만) 하나가 한다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service PATCH //admin/oauth-clients/:clientId': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/admin/oauth-clients/oauth-clients.controller.ts:42',
    predicate: '',
    note: 'OAuth 클라이언트 관리 — 시스템 설정이라 회원 소유 리소스가 없다. 판정은 권한 키 system.oauth_client.write(첫 부여 없음 = master 만) 하나가 한다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service POST //admin/oauth-clients/:clientId/clear-previous-secret': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/admin/oauth-clients/oauth-clients.controller.ts:61',
    predicate: '',
    note: 'OAuth 클라이언트 관리 — 시스템 설정이라 회원 소유 리소스가 없다. 판정은 권한 키 system.oauth_client.write(첫 부여 없음 = master 만) 하나가 한다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service POST //admin/oauth-clients/:clientId/rotate-secret': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/admin/oauth-clients/oauth-clients.controller.ts:53',
    predicate: '',
    note: 'OAuth 클라이언트 관리 — 시스템 설정이라 회원 소유 리소스가 없다. 판정은 권한 키 system.oauth_client.write(첫 부여 없음 = master 만) 하나가 한다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service POST /admin/auth': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/admin/auth/auth.controller.ts:15',
    predicate: '',
    note: '역할·권한·관리자 계정 관리 화면 — 임의의 역할·사람을 고르는 것이 기능이다. 권한 상승·시스템 역할 규칙은 iam Manager 가 지킨다. 판정은 권한 키 iam.admin_user.write(첫 부여 없음 = master 만) 하나가 한다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service PATCH /admin/auth/change-password': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/admin/auth/auth.controller.ts:21',
    predicate: '',
    note: '관리자 회원 관리 화면 — 임의 회원을 식별자로 고르는 것이 기능이다(고객 역할은 이 권한을 갖지 않는다). 판정은 권한 키 customer.profile.write(첫 부여: admin) 하나가 한다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service GET /admin/blacklists': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/admin/blacklists/blacklists.controller.ts:15',
    predicate: '',
    note: '관리자 회원 관리 화면 — 임의 회원을 식별자로 고르는 것이 기능이다(고객 역할은 이 권한을 갖지 않는다). 판정은 권한 키 customer.profile.read(첫 부여: admin, intern) 하나가 한다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service POST /admin/blacklists': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/admin/blacklists/blacklists.controller.ts:57',
    predicate: '',
    note: '관리자 회원 관리 화면 — 임의 회원을 식별자로 고르는 것이 기능이다(고객 역할은 이 권한을 갖지 않는다). 판정은 권한 키 customer.blacklist.write(첫 부여: admin) 하나가 한다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service DELETE /admin/blacklists/:userId': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/admin/blacklists/blacklists.controller.ts:71',
    predicate: '',
    note: '관리자 회원 관리 화면 — 임의 회원을 식별자로 고르는 것이 기능이다(고객 역할은 이 권한을 갖지 않는다). 판정은 권한 키 customer.blacklist.write(첫 부여: admin) 하나가 한다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service GET /admin/blacklists/:userId': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/admin/blacklists/blacklists.controller.ts:45',
    predicate: '',
    note: '관리자 회원 관리 화면 — 임의 회원을 식별자로 고르는 것이 기능이다(고객 역할은 이 권한을 갖지 않는다). 판정은 권한 키 customer.profile.read(첫 부여: admin, intern) 하나가 한다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service GET /admin/business-licenses': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/admin/business-licenses/business-licenses.controller.ts:66',
    predicate: '',
    note: '관리자 회원 관리 화면 — 임의 회원을 식별자로 고르는 것이 기능이다(고객 역할은 이 권한을 갖지 않는다). 판정은 권한 키 customer.profile.read(첫 부여: admin, intern) 하나가 한다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service GET /admin/business-licenses//user/:userId': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/admin/business-licenses/business-licenses.controller.ts:17',
    predicate: '',
    note: '관리자 회원 관리 화면 — 임의 회원을 식별자로 고르는 것이 기능이다(고객 역할은 이 권한을 갖지 않는다). 판정은 권한 키 customer.profile.read(첫 부여: admin, intern) 하나가 한다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service POST /admin/business-licenses//user/:userId': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/admin/business-licenses/business-licenses.controller.ts:36',
    predicate: '',
    note: '관리자 회원 관리 화면 — 임의 회원을 식별자로 고르는 것이 기능이다(고객 역할은 이 권한을 갖지 않는다). 판정은 권한 키 customer.business_verification.review(첫 부여: admin) 하나가 한다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service PUT /admin/business-licenses/:businessId': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/admin/business-licenses/business-licenses.controller.ts:106',
    predicate: '',
    note: '관리자 회원 관리 화면 — 임의 회원을 식별자로 고르는 것이 기능이다(고객 역할은 이 권한을 갖지 않는다). 판정은 권한 키 customer.business_verification.review(첫 부여: admin) 하나가 한다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service DELETE /admin/business-licenses/:id': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/admin/business-licenses/business-licenses.controller.ts:123',
    predicate: '',
    note: '관리자 회원 관리 화면 — 임의 회원을 식별자로 고르는 것이 기능이다(고객 역할은 이 권한을 갖지 않는다). 판정은 권한 키 customer.account.archive(첫 부여: admin) 하나가 한다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service GET /admin/business-licenses/:id': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/admin/business-licenses/business-licenses.controller.ts:89',
    predicate: '',
    note: '관리자 회원 관리 화면 — 임의 회원을 식별자로 고르는 것이 기능이다(고객 역할은 이 권한을 갖지 않는다). 판정은 권한 키 customer.profile.read(첫 부여: admin, intern) 하나가 한다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service GET /admin/business-licenses/stats/daily': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/admin/business-licenses/business-licenses.controller.ts:59',
    predicate: '',
    note: '관리자 회원 관리 화면 — 임의 회원을 식별자로 고르는 것이 기능이다(고객 역할은 이 권한을 갖지 않는다). 판정은 권한 키 customer.profile.read(첫 부여: admin, intern) 하나가 한다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service POST /admin/dormant/process': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/admin/dormant/dormant.controller.ts:12',
    predicate: '',
    note: '관리자 회원 관리 화면 — 임의 회원을 식별자로 고르는 것이 기능이다(고객 역할은 이 권한을 갖지 않는다). 판정은 권한 키 customer.dormant.execute(첫 부여 없음 = master 만) 하나가 한다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service GET /admin/iam/audit-logs': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/iam/audit/iam-audit.controller.ts:13',
    predicate: '',
    note: '역할·권한·관리자 계정 관리 화면 — 임의의 역할·사람을 고르는 것이 기능이다. 권한 상승·시스템 역할 규칙은 iam Manager 가 지킨다. 판정은 권한 키 iam.audit_log.read(첫 부여: admin) 하나가 한다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service GET /admin/iam/pii-access-logs': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/iam/pii-access/pii-access-log.controller.ts:21',
    predicate: '',
    note: '역할·권한·관리자 계정 관리 화면 — 임의의 역할·사람을 고르는 것이 기능이다. 권한 상승·시스템 역할 규칙은 iam Manager 가 지킨다. 판정은 권한 키 iam.pii_access_log.read(첫 부여 없음 = master 만) 하나가 한다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service GET /admin/iam/pii-access-logs/summary': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/iam/pii-access/pii-access-log.controller.ts:28',
    predicate: '',
    note: '역할·권한·관리자 계정 관리 화면 — 임의의 역할·사람을 고르는 것이 기능이다. 권한 상승·시스템 역할 규칙은 iam Manager 가 지킨다. 판정은 권한 키 iam.pii_access_log.read(첫 부여 없음 = master 만) 하나가 한다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service GET /admin/iam/pii-access-reviews': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/iam/pii-access/pii-access-log.controller.ts:35',
    predicate: '',
    note: '역할·권한·관리자 계정 관리 화면 — 임의의 역할·사람을 고르는 것이 기능이다. 권한 상승·시스템 역할 규칙은 iam Manager 가 지킨다. 판정은 권한 키 iam.pii_access_log.read(첫 부여 없음 = master 만) 하나가 한다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service POST /admin/iam/pii-access-reviews': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/iam/pii-access/pii-access-log.controller.ts:42',
    predicate: '',
    note: '역할·권한·관리자 계정 관리 화면 — 임의의 역할·사람을 고르는 것이 기능이다. 권한 상승·시스템 역할 규칙은 iam Manager 가 지킨다. 판정은 권한 키 iam.pii_access_log.read(첫 부여 없음 = master 만) 하나가 한다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service GET /admin/roles': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/iam/roles/role-admin.controller.ts:34',
    predicate: '',
    note: '역할·권한·관리자 계정 관리 화면 — 임의의 역할·사람을 고르는 것이 기능이다. 권한 상승·시스템 역할 규칙은 iam Manager 가 지킨다. 판정은 권한 키 iam.role.read(첫 부여 없음 = master 만) 하나가 한다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service POST /admin/roles': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/iam/roles/role-admin.controller.ts:48',
    predicate: '',
    note: '역할·권한·관리자 계정 관리 화면 — 임의의 역할·사람을 고르는 것이 기능이다. 권한 상승·시스템 역할 규칙은 iam Manager 가 지킨다. 판정은 권한 키 iam.role.write(첫 부여 없음 = master 만) 하나가 한다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service DELETE /admin/roles/:roleId': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/iam/roles/role-admin.controller.ts:77',
    predicate: '',
    note: '역할·권한·관리자 계정 관리 화면 — 임의의 역할·사람을 고르는 것이 기능이다. 권한 상승·시스템 역할 규칙은 iam Manager 가 지킨다. 판정은 권한 키 iam.role.write(첫 부여 없음 = master 만) 하나가 한다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service GET /admin/roles/:roleId': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/iam/roles/role-admin.controller.ts:41',
    predicate: '',
    note: '역할·권한·관리자 계정 관리 화면 — 임의의 역할·사람을 고르는 것이 기능이다. 권한 상승·시스템 역할 규칙은 iam Manager 가 지킨다. 판정은 권한 키 iam.role.read(첫 부여 없음 = master 만) 하나가 한다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service PATCH /admin/roles/:roleId': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/iam/roles/role-admin.controller.ts:55',
    predicate: '',
    note: '역할·권한·관리자 계정 관리 화면 — 임의의 역할·사람을 고르는 것이 기능이다. 권한 상승·시스템 역할 규칙은 iam Manager 가 지킨다. 판정은 권한 키 iam.role.write(첫 부여 없음 = master 만) 하나가 한다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service GET /admin/roles/:roleId/members': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/iam/assignments/role-assignment.controller.ts:49',
    predicate: '',
    note: '역할·권한·관리자 계정 관리 화면 — 임의의 역할·사람을 고르는 것이 기능이다. 권한 상승·시스템 역할 규칙은 iam Manager 가 지킨다. 판정은 권한 키 iam.role.read(첫 부여 없음 = master 만) 하나가 한다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service POST /admin/roles/:roleId/members': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/iam/assignments/role-assignment.controller.ts:57',
    predicate: '',
    note: '역할·권한·관리자 계정 관리 화면 — 임의의 역할·사람을 고르는 것이 기능이다. 권한 상승·시스템 역할 규칙은 iam Manager 가 지킨다. 판정은 권한 키 iam.role.assign(첫 부여 없음 = master 만) 하나가 한다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service DELETE /admin/roles/:roleId/members/:userId': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/iam/assignments/role-assignment.controller.ts:68',
    predicate: '',
    note: '역할·권한·관리자 계정 관리 화면 — 임의의 역할·사람을 고르는 것이 기능이다. 권한 상승·시스템 역할 규칙은 iam Manager 가 지킨다. 판정은 권한 키 iam.role.assign(첫 부여 없음 = master 만) 하나가 한다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service PUT /admin/roles/:roleId/permissions': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/iam/roles/role-admin.controller.ts:66',
    predicate: '',
    note: '역할·권한·관리자 계정 관리 화면 — 임의의 역할·사람을 고르는 것이 기능이다. 권한 상승·시스템 역할 규칙은 iam Manager 가 지킨다. 판정은 권한 키 iam.role.write(첫 부여 없음 = master 만) 하나가 한다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service GET /admin/shops//:userId': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/admin/shop/shop.controller.ts:11',
    predicate: '',
    note: '관리자 회원 관리 화면 — 임의 회원을 식별자로 고르는 것이 기능이다(고객 역할은 이 권한을 갖지 않는다). 판정은 권한 키 customer.profile.read(첫 부여: admin, intern) 하나가 한다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service GET /admin/users': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/admin/users/users.controller.ts:29',
    predicate: '',
    note: '관리자 회원 관리 화면 — 임의 회원을 식별자로 고르는 것이 기능이다(고객 역할은 이 권한을 갖지 않는다). 판정은 권한 키 customer.profile.read(첫 부여: admin, intern) 하나가 한다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service GET /admin/users/:userId': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/admin/users/users.controller.ts:95',
    predicate: '',
    note: '관리자 회원 관리 화면 — 임의 회원을 식별자로 고르는 것이 기능이다(고객 역할은 이 권한을 갖지 않는다). 판정은 권한 키 customer.profile.read(첫 부여: admin, intern) 하나가 한다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service PATCH /admin/users/:userId': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/admin/users/users.controller.ts:128',
    predicate: '',
    note: '관리자 회원 관리 화면 — 임의 회원을 식별자로 고르는 것이 기능이다(고객 역할은 이 권한을 갖지 않는다). 판정은 권한 키 customer.profile.write(첫 부여: admin) 하나가 한다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service GET /admin/users/:userId/roles': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/iam/assignments/role-assignment.controller.ts:20',
    predicate: '',
    note: '역할·권한·관리자 계정 관리 화면 — 임의의 역할·사람을 고르는 것이 기능이다. 권한 상승·시스템 역할 규칙은 iam Manager 가 지킨다. 판정은 권한 키 iam.role.read(첫 부여 없음 = master 만) 하나가 한다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service PUT /admin/users/:userId/roles': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/iam/assignments/role-assignment.controller.ts:27',
    predicate: '',
    note: '역할·권한·관리자 계정 관리 화면 — 임의의 역할·사람을 고르는 것이 기능이다. 권한 상승·시스템 역할 규칙은 iam Manager 가 지킨다. 판정은 권한 키 iam.role.assign(첫 부여 없음 = master 만) 하나가 한다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service PUT /admin/users/:userId/staff-roles': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/iam/assignments/role-assignment.controller.ts:38',
    predicate: '',
    note: '역할·권한·관리자 계정 관리 화면 — 임의의 역할·사람을 고르는 것이 기능이다. 권한 상승·시스템 역할 규칙은 iam Manager 가 지킨다. 판정은 권한 키 iam.role.assign(첫 부여 없음 = master 만) 하나가 한다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service GET /admin/users/consent/:userId': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/admin/users/users.controller.ts:81',
    predicate: '',
    note: '관리자 회원 관리 화면 — 임의 회원을 식별자로 고르는 것이 기능이다(고객 역할은 이 권한을 갖지 않는다). 판정은 권한 키 customer.profile.read(첫 부여: admin, intern) 하나가 한다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service GET /admin/users/consents': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/admin/users/users.controller.ts:55',
    predicate: '',
    note: '관리자 회원 관리 화면 — 임의 회원을 식별자로 고르는 것이 기능이다(고객 역할은 이 권한을 갖지 않는다). 판정은 권한 키 customer.profile.read(첫 부여: admin, intern) 하나가 한다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service GET /admin/users/stats/daily-signups': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/admin/users/users.controller.ts:48',
    predicate: '',
    note: '관리자 회원 관리 화면 — 임의 회원을 식별자로 고르는 것이 기능이다(고객 역할은 이 권한을 갖지 않는다). 판정은 권한 키 customer.profile.read(첫 부여: admin, intern) 하나가 한다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service POST /attendance/requests/:id/decision': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/attendance/controllers/attendance-requests.controller.ts:49',
    predicate: '',
    note: '근태 관리 화면 — 직원 전원의 신청·근무지·급여를 다루는 것이 기능이라 대상 직원을 고르는 값은 소유권 검사 대상이 아니다. 클래스의 ActiveAttendanceStaffGuard 는 그대로다. 판정은 권한 키 attendance.request.review(첫 부여 없음 = master 만) 하나가 한다. 옛 가드 MasterRoleGuard 를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service GET /attendance/review': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/attendance/controllers/attendance-requests.controller.ts:43',
    predicate: '',
    note: '근태 관리 화면 — 직원 전원의 신청·근무지·급여를 다루는 것이 기능이라 대상 직원을 고르는 값은 소유권 검사 대상이 아니다. 클래스의 ActiveAttendanceStaffGuard 는 그대로다. 판정은 권한 키 attendance.request.review(첫 부여 없음 = master 만) 하나가 한다. 옛 가드 MasterRoleGuard 를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service GET /attendance/statistics/monthly': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/attendance/controllers/attendance-statistics.controller.ts:11',
    predicate: '',
    note: '근태 관리 화면 — 직원 전원의 신청·근무지·급여를 다루는 것이 기능이라 대상 직원을 고르는 값은 소유권 검사 대상이 아니다. 클래스의 ActiveAttendanceStaffGuard 는 그대로다. 판정은 권한 키 attendance.statistics.read(첫 부여 없음 = master 만) 하나가 한다. 옛 가드 MasterRoleGuard 를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service DELETE /attendance/wage/absences/:userId/:workDate': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/attendance/wage/wage-settlement.controller.ts:72',
    predicate: '',
    note: '근태 관리 화면 — 직원 전원의 신청·근무지·급여를 다루는 것이 기능이라 대상 직원을 고르는 값은 소유권 검사 대상이 아니다. 클래스의 ActiveAttendanceStaffGuard 는 그대로다. 판정은 권한 키 attendance.request.review(첫 부여 없음 = master 만) 하나가 한다. 옛 가드 MasterRoleGuard 를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service PUT /attendance/wage/absences/:userId/:workDate': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/attendance/wage/wage-settlement.controller.ts:51',
    predicate: '',
    note: '근태 관리 화면 — 직원 전원의 신청·근무지·급여를 다루는 것이 기능이라 대상 직원을 고르는 값은 소유권 검사 대상이 아니다. 클래스의 ActiveAttendanceStaffGuard 는 그대로다. 판정은 권한 키 attendance.request.review(첫 부여 없음 = master 만) 하나가 한다. 옛 가드 MasterRoleGuard 를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service GET /attendance/wage/decisions': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/attendance/wage/wage-settlement.controller.ts:34',
    predicate: '',
    note: '근태 관리 화면 — 직원 전원의 신청·근무지·급여를 다루는 것이 기능이라 대상 직원을 고르는 값은 소유권 검사 대상이 아니다. 클래스의 ActiveAttendanceStaffGuard 는 그대로다. 판정은 권한 키 attendance.request.review(첫 부여 없음 = master 만) 하나가 한다. 옛 가드 MasterRoleGuard 를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service GET /attendance/wage/decisions/groups': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/attendance/wage/wage-settlement.controller.ts:28',
    predicate: '',
    note: '근태 관리 화면 — 직원 전원의 신청·근무지·급여를 다루는 것이 기능이라 대상 직원을 고르는 값은 소유권 검사 대상이 아니다. 클래스의 ActiveAttendanceStaffGuard 는 그대로다. 판정은 권한 키 attendance.request.review(첫 부여 없음 = master 만) 하나가 한다. 옛 가드 MasterRoleGuard 를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service GET /attendance/wage/groups': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/attendance/wage/wage-settings.controller.ts:34',
    predicate: '',
    note: '근태 관리 화면 — 직원 전원의 신청·근무지·급여를 다루는 것이 기능이라 대상 직원을 고르는 값은 소유권 검사 대상이 아니다. 클래스의 ActiveAttendanceStaffGuard 는 그대로다. 판정은 권한 키 attendance.wage.read(첫 부여 없음 = master 만) 하나가 한다. 옛 가드 MasterRoleGuard 를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service POST /attendance/wage/groups': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/attendance/wage/wage-settings.controller.ts:40',
    predicate: '',
    note: '근태 관리 화면 — 직원 전원의 신청·근무지·급여를 다루는 것이 기능이라 대상 직원을 고르는 값은 소유권 검사 대상이 아니다. 클래스의 ActiveAttendanceStaffGuard 는 그대로다. 판정은 권한 키 attendance.wage.write(첫 부여 없음 = master 만) 하나가 한다. 옛 가드 MasterRoleGuard 를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service DELETE /attendance/wage/groups/:id': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/attendance/wage/wage-settings.controller.ts:126',
    predicate: '',
    note: '근태 관리 화면 — 직원 전원의 신청·근무지·급여를 다루는 것이 기능이라 대상 직원을 고르는 값은 소유권 검사 대상이 아니다. 클래스의 ActiveAttendanceStaffGuard 는 그대로다. 판정은 권한 키 attendance.wage.write(첫 부여 없음 = master 만) 하나가 한다. 옛 가드 MasterRoleGuard 를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service PATCH /attendance/wage/groups/:id': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/attendance/wage/wage-settings.controller.ts:46',
    predicate: '',
    note: '근태 관리 화면 — 직원 전원의 신청·근무지·급여를 다루는 것이 기능이라 대상 직원을 고르는 값은 소유권 검사 대상이 아니다. 클래스의 ActiveAttendanceStaffGuard 는 그대로다. 판정은 권한 키 attendance.wage.write(첫 부여 없음 = master 만) 하나가 한다. 옛 가드 MasterRoleGuard 를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service GET /attendance/wage/groups/:id/policies': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/attendance/wage/wage-settings.controller.ts:56',
    predicate: '',
    note: '근태 관리 화면 — 직원 전원의 신청·근무지·급여를 다루는 것이 기능이라 대상 직원을 고르는 값은 소유권 검사 대상이 아니다. 클래스의 ActiveAttendanceStaffGuard 는 그대로다. 판정은 권한 키 attendance.wage.read(첫 부여 없음 = master 만) 하나가 한다. 옛 가드 MasterRoleGuard 를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service POST /attendance/wage/groups/:id/policies': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/attendance/wage/wage-settings.controller.ts:62',
    predicate: '',
    note: '근태 관리 화면 — 직원 전원의 신청·근무지·급여를 다루는 것이 기능이라 대상 직원을 고르는 값은 소유권 검사 대상이 아니다. 클래스의 ActiveAttendanceStaffGuard 는 그대로다. 판정은 권한 키 attendance.wage.write(첫 부여 없음 = master 만) 하나가 한다. 옛 가드 MasterRoleGuard 를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service DELETE /attendance/wage/groups/:id/policies/:policyId': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/attendance/wage/wage-settings.controller.ts:143',
    predicate: '',
    note: '근태 관리 화면 — 직원 전원의 신청·근무지·급여를 다루는 것이 기능이라 대상 직원을 고르는 값은 소유권 검사 대상이 아니다. 클래스의 ActiveAttendanceStaffGuard 는 그대로다. 판정은 권한 키 attendance.wage.write(첫 부여 없음 = master 만) 하나가 한다. 옛 가드 MasterRoleGuard 를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service PATCH /attendance/wage/groups/:id/policies/:policyId': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/attendance/wage/wage-settings.controller.ts:132',
    predicate: '',
    note: '근태 관리 화면 — 직원 전원의 신청·근무지·급여를 다루는 것이 기능이라 대상 직원을 고르는 값은 소유권 검사 대상이 아니다. 클래스의 ActiveAttendanceStaffGuard 는 그대로다. 판정은 권한 키 attendance.wage.write(첫 부여 없음 = master 만) 하나가 한다. 옛 가드 MasterRoleGuard 를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service GET /attendance/wage/minimum-wages': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/attendance/wage/wage-settings.controller.ts:114',
    predicate: '',
    note: '근태 관리 화면 — 직원 전원의 신청·근무지·급여를 다루는 것이 기능이라 대상 직원을 고르는 값은 소유권 검사 대상이 아니다. 클래스의 ActiveAttendanceStaffGuard 는 그대로다. 판정은 권한 키 attendance.wage.read(첫 부여 없음 = master 만) 하나가 한다. 옛 가드 MasterRoleGuard 를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service POST /attendance/wage/minimum-wages': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/attendance/wage/wage-settings.controller.ts:120',
    predicate: '',
    note: '근태 관리 화면 — 직원 전원의 신청·근무지·급여를 다루는 것이 기능이라 대상 직원을 고르는 값은 소유권 검사 대상이 아니다. 클래스의 ActiveAttendanceStaffGuard 는 그대로다. 판정은 권한 키 attendance.wage.write(첫 부여 없음 = master 만) 하나가 한다. 옛 가드 MasterRoleGuard 를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service DELETE /attendance/wage/minimum-wages/:effectiveFrom': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/attendance/wage/wage-settings.controller.ts:211',
    predicate: '',
    note: '근태 관리 화면 — 직원 전원의 신청·근무지·급여를 다루는 것이 기능이라 대상 직원을 고르는 값은 소유권 검사 대상이 아니다. 클래스의 ActiveAttendanceStaffGuard 는 그대로다. 판정은 권한 키 attendance.wage.write(첫 부여 없음 = master 만) 하나가 한다. 옛 가드 MasterRoleGuard 를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service PATCH /attendance/wage/minimum-wages/:effectiveFrom': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/attendance/wage/wage-settings.controller.ts:201',
    predicate: '',
    note: '근태 관리 화면 — 직원 전원의 신청·근무지·급여를 다루는 것이 기능이라 대상 직원을 고르는 값은 소유권 검사 대상이 아니다. 클래스의 ActiveAttendanceStaffGuard 는 그대로다. 판정은 권한 키 attendance.wage.write(첫 부여 없음 = master 만) 하나가 한다. 옛 가드 MasterRoleGuard 를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service DELETE /attendance/wage/overtime/:userId/:workDate': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/attendance/wage/wage-settlement.controller.ts:62',
    predicate: '',
    note: '근태 관리 화면 — 직원 전원의 신청·근무지·급여를 다루는 것이 기능이라 대상 직원을 고르는 값은 소유권 검사 대상이 아니다. 클래스의 ActiveAttendanceStaffGuard 는 그대로다. 판정은 권한 키 attendance.request.review(첫 부여 없음 = master 만) 하나가 한다. 옛 가드 MasterRoleGuard 를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service PUT /attendance/wage/overtime/:userId/:workDate': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/attendance/wage/wage-settlement.controller.ts:40',
    predicate: '',
    note: '근태 관리 화면 — 직원 전원의 신청·근무지·급여를 다루는 것이 기능이라 대상 직원을 고르는 값은 소유권 검사 대상이 아니다. 클래스의 ActiveAttendanceStaffGuard 는 그대로다. 판정은 권한 키 attendance.request.review(첫 부여 없음 = master 만) 하나가 한다. 옛 가드 MasterRoleGuard 를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service GET /attendance/wage/settlements': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/attendance/wage/wage-settlement.controller.ts:94',
    predicate: '',
    note: '근태 관리 화면 — 직원 전원의 신청·근무지·급여를 다루는 것이 기능이라 대상 직원을 고르는 값은 소유권 검사 대상이 아니다. 클래스의 ActiveAttendanceStaffGuard 는 그대로다. 판정은 권한 키 attendance.wage.read(첫 부여 없음 = master 만) 하나가 한다. 옛 가드 MasterRoleGuard 를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service POST /attendance/wage/settlements': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/attendance/wage/wage-settlement.controller.ts:112',
    predicate: '',
    note: '근태 관리 화면 — 직원 전원의 신청·근무지·급여를 다루는 것이 기능이라 대상 직원을 고르는 값은 소유권 검사 대상이 아니다. 클래스의 ActiveAttendanceStaffGuard 는 그대로다. 판정은 권한 키 attendance.wage.write(첫 부여 없음 = master 만) 하나가 한다. 옛 가드 MasterRoleGuard 를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service GET /attendance/wage/settlements/:id': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/attendance/wage/wage-settlement.controller.ts:100',
    predicate: '',
    note: '근태 관리 화면 — 직원 전원의 신청·근무지·급여를 다루는 것이 기능이라 대상 직원을 고르는 값은 소유권 검사 대상이 아니다. 클래스의 ActiveAttendanceStaffGuard 는 그대로다. 판정은 권한 키 attendance.wage.read(첫 부여 없음 = master 만) 하나가 한다. 옛 가드 MasterRoleGuard 를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service GET /attendance/wage/settlements/:id/export': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/attendance/wage/wage-settlement.controller.ts:106',
    predicate: '',
    note: '근태 관리 화면 — 직원 전원의 신청·근무지·급여를 다루는 것이 기능이라 대상 직원을 고르는 값은 소유권 검사 대상이 아니다. 클래스의 ActiveAttendanceStaffGuard 는 그대로다. 판정은 권한 키 attendance.wage.export(첫 부여 없음 = master 만) 하나가 한다. 옛 가드 MasterRoleGuard 를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service POST /attendance/wage/settlements/:id/reopen': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/attendance/wage/wage-settlement.controller.ts:118',
    predicate: '',
    note: '근태 관리 화면 — 직원 전원의 신청·근무지·급여를 다루는 것이 기능이라 대상 직원을 고르는 값은 소유권 검사 대상이 아니다. 클래스의 ActiveAttendanceStaffGuard 는 그대로다. 판정은 권한 키 attendance.wage.write(첫 부여 없음 = master 만) 하나가 한다. 옛 가드 MasterRoleGuard 를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service GET /attendance/wage/settlements/preview': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/attendance/wage/wage-settlement.controller.ts:82',
    predicate: '',
    note: '근태 관리 화면 — 직원 전원의 신청·근무지·급여를 다루는 것이 기능이라 대상 직원을 고르는 값은 소유권 검사 대상이 아니다. 클래스의 ActiveAttendanceStaffGuard 는 그대로다. 판정은 권한 키 attendance.wage.read(첫 부여 없음 = master 만) 하나가 한다. 옛 가드 MasterRoleGuard 를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service GET /attendance/wage/settlements/preview/export': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/attendance/wage/wage-settlement.controller.ts:88',
    predicate: '',
    note: '근태 관리 화면 — 직원 전원의 신청·근무지·급여를 다루는 것이 기능이라 대상 직원을 고르는 값은 소유권 검사 대상이 아니다. 클래스의 ActiveAttendanceStaffGuard 는 그대로다. 판정은 권한 키 attendance.wage.export(첫 부여 없음 = master 만) 하나가 한다. 옛 가드 MasterRoleGuard 를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service GET /attendance/wage/workers': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/attendance/wage/wage-settings.controller.ts:72',
    predicate: '',
    note: '근태 관리 화면 — 직원 전원의 신청·근무지·급여를 다루는 것이 기능이라 대상 직원을 고르는 값은 소유권 검사 대상이 아니다. 클래스의 ActiveAttendanceStaffGuard 는 그대로다. 판정은 권한 키 attendance.wage.read(첫 부여 없음 = master 만) 하나가 한다. 옛 가드 MasterRoleGuard 를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service DELETE /attendance/wage/workers/:userId': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/attendance/wage/wage-settings.controller.ts:153',
    predicate: '',
    note: '근태 관리 화면 — 직원 전원의 신청·근무지·급여를 다루는 것이 기능이라 대상 직원을 고르는 값은 소유권 검사 대상이 아니다. 클래스의 ActiveAttendanceStaffGuard 는 그대로다. 판정은 권한 키 attendance.wage.write(첫 부여 없음 = master 만) 하나가 한다. 옛 가드 MasterRoleGuard 를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service GET /attendance/wage/workers/:userId': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/attendance/wage/wage-settings.controller.ts:78',
    predicate: '',
    note: '근태 관리 화면 — 직원 전원의 신청·근무지·급여를 다루는 것이 기능이라 대상 직원을 고르는 값은 소유권 검사 대상이 아니다. 클래스의 ActiveAttendanceStaffGuard 는 그대로다. 판정은 권한 키 attendance.wage.read(첫 부여 없음 = master 만) 하나가 한다. 옛 가드 MasterRoleGuard 를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service PUT /attendance/wage/workers/:userId': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/attendance/wage/wage-settings.controller.ts:84',
    predicate: '',
    note: '근태 관리 화면 — 직원 전원의 신청·근무지·급여를 다루는 것이 기능이라 대상 직원을 고르는 값은 소유권 검사 대상이 아니다. 클래스의 ActiveAttendanceStaffGuard 는 그대로다. 판정은 권한 키 attendance.wage.write(첫 부여 없음 = master 만) 하나가 한다. 옛 가드 MasterRoleGuard 를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service POST /attendance/wage/workers/:userId/rates': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/attendance/wage/wage-settings.controller.ts:94',
    predicate: '',
    note: '근태 관리 화면 — 직원 전원의 신청·근무지·급여를 다루는 것이 기능이라 대상 직원을 고르는 값은 소유권 검사 대상이 아니다. 클래스의 ActiveAttendanceStaffGuard 는 그대로다. 판정은 권한 키 attendance.wage.write(첫 부여 없음 = master 만) 하나가 한다. 옛 가드 MasterRoleGuard 를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service DELETE /attendance/wage/workers/:userId/rates/:rateId': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/attendance/wage/wage-settings.controller.ts:170',
    predicate: '',
    note: '근태 관리 화면 — 직원 전원의 신청·근무지·급여를 다루는 것이 기능이라 대상 직원을 고르는 값은 소유권 검사 대상이 아니다. 클래스의 ActiveAttendanceStaffGuard 는 그대로다. 판정은 권한 키 attendance.wage.write(첫 부여 없음 = master 만) 하나가 한다. 옛 가드 MasterRoleGuard 를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service PATCH /attendance/wage/workers/:userId/rates/:rateId': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/attendance/wage/wage-settings.controller.ts:159',
    predicate: '',
    note: '근태 관리 화면 — 직원 전원의 신청·근무지·급여를 다루는 것이 기능이라 대상 직원을 고르는 값은 소유권 검사 대상이 아니다. 클래스의 ActiveAttendanceStaffGuard 는 그대로다. 판정은 권한 키 attendance.wage.write(첫 부여 없음 = master 만) 하나가 한다. 옛 가드 MasterRoleGuard 를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service POST /attendance/wage/workers/:userId/schedules': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/attendance/wage/wage-settings.controller.ts:104',
    predicate: '',
    note: '근태 관리 화면 — 직원 전원의 신청·근무지·급여를 다루는 것이 기능이라 대상 직원을 고르는 값은 소유권 검사 대상이 아니다. 클래스의 ActiveAttendanceStaffGuard 는 그대로다. 판정은 권한 키 attendance.wage.write(첫 부여 없음 = master 만) 하나가 한다. 옛 가드 MasterRoleGuard 를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service DELETE /attendance/wage/workers/:userId/schedules/:scheduleId': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/attendance/wage/wage-settings.controller.ts:191',
    predicate: '',
    note: '근태 관리 화면 — 직원 전원의 신청·근무지·급여를 다루는 것이 기능이라 대상 직원을 고르는 값은 소유권 검사 대상이 아니다. 클래스의 ActiveAttendanceStaffGuard 는 그대로다. 판정은 권한 키 attendance.wage.write(첫 부여 없음 = master 만) 하나가 한다. 옛 가드 MasterRoleGuard 를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service PATCH /attendance/wage/workers/:userId/schedules/:scheduleId': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/attendance/wage/wage-settings.controller.ts:180',
    predicate: '',
    note: '근태 관리 화면 — 직원 전원의 신청·근무지·급여를 다루는 것이 기능이라 대상 직원을 고르는 값은 소유권 검사 대상이 아니다. 클래스의 ActiveAttendanceStaffGuard 는 그대로다. 판정은 권한 키 attendance.wage.write(첫 부여 없음 = master 만) 하나가 한다. 옛 가드 MasterRoleGuard 를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service POST /attendance/worksites': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/attendance/controllers/attendance.controller.ts:187',
    predicate: '',
    note: '근태 관리 화면 — 직원 전원의 신청·근무지·급여를 다루는 것이 기능이라 대상 직원을 고르는 값은 소유권 검사 대상이 아니다. 클래스의 ActiveAttendanceStaffGuard 는 그대로다. 판정은 권한 키 attendance.worksite.write(첫 부여 없음 = master 만) 하나가 한다. 옛 가드 MasterRoleGuard 를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service PUT /attendance/worksites/:id': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/attendance/controllers/attendance.controller.ts:208',
    predicate: '',
    note: '근태 관리 화면 — 직원 전원의 신청·근무지·급여를 다루는 것이 기능이라 대상 직원을 고르는 값은 소유권 검사 대상이 아니다. 클래스의 ActiveAttendanceStaffGuard 는 그대로다. 판정은 권한 키 attendance.worksite.write(첫 부여 없음 = master 만) 하나가 한다. 옛 가드 MasterRoleGuard 를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service GET /consents/marketing/:userId': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/consents/consents.controller.ts:58',
    predicate: '',
    note: '관리자 회원 관리 화면 — 임의 회원을 식별자로 고르는 것이 기능이다(고객 역할은 이 권한을 갖지 않는다). 판정은 권한 키 customer.profile.read(첫 부여: admin, intern) 하나가 한다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service GET /consents/profile/:userId': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/consents/consents.controller.ts:78',
    predicate: '',
    note: '관리자 회원 관리 화면 — 임의 회원을 식별자로 고르는 것이 기능이다(고객 역할은 이 권한을 갖지 않는다). 판정은 권한 키 customer.profile.read(첫 부여: admin, intern) 하나가 한다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service POST /consents/search': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/consents/consents.controller.ts:98',
    predicate: '',
    note: '관리자 회원 관리 화면 — 임의 회원을 식별자로 고르는 것이 기능이다(고객 역할은 이 권한을 갖지 않는다). 판정은 권한 키 customer.profile.read(첫 부여: admin, intern) 하나가 한다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service GET /events/trace/chain/:chainId': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/events/event-trace.controller.ts:34',
    predicate: '',
    note: "운영 진단 화면 — 리소스·체인 식별자로 이벤트 추적을 보는 것이 기능이다(회원 소유 리소스가 아니다). 판정은 권한 키 system.operations.read(첫 부여: admin) 하나가 한다. 옛 가드 RolesGuard('admin', 'master') 를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.",
  },
  'user-service GET /events/trace/resource/:resourceType': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/events/event-trace.controller.ts:13',
    predicate: '',
    note: "운영 진단 화면 — 리소스·체인 식별자로 이벤트 추적을 보는 것이 기능이다(회원 소유 리소스가 아니다). 판정은 권한 키 system.operations.read(첫 부여: admin) 하나가 한다. 옛 가드 RolesGuard('admin', 'master') 를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.",
  },
  'user-service GET /events/trace/resource/:resourceType/:resourceId': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/events/event-trace.controller.ts:24',
    predicate: '',
    note: "운영 진단 화면 — 리소스·체인 식별자로 이벤트 추적을 보는 것이 기능이다(회원 소유 리소스가 아니다). 판정은 권한 키 system.operations.read(첫 부여: admin) 하나가 한다. 옛 가드 RolesGuard('admin', 'master') 를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.",
  },
  'user-service GET /users/find-by-email': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/users/users.controller.ts:39',
    predicate: '',
    note: '관리자 회원 관리 화면 — 임의 회원을 식별자로 고르는 것이 기능이다(고객 역할은 이 권한을 갖지 않는다). 판정은 권한 키 customer.profile.read(첫 부여: admin, intern) 하나가 한다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다 — 접근 범위는 권한 강제 이후와 같다.',
  },
  'user-service DELETE /auth': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/auth/auth.controller.ts:258',
    predicate: 'return this.authService.softDeleteUser(user.id);',
    note: '본인 탈퇴. 핸들러가 @CurrentUser() user.id(서명 검증된 토큰)만 넘기고 경로·바디로 대상 회원을 받지 않는다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다.',
  },
  'user-service DELETE /auth/identities/:provider': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/auth/account-linking.service.ts:205',
    predicate: 'eq(userServiceSchema.userIdentities.userId, userId),',
    note: '본인 소셜 연결 해제. :provider 는 kakao/naver 선택일 뿐이고 삭제는 (userId, provider) 로 좁혀진다. 핸들러가 @CurrentUser() user.id(서명 검증된 토큰)만 넘기고 경로·바디로 대상 회원을 받지 않는다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다.',
  },
  'user-service GET /auth/identities': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/auth/account-linking.service.ts:258',
    predicate: '.where(eq(userServiceSchema.userIdentities.userId, userId));',
    note: '본인 연결 목록. 핸들러가 @CurrentUser() user.id(서명 검증된 토큰)만 넘기고 경로·바디로 대상 회원을 받지 않는다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다.',
  },
  'user-service GET /auth/link/kakao': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/auth/account-linking.controller.ts:69',
    predicate: 'generateLinkingState(user.id, query.redirectTo)',
    note: '연결 시작. state 에 토큰 user.id 를 서명해 넣고 콜백이 그 state 로만 대상을 정한다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다.',
  },
  'user-service GET /auth/link/naver': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/auth/account-linking.controller.ts:123',
    predicate: 'generateLinkingState(user.id, query.redirectTo)',
    note: '연결 시작. state 에 토큰 user.id 를 서명해 넣고 콜백이 그 state 로만 대상을 정한다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다.',
  },
  'user-service GET /consents': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/consents/consents.service.ts:25',
    predicate: '.where(eq(userConsents.userId, userId))',
    note: '본인 동의 조회. 핸들러가 @CurrentUser() user.id(서명 검증된 토큰)만 넘기고 경로·바디로 대상 회원을 받지 않는다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다.',
  },
  'user-service POST /consents': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/consents/consents.controller.ts:39',
    predicate: 'this.consentsService.createConsent(user.id, createConsentDto)',
    note: '본인 동의 생성. 행의 userId 는 토큰 값이다(consents.service.ts:46-48). 핸들러가 @CurrentUser() user.id(서명 검증된 토큰)만 넘기고 경로·바디로 대상 회원을 받지 않는다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다.',
  },
  'user-service PATCH /consents/marketing': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/consents/consents.service.ts:67',
    predicate: '.where(eq(userConsents.userId, userId))',
    note: '본인 마케팅 동의 변경. 핸들러가 @CurrentUser() user.id(서명 검증된 토큰)만 넘기고 경로·바디로 대상 회원을 받지 않는다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다.',
  },
  'user-service GET /shop/info': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/shop/shop.service.ts:69',
    predicate: '.where(eq(schema.shops.userId, userId))',
    note: '본인 상점 정보. 핸들러가 @CurrentUser() user.id(서명 검증된 토큰)만 넘기고 경로·바디로 대상 회원을 받지 않는다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다.',
  },
  'user-service POST /shop/info': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/shop/shop.service.ts:35',
    predicate: '.where(eq(schema.shops.userId, userId))',
    note: '본인 상점 정보 생성(있으면 갱신, 없으면 userId 로 삽입 38행). 핸들러가 @CurrentUser() user.id(서명 검증된 토큰)만 넘기고 경로·바디로 대상 회원을 받지 않는다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다.',
  },
  'user-service PUT /shop/info': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/shop/shop.service.ts:59',
    predicate: '.where(eq(schema.shops.userId, userId))',
    note: '본인 상점 정보 수정. 핸들러가 @CurrentUser() user.id(서명 검증된 토큰)만 넘기고 경로·바디로 대상 회원을 받지 않는다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다.',
  },
  'user-service PATCH /shop/remind': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/shop/shop.service.ts:90',
    predicate: '.where(eq(schema.shops.userId, userId))',
    note: '본인 상점 알림 시각. 핸들러가 @CurrentUser() user.id(서명 검증된 토큰)만 넘기고 경로·바디로 대상 회원을 받지 않는다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다.',
  },
  'user-service GET /users/roles': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/users/user-roles.reader.ts:24',
    predicate: 'eq(schema.userRoleAssignments.userId, userId),',
    note: '본인 역할 목록. 핸들러가 @CurrentUser() user.id(서명 검증된 토큰)만 넘기고 경로·바디로 대상 회원을 받지 않는다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다.',
  },
  'user-service PATCH /users/me': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/users/users.service.ts:357',
    predicate: '.where(eq(schema.users.id, userId))',
    note: '본인 프로필 수정. 핸들러가 @CurrentUser() user.id(서명 검증된 토큰)만 넘기고 경로·바디로 대상 회원을 받지 않는다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다.',
  },
  'user-service POST /business-licenses': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/business-licenses/business-licenses.controller.ts:32',
    predicate: 'this.businessLicensesService.createBusinessLicense(user.id, data)',
    note: '본인 사업자 등록 생성. 삽입 행의 userId 는 토큰 값이다(business-licenses.service.ts:214-215,230-231). 핸들러가 @CurrentUser() user.id(서명 검증된 토큰)만 넘기고 경로·바디로 대상 회원을 받지 않는다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다.',
  },
  'user-service POST /business-licenses/fetch': {
    verdict: 'N/A',
    evidence: 'apps/user-service/src/api/business-licenses/business-licenses.controller.ts:78',
    predicate: '',
    note: '국세청 사업자 진위 조회를 대신 부르는 외부 조회다. 바디의 사업자번호로 공공 API 만 부르고 회원 소유 레코드를 읽거나 쓰지 않는다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다.',
  },
  'user-service PUT /business-licenses/:businessId': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/business-licenses/business-licenses.service.ts:579',
    predicate: '.where(and(eq(businessLicenses.id, businessLicenseId), eq(businessLicenses.userId, userId)))',
    note: '본인 사업자 등록 수정. 먼저 토큰 userId 의 등록을 찾아 경로 id 와 다르면 404(499-507행), 갱신도 (id, userId) 로 좁힌다(579·597행). 옛 스코프 가드를 걷어 내며 대상에 들어왔다.',
  },
  'user-service DELETE /business-licenses/:id': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/business-licenses/business-licenses.service.ts:532',
    predicate: '.where(and(eq(businessLicenses.id, businessLicenseId), eq(businessLicenses.userId, userId)))',
    note: '본인 사업자 등록 삭제. 토큰 userId 의 등록과 소유권을 확인한 뒤(519-525행) 삭제도 (id, userId) 로 좁힌다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다.',
  },
  'user-service POST /files/upload': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/file/file.service.ts:41',
    predicate: 'const key = `${S3_FOLDER_NAMES[folderName]}/${userId}/${uuid()}.${fileExtension}`;',
    note: '업로드 키에 토큰 userId 가 들어가 남의 경로에 쓸 수 없다. 핸들러가 @CurrentUser() user.id(서명 검증된 토큰)만 넘기고 경로·바디로 대상 회원을 받지 않는다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다.',
  },
  'user-service POST /files/delete': {
    verdict: 'SAFE',
    evidence: 'apps/user-service/src/api/file/file.controller.ts:81',
    predicate: 'const key = `${deleteFileDto.folderName}/${user.id}/${deleteFileDto.fileName}`;',
    note: '삭제 키의 회원 구간을 바디가 아니라 토큰 user.id 로 만든다 — 남의 폴더를 가리킬 수 없다. 옛 스코프 가드를 걷어 내며 대상에 들어왔다.',
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
    expect(targets).toHaveLength(276);
  });

  // search 와 analytics 가 둘 다 `GET /health` 이고, user-service 와 file-service 가 둘 다
  // `POST /files/upload` 다. `<VERB> <route>` 로 키를 만들면 그만큼 뭉개지고 스냅샷이 조용히 잃는다.
  it('키에 app 이 들어가야 충돌하지 않는다', () => {
    const targets = runAudit().filter((r) => r.idorTarget);
    expect(new Set(targets.map(keyOf)).size).toBe(276);
    expect(new Set(targets.map((r) => `${r.verb} ${r.route}`)).size).toBe(274);
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

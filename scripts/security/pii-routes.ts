/**
 * 개인정보(이름·연락처·이메일·주소·계좌 등)를 응답하는 직원용 라우트 — `<앱> <동사> <경로>`.
 * 여기 있는 라우트는 `@PiiResponse` 를 선언해야 하고, 선언한 라우트는 여기 있어야 한다(`pii-routes.spec.ts`).
 * 새 관리자 라우트가 고객 개인정보를 돌려주면 여기에 한 줄 더한다.
 */
export const PII_ROUTES: readonly string[] = [
  'channel-adapter GET /adapter/:channel/query/:queryType/:identifier',
  'channel-adapter GET /adapter/:channel/query/exchange-requests',
  'channel-adapter GET /adapter/event-failures/dead-letters/:id',
  'channel-adapter GET /adapter/event-failures/outbox/:id',
  'channel-adapter GET /adapter/order-collection-failures',
  'channel-adapter GET /adapter/order-collection-failures/:id',
  'core GET /admin/customer-returns',
  'core GET /admin/print-orders',
  'core GET /admin/print-orders/by-design/:almondDesignId',
  'core GET /admin/print-orders/by-line/:lineId',
  'core GET /cs-cases',
  'core GET /cs-cases/:id',
  'core GET /direct-ship/handoffs/:handoffId/sheet',
  'core POST /direct-ship/suppliers/:supplierId/handoffs',
  'core GET /event-failures/dead-letters/:id',
  'core GET /event-failures/outbox/:id',
  'core GET /fulfillment-operations/:operationId',
  'core GET /fulfillments',
  'core GET /fulfillments/:id',
  'core GET /matchings/order-lines',
  'core GET /order-progress/orders',
  'core GET /sales-order-amendments',
  'core GET /sales-order-amendments/:id',
  'core GET /sales-orders',
  'core GET /sales-orders/:id',
  'core GET /sales-orders/:id/amendments',
  'core GET /shipments/:id',
  'core GET /shipments/consolidation-candidates',
  'core PATCH /cs-cases/:caseId/comments/:commentId',
  'core PATCH /cs-cases/:id/assignee',
  'core PATCH /cs-cases/:id/status',
  'core PATCH /sales-orders/:id',
  'core PATCH /shipments/:id/recipient',
  'core POST /cs-cases',
  'core POST /cs-cases/:caseId/comments',
  'core POST /fulfillments',
  'core POST /sales-order-amendments',
  'core POST /sales-orders',
  'core POST /sales-orders/:id/cancel',
  'core POST /sales-orders/:id/confirm',
  'core POST /shipments/:id/plan',
  'core POST /shipments/:id/split-unreserved',
  'core POST /shipments/:id/splits',
  'membership GET /admin/contract-events',
  'membership GET /admin/members/:userId',
  'membership GET /admin/subscriptions/:contractId/events',
  'notification GET /alimtalk/auto-sends',
  'notification GET /alimtalk/campaigns/:id/results',
  'notification GET /bulk-notifications/:campaignId',
  'notification GET /bulk-notifications/:campaignId/recipients',
  'notification GET /logs',
  'notification GET /logs/notifications/:notificationId',
  'notification GET /notifications/:id',
  'notification GET /notifications/users/:userId',
  'notification GET /sms-gate/campaigns/:id/clicks',
  'notification GET /sms-gate/conversations',
  'notification GET /sms-gate/conversations/messages',
  'notification GET /sms-gate/messages',
  'ugc-service GET /admin/shop-listings',
  'ugc-service GET /admin/shop-listings/:id',
  'ugc-service GET /reviews/admin/reviews',
  'ugc-service GET /reviews/admin/reviews/:id',
  'ugc-service POST /reviews/admin/reviews',
  'user-service GET /admin/blacklists',
  'user-service GET /admin/blacklists/:userId',
  'user-service GET /admin/business-licenses',
  'user-service GET /admin/business-licenses//user/:userId',
  'user-service GET /admin/business-licenses/:id',
  'user-service GET /admin/roles/:roleId/members',
  'user-service GET /admin/users',
  'user-service GET /admin/users/:userId',
  'user-service GET /consents/profile/:userId',
  'user-service GET /users/find-by-email',
  'user-service PATCH /admin/users/:userId',
  'user-service POST /admin/business-licenses//user/:userId',
  'user-service POST /consents/search',
  'wallet GET /v1/admin/payment-intents/:id',
  'wallet GET /v1/admin/payment-intents/pending-bank-transfers',
  'wallet GET /v1/admin/recurring-billing/invoices',
  'wallet GET /v1/admin/refund-requests',
  'wallet POST /v1/admin/refund-requests/:id/approve',
  'wallet POST /v1/admin/refund-requests/:id/reject',
];

/**
 * 위 라우트 중 단건 상세라 기본 가림 모드에서 [보기]로 원문을 다시 받는 것(`@PiiResponse({ reveal: true })`).
 * admin-web 화면표(`pii-screens.ts`)의 [보기] 표시가 이것으로 검사된다. 선언과 양쪽으로 맞아야 한다(`pii-routes.spec.ts`).
 */
export const PII_REVEAL_ROUTES: readonly string[] = [
  'channel-adapter GET /adapter/order-collection-failures/:id',
  'core GET /cs-cases/:id',
  'core GET /fulfillments/:id',
  'core GET /sales-order-amendments/:id',
  'core GET /sales-orders/:id',
  'core GET /shipments/:id',
  'membership GET /admin/members/:userId',
  'notification GET /notifications/:id',
  'notification GET /sms-gate/conversations/messages',
  'ugc-service GET /admin/shop-listings/:id',
  'ugc-service GET /reviews/admin/reviews/:id',
  'user-service GET /admin/blacklists/:userId',
  'user-service GET /admin/business-licenses//user/:userId',
  'user-service GET /admin/business-licenses/:id',
  'user-service GET /admin/users/:userId',
  'user-service GET /consents/profile/:userId',
  'wallet GET /v1/admin/payment-intents/:id',
];

/**
 * 위 라우트 중 선언한 필드가 모두 받는 분 정보 권한(`fulfillment.recipient.read`)으로도 열리는 것 — 그 권한자에게는
 * 전부 원문이 간다. admin-web 화면표의 `recipientCoversAll` 이 이것으로 검사된다. 선언과 양쪽으로 맞아야 한다.
 */
export const PII_RECIPIENT_ROUTES: readonly string[] = [
  'core GET /direct-ship/handoffs/:handoffId/sheet',
  'core GET /fulfillment-operations/:operationId',
  'core GET /fulfillments',
  'core GET /fulfillments/:id',
  'core GET /order-progress/orders',
  'core GET /shipments/:id',
  'core GET /shipments/consolidation-candidates',
  'core PATCH /shipments/:id/recipient',
  'core POST /direct-ship/suppliers/:supplierId/handoffs',
  'core POST /fulfillments',
  'core POST /shipments/:id/plan',
  'core POST /shipments/:id/split-unreserved',
  'core POST /shipments/:id/splits',
];

/** `*.export` 권한 라우트 중 사유 헤더를 강제하지 않는 것. 값은 이유. */
export const PII_EXPORT_EXCEPTIONS: Readonly<Record<string, string>> = {
  // 현재 예외 없음 — 모든 `*.export` 라우트가 사유 헤더를 강제한다. 예외를 더하면 값에 이유를 적는다.
};

/**
 * 요청 본문으로 개인정보 원문을 받는 직원용 쓰기 라우트 — `@PiiWrite` 를 선언해야 하고, 선언한 라우트는 여기 있어야
 * 한다(`pii-write-routes.spec.ts`). 그 화면이 가린 값을 채워 보내는 쓰기면 여기에 한 줄 더한다.
 */
export const PII_WRITE_ROUTES: readonly string[] = [
  'core PATCH /cs-cases/:caseId/comments/:commentId',
  'core PATCH /sales-orders/:id',
  'core PATCH /shipments/:id/recipient',
  'notification POST /sms-gate/conversations/reply',
  'user-service PATCH /admin/users/:userId',
  'user-service POST /admin/business-licenses//user/:userId',
];

/**
 * 응답에서 가리는 필드를 본문으로 받지만 `@PiiWrite` 를 달지 않는 쓰기 — 새 값을 입력하는 만들기·메모 남기기라 이미
 * 저장된 값을 다시 보내지 않는다. 기존 값을 채워 고치는 화면이 생기면 여기서 빼고 선언한다.
 */
export const PII_WRITE_EXEMPT: Readonly<Record<string, string>> = {
  'core POST /cs-cases': '새 상담을 입력한다',
  'core POST /cs-cases/:caseId/comments': '새 댓글을 입력한다',
  'core POST /direct-ship/suppliers/:supplierId/handoffs': '본문 없음 — 응답으로만 개인정보가 나간다',
  'core POST /fulfillments': '주문에서 출고 요청을 만든다',
  'core POST /sales-order-amendments': '새 주문 변경을 접수한다',
  'core POST /sales-orders': '새 주문을 입력한다',
  'wallet POST /v1/admin/refund-requests/:id/approve': '처리 메모를 새로 남긴다',
  'wallet POST /v1/admin/refund-requests/:id/reject': '처리 메모를 새로 남긴다',
};

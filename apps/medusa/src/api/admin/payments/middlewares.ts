import { validateAndTransformBody, validateAndTransformQuery } from '@medusajs/framework';
import { MiddlewareRoute } from '@medusajs/framework/http';
import * as queryConfig from './query-config';
import { AdminCreatePaymentRefund, AdminGetPaymentParams } from './validators';
import { rejectRefundOnCanceledOrder } from './middlewares/reject-refund-on-canceled-order';

export const adminPaymentRoutesMiddlewares: MiddlewareRoute[] = [
  {
    method: ['POST'],
    matcher: '/admin/payments/:id/refund',
    middlewares: [
      // 1. 환불 요청 데이터 검증
      validateAndTransformBody(AdminCreatePaymentRefund),

      // 2. 결제 정보 조회 설정
      validateAndTransformQuery(
        AdminGetPaymentParams, // 결제 ID 등 파라미터 검증
        queryConfig.retrieveTransformQueryConfig, // 어떤 결제 정보를 가져올지 설정
      ),

      // 3. 취소된 주문의 환불 막기(#1016 36번 §6.6) — 본문 검증 뒤에 둬야 잘못된 본문이 DB 를 읽지 않고 400 으로 끝난다
      rejectRefundOnCanceledOrder,
    ],
  },
];

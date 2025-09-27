import {
  validateAndTransformBody,
  validateAndTransformQuery,
} from '@medusajs/framework';
import { MiddlewareRoute } from '@medusajs/framework/http';
import * as queryConfig from './query-config';
import { AdminCreatePaymentRefund, AdminGetPaymentParams } from './validators';

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
    ],
  },
];

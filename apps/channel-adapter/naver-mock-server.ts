#!/usr/bin/env ts-node

/**
 * 네이버 커머스 API Mock 서버
 *
 * 민감한 작업(발송처리, 취소승인 등)을 안전하게 테스트하기 위한 Mock 서버입니다.
 * 실제 네이버 API와 동일한 응답 형식을 제공하지만 실제 처리는 하지 않습니다.
 *
 * @author Channel Adapter Team
 * @version 1.0.0
 *
 * @example
 * ```bash
 * # Mock 서버 시작
 * npm run mock:naver-server
 *
 * # 포트 지정해서 시작
 * PORT=3001 npm run mock:naver-server
 * ```
 */

import express from 'express';
import cors from 'cors';
import { z } from 'zod';

// Mock 서버 설정
const app = express();
const PORT = process.env.MOCK_PORT || 3001;

// 미들웨어 설정
app.use(cors());
app.use(express.json());

// 요청 로깅 미들웨어
app.use((req, res, next) => {
  console.log(`🔍 [${new Date().toISOString()}] ${req.method} ${req.url}`);
  if (Object.keys(req.body).length > 0) {
    console.log('📦 Request Body:', JSON.stringify(req.body, null, 2));
  }
  next();
});

// 인증 토큰 검증 미들웨어
const validateToken = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      timestamp: new Date().toISOString(),
      traceId: `mock-error-${Date.now()}`,
      error: {
        code: 'UNAUTHORIZED',
        message: '인증 토큰이 필요합니다.',
      },
    });
  }

  // Mock에서는 토큰 형식만 체크
  const token = authHeader.substring(7);
  if (token.length < 10) {
    return res.status(401).json({
      timestamp: new Date().toISOString(),
      traceId: `mock-error-${Date.now()}`,
      error: {
        code: 'INVALID_TOKEN',
        message: '유효하지 않은 토큰입니다.',
      },
    });
  }

  next();
};

/**
 * 🚀 발송처리 API Mock
 * POST /v1/pay-order/seller/product-orders/dispatch
 */
app.post('/v1/pay-order/seller/product-orders/dispatch', validateToken, (req, res) => {
  console.log('📦 네이버 발송처리 Mock API 호출');

  try {
    // 요청 데이터 검증 (간단한 검증만)
    const { dispatchProductOrders } = req.body;

    if (!dispatchProductOrders || !Array.isArray(dispatchProductOrders)) {
      return res.status(400).json({
        timestamp: new Date().toISOString(),
        traceId: `mock-error-${Date.now()}`,
        error: {
          code: 'INVALID_REQUEST',
          message: 'dispatchProductOrders는 필수이며 배열이어야 합니다.',
        },
      });
    }

    if (dispatchProductOrders.length === 0) {
      return res.status(400).json({
        timestamp: new Date().toISOString(),
        traceId: `mock-error-${Date.now()}`,
        error: {
          code: 'EMPTY_ORDERS',
          message: '최소 1개의 상품 주문이 필요합니다.',
        },
      });
    }

    if (dispatchProductOrders.length > 30) {
      return res.status(400).json({
        timestamp: new Date().toISOString(),
        traceId: `mock-error-${Date.now()}`,
        error: {
          code: 'TOO_MANY_ORDERS',
          message: '최대 30개의 상품 주문만 처리 가능합니다.',
        },
      });
    }

    // Mock 성공 응답 생성
    const results = dispatchProductOrders.map((order: any, index: number) => {
      // 일부 주문은 실패로 시뮬레이션 (테스트용)
      const shouldFail = Math.random() < 0.1; // 10% 확률로 실패

      if (shouldFail) {
        return {
          productOrderId: order.productOrderId,
          success: false,
          errorCode: 'ALREADY_DISPATCHED',
          message: '이미 발송처리된 주문입니다.',
        };
      }

      return {
        productOrderId: order.productOrderId,
        success: true,
        message: '발송처리가 완료되었습니다.',
        dispatchedAt: new Date().toISOString(),
        trackingNumber: order.trackingNumber,
        deliveryCompanyCode: order.deliveryCompanyCode,
      };
    });

    const response = {
      timestamp: new Date().toISOString(),
      traceId: `mock-dispatch-${Date.now()}`,
      data: {
        totalCount: dispatchProductOrders.length,
        successCount: results.filter((r) => r.success).length,
        failedCount: results.filter((r) => !r.success).length,
        results,
      },
    };

    console.log('✅ 발송처리 Mock 응답:', JSON.stringify(response, null, 2));
    res.json(response);
  } catch (error) {
    console.error('❌ 발송처리 Mock 에러:', error);
    res.status(500).json({
      timestamp: new Date().toISOString(),
      traceId: `mock-error-${Date.now()}`,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: '서버 내부 오류가 발생했습니다.',
      },
    });
  }
});

/**
 * 🚫 취소승인 API Mock
 * POST /v1/pay-order/seller/product-orders/{productOrderId}/cancel/approve
 */
app.post('/v1/pay-order/seller/product-orders/:productOrderId/cancel/approve', validateToken, (req, res) => {
  console.log(`❌ 네이버 취소승인 Mock API 호출 - 상품주문ID: ${req.params.productOrderId}`);

  const { productOrderId } = req.params;
  const { cancelReason, refundBankAccount } = req.body;

  // Mock 성공 응답
  const response = {
    timestamp: new Date().toISOString(),
    traceId: `mock-cancel-${Date.now()}`,
    data: {
      productOrderId,
      status: 'CANCEL_APPROVED',
      approvedAt: new Date().toISOString(),
      cancelReason: cancelReason || '고객 요청',
      estimatedRefundDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(), // 3일 후
    },
  };

  console.log('✅ 취소승인 Mock 응답:', JSON.stringify(response, null, 2));
  res.json(response);
});

/**
 * 🔄 반품승인 API Mock
 * POST /v1/pay-order/seller/product-orders/{productOrderId}/return/approve
 */
app.post('/v1/pay-order/seller/product-orders/:productOrderId/return/approve', validateToken, (req, res) => {
  console.log(`🔄 네이버 반품승인 Mock API 호출 - 상품주문ID: ${req.params.productOrderId}`);

  const { productOrderId } = req.params;
  const { returnReason, collectAddress } = req.body;

  // Mock 성공 응답
  const response = {
    timestamp: new Date().toISOString(),
    traceId: `mock-return-${Date.now()}`,
    data: {
      productOrderId,
      status: 'RETURN_APPROVED',
      approvedAt: new Date().toISOString(),
      returnReason: returnReason || '고객 요청',
      collectAddress: collectAddress || '판매자 지정 수거지',
      estimatedCollectDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(), // 2일 후
    },
  };

  console.log('✅ 반품승인 Mock 응답:', JSON.stringify(response, null, 2));
  res.json(response);
});

/**
 * 🔄 교환승인 API Mock
 * POST /v1/pay-order/seller/product-orders/{productOrderId}/exchange/approve
 */
app.post('/v1/pay-order/seller/product-orders/:productOrderId/exchange/approve', validateToken, (req, res) => {
  console.log(`🔄 네이버 교환승인 Mock API 호출 - 상품주문ID: ${req.params.productOrderId}`);

  const { productOrderId } = req.params;
  const { exchangeReason, newProductInfo } = req.body;

  // Mock 성공 응답
  const response = {
    timestamp: new Date().toISOString(),
    traceId: `mock-exchange-${Date.now()}`,
    data: {
      productOrderId,
      status: 'EXCHANGE_APPROVED',
      approvedAt: new Date().toISOString(),
      exchangeReason: exchangeReason || '고객 요청',
      newProductInfo: newProductInfo || {
        productId: '12345',
        optionId: '67890',
      },
      estimatedDeliveryDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(), // 5일 후
    },
  };

  console.log('✅ 교환승인 Mock 응답:', JSON.stringify(response, null, 2));
  res.json(response);
});

/**
 * 📊 Mock 서버 상태 확인
 * GET /health
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'Naver Commerce API Mock Server',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    endpoints: [
      'POST /v1/pay-order/seller/product-orders/dispatch',
      'POST /v1/pay-order/seller/product-orders/:id/cancel/approve',
      'POST /v1/pay-order/seller/product-orders/:id/return/approve',
      'POST /v1/pay-order/seller/product-orders/:id/exchange/approve',
    ],
  });
});

/**
 * 📋 Mock 서버 API 목록
 * GET /
 */
app.get('/', (req, res) => {
  res.json({
    message: '네이버 커머스 API Mock 서버',
    description: '민감한 작업(발송처리, 취소승인 등)을 안전하게 테스트하기 위한 Mock 서버',
    endpoints: {
      'GET /health': '서버 상태 확인',
      'POST /v1/pay-order/seller/product-orders/dispatch': '발송처리 (Mock)',
      'POST /v1/pay-order/seller/product-orders/:id/cancel/approve': '취소승인 (Mock)',
      'POST /v1/pay-order/seller/product-orders/:id/return/approve': '반품승인 (Mock)',
      'POST /v1/pay-order/seller/product-orders/:id/exchange/approve': '교환승인 (Mock)',
    },
    usage: {
      Authorization: 'Bearer {token} 헤더 필요',
      'Content-Type': 'application/json',
    },
  });
});

// 404 핸들러
app.use((req, res) => {
  res.status(404).json({
    timestamp: new Date().toISOString(),
    traceId: `mock-404-${Date.now()}`,
    error: {
      code: 'NOT_FOUND',
      message: `API 엔드포인트를 찾을 수 없습니다: ${req.method} ${req.url}`,
    },
  });
});

// 에러 핸들러
app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('💥 Mock 서버 에러:', error);
  res.status(500).json({
    timestamp: new Date().toISOString(),
    traceId: `mock-error-${Date.now()}`,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: '서버 내부 오류가 발생했습니다.',
    },
  });
});

// 서버 시작
app.listen(PORT, () => {
  console.log('🚀 네이버 커머스 API Mock 서버가 시작되었습니다!');
  console.log(`📍 서버 주소: http://localhost:${PORT}`);
  console.log(`📋 API 목록: http://localhost:${PORT}`);
  console.log(`💚 헬스체크: http://localhost:${PORT}/health`);
  console.log('');
  console.log('📦 지원되는 Mock API:');
  console.log('  - POST /v1/pay-order/seller/product-orders/dispatch (발송처리)');
  console.log('  - POST /v1/pay-order/seller/product-orders/:id/cancel/approve (취소승인)');
  console.log('  - POST /v1/pay-order/seller/product-orders/:id/return/approve (반품승인)');
  console.log('  - POST /v1/pay-order/seller/product-orders/:id/exchange/approve (교환승인)');
  console.log('');
  console.log('⚠️  주의: 이는 Mock 서버입니다. 실제 네이버 API 처리는 하지 않습니다.');
});

export default app;

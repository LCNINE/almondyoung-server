# 네이버 커머스 API Mock 서버 사용 가이드

## 🎯 개요

네이버 커머스 API의 민감한 작업(발송처리, 취소승인, 반품승인 등)을 안전하게 테스트하기 위한 Mock 서버입니다.

- **조회 API**: 실제 네이버 라이브 서버 사용 (안전)
- **처리 API**: Mock 서버 사용 (안전한 테스트)

## 🚀 빠른 시작

### 1. Mock 서버 시작

```bash
# 기본 포트(3001)로 Mock 서버 시작
npm run mock:naver-server

# 백그라운드로 Mock 서버 시작
npm run mock:naver-server:bg

# 사용자 정의 포트로 시작
MOCK_PORT=3002 npm run mock:naver-server
```

### 2. 환경변수 설정

`.env` 파일에 다음 설정 추가:

```env
# 네이버 API 기본 설정 (기존)
NAVER_CLIENT_ID=your_client_id
NAVER_CLIENT_SECRET=your_client_secret
NAVER_API_ENDPOINT=https://api.commerce.naver.com/external/v1

# Mock 서버 사용 설정
NAVER_USE_MOCK_SERVER=true
NAVER_MOCK_SERVER_URL=http://localhost:3001
```

### 3. 테스트 실행

```bash
# Mock 서버를 사용한 명령 실행 테스트
NAVER_USE_MOCK_SERVER=true npm run test:orchestration:command

# 전체 오케스트레이션 테스트
NAVER_USE_MOCK_SERVER=true npm run test:orchestration
```

## 📋 Mock 서버 API 목록

### 🔍 서버 상태 확인

- `GET /health` - Mock 서버 헬스체크
- `GET /` - API 목록 및 사용법

### 📦 발송처리 API

- `POST /v1/pay-order/seller/product-orders/dispatch`
- 실제 네이버 API와 동일한 요청/응답 형식
- 10% 확률로 일부 주문 실패 시뮬레이션

### ❌ 취소승인 API

- `POST /v1/pay-order/seller/product-orders/{productOrderId}/cancel/approve`
- 취소승인 처리 시뮬레이션

### 🔄 반품승인 API

- `POST /v1/pay-order/seller/product-orders/{productOrderId}/return/approve`
- 반품승인 처리 시뮬레이션

### 🔄 교환승인 API

- `POST /v1/pay-order/seller/product-orders/{productOrderId}/exchange/approve`
- 교환승인 처리 시뮬레이션

## 🔧 환경별 설정

### 개발 환경 (Mock 서버 사용)

```env
NAVER_USE_MOCK_SERVER=true
NAVER_MOCK_SERVER_URL=http://localhost:3001
```

### 스테이징 환경 (Mock 서버 사용)

```env
NAVER_USE_MOCK_SERVER=true
NAVER_MOCK_SERVER_URL=http://staging-mock-server:3001
```

### 운영 환경 (실제 API 사용) ⚠️

```env
NAVER_USE_MOCK_SERVER=false
# 또는 환경변수 설정하지 않음
```

## 🧪 테스트 시나리오

### 1. 발송처리 테스트

Mock 서버 시작:

```bash
npm run mock:naver-server
```

별도 터미널에서 테스트:

```bash
NAVER_USE_MOCK_SERVER=true npm run test:orchestration:command
```

### 2. 실제 API vs Mock 비교 테스트

```bash
# Mock 서버 테스트
NAVER_USE_MOCK_SERVER=true npm run test:orchestration:command

# 실제 API 테스트 (주의!)
NAVER_USE_MOCK_SERVER=false npm run test:orchestration:command
```

## 📊 Mock 응답 예시

### 발송처리 성공 응답

```json
{
  "timestamp": "2025-09-18T05:30:00.000Z",
  "traceId": "mock-dispatch-1726632600000",
  "data": {
    "totalCount": 1,
    "successCount": 1,
    "failedCount": 0,
    "results": [
      {
        "productOrderId": "2025091565429621",
        "success": true,
        "message": "발송처리가 완료되었습니다.",
        "dispatchedAt": "2025-09-18T05:30:00.000Z",
        "trackingNumber": "1234567890123",
        "deliveryCompanyCode": "CJGLS"
      }
    ]
  }
}
```

### 취소승인 성공 응답

```json
{
  "timestamp": "2025-09-18T05:30:00.000Z",
  "traceId": "mock-cancel-1726632600000",
  "data": {
    "productOrderId": "2025091565429621",
    "status": "CANCEL_APPROVED",
    "approvedAt": "2025-09-18T05:30:00.000Z",
    "cancelReason": "고객 요청",
    "estimatedRefundDate": "2025-09-21T05:30:00.000Z"
  }
}
```

## ⚠️ 주의사항

1. **Mock 서버는 실제 처리를 하지 않습니다**

   - 실제 발송처리, 취소승인 등이 이루어지지 않음
   - 테스트 목적으로만 사용

2. **운영 환경에서는 반드시 확인**

   - `NAVER_USE_MOCK_SERVER=false` 또는 환경변수 미설정
   - 실제 API 호출 전 충분한 테스트 필요

3. **조회 API는 실제 서버 사용**
   - 토큰 발급: 실제 네이버 API
   - 주문 조회: 실제 네이버 API
   - 상태 변경 조회: 실제 네이버 API

## 🔍 디버깅

### Mock 서버 로그 확인

Mock 서버 실행 시 모든 요청/응답이 콘솔에 출력됩니다:

```
🔍 [2025-09-18T05:30:00.000Z] POST /v1/pay-order/seller/product-orders/dispatch
📦 Request Body: {
  "dispatchProductOrders": [...]
}
📦 네이버 발송처리 Mock API 호출
✅ 발송처리 Mock 응답: {...}
```

### 환경변수 확인

```bash
echo $NAVER_USE_MOCK_SERVER
echo $NAVER_MOCK_SERVER_URL
```

## 🚀 확장

새로운 Mock API 추가 시 `naver-mock-server.ts`에서:

1. 라우트 추가
2. 요청 검증 로직 추가
3. Mock 응답 생성
4. 에러 처리 추가

예시:

```typescript
app.post('/v1/new-api-endpoint', validateToken, (req, res) => {
  // Mock 로직 구현
});
```

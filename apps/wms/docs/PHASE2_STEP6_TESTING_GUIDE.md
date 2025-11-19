# Phase 2 Step 6: Manual API Testing Guide

**Date:** 2025-10-19
**Services:** SKU Pricing, SKU Managers, SKU Location Movement

---

## 🎯 Overview

이 문서는 Phase 2 Step 6에서 구현된 3개의 새로운 서비스와 API 엔드포인트를 테스트하기 위한 가이드입니다.

### 구현된 서비스
1. **SKU Pricing Service** - 다단계 가격 관리
2. **SKU Managers Service** - SKU 담당자 관리
3. **SKU Location Movement Service** - SKU 위치 이동 추적

---

## 📋 사전 준비

### 1. 서버 실행
```bash
npm run start:dev wms
```

### 2. 테스트용 데이터 준비

먼저 테스트에 필요한 SKU, 위치, 창고가 있는지 확인합니다.

```bash
# SKU 목록 확인
curl http://localhost:3000/inventory/skus | jq '.[0:3]'

# 위치 목록 확인
curl http://localhost:3000/inventory/locations | jq '.[0:3]'
```

테스트용 환경 변수를 설정합니다:
```bash
# 실제 SKU ID로 대체하세요
export TEST_SKU_ID="your-sku-id-here"
export TEST_LOCATION_FROM="location-id-1"
export TEST_LOCATION_TO="location-id-2"
export TEST_MANAGER_ID="manager-id-here"
```

---

## 🧪 1. SKU Pricing API 테스트

### 1.1 가격 생성 (Create/Upsert)

```bash
curl -X POST http://localhost:3000/inventory/skus/pricing \
  -H "Content-Type: application/json" \
  -d '{
    "skuId": "'${TEST_SKU_ID}'",
    "retailPrice": 50000,
    "specialSalePrice": 45000,
    "wholesalePrice": 40000,
    "sellingPrice": 45000,
    "priceEffectiveDate": "2025-01-01T00:00:00Z",
    "priceExpiryDate": "2025-12-31T23:59:59Z"
  }' | jq
```

**예상 결과:**
```json
{
  "id": "uuid",
  "skuId": "test-sku-id",
  "retailPrice": 50000,
  "specialSalePrice": 45000,
  "wholesalePrice": 40000,
  "sellingPrice": 45000,
  "priceEffectiveDate": "2025-01-01T00:00:00.000Z",
  "priceExpiryDate": "2025-12-31T23:59:59.000Z",
  "createdAt": "2025-10-19...",
  "updatedAt": "2025-10-19..."
}
```

### 1.2 가격 조회

```bash
curl http://localhost:3000/inventory/skus/${TEST_SKU_ID}/pricing | jq
```

### 1.3 유효한 가격 조회 (현재 날짜 기준)

```bash
curl http://localhost:3000/inventory/skus/${TEST_SKU_ID}/pricing/effective | jq
```

### 1.4 특정 날짜 기준 유효 가격 조회

```bash
# 2025년 6월 1일 기준
curl "http://localhost:3000/inventory/skus/${TEST_SKU_ID}/pricing/effective?referenceDate=2025-06-01T00:00:00Z" | jq
```

### 1.5 가격 수정

```bash
curl -X PUT http://localhost:3000/inventory/skus/${TEST_SKU_ID}/pricing \
  -H "Content-Type: application/json" \
  -d '{
    "sellingPrice": 42000,
    "specialSalePrice": 42000
  }' | jq
```

### 1.6 가격 유효성 확인

```bash
curl "http://localhost:3000/inventory/skus/${TEST_SKU_ID}/pricing/valid" | jq
```

**예상 결과:**
```json
{
  "isValid": true,
  "skuId": "test-sku-id",
  "referenceDate": "2025-10-19T..."
}
```

### 1.7 전체 가격 목록

```bash
curl http://localhost:3000/inventory/skus/pricing/all | jq
```

### 1.8 가격 삭제

```bash
curl -X DELETE http://localhost:3000/inventory/skus/${TEST_SKU_ID}/pricing | jq
```

---

## 👥 2. SKU Managers API 테스트

### 2.1 담당자 할당

```bash
curl -X POST http://localhost:3000/inventory/skus/managers \
  -H "Content-Type: application/json" \
  -d '{
    "skuId": "'${TEST_SKU_ID}'",
    "designerId": "'${TEST_MANAGER_ID}'",
    "purchaseManagerId": "'${TEST_MANAGER_ID}'",
    "registrationManagerId": "'${TEST_MANAGER_ID}'"
  }' | jq
```

**예상 결과:**
```json
{
  "id": "uuid",
  "skuId": "test-sku-id",
  "designerId": "manager-id",
  "purchaseManagerId": "manager-id",
  "registrationManagerId": "manager-id",
  "createdAt": "2025-10-19...",
  "updatedAt": "2025-10-19..."
}
```

### 2.2 담당자 조회

```bash
curl http://localhost:3000/inventory/skus/${TEST_SKU_ID}/managers | jq
```

### 2.3 담당자 수정 (부분 업데이트)

```bash
curl -X PUT http://localhost:3000/inventory/skus/${TEST_SKU_ID}/managers \
  -H "Content-Type: application/json" \
  -d '{
    "purchaseManagerId": "new-manager-id"
  }' | jq
```

### 2.4 특정 역할 제거

```bash
# designer 역할 제거
curl -X DELETE http://localhost:3000/inventory/skus/${TEST_SKU_ID}/managers/designer | jq
```

### 2.5 담당자별 SKU 목록 조회

```bash
curl http://localhost:3000/inventory/managers/${TEST_MANAGER_ID}/skus | jq
```

**예상 결과:**
```json
[
  {
    "skuId": "sku-1",
    "role": "designer",
    "assignedAt": "2025-10-19..."
  },
  {
    "skuId": "sku-1",
    "role": "purchaseManager",
    "assignedAt": "2025-10-19..."
  }
]
```

### 2.6 전체 담당자 할당 목록

```bash
curl http://localhost:3000/inventory/skus/managers/all | jq
```

### 2.7 모든 담당자 제거

```bash
curl -X DELETE http://localhost:3000/inventory/skus/${TEST_SKU_ID}/managers | jq
```

---

## 📦 3. SKU Location Movement API 테스트

### 3.1 위치 이동 기록

```bash
curl -X POST http://localhost:3000/inventory/location-movements \
  -H "Content-Type: application/json" \
  -d '{
    "skuId": "'${TEST_SKU_ID}'",
    "barcode": "TEST-BARCODE-001",
    "fromLocationId": "'${TEST_LOCATION_FROM}'",
    "toLocationId": "'${TEST_LOCATION_TO}'",
    "quantity": 10,
    "reason": "Reorganization",
    "movedBy": "'${TEST_MANAGER_ID}'"
  }' | jq
```

**예상 결과:**
```json
{
  "id": "movement-uuid",
  "skuId": "test-sku-id",
  "barcode": "TEST-BARCODE-001",
  "fromLocationId": "location-1",
  "toLocationId": "location-2",
  "quantity": 10,
  "reason": "Reorganization",
  "status": "completed",
  "movedBy": "manager-id",
  "movementTimestamp": "2025-10-19...",
  "createdAt": "2025-10-19...",
  "updatedAt": "2025-10-19..."
}
```

### 3.2 SKU별 이동 이력 조회

```bash
curl "http://localhost:3000/inventory/skus/${TEST_SKU_ID}/location-movements?limit=10&offset=0" | jq
```

**예상 결과:**
```json
{
  "movements": [...],
  "total": 5
}
```

### 3.3 전체 이동 내역 (필터링)

```bash
# 기본 조회
curl http://localhost:3000/inventory/location-movements | jq

# 특정 SKU 필터
curl "http://localhost:3000/inventory/location-movements?skuId=${TEST_SKU_ID}" | jq

# 출발 위치 필터
curl "http://localhost:3000/inventory/location-movements?fromLocationId=${TEST_LOCATION_FROM}" | jq

# 날짜 범위 필터
curl "http://localhost:3000/inventory/location-movements?startDate=2025-10-01T00:00:00Z&endDate=2025-10-31T23:59:59Z" | jq
```

### 3.4 최근 이동 내역

```bash
curl "http://localhost:3000/inventory/location-movements/recent?limit=20" | jq
```

### 3.5 이동 통계

```bash
# 전체 통계
curl http://localhost:3000/inventory/location-movements/statistics | jq

# 기간별 통계
curl "http://localhost:3000/inventory/location-movements/statistics?startDate=2025-10-01T00:00:00Z&endDate=2025-10-31T23:59:59Z" | jq
```

**예상 결과:**
```json
{
  "totalMovements": 150,
  "mostMovedSkus": [
    {
      "skuId": "sku-1",
      "skuName": "Product A",
      "movementCount": 25
    }
  ],
  "mostActiveLocations": [
    {
      "locationId": "loc-1",
      "locationCode": "A-01-01",
      "movementCount": 30,
      "direction": "from"
    }
  ]
}
```

### 3.6 위치별 이동 내역

```bash
# 해당 위치에서 나간 이동 (from)
curl "http://localhost:3000/inventory/locations/${TEST_LOCATION_FROM}/movements?direction=from" | jq

# 해당 위치로 들어온 이동 (to)
curl "http://localhost:3000/inventory/locations/${TEST_LOCATION_TO}/movements?direction=to" | jq

# 양방향 모두 (both)
curl "http://localhost:3000/inventory/locations/${TEST_LOCATION_FROM}/movements?direction=both" | jq
```

### 3.7 특정 이동 조회

```bash
export MOVEMENT_ID="movement-uuid-from-create"
curl http://localhost:3000/inventory/location-movements/${MOVEMENT_ID} | jq
```

---

## 🔍 4. 통합 시나리오 테스트

### 시나리오: 신규 SKU 등록부터 위치 이동까지

```bash
#!/bin/bash

echo "=== 1. SKU 가격 설정 ==="
curl -X POST http://localhost:3000/inventory/skus/pricing \
  -H "Content-Type: application/json" \
  -d '{
    "skuId": "'${TEST_SKU_ID}'",
    "retailPrice": 30000,
    "sellingPrice": 30000
  }' | jq

echo -e "\n=== 2. 담당자 할당 ==="
curl -X POST http://localhost:3000/inventory/skus/managers \
  -H "Content-Type: application/json" \
  -d '{
    "skuId": "'${TEST_SKU_ID}'",
    "purchaseManagerId": "'${TEST_MANAGER_ID}'"
  }' | jq

echo -e "\n=== 3. 위치 이동 기록 ==="
curl -X POST http://localhost:3000/inventory/location-movements \
  -H "Content-Type: application/json" \
  -d '{
    "skuId": "'${TEST_SKU_ID}'",
    "barcode": "INTEGRATED-TEST-001",
    "fromLocationId": "'${TEST_LOCATION_FROM}'",
    "toLocationId": "'${TEST_LOCATION_TO}'",
    "quantity": 5,
    "reason": "Initial placement",
    "movedBy": "'${TEST_MANAGER_ID}'"
  }' | jq

echo -e "\n=== 4. 데이터 확인 ==="
echo "Price:"
curl http://localhost:3000/inventory/skus/${TEST_SKU_ID}/pricing | jq

echo -e "\nManagers:"
curl http://localhost:3000/inventory/skus/${TEST_SKU_ID}/managers | jq

echo -e "\nMovement History:"
curl http://localhost:3000/inventory/skus/${TEST_SKU_ID}/location-movements | jq
```

---

## ✅ 5. 검증 체크리스트

### SKU Pricing
- [ ] 가격 생성 성공
- [ ] 가격 조회 성공
- [ ] 유효 기간 기반 필터링 동작
- [ ] 가격 수정 성공
- [ ] 가격 삭제 성공
- [ ] 날짜 검증 (effectiveDate < expiryDate)
- [ ] 존재하지 않는 SKU 처리 (404)

### SKU Managers
- [ ] 담당자 할당 성공
- [ ] 담당자 조회 성공
- [ ] 부분 업데이트 동작
- [ ] 특정 역할 제거 성공
- [ ] 담당자별 SKU 목록 조회
- [ ] 전체 담당자 제거 성공
- [ ] 최소 1명의 담당자 필요 검증

### SKU Location Movement
- [ ] 이동 기록 생성 성공
- [ ] SKU별 이동 이력 조회
- [ ] 필터링 기능 동작 (SKU, 위치, 날짜)
- [ ] 최근 이동 내역 조회
- [ ] 통계 조회 성공
- [ ] 위치별 이동 내역 (from/to/both)
- [ ] 동일 위치 이동 방지 (from != to)
- [ ] 존재하지 않는 위치 처리 (404)

---

## 🐛 6. 예상 에러 케이스

### 6.1 잘못된 날짜 범위 (Pricing)

```bash
curl -X POST http://localhost:3000/inventory/skus/pricing \
  -H "Content-Type: application/json" \
  -d '{
    "skuId": "'${TEST_SKU_ID}'",
    "priceEffectiveDate": "2025-12-31T00:00:00Z",
    "priceExpiryDate": "2025-01-01T00:00:00Z"
  }' | jq
```

**예상 결과:** 400 Bad Request
```json
{
  "statusCode": 400,
  "message": "priceEffectiveDate must be before priceExpiryDate"
}
```

### 6.2 담당자 없이 할당 (Managers)

```bash
curl -X POST http://localhost:3000/inventory/skus/managers \
  -H "Content-Type: application/json" \
  -d '{
    "skuId": "'${TEST_SKU_ID}'"
  }' | jq
```

**예상 결과:** 400 Bad Request

### 6.3 동일 위치로 이동 (Location Movement)

```bash
curl -X POST http://localhost:3000/inventory/location-movements \
  -H "Content-Type: application/json" \
  -d '{
    "skuId": "'${TEST_SKU_ID}'",
    "barcode": "TEST",
    "fromLocationId": "'${TEST_LOCATION_FROM}'",
    "toLocationId": "'${TEST_LOCATION_FROM}'",
    "quantity": 1
  }' | jq
```

**예상 결과:** 400 Bad Request
```json
{
  "statusCode": 400,
  "message": "From and To locations must be different"
}
```

---

## 📊 7. Swagger 문서 확인

서버 실행 후 Swagger UI에서 API 문서를 확인할 수 있습니다:

```
http://localhost:3000/api
```

### 확인 사항:
- [ ] **SKU Pricing** 태그에 7개 엔드포인트 존재
- [ ] **SKU Managers** 태그에 6개 엔드포인트 존재
- [ ] **Manager SKU Assignments** 태그에 1개 엔드포인트 존재
- [ ] **SKU Location Movements** 태그에 5개 엔드포인트 존재
- [ ] **Location Movement History** 태그에 1개 엔드포인트 존재
- [ ] 모든 DTO에 @ApiProperty 데코레이터 적용
- [ ] Response 스키마가 올바르게 표시됨

---

## 🎉 8. 완료 기준

다음 모든 항목이 충족되면 Step 6 완료:

- [x] 3개 서비스 구현 및 등록
- [x] 6개 컨트롤러 구현 및 등록
- [x] Linter 에러 없음
- [ ] 모든 API 엔드포인트 수동 테스트 통과
- [ ] Swagger 문서 정상 표시
- [ ] 에러 케이스 정상 처리
- [ ] 통합 시나리오 테스트 통과

---

## 📝 참고 사항

### API 엔드포인트 요약

**SKU Pricing (7개)**
- POST `/inventory/skus/pricing` - 생성/수정
- GET `/inventory/skus/:skuId/pricing` - 조회
- GET `/inventory/skus/:skuId/pricing/effective` - 유효 가격 조회
- PUT `/inventory/skus/:skuId/pricing` - 수정
- DELETE `/inventory/skus/:skuId/pricing` - 삭제
- GET `/inventory/skus/pricing/all` - 전체 목록
- GET `/inventory/skus/:skuId/pricing/valid` - 유효성 확인

**SKU Managers (7개)**
- POST `/inventory/skus/managers` - 할당
- GET `/inventory/skus/:skuId/managers` - 조회
- PUT `/inventory/skus/:skuId/managers` - 수정
- DELETE `/inventory/skus/:skuId/managers` - 전체 제거
- DELETE `/inventory/skus/:skuId/managers/:role` - 역할 제거
- GET `/inventory/skus/managers/all` - 전체 목록
- GET `/inventory/managers/:managerId/skus` - 담당 SKU 목록

**SKU Location Movement (6개)**
- POST `/inventory/location-movements` - 이동 기록
- GET `/inventory/location-movements` - 필터링 조회
- GET `/inventory/location-movements/recent` - 최근 이동
- GET `/inventory/location-movements/statistics` - 통계
- GET `/inventory/location-movements/:id` - 상세 조회
- GET `/inventory/skus/:skuId/location-movements` - SKU 이동 이력
- GET `/inventory/locations/:locationId/movements` - 위치별 이동

**총 20개 엔드포인트**

---

**문서 작성일:** 2025-10-19
**마지막 업데이트:** 2025-10-19


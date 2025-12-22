# PIM-Medusa 동기화 기능

## 📖 개요

PIM (Product Information Management)에서 상품이 publish되면 자동으로 Medusa로 동기화하는 기능입니다.

### 주요 특징

- **이벤트 기반 동기화**: PIM에서 `ProductMasterActiveVersionChanged` 이벤트 발행 시 자동 동기화
- **Upsert 패턴**: PIM Master ID 기반으로 Medusa Product를 생성 또는 업데이트
- **안정적인 매핑**: `metadata.pimMasterId`로 추적, `handle`은 `pim-{masterId}` 형태로 고정
- **백필 스크립트**: 기존 PIM 상품을 일괄 동기화하는 CLI 도구 제공

---

## 🏗 아키텍처

```
PIM (Publish Event)
    ↓ Kafka
[PimProductEventConsumer]
    ↓
[PimMedusaSyncService]
    ├─ [PimClient] ────→ PIM API (Active Version 조회)
    ├─ [Transformer] ──→ PIM → Medusa 변환
    └─ [MedusaClient] ─→ Medusa API (Upsert)
```

---

## 📁 파일 구조

```
apps/channel-adapter/
├── src/
│   ├── types.ts                           # 타입 정의 추가
│   ├── consumers/
│   │   └── pim-product-event.consumer.ts  # Kafka 이벤트 컨슈머
│   └── services/
│       └── pim-medusa-sync/
│           ├── pim.client.ts              # PIM API 클라이언트
│           ├── medusa.client.ts           # Medusa API 클라이언트
│           ├── pim-to-medusa.transformer.ts # 변환 로직 (순수 함수)
│           └── pim-medusa-sync.service.ts  # 동기화 오케스트레이션
├── sync-pim-to-medusa.ts                  # 백필 스크립트
└── .env.example.pim-medusa                # 환경변수 예시
```

---

## 🚀 설정 방법

### 1. 환경변수 설정

`.env` 파일에 다음 내용 추가:

```bash
# PIM API
PIM_API_URL=http://localhost:3001

# Medusa API
MEDUSA_API_URL=http://localhost:9000
MEDUSA_API_KEY=your_api_key_here  # 필요 시

# Kafka (이벤트 컨슈밍용)
KAFKA_BROKERS=localhost:9092
KAFKA_CLIENT_ID_PREFIX=channel-adapter
KAFKA_GROUP_ID=channel-adapter-pim-medusa-sync
```

### 2. 서비스 시작

Channel Adapter 서비스를 실행하면 자동으로 Kafka 이벤트를 컨슘합니다:

```bash
npm run start:dev channel-adapter
```

---

## 🔄 동기화 플로우

### 이벤트 기반 (자동)

1. **PIM에서 상품 Publish**
   ```
   사용자가 PIM에서 Draft 버전을 Active로 Publish
   ```

2. **PIM 이벤트 발행**
   ```json
   {
     "eventType": "ProductMasterActiveVersionChanged",
     "aggregateId": "master-uuid",
     "payload": {
       "masterId": "master-uuid",
       "productId": "version-uuid",
       "version": 1,
       "name": "상품명",
       "changeReason": "published",
       "changedAt": "2025-12-19T10:00:00Z"
     }
   }
   ```

3. **Channel Adapter가 이벤트 컨슘**
   ```
   PimProductEventConsumer가 Kafka에서 이벤트 수신
   ```

4. **PIM Active Version 조회**
   ```
   PimClient가 PIM API 호출:
   - GET /masters/{masterId}/versions/active
   - GET /masters/{masterId}/variants?includePrice=true
   - GET /masters/{masterId}/options
   ```

5. **Medusa Payload로 변환**
   ```typescript
   transformPimToMedusa(snapshot) → MedusaProductPayload
   ```

6. **Medusa에 Upsert**
   ```
   MedusaClient.upsertProduct(payload)
   - metadata.pimMasterId로 기존 Product 조회
   - 없으면 생성 (POST /admin/products)
   - 있으면 업데이트 (POST /admin/products/{id})
   ```

---

## 🛠 백필 (일괄 동기화)

### 전체 동기화

모든 Active PIM Masters를 Medusa로 동기화:

```bash
npx tsx apps/channel-adapter/sync-pim-to-medusa.ts --all
```

### 단건 동기화

특정 Master만 동기화:

```bash
npx tsx apps/channel-adapter/sync-pim-to-medusa.ts --master <masterId>
```

**예시:**
```bash
npx tsx apps/channel-adapter/sync-pim-to-medusa.ts --master 01930000-0000-0000-0000-000000000000
```

### 여러 건 동기화

여러 Masters를 동시에 동기화:

```bash
npx tsx apps/channel-adapter/sync-pim-to-medusa.ts --masters <id1>,<id2>,<id3>
```

**예시:**
```bash
npx tsx apps/channel-adapter/sync-pim-to-medusa.ts --masters 01930001-...,01930002-...,01930003-...
```

### 백필 스크립트 출력 예시

```
[SyncPimToMedusa] Initializing application...
[SyncPimToMedusa] Checking connections...
[SyncPimToMedusa] ✅ Connections OK
[SyncPimToMedusa] 🔄 Starting full sync...
[PimMedusaSyncService] Found 150 active masters to sync
[PimMedusaSyncService] 🔄 Syncing 150 PIM masters...
[PimMedusaSyncService] ✅ Sync completed: master-001 → Medusa prod_123 (created)
[PimMedusaSyncService] ✅ Sync completed: master-002 → Medusa prod_124 (updated)
...
[SyncPimToMedusa] ==== SYNC RESULTS ====
[SyncPimToMedusa] Total: 150
[SyncPimToMedusa] ✅ Success: 148
[SyncPimToMedusa] ❌ Failed: 2
[SyncPimToMedusa] Failed masters:
  - master-099: No active version found
  - master-120: Medusa API timeout
[SyncPimToMedusa] 🎉 Sync completed successfully
```

---

## 🧪 테스트 방법

### 1. PIM에서 상품 생성 및 Publish

1. PIM에서 새 상품 생성:
   ```bash
   POST http://localhost:3001/api/v1/masters
   ```

2. 상품 정보 입력 후 Publish:
   ```bash
   PATCH http://localhost:3001/api/v1/masters/{masterId}/versions/{versionId}/publish
   {
     "targetStatus": "active"
   }
   ```

3. Channel Adapter 로그 확인:
   ```
   [PimProductEventConsumer] 📨 Received event: ProductMasterActiveVersionChanged
   [PimMedusaSyncService] 🔄 Starting sync for PIM master: xxx
   [MedusaClient] Creating Medusa product: 상품명 (pim-xxx)
   [MedusaClient] ✅ Created Medusa product: prod_xxx (pim-xxx)
   [PimMedusaSyncService] ✅ Sync completed: xxx → Medusa prod_xxx (created)
   ```

4. Medusa Admin에서 확인:
   ```
   http://localhost:9000/app/products
   - 새 상품이 생성되었는지 확인
   - metadata.pimMasterId가 올바른지 확인
   ```

### 2. 단건 백필 테스트

기존 PIM 상품을 수동으로 동기화:

```bash
npx tsx apps/channel-adapter/sync-pim-to-medusa.ts --master <masterId>
```

### 3. 헬스 체크

PIM & Medusa 연결 확인:

```typescript
const syncService = app.get(PimMedusaSyncService);
const health = await syncService.healthCheck();
console.log(health); // { pim: true, medusa: true, overall: true }
```

---

## 🔍 데이터 매핑

### PIM → Medusa

| PIM 필드 | Medusa 필드 | 비고 |
|----------|-------------|------|
| `masterId` | `metadata.pimMasterId` | **핵심: 업서트 키** |
| `versionId` | `metadata.pimVersionId` | 버전 추적용 |
| `version` | `metadata.pimVersion` | 버전 번호 |
| `name` | `title` | 상품명 |
| `masterId` | `handle` | `pim-{masterId}` 형태로 고정 |
| `description` | `description` | 상품 설명 |
| `thumbnail` | `thumbnail` | 썸네일 URL |
| `images` | `images` | 이미지 URL 배열 |
| `status` | `status` | `active` → `published`, `draft` → `draft` |
| `optionGroups` | `options` | 옵션 그룹 → 옵션 |
| `variants` | `variants` | Variant 배열 |
| `variants[].id` | `variants[].metadata.pimVariantId` | Variant 추적용 |
| `variants[].basePrice` | `variants[].prices[0].amount` | KRW 기준 가격 |

---

## ⚠️ 주의사항

### 1. Handle 충돌

- Medusa `handle`은 **전역 유일**해야 합니다
- `pim-{masterId}` 형태로 고정하여 충돌 방지
- 절대 수동으로 변경하지 마세요

### 2. 가격 정책

- 현재는 `basePrice`만 동기화
- `membershipPrice`는 Medusa의 Customer Group 규칙으로 매핑 가능
- 복잡한 가격 정책은 추가 구현 필요

### 3. 재고 관리

- Medusa `variants[].manage_inventory`는 기본값 `true`
- 실제 재고 수량은 WMS에서 별도 관리
- Inventory Item 연동은 추후 구현

### 4. 이미지

- PIM에서 이미지 URL만 전달
- Medusa에서 실제 파일 업로드는 하지 않음
- CDN URL 형태로 전달 권장

### 5. 옵션 변경

- PIM에서 옵션 변경 시 Variant가 재생성됨
- Medusa에도 동일하게 반영하려면 전체 업데이트 필요
- 현재는 새 Variant 추가 시 기존 Variant 유지

---

## 🐛 트러블슈팅

### 이벤트가 컨슘되지 않음

**원인:** Kafka 연결 실패 또는 Consumer Group 설정 오류

**해결:**
```bash
# Kafka 브로커 확인
echo $KAFKA_BROKERS

# Consumer 로그 확인
tail -f logs/channel-adapter.log | grep PimProductEventConsumer
```

### Medusa API 인증 실패

**원인:** `MEDUSA_API_KEY` 미설정 또는 잘못된 키

**해결:**
```bash
# Medusa Admin에서 API Key 생성
# .env 파일에 추가
MEDUSA_API_KEY=sk_xxx...
```

### PIM Active Version 조회 실패

**원인:** Master에 Active 버전이 없거나 PIM API 오류

**해결:**
```bash
# PIM에서 Master 확인
curl http://localhost:3001/api/v1/masters/{masterId}/versions/active

# Draft 버전을 Publish 했는지 확인
```

### Medusa Product 중복 생성

**원인:** `metadata.pimMasterId` 조회 실패 또는 인덱스 미생성

**해결:**
```sql
-- Medusa DB에서 중복 확인
SELECT id, handle, metadata->>'pimMasterId' FROM product WHERE metadata->>'pimMasterId' = 'xxx';

-- 중복 삭제 후 재동기화
```

---

## 🎯 다음 단계 (TODO)

- [ ] Unpublish 시 Medusa status를 'draft'로 변경
- [ ] 가격 정책 고급 매핑 (멤버십, 도매 등)
- [ ] 이미지 최적화 및 CDN 연동
- [ ] 재고 수량 동기화 (WMS → Medusa Inventory)
- [ ] 카테고리/태그 자동 생성 및 매핑
- [ ] 동기화 이력 및 모니터링 대시보드

---

**작성일:** 2025-12-19  
**작성자:** Cursor AI


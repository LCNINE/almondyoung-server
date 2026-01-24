# PIM → Medusa Migration Guide

채널 어댑터의 PIM → Medusa 백필 마이그레이션 가이드입니다.

## 준비 사항

### 1. 환경 변수 설정

`.env.migration.example` 파일을 복사하여 `.env.migration` 파일을 생성하고, 실제 값으로 변경합니다.

```bash
cp apps/channel-adapter/.env.migration.example apps/channel-adapter/.env.migration
```

`.env.migration` 파일 예시:

```bash
# 필수
PIM_SOURCE_DB_URL=postgresql://user:password@localhost:5432/pim_db
DATABASE_URL=postgresql://user:password@localhost:5432/channel_adapter_db
MEDUSA_API_URL=http://localhost:9000
MEDUSA_API_KEY=sk_your_api_key_here

# 선택적
FILE_SERVICE_URL=http://localhost:3000
MEDUSA_MEMBERSHIP_GROUP_ID=cgrp_01J8XXXXX
SKIP_VARIANTS_WITHOUT_PRICE=false
STRIP_BARCODE_ON_SYNC=false
```

### 2. 데이터베이스 준비

```bash
# Channel Adapter 데이터베이스 스키마 마이그레이션
npm run db:push:channel-adapter
```

## 마이그레이션 실행

### 기본 실행 (전체 동기화)

```bash
npm run migrate:backfill
```

### 옵션과 함께 실행

#### 1. 배치 크기 지정

```bash
npm run migrate:backfill -- --batch-size=50
```

#### 2. 제한된 개수만 처리 (테스트용)

```bash
npm run migrate:backfill:limit=100
# 또는
npm run migrate:backfill -- --limit=100
```

#### 3. 중단된 세션 재개

```bash
npm run migrate:backfill:resume=backfill-1737600000-abc12345
# 또는
npm run migrate:backfill -- --resume=backfill-1737600000-abc12345
```

#### 4. 배치 크기 + 제한 (조합)

```bash
npm run migrate:backfill -- --batch-size=50 --limit=200
```

## 진행 상황 모니터링

### 진행률 확인

```bash
npm run migrate:check-progress
```

출력 예시:
```
📊 Migration Progress

Session: backfill-1737600000-abc12345
Started: 2024-01-23 10:00:00
Batch size: 100

Progress:
  ✅ Success: 850
  ❌ Failed: 15
  ⏭️  Skipped: 5
  📊 Total: 870 / ~1000

Current offset: 900
```

### 실패한 항목 재시도

```bash
npm run migrate:retry-failed
```

## 고급 기능

### 카테고리 사전 생성 (선택적)

PIM 카테고리를 미리 Medusa에 생성해두면 제품 동기화 시 카테고리 생성 오버헤드를 줄일 수 있습니다.

```bash
npm run migrate:prefill-categories
```

## 문제 해결

### 1. 연결 오류

**증상**: `ECONNREFUSED` 또는 타임아웃 오류

**해결**:
- `.env.migration`의 DB URL과 Medusa URL 확인
- 네트워크 연결 확인
- Medusa 서버 실행 상태 확인

### 2. 인증 오류

**증상**: `401 Unauthorized` 또는 `403 Forbidden`

**해결**:
- `MEDUSA_API_KEY`가 올바른 Admin API 키인지 확인
- Medusa Admin 대시보드에서 API 키 재생성

### 3. 메모리 부족

**증상**: `JavaScript heap out of memory`

**해결**:
```bash
# Node.js 메모리 제한 늘리기
NODE_OPTIONS=--max-old-space-size=4096 npm run migrate:backfill
```

### 4. 중단된 마이그레이션

세션 ID를 확인하여 재개:

```bash
# 1. 진행 상황에서 세션 ID 확인
npm run migrate:check-progress

# 2. 세션 ID로 재개
npm run migrate:backfill -- --resume=backfill-1737600000-abc12345
```

## 데이터베이스 테이블

마이그레이션은 다음 테이블을 사용합니다:

- `pim_medusa_mapping`: 제품 매핑 정보 (masterId ↔ medusaProductId)
- `migration_progress`: 마이그레이션 세션 진행률
- `migration_failures`: 실패한 항목 기록

## 주의 사항

1. **읽기 전용**: PIM 데이터베이스는 읽기 전용으로 접근됩니다.
2. **멱등성**: 동일 제품을 여러 번 실행해도 안전합니다 (upsert 방식).
3. **트랜잭션**: 각 제품은 독립적으로 처리되며, 실패해도 다른 제품에 영향을 주지 않습니다.
4. **성능**: 대량 데이터의 경우 배치 크기를 조정하여 최적화할 수 있습니다.

## 참고

- 스크립트: `apps/channel-adapter/scripts/backfill-v2.ts`
- 변환 로직: `apps/channel-adapter/src/adapters/medusa/transformers/pim-to-medusa.transformer.ts`
- 동기화 서비스: `apps/channel-adapter/src/adapters/medusa/pim-medusa-sync.service.ts`

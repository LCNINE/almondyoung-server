# Outbox Demo App

**Transactional Outbox Pattern** 실증 데모 애플리케이션

## 개요

이 앱은 `@app/events` 모듈의 Outbox 패턴 기능을 사용하여 DB 트랜잭션과 이벤트 발행의 원자성을 보장하는 방법을 보여줍니다.

### 주요 기능

- ✅ DB 트랜잭션과 이벤트 발행의 원자성 보장
- ✅ Outbox 테이블을 통한 At-Least-Once 보장
- ✅ `@app/events` 모듈의 OutboxPublisher 및 OutboxDispatcher 사용
- ✅ Cron 기반 자동 이벤트 발행 (5초마다)
- ✅ 재시도 메커니즘 (최대 5회)
- ✅ 실패한 이벤트 추적

## 아키텍처

```
┌─────────────────────────────────────┐
│  POST /test (Create Record)        │
│  ┌──────────────────────────────┐   │
│  │ 1. test_records INSERT       │   │
│  │ 2. outbox_events INSERT      │   │  ← 같은 트랜잭션!
│  └──────────────────────────────┘   │
│           COMMIT (원자적)            │
└─────────────────────────────────────┘
              ↓
         (트랜잭션 밖)
              ↓
┌─────────────────────────────────────┐
│  OutboxDispatcher (@Cron 5초마다)   │
│  - outbox_events 폴링               │
│  - Kafka로 발행                     │
│  - 성공 시 PUBLISHED 상태 변경      │
└─────────────────────────────────────┘
```

## 설정

### 1. 환경 변수 설정

```bash
# .env.local 파일 생성
cp .env.example .env.local

# 환경 변수 편집
# - DATABASE_URL: Neon PostgreSQL URL
# - KAFKA_BROKERS: Confluent Cloud 브로커
# - KAFKA_API_KEY/SECRET: Confluent Cloud 인증 정보
```

### 2. 데이터베이스 설정

```bash
# event 스키마 마이그레이션 (event.outbox_events 테이블 생성)
npm run migrate:event "postgresql://user:password@localhost:5432/mydb"

# test_records 테이블 생성
npm run db:push:outbox-demo
```

생성되는 테이블:
- `event.outbox_events`: Outbox 이벤트 저장 (공용 스키마)
- `test_records`: 테스트 비즈니스 데이터

## 실행

### 개발 모드

```bash
npm run start:outbox-demo:dev
```

### 프로덕션 모드

```bash
# 빌드
npm run build:outbox-demo

# 실행
npm run start:outbox-demo:prod
```

## API 사용법

### 1. 테스트 레코드 생성 (Outbox 패턴 실증)

```bash
# POST /test
curl -X POST http://localhost:3003/test \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Record 1",
    "description": "Testing outbox pattern"
  }'
```

**결과:**
- `test_records` 테이블에 레코드 생성
- `event.outbox_events` 테이블에 `TestRecordCreated` 이벤트 저장 (status: PENDING)
- 5초 이내에 `@app/events`의 OutboxDispatcher가 이벤트를 Kafka로 자동 발행
- 성공 시 이벤트 상태가 PUBLISHED로 변경

### 2. 모든 레코드 조회

```bash
# GET /test
curl http://localhost:3003/test
```

### 3. 특정 레코드 조회

```bash
# GET /test/:id
curl http://localhost:3003/test/1
```

### 4. 레코드 삭제 (Outbox 패턴 실증)

```bash
# DELETE /test/:id
curl -X DELETE http://localhost:3003/test/1
```

**결과:**
- `test_records.status`가 DELETED로 변경
- `event.outbox_events` 테이블에 `TestRecordDeleted` 이벤트 저장
- `@app/events`의 OutboxDispatcher가 Kafka로 발행

## 로그 확인

`@app/events`의 OutboxDispatcher는 다음과 같은 로그를 출력합니다:

```
[OutboxDispatcher] Processing 2 outbox events
[OutboxDispatcher] Event 1 published: TestRecordCreated
[OutboxDispatcher] Event 2 published: TestRecordDeleted
```

실패 시:
```
[OutboxDispatcher] Event 3 failed (1/5): Connection timeout
```

최종 실패 시:
```
[OutboxDispatcher] Event 3 failed (5/5): Connection timeout
```

## Outbox 이벤트 상태 전이

```
PENDING → PROCESSING → PUBLISHED (성공)
                    ↓
                  PENDING (재시도)
                    ↓
                  FAILED (최종 실패, 5회 초과)
```

## 모니터링

### `@app/events` OutboxDispatcher Cron 작업

1. **매 5초마다**: PENDING 이벤트 처리 및 Kafka 발행
2. **매일 새벽 2시**: 7일 이상 된 PUBLISHED 이벤트 자동 삭제

## 데이터베이스 직접 확인

```sql
-- Outbox 이벤트 현황
SELECT status, COUNT(*)
FROM event.outbox_events
GROUP BY status;

-- 최근 이벤트 확인
SELECT id, event_type, status, created_at, published_at, retry_count
FROM event.outbox_events
ORDER BY created_at DESC
LIMIT 10;

-- 실패한 이벤트 확인
SELECT id, event_type, error_message, retry_count
FROM event.outbox_events
WHERE status = 'FAILED';
```

## 학습 포인트

이 데모를 통해 확인할 수 있는 것들:

1. **원자성**: DB 저장과 이벤트 발행이 논리적으로 원자적으로 처리됨
2. **At-Least-Once**: 네트워크 장애 시에도 재시도를 통해 최종적으로 발행 보장
3. **트랜잭션 범위**: SELECT + UPDATE는 트랜잭션 안에, Kafka 발행은 밖에
4. **상태 관리**: PENDING → PROCESSING → PUBLISHED 전이
5. **재시도 메커니즘**: 최대 5회 재시도 후 FAILED 상태로 전환
6. **`@app/events` 모듈**: OutboxPublisher와 OutboxDispatcher를 통한 쉬운 구현

## 코드 예시

### OutboxPublisher 사용

```typescript
import { OutboxPublisher } from '@app/events';

@Injectable()
export class TestService {
  constructor(
    @Inject('DATABASE') private readonly db: Database,
    private readonly outboxPublisher: OutboxPublisher,
  ) {}

  async createTestRecord(dto: CreateTestRecordDto) {
    return this.db.transaction(async (tx) => {
      // 1. 비즈니스 로직
      const [record] = await tx.insert(test_records).values({...}).returning();

      // 2. Outbox에 이벤트 저장 (같은 트랜잭션)
      await this.outboxPublisher.saveEvent({
        topic: 'test.events.v1',
        eventType: 'TestRecordCreated',
        aggregateType: 'TestRecord',
        aggregateId: record.id.toString(),
        payload: {
          id: record.id,
          name: record.name,
        },
      }, tx);

      return record;
    });
  }
}
```

### AppModule 설정

```typescript
import { EventsModule } from '@app/events';

@Module({
  imports: [
    EventsModule.forRoot({
      streams: [TEST_STREAM],
      serviceName: 'outbox-demo',
      enableOutbox: true,  // Outbox 패턴 활성화
      outbox: {
        dispatchIntervalMs: 5000,
        maxRetries: 5,
      },
    }),
    // ...
  ],
})
export class AppModule {}
```

## 테스트 시나리오

### 1. 정상 플로우 테스트

```bash
# 레코드 생성
curl -X POST http://localhost:3003/test \
  -H "Content-Type: application/json" \
  -d '{"name": "Normal Flow Test"}'

# 5초 대기 후 로그 확인
# → "✅ Event X: TestRecordCreated" 로그 확인

# DB에서 이벤트 상태 확인
# → status = 'PUBLISHED', published_at이 설정되어 있음
```

### 2. 재시도 메커니즘 테스트

```bash
# Kafka 브로커를 일시적으로 중단하거나
# 잘못된 KAFKA_BROKERS 설정

# 레코드 생성
curl -X POST http://localhost:3003/test \
  -H "Content-Type: application/json" \
  -d '{"name": "Retry Test"}'

# 로그 확인
# → "❌ Event X failed (1/5): ..." 재시도 로그 반복

# Kafka 브로커 복구 후
# → "✅ Event X: TestRecordCreated" 성공 로그
```

### 3. Dual Write Problem 회피 확인

```bash
# 트랜잭션 중 에러 발생 시뮬레이션 (코드 수정 필요)
# - test_records INSERT 후 outbox_events INSERT 전에 에러 발생

# 결과: 둘 다 롤백됨 → Dual Write Problem 회피!
```

## 참고 문서

- [Events Module](../../libs/events/)
- [Events Module README](../../libs/events/README.md)
- Transactional Outbox Pattern 구현은 `libs/events/src/outbox/`에 있습니다

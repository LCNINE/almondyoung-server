# 🆘 Events Module - 문제 해결 가이드

자주 발생하는 문제와 해결 방법을 정리했습니다.

---

## 1. Consumer가 메시지를 받지 못해요

### 증상
- Publisher는 메시지를 발행함
- Consumer 로그가 전혀 나타나지 않음
- Confluent Cloud Console에서 메시지는 확인됨

### 원인 및 해결

#### A. Consumer가 controllers 배열에 없음 ⭐ 가장 흔한 실수!

**문제:**
```typescript
@Module({
  controllers: [MyController],
  providers: [MyService, MyConsumer],  // ❌ 잘못됨!
})
```

**해결:**
```typescript
@Module({
  controllers: [MyController, MyConsumer],  // ✅ controllers에 추가!
  providers: [MyService],
})
```

**이유:** `@Controller()` 데코레이터를 사용하는 클래스는 반드시 `controllers` 배열에 등록해야 NestJS가 `@EventPattern`을 인식합니다.

---

#### B. EventTypeGuard가 없음

**문제:**
```typescript
@Controller()
export class MyConsumer {  // ❌ EventTypeGuard 없음
  @OnEvent('orders.events.v1', 'OrderCreated')
  async handleOrderCreated(...) {}
}
```

**해결:**
```typescript
@Controller()
@UseInterceptors(EventTypeGuard)  // ✅ 추가!
export class MyConsumer {
  @OnEvent('orders.events.v1', 'OrderCreated')
  async handleOrderCreated(...) {}
}
```

**이유:** EventTypeGuard가 없으면 모든 핸들러가 모든 메시지에 대해 호출되거나, 필터링이 제대로 작동하지 않습니다.

---

#### C. 환경변수가 로딩되지 않음

**문제:**
```typescript
import { NestFactory } from '@nestjs/core';
import * as dotenv from 'dotenv';

dotenv.config();  // ❌ import 후에 실행
```

**해결:**
```typescript
// ⚠️ 반드시 다른 import보다 먼저!
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ 
  path: path.resolve(process.cwd(), 'apps/my-service/.env'),
  override: true 
});

import { NestFactory } from '@nestjs/core';
// ...
```

**이유:** Module import 시점에 이미 환경변수를 읽으므로, import 전에 dotenv를 로딩해야 합니다.

---

#### D. Confluent Cloud ACL 권한 부족

**증상:**
- `memberAssignment: {}` (파티션 할당 없음)
- Consumer가 group에 join하지만 토픽을 읽지 못함

**해결:**
1. Confluent Cloud Console 로그인
2. 클러스터 → Data integration → Clients
3. 사용 중인 API Key 선택
4. Permissions 탭에서 ACL 추가:
   - Resource Type: `TOPIC`
   - Resource Name: `your-topic-name`
   - Pattern Type: `LITERAL`
   - Operation: `READ`, `DESCRIBE`

---

## 2. 같은 메시지를 계속 처리해요

### 증상
- 같은 메시지 ID가 계속 로그에 출력됨
- Kafka offset이 commit되지 않음

### 원인 및 해결

#### A. 핸들러에서 에러 발생

**문제:**
```typescript
@OnEvent('orders.events.v1', 'OrderCreated')
async handleOrderCreated(@EventPayload() payload: OrderCreatedPayload) {
  // 에러 발생 → Offset commit 실패 → 무한 재처리
  await this.processOrder(payload);  // 여기서 에러!
}
```

**해결:**
```typescript
@OnEvent('orders.events.v1', 'OrderCreated')
@RetryPolicy({ maxAttempts: 3, backoff: 'exponential' })  // ✅ 재시도 정책 추가
async handleOrderCreated(@EventPayload() payload: OrderCreatedPayload) {
  try {
    await this.processOrder(payload);
  } catch (error) {
    this.logger.error(`Failed to process order: ${error.message}`);
    // 재시도 후에도 실패하면 DLQ로 이동
    throw error;
  }
}
```

그리고 Module에서:
```typescript
EventsModule.forConsumerModule({
  streams: [ORDER_STREAM],
  groupId: 'my-consumer',
  enableAutoDLQ: true,  // ✅ 자동 DLQ 활성화
})
```

---

#### B. Guard가 false 반환 (구버전 문제)

**문제:**
```typescript
@UseGuards(SomeGuard)  // Guard가 false 반환 → 에러 발생
```

**해결:**
- Guard 대신 Interceptor 사용
- EventTypeGuard는 이미 Interceptor로 구현되어 있음 ✅

---

## 3. "EmptyError: no elements in sequence" 에러

### 증상
```
ERROR [Runner] Error when calling eachMessage
EmptyError: no elements in sequence
```

### 원인
Interceptor에서 `EMPTY` Observable을 반환했을 때 발생합니다.

### 해결
**EventTypeGuard는 이미 수정되어 있습니다 (v1.1.0+)**

만약 직접 Interceptor를 만들었다면:

```typescript
// ❌ 잘못된 방법
return EMPTY;

// ✅ 올바른 방법
return of(undefined);
```

---

## 4. 환경변수를 못 읽어요

### 증상
```
KAFKA_BROKERS: undefined
KAFKA_API_KEY: NOT SET
```

### 원인 및 해결

#### A. .env 파일 경로 오류

**문제:**
```typescript
dotenv.config({ path: path.resolve(__dirname, '../.env') });
```

**해결:**
```typescript
// process.cwd()는 항상 프로젝트 루트를 가리킴
dotenv.config({ 
  path: path.resolve(process.cwd(), 'apps/my-service/.env'),
  override: true 
});
```

---

#### B. .env 파일이 없음

**해결:**
```bash
cd apps/my-service
cp .env.example .env
# .env 파일 수정
```

---

## 5. "Forbidden resource" 에러

### 증상
```
ERROR [ServerKafka] ERROR [Runner] Error when calling eachMessage
error: "Forbidden resource"
```

### 원인
Guard가 `false`를 반환하거나, ACL 권한 문제입니다.

### 해결

#### A. EventTypeGuard 사용

```typescript
@Controller()
@UseInterceptors(EventTypeGuard)  // ✅ Guard가 아닌 Interceptor
export class MyConsumer {}
```

#### B. ACL 권한 확인 (Confluent Cloud)

위의 "1-D. Confluent Cloud ACL 권한 부족" 참고

---

## 6. 메시지 발행은 되는데 Consumer에 안 와요

### 체크리스트

1. ✅ **Confluent Cloud에서 메시지 확인**
   - Topics → your-topic → Messages 탭
   - 메시지가 실제로 있나요?

2. ✅ **Consumer Group 확인**
   - Consumers 탭
   - Consumer group이 보이나요?
   - Lag이 쌓이고 있나요?

3. ✅ **토픽 이름 일치 확인**
   - Stream 정의: `topic: 'orders.events.v1'`
   - Confluent Cloud: `orders.events.v1`
   - 정확히 일치하나요? (점, 하이픈 주의!)

4. ✅ **파티션 수 일치 확인**
   - Stream 정의: `partitions: 6`
   - Confluent Cloud: 실제 파티션 수는?
   - 일치하지 않아도 작동하지만, 일치시키는 것이 좋습니다

5. ✅ **fromBeginning 설정**
   - 기본값은 `false` (새 메시지만 수신)
   - Consumer 시작 전 메시지는 못 받습니다
   - 테스트 시에는 Consumer 시작 **후** 메시지 발행

---

## 7. TypeScript 컴파일 에러

### 증상
```
TS2352: Conversion of type 'null' to type 'string' may be a mistake
```

### 해결
**Events Module v1.1.0+는 이미 수정되어 있습니다.**

업데이트:
```bash
# package.json에서 @app/events 버전 확인
# 최신 버전으로 업데이트
```

---

## 8. Confluent Cloud 토픽 생성 방법

### 단계별 가이드

1. **Confluent Cloud Console 접속**
   - https://confluent.cloud/ 로그인

2. **클러스터 선택**

3. **Topics 메뉴**
   - 왼쪽 메뉴에서 "Topics" 클릭
   - "Create topic" 버튼 클릭

4. **Main Topic 생성**
   ```
   Topic name: orders.events.v1
   Partitions: 6
   Retention time: 168 hours (7 days)
   Cleanup policy: delete
   Compression type: producer
   ```

5. **DLQ Topic 생성**
   ```
   Topic name: orders.events.v1.dlq
   Partitions: 1
   Retention time: 720 hours (30 days)
   Cleanup policy: delete
   ```

6. **완료!**

---

## 9. "The group is rebalancing" 에러

### 증상
```
ERROR [Connection] Response SyncGroup
error: "The group is rebalancing, so a rejoin is needed"
```

### 원인
이것은 **정상적인 동작**입니다! Consumer가 group에 join하는 과정에서 발생합니다.

### 해결
- 무시하세요 ✅
- 몇 초 후 "Consumer has joined the group" 로그가 나타나면 정상입니다

---

## 10. KafkaJS v2.0.0 Partitioner 경고

### 증상
```
WARN [undefined] KafkaJS v2.0.0 switched default partitioner...
```

### 해결

**.env 파일에 추가:**
```env
KAFKAJS_NO_PARTITIONER_WARNING=1
```

---

## 🆘 여전히 해결이 안 돼요!

### 디버깅 체크리스트

1. **로그 확인**
   ```bash
   npm run start:my-service:dev
   # 전체 로그를 확인하세요
   ```

2. **Confluent Cloud Console 확인**
   - Topics: 메시지가 있나요?
   - Consumers: Consumer group이 보이나요?
   - Clients: API Key가 활성 상태인가요?

3. **events-test 앱으로 테스트**
   ```bash
   # 기본 동작 확인
   npm run start:events-test:dev
   ```

4. **로그 레벨 올리기**
   ```env
   LOG_LEVEL=debug
   ```

---

**더 도움이 필요하면 [Quick Start Guide](./quick-start-guide.md)를 참고하세요!**


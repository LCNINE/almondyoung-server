# 이벤트 체인 추적 가이드

Kafka 이벤트 드리븐 시스템에서 "이벤트 A → 이벤트 B → 이벤트 C" 같은 연쇄 흐름을 추적하기 위한 기능입니다.

---

## 핵심 개념

### Chain ID

하나의 비즈니스 흐름에 속하는 모든 이벤트를 묶는 UUID v7 식별자입니다. 이벤트가 발행될 때 envelope에 포함되어 downstream으로 자동 전파됩니다.

### 리소스 링크 (`event.event_resource_links`)

이벤트와 리소스의 인과관계를 기록하는 테이블입니다.

- **CAUSE**: 어떤 리소스가 이벤트 발행을 유발했는지
- **EFFECT**: 이벤트 처리 결과로 어떤 리소스에 무슨 작업이 일어났는지

### CLS (Continuation Local Storage)

`nestjs-cls` 기반으로, 같은 처리 흐름 안에서는 명시적으로 chainId를 넘기지 않아도 자동으로 전파됩니다.

---

## 설치 및 마이그레이션

### 데이터베이스 테이블 생성

```bash
npm run migrate:event
```

`event.event_resource_links` 테이블과 인덱스가 생성됩니다.

### AppModule 설정

CLS가 동작하려면 앱 최상위 모듈에 `ClsModule.forRoot()`를 등록해야 합니다. `EventsModule.forRoot()`나 `EventsModule.forConsumerModule()`을 사용하면 **자동으로 포함**되므로 별도 등록은 필요 없습니다.

직접 등록이 필요한 경우:

```typescript
import { ClsModule } from 'nestjs-cls';

@Module({
  imports: [
    ClsModule.forRoot({ global: true, middleware: { mount: false } }),
    // ...
  ],
})
export class AppModule {}
```

---

## 사용법

### 1. 이벤트 발행 시 원인 기록

`publishEvent()`에 `causedBy`를 추가합니다. "무엇이 이 이벤트를 유발했는지" CAUSE 레코드가 자동 저장됩니다.

```typescript
await this.orderEventPublisher.publishEvent({
  eventType: 'OrderCreated',
  aggregateId: order.id,
  payload: { orderId: order.id, ... },
  causedBy: {
    resourceType: 'PAYMENT',
    resourceId: payment.id,
    description: '결제 확인으로 주문 생성',  // 선택
  },
});
```

`causedBy`는 선택 사항입니다. 생략하면 chainId만 전파되고 CAUSE 기록은 남지 않습니다.

---

### 2. 이벤트 처리 결과 기록

핸들러(inbox-worker, 이벤트 컨슈머 등)에서 처리 결과를 남깁니다. `chainId`와 `eventId`는 CLS에서 자동으로 읽어오므로 넘길 필요 없습니다.

```typescript
// InboxWorkerService switch-case 안에서
case 'OrderCreated': {
  const order = await this.orderService.create(payload, tx);

  await this.eventTrackingService.trackEffect({
    resourceType: 'ORDER',
    resourceId: order.id,
    action: 'CREATED',
    description: '주문 이벤트 수신으로 주문 레코드 생성',
    eventType: 'OrderCreated',
  }, tx);  // tx를 넘기면 비즈니스 트랜잭션과 동일 TX에서 기록됨

  break;
}
```

**`action` 권장 값:** `CREATED` / `UPDATED` / `DELETED` / `SYNCED` / `SKIPPED`

`tx` 없이 호출하면 별도 커넥션으로 기록됩니다.

---

### 3. 체인 중간에서 후속 이벤트 발행

핸들러 안에서 새 이벤트를 발행하면 현재 chainId가 **자동으로 이어집니다**. 별도 작업이 필요 없습니다.

```typescript
case 'MembershipStatusChanged': {
  await this.membershipSyncService.handle(payload);

  // publishEvent 내부에서 CLS의 chainId를 읽어 envelope에 포함
  await this.notificationPublisher.publishEvent({
    eventType: 'MembershipSyncedToMedusa',
    aggregateId: payload.userId,
    payload: { userId: payload.userId },
  });
  break;
}
```

---

### 4. EventTrackingService 주입

`EventsModule`이 `@Global()`이므로 별도 import 없이 주입할 수 있습니다.

```typescript
import { EventTrackingService } from '@app/events';

@Injectable()
export class OrderService {
  constructor(
    private readonly eventTrackingService: EventTrackingService,
  ) {}
}
```

---

## 흐름 예시

결제 → 주문 생성 → Medusa 동기화 체인:

```
[결제 서비스]
  PaymentConfirmed 이벤트 발행
  causedBy: { resourceType: 'PAYMENT', resourceId: 'pay-001' }
  → CAUSE 기록: PAYMENT pay-001 → PaymentConfirmed

[주문 서비스 - inbox worker]
  PaymentConfirmed 처리
  → ORDER ord-123 생성
  → trackEffect: ORDER ord-123 CREATED
  → EFFECT 기록: PaymentConfirmed → ORDER ord-123 CREATED

  OrderCreated 이벤트 발행 (chainId 자동 이어짐)
  causedBy: { resourceType: 'ORDER', resourceId: 'ord-123' }
  → CAUSE 기록: ORDER ord-123 → OrderCreated

[channel-adapter - inbox worker]
  OrderCreated 처리
  → Medusa customer 업데이트
  → trackEffect: CUSTOMER medusa-cust-456 UPDATED
  → EFFECT 기록: OrderCreated → CUSTOMER medusa-cust-456 UPDATED
```

---

## 추적 데이터 조회

```sql
-- chain_id로 전체 흐름 조회
SELECT
  direction,
  event_type,
  resource_type,
  resource_id,
  action,
  description,
  service_name,
  created_at
FROM event.event_resource_links
WHERE chain_id = '019687ab-cdef-7000-8000-abcdef012345'
ORDER BY created_at;
```

결과 예시:

```
direction | event_type          | resource_type | resource_id    | action
----------+---------------------+---------------+----------------+---------
CAUSE     | PaymentConfirmed    | PAYMENT       | pay-001        |
EFFECT    | PaymentConfirmed    | ORDER         | ord-123        | CREATED
CAUSE     | OrderCreated        | ORDER         | ord-123        |
EFFECT    | OrderCreated        | CUSTOMER      | medusa-cust-456| UPDATED
```

---

## 동작 보장 수준

이 기능은 **베스트 에포트(best-effort)** 로 동작합니다.

- CAUSE/EFFECT 기록 실패 시 경고 로그만 남기고 이벤트 처리는 계속됩니다.
- CLS 컨텍스트 없이 `trackEffect()`를 호출하면 기록 없이 넘어갑니다 (경고 로그 출력).
- 비즈니스 로직과 트래킹 실패는 독립적입니다.

---

## 요약

| 하려는 것 | 방법 |
|----------|------|
| 이벤트 발행 원인 남기기 | `publishEvent({ ..., causedBy: { resourceType, resourceId } })` |
| 이벤트 처리 결과 남기기 | `eventTrackingService.trackEffect({ resourceType, resourceId, action })` |
| 체인 이어서 후속 이벤트 발행 | 그냥 `publishEvent()` — chainId 자동 전파 |
| 전체 체인 조회 | `SELECT * FROM event.event_resource_links WHERE chain_id = ?` |

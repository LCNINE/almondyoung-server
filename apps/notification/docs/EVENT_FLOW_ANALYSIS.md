# 이벤트 → 알림 발송 플로우 분석

## 전체 플로우 개요

```
┌─────────────────┐
│  Domain Event   │ (Kafka / HTTP)
│   (Trigger)     │
└────────┬────────┘
         │
         ├─────────────────────────────────┐
         │                                 │
         ▼                                 ▼
┌────────────────────┐        ┌──────────────────────┐
│  Event Consumer    │        │  EventController    │
│  (@OnEvent)        │        │  (HTTP /trigger)     │
└────────┬───────────┘        └──────────┬───────────┘
         │                               │
         │                               │
         ▼                               ▼
┌────────────────────┐        ┌──────────────────────┐
│ EventMappingService│        │NotificationDispatcher│
│  .getEventMapping()│        │  .processEvent()     │
└────────┬───────────┘        └──────────┬───────────┘
         │                               │
         │                               │
         └───────────────┬───────────────┘
                         │
                         ▼
            ┌────────────────────────┐
            │NotificationDispatcher │
            │    .send()            │
            └───────────┬───────────┘
                        │
                        │ 1. notifications 테이블에 레코드 생성
                        │ 2. Bull 큐에 'send-notification' 잡 추가
                        │
                        ▼
            ┌────────────────────────┐
            │ NotificationProcessor  │
            │  @Process('send-       │
            │   notification')       │
            └───────────┬───────────┘
                        │
                        │ 1. notification 조회
                        │ 2. 사용자 연락처 추출
                        │ 3. ProviderManager.getAvailableProviderForChannel()
                        │
                        ▼
            ┌────────────────────────┐
            │  ProviderManager       │
            │  .getAvailableProvider │
            │  ForChannel()          │
            └───────────┬───────────┘
                        │
                        │ 채널별 사용 가능한 프로바이더 반환
                        │ (ResendProvider, TwilioProvider, etc.)
                        │
                        ▼
            ┌────────────────────────┐
            │  NotificationProvider   │
            │  .send()                │
            └───────────┬───────────┘
                        │
                        │ 실제 외부 API 호출
                        │ (Resend, Twilio, NHN Kakao, FCM)
                        │
                        ▼
                   [알림 발송 완료]
```

---

## 1. Kafka 이벤트 경로 

### 플로우:
1. **이벤트 수신**: `UserEventConsumer`, `OrderEventConsumer`, `WalletEventConsumer`
   - `@OnEvent('stream', 'eventType')` 데코레이터로 이벤트 수신
   - 예: `@OnEvent('users.events.v1', 'UserVerification')`

2. **이벤트 매핑 조회**: `EventMappingService.getEventMapping(eventKey)`
   - `notification_events` 테이블에서 매핑 정보 조회
   - 템플릿 키, 기본 채널, 카테고리, 우선순위 등

3. **알림 생성 및 큐 추가**: `NotificationDispatcherService.send(sendDto)`
   - `notifications` 테이블에 레코드 생성
   - Bull 큐에 `send-notification` 잡 추가
   - 채널별로 별도 알림 레코드 생성

4. **큐 처리**: `NotificationProcessor.handleSendNotification()`
   - 큐에서 잡을 가져와 처리
   - `ProviderManager.getAvailableProviderForChannel()`로 프로바이더 조회
   - `provider.send()`로 실제 발송

5. **상태 업데이트**: 발송 성공/실패에 따라 `notifications` 테이블 업데이트



---

## 2. HTTP 이벤트 경로 

1. **HTTP 요청**: `POST /events/trigger`
   - `TriggerEventDto` 받음

2. **이벤트 처리**: `NotificationDispatcherService.processEvent()`
   - `notification_events` 테이블에서 매핑 조회
   - `SendNotificationDto` 구성
   - `send()` 호출하여 알림 생성 및 큐 추가

3. **이후 플로우**: Kafka 이벤트 경로와 동일


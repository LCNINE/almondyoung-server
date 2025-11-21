# 웹훅 처리 구현 완료

## 구현 완료 사항

### 1. ✅ Kakao 웹훅 처리 (NHN KakaoTalk API v2.3)

#### DTO 생성
- `apps/notification/src/provider/providers/kakao/kakao-webhook.dto.ts`
  - `KakaoWebhookPayload`: 웹훅 페이로드 구조
  - `KakaoMessageResultUpdateHook`: 메시지 발송 결과 업데이트
  - `KakaoTemplateStatusUpdateHook`: 템플릿 상태 업데이트

#### 웹훅 처리 로직
- **서명 검증**: `X-Toast-Webhook-Signature` 헤더 검증 (프로덕션 환경)
- **메시지 결과 업데이트** (`MESSAGE_RESULT_UPDATE`):
  - `requestId`로 notification 찾기
  - `resultCode` 매핑:
    - `MRC01` → `DELIVERED`
    - `MRC02` → `FAILED`
  - `messageStatus` 매핑:
    - `COMPLETED` → `DELIVERED`
    - `FAILED` → `FAILED`
    - `CANCEL` → `CANCELLED`
  - `notifications` 테이블 상태 업데이트
  - `receipts` 테이블에 웹훅 이벤트 저장

- **템플릿 상태 업데이트** (`TEMPLATE_STATUS_UPDATE`):
  - `templateCode`로 템플릿 찾기
  - 상태 매핑:
    - `TSC01` (요청) → `REQUESTED`
    - `TSC02` (검수 중) → `REQUESTED`
    - `TSC03` (승인) → `APPROVED`
    - `TSC04` (반려) → `REJECTED`
  - `templates` 테이블의 `kakaoTemplateStatus` 업데이트
  - 템플릿 문의(comments) 정보 저장

#### 웹훅 컨트롤러
- `POST /webhooks/kakao` 엔드포인트
- `X-Toast-Webhook-Signature` 헤더 지원
- Raw body 파서 적용 (서명 검증용)

---

### 2. ✅ Twilio 웹훅 처리

#### 웹훅 처리 로직
- **Status Callback 처리**:
  - `MessageSid`로 notification 찾기
  - `MessageStatus` 매핑:
    - `queued`, `sending` → `PROCESSING`
    - `sent` → `SENT`
    - `delivered` → `DELIVERED`
    - `undelivered`, `failed` → `FAILED`
  - `notifications` 테이블 상태 업데이트
  - `receipts` 테이블에 웹훅 이벤트 저장

#### 웹훅 컨트롤러
- `POST /webhooks/twilio` 엔드포인트
- Status Callback 파라미터 처리

---

### 3. ✅ Notification Processor 개선

#### requestId/messageSid 저장
- Kakao 알림 발송 시 `requestId`를 `metadata.requestId`에 저장
- Twilio SMS 발송 시 `messageSid`를 `metadata.messageSid`에 저장
- 웹훅에서 notification을 찾기 위해 필요

---

## 웹훅 플로우

### Kakao 웹훅 플로우

```
NHN KakaoTalk
    ↓
POST /webhooks/kakao
    ↓
WebhookController.handleKakao()
    ↓
WebhookService.handleKakaoWebhook()
    ↓
[서명 검증]
    ↓
이벤트 타입 분기:
    ├─ MESSAGE_RESULT_UPDATE
    │   ├─ requestId로 notification 찾기
    │   ├─ resultCode 매핑
    │   └─ notifications.status 업데이트
    │
    └─ TEMPLATE_STATUS_UPDATE
        ├─ templateCode로 템플릿 찾기
        ├─ 상태 매핑
        └─ templates.kakaoTemplateStatus 업데이트
```

### Twilio 웹훅 플로우

```
Twilio Status Callback
    ↓
POST /webhooks/twilio
    ↓
WebhookController.handleTwilio()
    ↓
WebhookService.handleTwilioWebhook()
    ↓
[MessageSid로 notification 찾기]
    ↓
MessageStatus 매핑
    ↓
notifications.status 업데이트
```

---

## 상태 매핑

### Kakao resultCode → NotificationStatus

| Kakao resultCode | NotificationStatus |
|-----------------|-------------------|
| MRC01 (성공) | DELIVERED |
| MRC02 (실패) | FAILED |
| COMPLETED | DELIVERED |
| FAILED | FAILED |
| CANCEL | CANCELLED |

### Kakao Template Status → Template Status

| NHN Status | Template Status |
|-----------|----------------|
| TSC01 (요청) | REQUESTED |
| TSC02 (검수 중) | REQUESTED |
| TSC03 (승인) | APPROVED |
| TSC04 (반려) | REJECTED |

### Twilio MessageStatus → NotificationStatus

| Twilio Status | NotificationStatus |
|--------------|-------------------|
| queued, sending | PROCESSING |
| sent | SENT |
| delivered | DELIVERED |
| undelivered, failed | FAILED |

---

## 환경 변수

### Kakao 웹훅
- `NHN_WEBHOOK_SIGNATURE`: 웹훅 서명 (프로덕션 환경 필수)

### 기존 환경 변수
- `RESEND_WEBHOOK_SECRET`: Resend 웹훅 서명 (이미 설정됨)

---

## 테스트 권장 사항

1. **Kakao 웹훅 테스트**:
   - `MESSAGE_RESULT_UPDATE` 이벤트 전송
   - `TEMPLATE_STATUS_UPDATE` 이벤트 전송
   - 서명 검증 테스트

2. **Twilio 웹훅 테스트**:
   - Status Callback 전송
   - 다양한 MessageStatus 테스트

3. **Notification 찾기 테스트**:
   - `requestId`/`messageSid`가 metadata에 저장되는지 확인
   - 웹훅에서 notification을 정확히 찾는지 확인

---

## 주의사항

1. **프로덕션 환경**:
   - Kakao 웹훅 서명 검증 필수
   - `NHN_WEBHOOK_SIGNATURE` 환경 변수 설정 필요

2. **Notification 찾기**:
   - `requestId`/`messageSid`는 notification 발송 시 metadata에 저장됨
   - 웹훅 수신 시 metadata에서 찾거나 receipts 테이블에서 찾음

3. **에러 처리**:
   - 서명 검증 실패 시 `UnauthorizedException` throw
   - notification을 찾지 못한 경우 경고 로그만 남기고 계속 진행


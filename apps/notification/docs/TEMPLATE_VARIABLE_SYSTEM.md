# 템플릿 변수 시스템

## 개요

알림 발송 시 템플릿에 동적 변수(사용자 이름, 인증키, 주문번호 등)를 치환하는 시스템입니다.

## 아키텍처

```
이벤트 수신 (payload)
    ↓
NotificationDispatcherService
    ↓
TemplateVariableMapperService (변수 추출 및 채널별 변환)
    ↓
NotificationProcessor
    ↓
Provider별 변수 전달
    - KAKAO: templateParameter (#{key} 형식)
    - EMAIL: template.variables (Resend 템플릿)
    - SMS/PUSH: {{variable}} 텍스트 치환
```

## 주요 컴포넌트

### 1. TemplateVariableMapperService

채널별로 다른 템플릿 변수 전달 방식을 처리합니다.

**주요 메서드:**

- `extractVariablesFromPayload()`: 이벤트 payload에서 템플릿 스키마 기반으로 변수 추출
- `mapVariablesForChannel()`: 채널별로 변수를 적절한 형식으로 변환
- `extractVariablesFromTemplate()`: 템플릿 body에서 변수 목록 추출

**채널별 변환:**

- **KAKAO (NHN)**: `templateParameter` 형식으로 변환
  ```typescript
  {
    kakaoTemplateCode: "TEMPLATE_001",
    kakaoTemplateParameters: {
      userName: "홍길동",
      verificationCode: "123456"
    }
  }
  ```

- **EMAIL (Resend)**: `template.variables` 형식으로 변환
  ```typescript
  {
    templateId: "tmpl_xxxxx",
    resendTemplateVariables: {
      USER_NAME: "홍길동",
      VERIFICATION_CODE: "123456"
    }
  }
  ```

- **SMS (Twilio)**: 일반 텍스트 치환용 변수
  ```typescript
  {
    interpolationVariables: {
      userName: "홍길동",
      verificationCode: "123456"
    }
  }
  ```

- **PUSH (FCM)**: 일반 텍스트 치환 + data payload 변수
  ```typescript
  {
    interpolationVariables: {
      userName: "홍길동",
      verificationCode: "123456"
    },
    fcmDataVariables: {
      userName: "홍길동",
      verificationCode: "123456"
    }
  }
  ```
  - `interpolationVariables`: notification.title, notification.body 치환용
  - `fcmDataVariables`: data payload에 포함될 변수 (모두 문자열)

### 2. NotificationDispatcherService

템플릿 변수를 추출하고 채널별로 변환하여 metadata에 저장합니다.

**처리 흐름:**

1. 템플릿 조회 (templateKey가 있는 경우)
2. 변수 추출:
   - `dto.variables`가 있으면 사용
   - 없으면 `template.variablesSchema`와 `payload`에서 자동 추출
3. 채널별 변수 매핑
4. metadata에 채널별 템플릿 정보 저장

### 3. NotificationProcessor

프로바이더별로 템플릿 변수를 전달합니다.

- **KAKAO**: `metadata.templateCode`와 `metadata.templateParameters` 전달
- **EMAIL**: `metadata.templateId`와 `metadata.templateVariables` 전달

## 사용 예시

### 1. 이벤트 컨슈머에서 변수 전달

```typescript
const sendDto: SendNotificationDto = {
  userId: payload.userId,
  channels: ['EMAIL', 'KAKAO'],
  templateKey: 'user-verification',
  payload: payload,
  variables: {
    name: payload.name,
    email: payload.email,
    verificationToken: payload.verificationToken,
  },
};
```

### 2. 템플릿 정의

**DB에 저장된 템플릿:**

```json
{
  "templateKey": "user-verification",
  "contents": {
    "EMAIL": {
      "ko": {
        "subject": "이메일 인증",
        "body": "안녕하세요 {{name}}님, 인증 코드는 {{verificationToken}}입니다."
      }
    },
    "KAKAO": {
      "ko": {
        "body": "안녕하세요 #{name}님, 인증 코드는 #{verificationToken}입니다."
      }
    }
  },
  "variablesSchema": {
    "name": { "type": "string", "required": true },
    "email": { "type": "string", "required": true },
    "verificationToken": { "type": "string", "required": true }
  },
  "kakaoTemplateCode": "TEMPLATE_001"
}
```

### 3. 자동 변수 추출

`variables`를 명시하지 않아도 `variablesSchema`와 `payload`를 기반으로 자동 추출됩니다:

```typescript
const sendDto: SendNotificationDto = {
  userId: payload.userId,
  channels: ['EMAIL'],
  templateKey: 'user-verification',
  payload: {
    name: '홍길동',
    email: 'hong@example.com',
    verificationToken: '123456',
    // 다른 필드들도 자동으로 무시됨
  },
  // variables 생략 가능 - 자동 추출됨
};
```

## NHN 카카오톡 템플릿 연동

### 템플릿 등록

1. NHN 콘솔에서 템플릿 등록 (템플릿 코드: `TEMPLATE_001`)
2. 우리 DB에 템플릿 저장:
   ```json
   {
     "kakaoTemplateCode": "TEMPLATE_001",
     "kakaoTemplateStatus": "APPROVED"
   }
   ```

### 발송 시

- `kakaoTemplateCode`가 있으면 NHN 템플릿 치환 발송 API 사용
- `templateParameter`로 변수 전달:
  ```typescript
  {
    templateCode: "TEMPLATE_001",
    templateParameter: {
      name: "홍길동",
      verificationToken: "123456"
    }
  }
  ```

## Resend 이메일 템플릿 연동

### 템플릿 등록

1. Resend 대시보드에서 템플릿 생성 (템플릿 ID: `tmpl_xxxxx`)
2. 우리 DB에 템플릿 저장:
   ```json
   {
     "providerTemplateId": "tmpl_xxxxx"
   }
   ```

### 발송 시

- `providerTemplateId`가 있으면 Resend 템플릿 사용
- `template.variables`로 변수 전달:
  ```typescript
  {
    template: {
      id: "tmpl_xxxxx",
      variables: {
        USER_NAME: "홍길동",
        VERIFICATION_CODE: "123456"
      }
    }
  }
  ```

## 변수 네이밍 규칙

### NHN 카카오톡

- 템플릿에 `#{key}` 형식으로 변수 정의
- `templateParameter`에 `{key: value}` 형식으로 전달
- 모든 값은 문자열로 변환됨

### Resend

- 템플릿에 변수 이름 정의 (예: `{{USER_NAME}}`)
- `template.variables`에 전달
- 문자열 또는 숫자만 허용 (최대 50자)
- 예약어: `FIRST_NAME`, `LAST_NAME`, `EMAIL`, `UNSUBSCRIBE_URL` 사용 불가

### SMS (Twilio)

- 템플릿에 `{{variable}}` 형식으로 변수 정의
- 일반 텍스트 치환으로 처리
- Twilio Verify 템플릿은 별도 서비스이므로 여기서는 일반 SMS만 처리

### PUSH (FCM)

- 템플릿에 `{{variable}}` 형식으로 변수 정의
- `notification.title`, `notification.body`에 일반 텍스트 치환 적용
- `data` payload에는 `fcmDataVariables`로 변수 정보 포함 (모두 문자열로 변환)

## 주의사항

1. **NHN 템플릿**: 템플릿 코드가 없으면 전문 발송(raw-messages) 사용
2. **Resend 템플릿**: 템플릿 사용 시 `html`/`text` 필드를 보내지 않음
3. **변수 타입**: Resend는 문자열/숫자만 허용, 객체/배열은 JSON 문자열로 변환 (50자 제한)
4. **자동 추출**: `variablesSchema`가 없으면 `payload` 전체를 변수로 사용


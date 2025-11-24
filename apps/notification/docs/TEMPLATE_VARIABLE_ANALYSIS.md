# 템플릿 변수 시스템 구조

## 개요

알림 발송 시 템플릿에 동적 변수(사용자 이름, 인증키, 주문번호 등)를 치환하는 시스템입니다.

**핵심 원칙:**
- 템플릿 시스템이 있는 채널(KAKAO, EMAIL)은 Provider에서 처리
- 템플릿 시스템이 없는 채널(SMS, PUSH)은 Dispatcher에서 텍스트 치환
- 불필요한 중복 처리를 방지하여 성능 최적화

## 전체 플로우

```
이벤트 수신 (payload + variables)
    ↓
NotificationDispatcherService.send()
    ↓
1. 템플릿 조회 (templateKey 기준)
2. 변수 추출 및 변환
   - 명시적 variables 우선
   - 없으면 variablesSchema 기반 자동 추출
   - 채널별 변수 형식 변환
    ↓
3. renderContent() - 템플릿 선택 및 조건부 치환
   - 템플릿 시스템 사용 여부 확인
   - 사용 안 함 → {{variable}} 치환
   - 사용 함 → 치환 안 함 (Provider에서 처리)
    ↓
4. notifications 테이블에 저장 + 큐 추가
    ↓
NotificationProcessor
    ↓
5. Provider별 변수 전달
   - KAKAO: templateCode + templateParameters
   - EMAIL: templateId + templateVariables
   - SMS/PUSH: 이미 치환된 content
    ↓
6. 실제 API 호출
```

## 채널별 처리 방식

### 1. KAKAO (NHN 카카오톡)

**템플릿 코드가 있는 경우:**
- `renderContent()`: 치환 안 함 (템플릿 시스템 사용)
- Provider: `templateCode` + `templateParameter` 전달
- NHN API: `#{key}` 형식의 템플릿에 변수 치환

```typescript
// 템플릿 정의 (NHN 콘솔)
템플릿 코드: "TEMPLATE_001"
템플릿 내용: "안녕하세요 #{name}님, 인증 코드는 #{code}입니다."

// 우리 DB
{
  kakaoTemplateCode: "TEMPLATE_001",
  contents: {
    KAKAO: {
      ko: {
        body: "안녕하세요 #{name}님, 인증 코드는 #{code}입니다."
      }
    }
  }
}

// 발송 시
{
  templateCode: "TEMPLATE_001",
  templateParameter: {
    name: "홍길동",
    code: "123456"
  }
}
```

**템플릿 코드가 없는 경우:**
- `renderContent()`: `{{variable}}` 치환 수행
- Provider: 치환된 `content`를 전문 발송(raw-messages)으로 전송

```typescript
// 템플릿 정의
{
  contents: {
    KAKAO: {
      ko: {
        body: "안녕하세요 {{name}}님, 인증 코드는 {{code}}입니다."
      }
    }
  }
}

// renderContent()에서 치환
body: "안녕하세요 홍길동님, 인증 코드는 123456입니다."

// Provider에서 전문 발송
{
  content: "안녕하세요 홍길동님, 인증 코드는 123456입니다."
}
```

### 2. EMAIL (Resend)

**템플릿 ID가 있는 경우:**
- `renderContent()`: 치환 안 함 (템플릿 시스템 사용)
- Provider: `templateId` + `templateVariables` 전달
- Resend API: 템플릿의 `{{VAR}}` 형식에 변수 치환

```typescript
// 템플릿 정의 (Resend 대시보드)
템플릿 ID: "tmpl_xxxxx"
템플릿 내용: "안녕하세요 {{USER_NAME}}님, 인증 코드는 {{VERIFICATION_CODE}}입니다."

// 우리 DB
{
  providerTemplateId: "tmpl_xxxxx",
  contents: {
    EMAIL: {
      ko: {
        subject: "이메일 인증",
        body: "안녕하세요 {{USER_NAME}}님, 인증 코드는 {{VERIFICATION_CODE}}입니다."
      }
    }
  }
}

// 발송 시
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

**템플릿 ID가 없는 경우:**
- `renderContent()`: `{{variable}}` 치환 수행
- Provider: 치환된 `html`/`text`를 직접 전송

```typescript
// 템플릿 정의
{
  contents: {
    EMAIL: {
      ko: {
        subject: "이메일 인증",
        body: "안녕하세요 {{name}}님, 인증 코드는 {{code}}입니다."
      }
    }
  }
}

// renderContent()에서 치환
subject: "이메일 인증"
html: "안녕하세요 홍길동님, 인증 코드는 123456입니다."

// Provider에서 직접 전송
{
  subject: "이메일 인증",
  html: "안녕하세요 홍길동님, 인증 코드는 123456입니다."
}
```

### 3. SMS (Twilio)

**항상 텍스트 치환:**
- `renderContent()`: `{{variable}}` 치환 수행
- Provider: 치환된 `body`를 직접 전송

```typescript
// 템플릿 정의
{
  contents: {
    SMS: {
      ko: {
        body: "안녕하세요 {{name}}님, 인증 코드는 {{code}}입니다."
      }
    }
  }
}

// renderContent()에서 치환
body: "안녕하세요 홍길동님, 인증 코드는 123456입니다."

// Provider에서 직접 전송
{
  body: "안녕하세요 홍길동님, 인증 코드는 123456입니다."
}
```

### 4. PUSH (FCM)

**항상 텍스트 치환:**
- `renderContent()`: `{{variable}}` 치환 수행
- Provider: 
  - `notification.title`, `notification.body`: 치환된 값 사용
  - `data` payload: 변수 정보를 문자열로 포함

```typescript
// 템플릿 정의
{
  contents: {
    PUSH: {
      ko: {
        subject: "알림",
        body: "안녕하세요 {{name}}님, 인증 코드는 {{code}}입니다."
      }
    }
  }
}

// renderContent()에서 치환
subject: "알림"
body: "안녕하세요 홍길동님, 인증 코드는 123456입니다."

// Provider에서 전송
{
  notification: {
    title: "알림",
    body: "안녕하세요 홍길동님, 인증 코드는 123456입니다."
  },
  data: {
    name: "홍길동",
    code: "123456",
    notificationId: "...",
    category: "..."
  }
}
```

## 변수 추출 및 변환

### 1. 변수 추출 우선순위

```typescript
// 1순위: 명시적으로 전달된 variables
variables: {
  name: "홍길동",
  code: "123456"
}

// 2순위: variablesSchema 기반 자동 추출
if (!dto.variables && template?.variablesSchema && payload) {
  finalVariables = extractVariablesFromPayload(payload, template.variablesSchema);
}

// 3순위: payload 전체 사용 (경고 로그)
if (!finalVariables && payload) {
  finalVariables = payload; // 경고 로그 출력
}
```

### 2. 채널별 변수 변환

`TemplateVariableMapperService.mapVariablesForChannel()`에서 처리:

| 채널 | 변환 결과 |
|------|----------|
| **KAKAO** | `kakaoTemplateParameters: { key: "value" }` (모두 문자열) |
| **EMAIL** | `resendTemplateVariables: { VAR: "value" }` (문자열/숫자, 50자 제한) |
| **SMS** | `interpolationVariables: { key: value }` (원본 유지) |
| **PUSH** | `interpolationVariables` + `fcmDataVariables` (문자열 변환) |

## 핵심 로직

### renderContent() - 조건부 치환

```typescript
// 템플릿 시스템 사용 여부 확인
const usesProviderTemplate = 
  (channel === 'KAKAO' && template?.kakaoTemplateCode) ||
  (channel === 'EMAIL' && template?.providerTemplateId);

if (!usesProviderTemplate) {
  // 템플릿 시스템을 사용하지 않는 경우만 텍스트 치환
  if (variables && body) {
    body = this.interpolate(body, variables);
  }
  if (variables && subject) {
    subject = this.interpolate(subject, variables);
  }
}
// 템플릿 시스템을 사용하는 경우는 Provider에서 처리
```

**효과:**
- 템플릿 시스템 사용 시 불필요한 치환 작업 제거
- 성능 최적화
- 각 채널의 특성에 맞는 처리

### 변수 추출 로직

```typescript
// 명시적 variables 우선
let finalVariables = dto.variables;

if (!finalVariables && template?.variablesSchema && payload) {
  // 자동 추출 (디버그 로그)
  this.logger.debug('Auto-extracting variables from payload');
  finalVariables = this.variableMapper.extractVariablesFromPayload(
    payload,
    template.variablesSchema
  );
} else if (!finalVariables && payload && template) {
  // 스키마 없음 (경고 로그)
  this.logger.warn('No variables provided and no schema found');
  finalVariables = payload;
}
```

## 사용 예시

### 이벤트 컨슈머에서 변수 전달

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

### 자동 변수 추출 (variables 생략)

```typescript
// variablesSchema가 정의된 경우
const sendDto: SendNotificationDto = {
  userId: payload.userId,
  channels: ['EMAIL'],
  templateKey: 'user-verification',
  payload: {
    name: '홍길동',
    email: 'hong@example.com',
    verificationToken: '123456',
    // 다른 필드들도 있지만 스키마에 없는 것은 무시됨
  },
  // variables 생략 → 자동 추출
};
```

## 장점

1. **성능 최적화**: 템플릿 시스템 사용 시 불필요한 치환 방지
2. **명확한 책임 분리**: 
   - Dispatcher: 변수 추출 및 변환
   - Provider: 채널별 API 호출
3. **확장성**: 새로운 Provider 추가 시 기존 로직 재사용
4. **유연성**: 템플릿 시스템 유무에 관계없이 동작

## 주의사항

1. **NHN 템플릿**: 템플릿 코드가 없으면 전문 발송(raw-messages) 사용
2. **Resend 템플릿**: 템플릿 사용 시 `html`/`text` 필드를 보내지 않음
3. **변수 타입**: Resend는 문자열/숫자만 허용 (50자 제한)
4. **자동 추출**: `variablesSchema`가 없으면 `payload` 전체를 변수로 사용 (경고 로그)

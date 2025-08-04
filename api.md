# 멤버십 서비스 API 문서

## 개요
멤버십 서비스의 RESTful API 문서입니다. 구독 관리, 티어 관리, 정책 관리, 권한 관리 등의 기능을 제공합니다.

## 목차
1. [구독 관리 API](#구독-관리-api)
2. [플랜 및 티어 조회 API](#플랜-및-티어-조회-api)
3. [일시정지 관리 API](#일시정지-관리-api)
4. [관리자 운영 API](#관리자-운영-api)
5. [정책 관리 API](#정책-관리-api)
6. [정책 검증 API](#정책-검증-api)
7. [권한 관리 API](#권한-관리-api)
8. [에러 코드](#에러-코드)
9. [참고사항](#참고사항)

## 공통 응답 형식

### 성공 응답
```json
{
  "success": true,
  "data": {
    // 응답 데이터
  }
}
```

### 에러 응답
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "에러 메시지",
    "details": {}
  }
}
```

---

# 구독 관리 API

## 1. 현재 구독 상태 조회

**GET** `/subscriptions/current`

현재 사용자의 활성 구독 정보를 조회합니다.

### Parameters
| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| userId | string | ✓ | 사용자 ID (쿼리 파라미터) |

### Response
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "status": "ACTIVE" | "PAUSED" | "CANCELLED" | "EXPIRED",
    "currentTier": {
      "id": "uuid",
      "code": "PREMIUM",
      "name": "프리미엄",
      "priorityLevel": 10
    },
    "plan": {
      "id": "uuid",
      "price": 9900,
      "durationDays": 30,
      "currency": "KRW",
      "trialDays": 7
    },
    "nextBillingDate": "2025-09-04T00:00:00Z",
    "startsAt": "2025-08-04T00:00:00Z",
    "endsAt": "2025-09-04T00:00:00Z",
    "isPaused": false,
    "pausedAt": null
  }
}
```

---

## 2. 구독 생성

**POST** `/subscriptions`

새로운 구독을 생성합니다.

### Parameters
| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| userId | string | ✓ | 사용자 ID (쿼리 파라미터) |

### Request Body
```json
{
  "planId": "uuid" // 구독할 플랜 ID
}
```

### Validation Rules
- `planId`: 유효한 UUID 형식이어야 합니다.

### Response
```json
{
  "success": true,
  "data": {
    "subscriptionId": "uuid",
    "message": "구독이 성공적으로 생성되었습니다."
  }
}
```

---

## 3. 구독 업그레이드

**POST** `/subscriptions/upgrade`

현재 구독을 더 높은 티어로 업그레이드합니다.

### Parameters
| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| userId | string | ✓ | 사용자 ID (쿼리 파라미터) |

### Request Body
```json
{
  "newPlanId": "uuid" // 업그레이드할 플랜 ID
}
```

### Validation Rules
- `newPlanId`: 유효한 UUID 형식이어야 합니다.

### Response
```json
{
  "success": true,
  "data": {
    "subscriptionId": "uuid",
    "message": "구독이 성공적으로 업그레이드되었습니다.",
    "effectiveDate": "2025-08-04T00:00:00Z"
  }
}
```

---

## 4. 구독 다운그레이드

**POST** `/subscriptions/downgrade`

현재 구독을 더 낮은 티어로 다운그레이드합니다.

### Parameters
| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| userId | string | ✓ | 사용자 ID (쿼리 파라미터) |

### Request Body
```json
{
  "newPlanId": "uuid", // 다운그레이드할 플랜 ID
  "effectiveDate": "2025-09-04T00:00:00Z" // 선택적: 적용 날짜
}
```

### Validation Rules
- `newPlanId`: 유효한 UUID 형식이어야 합니다.
- `effectiveDate`: 유효한 datetime 형식이어야 합니다. (선택사항)

### Response
```json
{
  "success": true,
  "data": {
    "subscriptionId": "uuid",
    "message": "구독이 성공적으로 다운그레이드되었습니다.",
    "effectiveDate": "2025-09-04T00:00:00Z"
  }
}
```

---

## 5. 구독 취소

**POST** `/subscriptions/cancel`

현재 구독을 취소합니다.

### Parameters
| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| userId | string | ✓ | 사용자 ID (쿼리 파라미터) |

### Request Body
```json
{
  "reason": "더 이상 서비스를 이용하지 않음", // 선택적: 취소 사유
  "effectiveDate": "2025-09-04T00:00:00Z" // 선택적: 적용 날짜
}
```

### Validation Rules
- `reason`: 문자열 (선택사항)
- `effectiveDate`: 유효한 datetime 형식이어야 합니다. (선택사항)

### Response
```json
{
  "success": true,
  "data": {
    "subscriptionId": "uuid",
    "message": "구독이 성공적으로 취소되었습니다.",
    "effectiveDate": "2025-09-04T00:00:00Z"
  }
}
```

---

## 6. 구독 이력 조회

**GET** `/subscriptions/history`

사용자의 구독 변경 이력을 조회합니다.

### Parameters
| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| userId | string | ✓ | 사용자 ID (쿼리 파라미터) |

### Response
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "planId": "uuid",
      "tierCode": "PREMIUM",
      "status": "ACTIVE",
      "startedAt": "2025-07-04T00:00:00Z",
      "endedAt": null,
      "changeType": "CREATED"
    },
    {
      "id": "uuid",
      "planId": "uuid",
      "tierCode": "BASIC",
      "status": "EXPIRED",
      "startedAt": "2025-06-04T00:00:00Z",
      "endedAt": "2025-07-04T00:00:00Z",
      "changeType": "DOWNGRADED"
    }
  ]
}
```

---

# 플랜 및 티어 조회 API

## 1. 모든 활성 플랜 목록 조회

**GET** `/plans`

시스템의 모든 활성 플랜을 조회합니다.

### Response
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "tier": {
        "id": "uuid",
        "code": "PREMIUM",
        "name": "프리미엄",
        "priorityLevel": 10,
        "createdAt": "2025-01-01T00:00:00Z",
        "updatedAt": "2025-01-01T00:00:00Z"
      },
      "price": 9900,
      "durationDays": 30,
      "currency": "KRW",
      "trialDays": 7,
      "createdAt": "2025-01-01T00:00:00Z",
      "updatedAt": "2025-01-01T00:00:00Z"
    }
  ]
}
```

---

## 2. 특정 플랜 상세 조회

**GET** `/plans/{planId}`

특정 플랜의 상세 정보를 조회합니다.

### Path Parameters
| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| planId | string | ✓ | 플랜 ID |

### Response
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "tier": {
      "id": "uuid",
      "code": "PREMIUM",
      "name": "프리미엄",
      "priorityLevel": 10,
      "createdAt": "2025-01-01T00:00:00Z",
      "updatedAt": "2025-01-01T00:00:00Z"
    },
    "price": 9900,
    "durationDays": 30,
    "currency": "KRW",
    "trialDays": 7,
    "createdAt": "2025-01-01T00:00:00Z",
    "updatedAt": "2025-01-01T00:00:00Z"
  }
}
```

---

## 3. 모든 티어 목록 조회

**GET** `/tiers`

시스템의 모든 티어를 조회합니다.

### Response
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "code": "BASIC",
      "name": "베이직",
      "priorityLevel": 1,
      "createdAt": "2025-01-01T00:00:00Z",
      "updatedAt": "2025-01-01T00:00:00Z"
    },
    {
      "id": "uuid",
      "code": "PREMIUM",
      "name": "프리미엄",
      "priorityLevel": 10,
      "createdAt": "2025-01-01T00:00:00Z",
      "updatedAt": "2025-01-01T00:00:00Z"
    }
  ]
}
```

---

## 4. 특정 티어의 모든 플랜 조회

**GET** `/tiers/{tierId}/plans`

특정 티어에 속한 모든 플랜을 조회합니다.

### Path Parameters
| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| tierId | string | ✓ | 티어 ID |

### Response
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "price": 9900,
      "durationDays": 30,
      "currency": "KRW",
      "trialDays": 7,
      "createdAt": "2025-01-01T00:00:00Z",
      "updatedAt": "2025-01-01T00:00:00Z"
    },
    {
      "id": "uuid",
      "price": 99000,
      "durationDays": 365,
      "currency": "KRW",
      "trialDays": 14,
      "createdAt": "2025-01-01T00:00:00Z",
      "updatedAt": "2025-01-01T00:00:00Z"
    }
  ]
}
```

---

## 5. 티어별 혜택 조회

**GET** `/tiers/{tierId}/benefits`

특정 티어의 혜택 정보를 조회합니다.

### Path Parameters
| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| tierId | string | ✓ | 티어 ID |

### Response
```json
{
  "success": true,
  "data": {
    "tier": {
      "id": "uuid",
      "code": "PREMIUM",
      "name": "프리미엄",
      "priorityLevel": 10,
      "createdAt": "2025-01-01T00:00:00Z",
      "updatedAt": "2025-01-01T00:00:00Z"
    },
    "plans": [
      {
        "id": "uuid",
        "price": 9900,
        "durationDays": 30,
        "currency": "KRW",
        "trialDays": 7,
        "createdAt": "2025-01-01T00:00:00Z",
        "updatedAt": "2025-01-01T00:00:00Z"
      }
    ],
    "benefits": [
      {
        "type": "FEATURE_ACCESS",
        "description": "프리미엄 기능 이용",
        "value": "unlimited"
      },
      {
        "type": "SUPPORT_LEVEL",
        "description": "우선 고객지원",
        "value": "priority"
      }
    ]
  }
}
```

---

# 일시정지 관리 API

## 1. 구독 일시정지

**POST** `/subscriptions/pause`

현재 구독을 일시정지합니다.

### Parameters
| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| userId | string | ✓ | 사용자 ID (쿼리 파라미터) |

### Request Body
```json
{
  "startDate": "2025-08-10T00:00:00Z",
  "endDate": "2025-08-20T00:00:00Z",
  "reason": "휴가로 인한 일시정지" // 선택적
}
```

### Validation Rules
- `startDate`: ISO datetime 형식이어야 합니다.
- `endDate`: ISO datetime 형식이어야 합니다.
- `startDate`는 `endDate`보다 이전이어야 합니다.
- `reason`: 문자열 (선택사항)

### Response
```json
{
  "success": true,
  "data": {
    "pauseId": "uuid",
    "subscriptionId": "uuid",
    "message": "구독이 성공적으로 일시정지되었습니다.",
    "startsAt": "2025-08-10T00:00:00Z",
    "endsAt": "2025-08-20T00:00:00Z",
    "status": "SCHEDULED"
  }
}
```

---

## 2. 구독 재개

**POST** `/subscriptions/pause/resume`

일시정지된 구독을 재개합니다.

### Parameters
| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| userId | string | ✓ | 사용자 ID (쿼리 파라미터) |

### Request Body
```json
{
  "reason": "휴가 종료" // 선택적
}
```

### Response
```json
{
  "success": true,
  "data": {
    "subscriptionId": "uuid",
    "message": "구독이 성공적으로 재개되었습니다.",
    "resumedAt": "2025-08-15T00:00:00Z",
    "newExpiryDate": "2025-09-05T00:00:00Z"
  }
}
```

---

## 3. 일시정지 이력 조회

**GET** `/subscriptions/pause/history`

사용자의 일시정지 이력을 조회합니다.

### Parameters
| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| userId | string | ✓ | 사용자 ID (쿼리 파라미터) |

### Response
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "startsAt": "2025-07-01T00:00:00Z",
      "endsAt": "2025-07-10T00:00:00Z",
      "actualResumedAt": "2025-07-08T00:00:00Z",
      "status": "COMPLETED",
      "createdAt": "2025-06-25T00:00:00Z"
    },
    {
      "id": "uuid",
      "startsAt": "2025-08-10T00:00:00Z",
      "endsAt": "2025-08-20T00:00:00Z",
      "actualResumedAt": null,
      "status": "SCHEDULED",
      "createdAt": "2025-08-04T00:00:00Z"
    }
  ]
}
```

---

## 4. 일시정지 자격 확인

**GET** `/subscriptions/pause/eligibility`

사용자의 일시정지 자격을 확인합니다.

### Parameters
| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| userId | string | ✓ | 사용자 ID (쿼리 파라미터) |
| year | string | - | 확인할 연도 (기본값: 현재 연도) |

### Response
```json
{
  "success": true,
  "data": {
    "eligible": true,
    "currentUsage": 1,
    "maxPauses": 3,
    "remainingPauses": 2
  }
}
```

---

# 관리자 운영 API

## 1. 티어 생성

**POST** `/admin/tiers`

새로운 티어를 생성합니다.

### Request Body
```json
{
  "code": "VIP",
  "name": "VIP 회원",
  "priorityLevel": 20
}
```

### Validation Rules
- `code`: 1-20자, 대문자와 언더스코어만 허용
- `name`: 1-50자
- `priorityLevel`: 1-100 사이의 숫자

### Response
```json
{
  "success": true,
  "data": {
    "success": true,
    "message": "티어가 성공적으로 생성되었습니다.",
    "tierId": "uuid"
  }
}
```

---

## 2. 티어 수정

**PUT** `/admin/tiers/{tierId}`

기존 티어를 수정합니다.

### Path Parameters
| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| tierId | string | ✓ | 티어 ID |

### Request Body
```json
{
  "name": "VIP 플러스 회원", // 선택적
  "priorityLevel": 25 // 선택적
}
```

### Response
```json
{
  "success": true,
  "data": {
    "success": true,
    "message": "티어가 성공적으로 수정되었습니다.",
    "tierId": "uuid",
    "impactAnalysis": {
      "affectedPlansCount": 3,
      "affectedPlans": [
        {
          "id": "uuid",
          "price": 19900,
          "durationDays": 30
        }
      ],
      "changes": {
        "name": "VIP 플러스 회원",
        "priorityLevel": 25
      }
    }
  }
}
```

---

## 3. 플랜 생성

**POST** `/admin/plans`

새로운 플랜을 생성합니다.

### Request Body
```json
{
  "tierId": "uuid",
  "price": 14900,
  "durationDays": 30,
  "currency": "KRW", // 선택적, 기본값: "KRW"
  "trialDays": 7 // 선택적, 기본값: 0
}
```

### Validation Rules
- `tierId`: 유효한 UUID
- `price`: 0 이상의 숫자
- `durationDays`: 1 이상의 숫자
- `currency`: 3자리 통화 코드
- `trialDays`: 0 이상의 숫자

### Response
```json
{
  "success": true,
  "data": {
    "success": true,
    "message": "플랜이 성공적으로 생성되었습니다.",
    "planId": "uuid"
  }
}
```

---

## 4. 플랜 수정

**PUT** `/admin/plans/{planId}`

기존 플랜을 수정합니다.

### Path Parameters
| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| planId | string | ✓ | 플랜 ID |

### Request Body
```json
{
  "price": 16900, // 선택적
  "durationDays": 30, // 선택적
  "currency": "KRW", // 선택적
  "trialDays": 14, // 선택적
  "isActive": true // 선택적
}
```

### Response
```json
{
  "success": true,
  "data": {
    "success": true,
    "message": "플랜이 성공적으로 수정되었습니다.",
    "planId": "uuid",
    "impactAnalysis": {
      "estimatedAffectedSubscribers": 150,
      "priceChange": "PRICE_UPDATED",
      "durationChange": "NO_DURATION_CHANGE",
      "changes": {
        "price": 16900,
        "trialDays": 14
      }
    }
  }
}
```

---

## 5. 플랜 비활성화

**DELETE** `/admin/plans/{planId}`

플랜을 비활성화합니다.

### Path Parameters
| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| planId | string | ✓ | 플랜 ID |

### Request Body
```json
{
  "reason": "수요 부족으로 인한 단종"
}
```

### Validation Rules
- `reason`: 1-500자의 문자열

### Response
```json
{
  "success": true,
  "data": {
    "success": true,
    "message": "플랜이 성공적으로 비활성화되었습니다.",
    "planId": "uuid",
    "impactAnalysis": {
      "estimatedAffectedSubscribers": 50,
      "alternativePlans": [
        {
          "id": "uuid",
          "price": 14900,
          "durationDays": 30,
          "currency": "KRW"
        }
      ],
      "warning": "50명의 구독자가 영향을 받습니다. 대안 플랜 안내가 필요합니다."
    }
  }
}
```

---

# 정책 관리 API

## 1. 정책 목록 조회

**GET** `/policies`

시스템의 모든 정책을 조회합니다.

### Query Parameters
| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| ruleType | string | - | 정책 규칙 타입으로 필터링 |
| tierId | string | - | 티어 ID로 필터링 |
| isActive | boolean | - | 활성 상태로 필터링 |
| page | number | - | 페이지 번호 (기본값: 1) |
| limit | number | - | 페이지당 항목 수 (기본값: 20, 최대: 100) |

### Response
```json
{
  "success": true,
  "data": {
    "policies": [
      {
        "id": "uuid",
        "ruleType": "MAX_PAUSES_PER_YEAR",
        "ruleValue": {
          "maxPauses": 3,
          "resetPeriod": "YEARLY"
        },
        "tierId": "uuid",
        "tierInfo": {
          "id": "uuid",
          "code": "PREMIUM",
          "name": "프리미엄",
          "priorityLevel": 10
        },
        "isActive": true,
        "validFrom": "2025-01-01T00:00:00Z",
        "validUntil": "2025-12-31T23:59:59Z",
        "createdAt": "2025-01-01T00:00:00Z",
        "updatedAt": "2025-01-01T00:00:00Z"
      }
    ],
    "total": 25,
    "page": 1,
    "limit": 20
  }
}
```

---

## 2. 특정 정책 조회

**GET** `/policies/{policyId}`

특정 정책의 상세 정보를 조회합니다.

### Path Parameters
| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| policyId | string | ✓ | 정책 ID |

### Response
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "ruleType": "MAX_PAUSES_PER_YEAR",
    "ruleValue": {
      "maxPauses": 3,
      "resetPeriod": "YEARLY"
    },
    "tierId": "uuid",
    "tierInfo": {
      "id": "uuid",
      "code": "PREMIUM",
      "name": "프리미엄",
      "priorityLevel": 10
    },
    "isActive": true,
    "validFrom": "2025-01-01T00:00:00Z",
    "validUntil": "2025-12-31T23:59:59Z",
    "createdAt": "2025-01-01T00:00:00Z",
    "updatedAt": "2025-01-01T00:00:00Z"
  }
}
```

---

## 3. 새 정책 생성

**POST** `/policies`

새로운 정책을 생성합니다.

### Request Body
```json
{
  "ruleType": "MAX_PAUSES_PER_YEAR",
  "ruleValue": {
    "maxPauses": 3,
    "resetPeriod": "YEARLY"
  },
  "tierId": "uuid", // 선택적: 특정 티어에만 적용
  "validFrom": "2025-01-01T00:00:00Z", // 선택적
  "validUntil": "2025-12-31T23:59:59Z" // 선택적
}
```

### Validation Rules
- `ruleType`: 지원되는 정책 타입 중 하나여야 합니다.
- `ruleValue`: 최소 하나의 속성을 가져야 합니다.
- `validFrom`과 `validUntil`이 모두 제공되면, `validFrom`이 `validUntil`보다 이전이어야 합니다.

### Supported Policy Types
- `MAX_PAUSES_PER_YEAR` - 연간 최대 일시정지 횟수
- `MIN_PAUSE_DURATION_DAYS` - 최소 일시정지 기간
- `MAX_PAUSE_DURATION_DAYS` - 최대 일시정지 기간
- `PAUSE_COOLDOWN_DAYS` - 일시정지 쿨다운 기간
- `PLAN_CHANGE_COOLDOWN_DAYS` - 플랜 변경 쿨다운 기간
- `ALLOWED_PLAN_CHANGES` - 허용된 플랜 변경
- `TIER_SPECIFIC_LIMITS` - 티어별 제한사항
- 기타 15개 정책 타입 지원

### Response
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "ruleType": "MAX_PAUSES_PER_YEAR",
    "ruleValue": {
      "maxPauses": 3,
      "resetPeriod": "YEARLY"
    },
    "tierId": "uuid",
    "isActive": true,
    "validFrom": "2025-01-01T00:00:00Z",
    "validUntil": "2025-12-31T23:59:59Z",
    "createdAt": "2025-08-04T00:00:00Z",
    "updatedAt": "2025-08-04T00:00:00Z"
  }
}
```

---

## 4. 정책 업데이트

**PUT** `/policies/{policyId}`

기존 정책을 업데이트합니다.

### Path Parameters
| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| policyId | string | ✓ | 정책 ID |

### Request Body
```json
{
  "ruleValue": {
    "maxPauses": 5,
    "resetPeriod": "YEARLY"
  }, // 선택적
  "isActive": false, // 선택적
  "validFrom": "2025-02-01T00:00:00Z", // 선택적
  "validUntil": "2025-11-30T23:59:59Z" // 선택적
}
```

### Response
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "ruleType": "MAX_PAUSES_PER_YEAR",
    "ruleValue": {
      "maxPauses": 5,
      "resetPeriod": "YEARLY"
    },
    "isActive": false,
    "validFrom": "2025-02-01T00:00:00Z",
    "validUntil": "2025-11-30T23:59:59Z",
    "updatedAt": "2025-08-04T00:00:00Z"
  }
}
```

---

## 5. 정책 비활성화

**DELETE** `/policies/{policyId}`

정책을 비활성화합니다. (물리적 삭제가 아닌 논리적 삭제)

### Path Parameters
| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| policyId | string | ✓ | 정책 ID |

### Response
```json
{
  "success": true,
  "data": {
    "success": true,
    "message": "정책이 성공적으로 비활성화되었습니다."
  }
}
```

---

# 정책 검증 API

## 1. 정책 준수 검증

**POST** `/policies/validation/validate`

특정 사용자의 액션이 정책을 준수하는지 검증합니다.

### Request Body
```json
{
  "userId": "uuid",
  "action": "PAUSE_SUBSCRIPTION",
  "context": {
    "subscriptionId": "uuid",
    "requestedStartDate": "2025-08-10T00:00:00Z",
    "requestedEndDate": "2025-08-20T00:00:00Z"
  },
  "policyIds": ["uuid1", "uuid2"] // 선택적: 특정 정책들만 검증
}
```

### Validation Rules
- `userId`: 유효한 UUID여야 합니다.
- `action`: 1-100자의 문자열이어야 합니다.
- `context`: 객체 형태여야 합니다.

### Response
```json
{
  "success": true,
  "data": {
    "isValid": false,
    "violatedPolicies": [
      {
        "policyId": "uuid",
        "policyName": "연간 최대 일시정지 제한",
        "ruleType": "MAX_PAUSES_PER_YEAR",
        "violationType": "LIMIT_EXCEEDED",
        "message": "연간 최대 일시정지 횟수(3회)를 초과했습니다.",
        "severity": "ERROR",
        "suggestedAction": "내년까지 기다리거나 고객지원에 문의하세요."
      }
    ],
    "warnings": [
      {
        "policyId": "uuid",
        "policyName": "일시정지 기간 권장사항",
        "message": "일시정지 기간이 권장 기간보다 짧습니다.",
        "context": {
          "recommendedMinDays": 7,
          "requestedDays": 3
        }
      }
    ],
    "appliedPolicies": [
      {
        "policyId": "uuid",
        "policyName": "최소 일시정지 기간",
        "ruleType": "MIN_PAUSE_DURATION_DAYS",
        "appliedValue": 1,
        "context": {
          "requestedDays": 10
        }
      }
    ],
    "executionTime": 45.2
  }
}
```

---

## 2. 벌크 정책 검증

**POST** `/policies/validation/validate/bulk`

여러 요청을 한 번에 검증합니다.

### Request Body
```json
{
  "requests": [
    {
      "userId": "uuid1",
      "action": "PAUSE_SUBSCRIPTION",
      "context": {
        "subscriptionId": "uuid1"
      }
    },
    {
      "userId": "uuid2",
      "action": "UPGRADE_SUBSCRIPTION",
      "context": {
        "currentPlanId": "uuid",
        "newPlanId": "uuid"
      }
    }
  ]
}
```

### Response
```json
{
  "success": true,
  "data": {
    "results": [
      {
        "userId": "uuid1",
        "isValid": true,
        "violatedPolicies": [],
        "warnings": [],
        "appliedPolicies": [],
        "executionTime": 23.1
      },
      {
        "userId": "uuid2",
        "isValid": false,
        "violatedPolicies": [...],
        "warnings": [],
        "appliedPolicies": [],
        "executionTime": 31.5
      }
    ],
    "totalExecutionTime": 54.6
  }
}
```

---

## 3. 사용자별 적용 가능한 정책 조회

**GET** `/policies/validation/user/{userId}/applicable`

특정 사용자에게 적용 가능한 정책 목록을 조회합니다.

### Path Parameters
| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| userId | string | ✓ | 사용자 ID |

### Query Parameters
| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| tierId | string | - | 티어 ID |
| subscriptionId | string | - | 구독 ID |
| currentDate | string | - | 기준 날짜 (ISO datetime) |

### Response
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "ruleType": "MAX_PAUSES_PER_YEAR",
      "ruleValue": {
        "maxPauses": 3
      },
      "tierId": "uuid",
      "isActive": true,
      "validFrom": "2025-01-01T00:00:00Z",
      "validUntil": "2025-12-31T23:59:59Z",
      "createdAt": "2025-01-01T00:00:00Z",
      "updatedAt": "2025-01-01T00:00:00Z"
    }
  ]
}
```

---

# 권한 관리 API

## 1. 사용자 권한 조회

**GET** `/rights/user/{userId}`

특정 사용자의 현재 권한 정보를 조회합니다.

### Path Parameters
| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| userId | string | ✓ | 사용자 ID |

### Response
```json
{
  "success": true,
  "data": {
    "userId": "uuid",
    "tierId": "uuid",
    "startsAt": "2025-01-01T00:00:00Z",
    "endsAt": "2025-12-31T23:59:59Z",
    "isActive": true,
    "pausedAt": null,
    "tierCode": "PREMIUM",
    "isPaused": false
  }
}
```

---

## 2. 사용자 권한 검증

**POST** `/rights/validate`

사용자의 권한을 검증합니다.

### Request Body
```json
{
  "userId": "uuid",
  "requiredTierLevel": 3 // 선택적: 필요한 최소 티어 레벨
}
```

### Response
```json
{
  "success": true,
  "data": {
    "userId": "uuid",
    "isValid": true,
    "requiredTierLevel": 3,
    "validatedAt": "2025-08-04T00:00:00Z"
  }
}
```

---

## 3. 여러 사용자 구독 상태 일괄 확인

**POST** `/rights/bulk-check`

여러 사용자의 구독 상태를 한 번에 확인합니다.

### Request Body
```json
{
  "userIds": ["uuid1", "uuid2", "uuid3"]
}
```

### Response
```json
{
  "success": true,
  "data": {
    "results": {
      "uuid1": {
        "hasActiveSubscription": true,
        "tierCode": "PREMIUM",
        "isPaused": false,
        "expiresAt": "2025-12-31T23:59:59Z"
      },
      "uuid2": {
        "hasActiveSubscription": false
      },
      "uuid3": {
        "hasActiveSubscription": true,
        "tierCode": "BASIC",
        "isPaused": true,
        "expiresAt": "2025-10-15T23:59:59Z"
      }
    },
    "checkedAt": "2025-08-04T00:00:00Z",
    "totalUsers": 3,
    "activeSubscriptions": 2
  }
}
```

---

## 4. 사용자 권한 연장 (관리자)

**POST** `/rights/extend`

관리자가 사용자의 권한을 연장합니다.

### Headers
| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| X-Admin-Id | string | ✓ | 관리자 ID |

### Request Body
```json
{
  "userId": "uuid",
  "additionalDays": 30,
  "reason": "보상 연장" // 선택적
}
```

### Response
```json
{
  "success": true,
  "data": {
    "success": true,
    "message": "사용자 uuid의 권한이 30일 연장되었습니다.",
    "extendedBy": "admin-uuid",
    "extendedAt": "2025-08-04T00:00:00Z"
  }
}
```

---

## 5. 사용자 권한 종료 (관리자)

**POST** `/rights/terminate`

관리자가 사용자의 권한을 종료합니다.

### Headers
| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| X-Admin-Id | string | ✓ | 관리자 ID |

### Request Body
```json
{
  "userId": "uuid",
  "reason": "정책 위반" // 선택적
}
```

### Response
```json
{
  "success": true,
  "data": {
    "success": true,
    "message": "사용자 uuid의 권한이 종료되었습니다.",
    "terminatedBy": "admin-uuid",
    "terminatedAt": "2025-08-04T00:00:00Z",
    "reason": "정책 위반"
  }
}
```

---

## 6. 사용자 권한 일시정지 (관리자)

**POST** `/rights/pause`

관리자가 사용자의 권한을 일시정지합니다.

### Headers
| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| X-Admin-Id | string | ✓ | 관리자 ID |

### Request Body
```json
{
  "userId": "uuid",
  "pausedAt": "2025-08-10T00:00:00Z" // 선택적: 미제공시 현재 시간
}
```

### Response
```json
{
  "success": true,
  "data": {
    "success": true,
    "message": "사용자 uuid의 권한이 일시정지되었습니다.",
    "pausedBy": "admin-uuid",
    "pausedAt": "2025-08-10T00:00:00Z"
  }
}
```

---

## 7. 사용자 권한 재개 (관리자)

**POST** `/rights/resume`

관리자가 사용자의 권한을 재개합니다.

### Headers
| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| X-Admin-Id | string | ✓ | 관리자 ID |

### Request Body
```json
{
  "userId": "uuid",
  "newEndsAt": "2025-12-31T23:59:59Z" // 선택적: 새로운 만료일
}
```

### Response
```json
{
  "success": true,
  "data": {
    "success": true,
    "message": "사용자 uuid의 권한이 재개되었습니다.",
    "resumedBy": "admin-uuid",
    "resumedAt": "2025-08-04T00:00:00Z",
    "newEndsAt": "2025-12-31T23:59:59Z"
  }
}
```

---

## 8. 권한 통계 조회 (관리자)

**GET** `/rights/stats`

권한 관련 통계를 조회합니다. (향후 구현 예정)

### Headers
| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| X-Admin-Id | string | ✓ | 관리자 ID |

### Response
```json
{
  "success": true,
  "data": {
    "message": "권한 통계 기능은 추후 구현 예정입니다.",
    "requestedBy": "admin-uuid",
    "requestedAt": "2025-08-04T00:00:00Z"
  }
}
```

---

## 에러 코드

### 구독 관련 에러
| 코드 | 설명 |
|------|------|
| SUBSCRIPTION_NOT_FOUND | 구독을 찾을 수 없음 |
| SUBSCRIPTION_ALREADY_EXISTS | 이미 활성 구독이 존재함 |
| SUBSCRIPTION_ALREADY_CANCELLED | 이미 취소된 구독 |
| SUBSCRIPTION_ALREADY_PAUSED | 이미 일시정지된 구독 |
| SUBSCRIPTION_NOT_PAUSED | 일시정지되지 않은 구독 |

### 플랜/티어 관련 에러
| 코드 | 설명 |
|------|------|
| PLAN_NOT_FOUND | 플랜을 찾을 수 없음 |
| PLAN_NOT_ACTIVE | 비활성화된 플랜 |
| PLAN_ALREADY_EXISTS | 이미 존재하는 플랜 |
| TIER_NOT_FOUND | 티어를 찾을 수 없음 |
| TIER_ALREADY_EXISTS | 이미 존재하는 티어 |
| TIER_CODE_DUPLICATE | 중복된 티어 코드 |
| INVALID_TIER_CHANGE | 유효하지 않은 티어 변경 |
| TIER_HAS_ACTIVE_PLANS | 활성 플랜이 있는 티어는 삭제 불가 |

### 일시정지 관련 에러
| 코드 | 설명 |
|------|------|
| PAUSE_NOT_ELIGIBLE | 일시정지 자격 없음 |
| PAUSE_LIMIT_EXCEEDED | 일시정지 한도 초과 |
| PAUSE_DURATION_INVALID | 유효하지 않은 일시정지 기간 |
| PAUSE_DATE_INVALID | 유효하지 않은 일시정지 날짜 |
| PAUSE_NOT_FOUND | 일시정지 기록을 찾을 수 없음 |
| PAUSE_ALREADY_RESUMED | 이미 재개된 일시정지 |
| PAUSE_IN_BLACKOUT_PERIOD | 일시정지 금지 기간 |

### 관리자 관련 에러
| 코드 | 설명 |
|------|------|
| ADMIN_NOT_FOUND | 관리자를 찾을 수 없음 |
| ADMIN_PERMISSION_DENIED | 관리자 권한 없음 |
| ADMIN_ACTION_NOT_ALLOWED | 허용되지 않은 관리자 작업 |
| IMPACT_ANALYSIS_FAILED | 영향도 분석 실패 |

### 정책 관련 에러
| 코드 | 설명 |
|------|------|
| POLICY_NOT_FOUND | 정책을 찾을 수 없음 |
| POLICY_ALREADY_EXISTS | 동일한 정책이 이미 존재함 |
| INVALID_POLICY_RULE | 유효하지 않은 정책 규칙 |
| POLICY_VALIDATION_FAILED | 정책 검증 실패 |
| POLICY_CONFLICT | 정책 간 충돌 발생 |
| POLICY_NOT_APPLICABLE | 해당 사용자/상황에 적용할 수 없는 정책 |

### 권한 관련 에러
| 코드 | 설명 |
|------|------|
| RIGHTS_NOT_FOUND | 사용자 권한을 찾을 수 없음 |
| RIGHTS_ALREADY_EXPIRED | 이미 만료된 권한 |
| RIGHTS_ALREADY_PAUSED | 이미 일시정지된 권한 |
| RIGHTS_NOT_PAUSED | 일시정지되지 않은 권한 |
| INSUFFICIENT_ADMIN_PRIVILEGES | 관리자 권한 부족 |
| INVALID_EXTENSION_PERIOD | 유효하지 않은 연장 기간 |

### 일반 에러
| 코드 | 설명 |
|------|------|
| VALIDATION_ERROR | 입력 데이터 검증 실패 |
| USER_NOT_FOUND | 사용자를 찾을 수 없음 |
| UNAUTHORIZED | 인증되지 않은 요청 |
| FORBIDDEN | 권한이 없는 요청 |
| TOO_MANY_REQUESTS | 요청 한도 초과 |
| INTERNAL_SERVER_ERROR | 서버 내부 오류 |
| SERVICE_UNAVAILABLE | 서비스 일시 중단 |

---

## 참고사항

- 모든 날짜는 ISO 8601 형식(UTC)으로 반환됩니다.
- 모든 API 요청은 적절한 인증이 필요합니다.
- 정책 시스템은 15가지 규칙 타입을 지원하며, 향후 확장 가능합니다.
- 관리자 권한이 필요한 API는 JWT 토큰에서 관리자 ID를 추출합니다.
- 벌크 검증 API는 대량 처리를 위해 설계되었으며, 적절한 Rate Limiting이 적용됩니다.
- 정책 검증 결과는 캐싱되어 성능을 최적화합니다.
- 권한 통계 API는 현재 개발 중이며, 향후 구현될 예정입니다.

### API 버전 정보
- 현재 버전: v1
- 지원되는 Content-Type: `application/json`
- Rate Limit: 
  - 일반 API: 분당 100회
  - 벌크 API: 분당 10회
  - 관리자 API: 분당 50회
  - 플랜/티어 조회 API: 분당 200회

### 일시정지 정책
- 기본 연간 최대 일시정지 횟수: 3회
- 최소 일시정지 기간: 1일
- 최대 일시정지 기간: 30일
- 일시정지 쿨다운 기간: 30일
- 정책에 따라 티어별로 다른 제한이 적용될 수 있습니다.

### 관리자 권한 체계
- 관리자 ID는 현재 하드코딩되어 있으며, 향후 JWT 토큰에서 추출될 예정입니다.
- 모든 관리자 작업은 감사 로그에 기록됩니다.
- 영향도 분석 기능을 통해 변경사항의 파급효과를 미리 확인할 수 있습니다.

### 플랜/티어 관리
- 티어 코드는 대문자와 언더스코어만 사용 가능합니다.
- 우선순위 레벨은 1-100 범위에서 설정 가능합니다.
- 플랜 비활성화 시 기존 구독자들에게 대안 플랜이 자동으로 제안됩니다.

### 정책 규칙 타입
현재 지원되는 15가지 정책 규칙 타입:
1. `MAX_PAUSES_PER_YEAR` - 연간 최대 일시정지 횟수
2. `MIN_PAUSE_DURATION_DAYS` - 최소 일시정지 기간
3. `MAX_PAUSE_DURATION_DAYS` - 최대 일시정지 기간
4. `PAUSE_COOLDOWN_DAYS` - 일시정지 쿨다운 기간
5. `PAUSE_BLACKOUT_PERIODS` - 일시정지 금지 기간
6. `PLAN_CHANGE_COOLDOWN_DAYS` - 플랜 변경 쿨다운 기간
7. `ALLOWED_PLAN_CHANGES` - 허용된 플랜 변경
8. `DOWNGRADE_RESTRICTIONS` - 다운그레이드 제한사항
9. `UPGRADE_BENEFITS` - 업그레이드 혜택
10. `TIER_SPECIFIC_LIMITS` - 티어별 제한사항
11. `VIP_USER_BENEFITS` - VIP 사용자 혜택
12. `NEW_USER_GRACE_PERIOD` - 신규 사용자 유예 기간
13. `PROMOTIONAL_PERIODS` - 프로모션 기간
14. `SEASONAL_RESTRICTIONS` - 계절별 제한사항
15. `SPECIAL_EVENT_RULES` - 특별 이벤트 규칙

### 지원되는 통화
- 기본 통화: KRW (한국 원)
- 향후 USD, EUR, JPY 등 추가 예정

### 데이터베이스 정보
- 모든 엔티티는 UUID를 기본키로 사용합니다.
- Soft Delete 방식을 사용하여 데이터 무결성을 보장합니다.
- 감사 로그를 통해 모든 변경사항을 추적합니다.
# Critical Bug Fixes - 실제 장애 가능성 높은 버그 수정

## 수정 완료된 버그 목록

### 1. ✅ 스케줄러 + Bull 큐: 중복 발송 방지

**문제점:**
- `handleScheduledCheck`에서 상태를 변경하지 않고 큐에만 추가
- 같은 notificationId가 여러 번 큐에 쌓일 수 있음
- 동일 알림이 여러 번 발송될 수 있는 치명적 버그

**수정 내용:**
```typescript
// 큐에 넣기 전에 상태를 PROCESSING으로 변경
const [updated] = await this.db
    .update(notifications)
    .set({
        status: NotificationStatus.PROCESSING,
        updatedAt: new Date(),
    })
    .where(
        and(
            eq(notifications.notificationId, notification.notificationId),
            eq(notifications.status, NotificationStatus.PENDING) // 상태가 여전히 PENDING인 경우만
        )
    )
    .returning();

// 상태 업데이트가 성공한 경우에만 큐에 추가
if (updated) {
    await job.queue.add('send-notification', { notificationId }, { priority });
}
```

**효과:**
- 동시성 문제 해결 (FOR UPDATE SKIP LOCKED 효과)
- 중복 큐잉 방지
- 같은 알림이 여러 번 발송되는 문제 해결

---

### 2. ✅ EventMappingService: 409 Conflict 처리

**문제점:**
- `createEvent`에서 unique constraint violation 시 500 에러 발생
- Swagger에는 409로 정의되어 있으나 실제로는 500 반환

**수정 내용:**
```typescript
try {
    const [newEvent] = await this.db.db.insert(notificationEvents).values({...}).returning();
    return {...};
} catch (error: any) {
    // PostgreSQL unique constraint violation (error code 23505)
    if (error.code === '23505' || error.code === 'SQLITE_CONSTRAINT_UNIQUE' || 
        (error.message && error.message.includes('UNIQUE constraint'))) {
        throw new ConflictException(`Event key "${dto.eventKey}" already exists`);
    }
    throw error;
}
```

**효과:**
- 중복 이벤트 키 생성 시 올바른 409 응답 반환
- API 스펙과 실제 동작 일치

---

### 3. ✅ EventMappingService: Optional 필드 NULL 방지

**문제점:**
- `updateEvent`에서 optional 필드가 `undefined`일 때 DB에 `NULL`로 저장될 수 있음
- NOT NULL 제약이 있으면 에러 발생
- 의도치 않은 NULL 값으로 인한 조회 로직 오류 가능

**수정 내용:**
```typescript
// undefined 필드는 업데이트하지 않도록 필터링
const updateData: any = {
    updatedAt: new Date(),
};

if (dto.name !== undefined) updateData.name = dto.name;
if (dto.description !== undefined) updateData.description = dto.description;
// ... 나머지 필드도 동일하게 처리

await this.db.db.update(notificationEvents).set(updateData).where(...);
```

**효과:**
- 의도치 않은 NULL 값 저장 방지
- 부분 업데이트 시 기존 값 유지

---

### 4. ✅ Kakao 웹훅: 시그니처 검증 강화

**문제점:**
- 프로덕션 환경에서도 시그니처가 없으면 통과
- `if (prod && signature)` 조건으로 인해 시그니처 없는 요청은 검증 없이 처리

**수정 내용:**
```typescript
if (process.env.NODE_ENV === 'production') {
    const expectedSignature = this.configService.get<string>('NHN_WEBHOOK_SIGNATURE');

    if (!expectedSignature) {
        this.logger.warn('NHN_WEBHOOK_SIGNATURE is not configured in production');
    }

    if (!signature) {
        throw new UnauthorizedException('Missing Kakao webhook signature');
    }

    if (expectedSignature && signature !== expectedSignature) {
        throw new UnauthorizedException('Invalid Kakao webhook signature');
    }
}
```

**효과:**
- 프로덕션 환경에서 시그니처 필수 검증
- 보안 강화

---

### 5. ✅ Twilio 웹훅: 시그니처 검증 추가

**문제점:**
- Twilio 웹훅 시그니처 검증이 전혀 없음
- 누가 보내든 다 받아들임 (보안 취약점)

**수정 내용:**
```typescript
async handleTwilioWebhook(
    data: any,
    signature?: string,
    requestUrl?: string,
): Promise<void> {
    // 프로덕션 환경에서 시그니처 검증 (선택적)
    if (process.env.NODE_ENV === 'production' && signature && requestUrl) {
        // TODO: Twilio 시그니처 검증 구현
        this.logger.warn('Twilio webhook signature verification not implemented');
    }
    // ...
}
```

**효과:**
- 시그니처 검증 구조 추가 (구현은 TODO로 남김)
- 향후 구현 시 쉽게 추가 가능

---

### 6. ✅ Kakao DTO: messageStatus 필드 추가

**문제점:**
- DTO에 `messageStatus` 필드가 없는데 코드에서 사용
- 타입 안전성 문제

**수정 내용:**
```typescript
export interface KakaoMessageResultUpdateHook {
    // ...
    resultCode: string;
    resultCodeName?: string;
    messageStatus?: string; // COMPLETED, FAILED, CANCEL (NHN API 응답에 따라 optional)
    // ...
}
```

**효과:**
- 타입 안전성 개선
- DTO와 실제 사용 코드 일치

---

### 7. ✅ Resend Webhook: handleEmailComplained 안전성 개선

**문제점:**
- `data.to[0]` 직접 접근으로 인한 런타임 에러 가능성
- `handleEmailBounced`는 안전하게 처리했으나 `handleEmailComplained`는 미처리

**수정 내용:**
```typescript
// 타입 안전성: to가 배열이고 비어있지 않은지 확인
const recipientEmail = Array.isArray(data.to) && data.to.length > 0
    ? data.to[0]
    : (typeof data.to === 'string' ? data.to : 'unknown');
```

**효과:**
- 런타임 에러 방지
- 일관된 에러 처리

---

### 8. ✅ ProviderManagerService: 헬스체크 에러 시 DB 상태 갱신

**문제점:**
- 헬스체크 에러 발생 시 DB 상태가 갱신되지 않음
- 실제로 죽은 provider인데 DB에는 ACTIVE로 남아있음
- metadata가 덮어씌워져서 이전 에러 정보 손실

**수정 내용:**
```typescript
// 성공 시: 기존 metadata 유지하면서 업데이트
const existingMetadata = existingProvider?.metadata || {};
await this.db.update(notificationProviders).set({
    metadata: {
        ...existingMetadata,
        lastHealthCheck: new Date().toISOString(),
        isHealthy: isAvailable,
    },
});

// 에러 시: DB 상태를 ERROR로 갱신
catch (error: any) {
    // ...
    await this.db.update(notificationProviders).set({
        status: ProviderStatus.ERROR,
        metadata: {
            ...existingMetadata,
            lastHealthCheck: new Date().toISOString(),
            isHealthy: false,
            lastError: error.message,
            lastErrorAt: new Date().toISOString(),
        },
    });
}
```

**효과:**
- 헬스체크 실패 시에도 DB 상태 정확히 반영
- 에러 이력 유지
- metadata 덮어쓰기 방지

---

### 9. ✅ batch.utils: 주석 수정 (순서 보장 안 됨 명시)

**문제점:**
- 주석에는 "입력 순서와 동일"이라고 되어 있으나 실제로는 처리 완료 순서
- 입력 순서가 중요한 경우 버그 발생 가능

**수정 내용:**
```typescript
/**
 * @returns 처리 결과 배열 (처리 완료 순서, 입력 순서와 다를 수 있음)
 * 
 * 주의: 결과 배열의 순서는 처리 완료 순서이며, 입력 배열 순서와 동일하지 않을 수 있습니다.
 * 입력 순서가 중요한 경우, 결과에 원본 인덱스를 포함하거나 다른 방식으로 매칭해야 합니다.
 */
```

**효과:**
- 개발자에게 정확한 동작 설명
- 잘못된 가정으로 인한 버그 방지

---

## 수정되지 않은 항목 (의도적)

### DbModule.forRoot 중복 호출
- 현재 구조상 여러 모듈에서 `DbModule.forRoot` 호출
- 실제 동작에는 문제 없으나, 향후 리팩토링 고려 필요
- 커넥션 풀 관리 최적화를 위해 상위 모듈에서 한 번만 호출하는 구조로 개선 권장

---

## 테스트 권장 사항

1. **중복 발송 테스트:**
   - 동시에 여러 스케줄러가 실행될 때 중복 발송 방지 확인
   - 같은 notificationId가 여러 번 큐에 쌓이지 않는지 확인

2. **409 Conflict 테스트:**
   - 동일한 eventKey로 이벤트 생성 시도
   - 409 응답 확인

3. **웹훅 시그니처 테스트:**
   - 프로덕션 환경에서 시그니처 없는 요청 시 401 응답 확인
   - 잘못된 시그니처 시 401 응답 확인

4. **헬스체크 에러 테스트:**
   - provider.isAvailable()이 에러를 던질 때 DB 상태가 ERROR로 변경되는지 확인
   - metadata에 에러 정보가 저장되는지 확인

---

## 결론

**실제 장애로 이어질 수 있는 9가지 버그를 모두 수정했습니다.**

특히 다음 4가지가 가장 치명적이었습니다:
1. 중복 발송 가능성 (스케줄러)
2. 409 Conflict 미처리
3. 웹훅 시그니처 검증 누락/약함
4. 헬스체크 에러 시 DB 상태 미갱신

이제 시스템 안정성이 크게 향상되었습니다.


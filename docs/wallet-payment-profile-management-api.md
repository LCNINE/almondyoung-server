# Wallet 결제 프로필 관리 API 명세서

## 📋 개요

### 목적

멤버십 회비 결제 수단 관리 페이지에서 필요한 결제 프로필 관리 기능을 제공합니다.

- 기본 결제 수단 변경
- 결제 프로필 삭제

### 중요 사항

**멤버십 결제는 HMS_CARD만 사용합니다.**

- 멤버십 구독/회비 결제는 반드시 `provider: 'HMS_CARD'`인 프로필만 사용 가능
- 다른 프로바이더(TOSS, HMS_BNPL 등)는 일반 주문 결제에만 사용

---

## 🎯 API 목록

### 우선순위 1: 기본 결제 수단 변경

#### `PATCH /payments/profiles/:profileId/set-default`

특정 결제 프로필을 사용자의 기본 결제 수단으로 설정합니다.

**경로 파라미터:**

- `profileId` (string, required): 변경할 결제 프로필 ID

**인증:**

- JWT 토큰 필요 (`JwtAuthGuard`)
- 요청한 사용자와 프로필 소유자가 일치해야 함

**요청 본문:**
없음 (경로 파라미터만 사용)

**응답 (200 OK):**

```json
{
  "success": true,
  "profileId": "01HZ1234567890ABCDEFGHIJK",
  "isDefault": true,
  "message": "기본 결제 수단이 변경되었습니다."
}
```

**비즈니스 로직:**

1. 프로필 존재 여부 확인
2. 프로필 소유자 확인 (요청한 userId와 일치하는지)
3. **프로필 상태 확인** (`status === 'ACTIVE'`만 허용)
4. **삭제 여부 확인** (`deletedAt IS NULL`만 허용)
5. **🚨 [Critical] HMS_CARD 검증**: 프로필의 `provider`가 `'HMS_CARD'`인지 확인
   - 멤버십 결제는 HMS_CARD만 사용하므로, 다른 프로바이더는 기본값으로 설정 불가
   - 검증 실패 시 `400 Bad Request` 반환
6. 기존 기본 결제 수단의 `isDefault`를 `false`로 변경
7. 선택한 프로필의 `isDefault`를 `true`로 변경
8. 트랜잭션으로 원자성 보장

**에러 응답:**

| 상태 코드 | 에러 메시지                           | 설명                                                             |
| --------- | ------------------------------------- | ---------------------------------------------------------------- |
| 400       | `Profile not found`                   | 프로필이 존재하지 않음                                           |
| 400       | `Profile already deleted`             | 삭제된 프로필은 기본값으로 설정 불가                             |
| 400       | `Profile status is not ACTIVE`        | 비활성 프로필은 기본값으로 설정 불가                             |
| 400       | `Only HMS_CARD can be set as default` | HMS_CARD가 아닌 프로필은 기본값으로 설정 불가 (멤버십 결제 제약) |
| 403       | `Profile does not belong to user`     | 다른 사용자의 프로필에 접근 시도                                 |
| 404       | `Profile not found`                   | 프로필을 찾을 수 없음                                            |

**스키마 제약:**

- `payment_profiles` 테이블의 Partial Unique Index (`uq_pp_user_default_active`)에 의해
- 사용자당 삭제되지 않은 프로필 중 `isDefault=true`는 최대 1개만 존재 가능

---

### 우선순위 2: 결제 프로필 삭제

#### `DELETE /payments/profiles/:profileId`

결제 프로필을 삭제합니다. (Soft Delete)

**경로 파라미터:**

- `profileId` (string, required): 삭제할 결제 프로필 ID

**인증:**

- JWT 토큰 필요 (`JwtAuthGuard`)
- 요청한 사용자와 프로필 소유자가 일치해야 함

**요청 본문:**
없음

**응답 (200 OK):**

```json
{
  "success": true,
  "profileId": "01HZ1234567890ABCDEFGHIJK",
  "deletedAt": "2025-01-15T10:30:00.000Z",
  "message": "결제 수단이 삭제되었습니다."
}
```

**비즈니스 로직:**

1. 프로필 존재 여부 확인
2. 프로필 소유자 확인
3. 이미 삭제된 프로필인지 확인 (`deletedAt IS NOT NULL`)
4. **기본 결제 수단인 경우:**
   - **자동 승계 로직 제거 (MVP 정책)**
   - 기본값을 해제하고 삭제만 수행 (`isDefault`가 없는 상태로 유지)
   - 사용자의 명시적 동의 없는 결제 수단 변경 방지 및 구현 복잡도 제거
5. `deletedAt` 필드에 현재 시각 기록 (Soft Delete)
6. 트랜잭션으로 원자성 보장

**주의사항:**

- Soft Delete이므로 실제 데이터는 삭제되지 않음
- `deletedAt IS NULL` 조건으로 조회 시 제외됨
- 삭제된 프로필은 결제에 사용할 수 없음
- **아키텍처 결합도 고려**: 멤버십 구독 상태 확인은 **프론트엔드에서 처리**
  - Wallet 서비스는 Membership 서비스와 직접 통신하지 않음
  - 프론트엔드에서 멤버십 API를 먼저 호출하여 구독 상태 확인 후 경고 표시
  - 백엔드는 삭제를 허용하되, 멤버십 결제 실패 시 별도 알림 처리 (Fail-over 방식)

**에러 응답:**

| 상태 코드 | 에러 메시지                       | 설명                             |
| --------- | --------------------------------- | -------------------------------- |
| 400       | `Profile not found`               | 프로필이 존재하지 않음           |
| 400       | `Profile already deleted`         | 이미 삭제된 프로필               |
| 403       | `Profile does not belong to user` | 다른 사용자의 프로필에 접근 시도 |
| 404       | `Profile not found`               | 프로필을 찾을 수 없음            |

---

## 📊 데이터베이스 스키마

### `payment_profiles` 테이블

```typescript
{
  id: string; // UUIDv7
  userId: string; // 사용자 ID
  kind: 'CARD' | 'BANK_ACCOUNT' | 'WALLET';
  provider: 'HMS_CARD' | 'HMS_BNPL' | 'TOSS' | 'KAKAOPAY' | 'POINTS';
  status: 'PENDING' | 'ACTIVE' | 'INACTIVE';
  name: string | null; // 사용자 별칭
  isDefault: boolean; // 기본 결제 수단 여부
  deletedAt: timestamp | null; // Soft Delete 시각
  createdAt: timestamp;
  updatedAt: timestamp;
}
```

### 제약 조건

1. **Partial Unique Index**: `uq_pp_user_default_active`
   - 사용자당 삭제되지 않은 프로필 중 `isDefault=true`는 최대 1개만 존재
   - SQL: `WHERE isDefault = true AND deletedAt IS NULL`

2. **CHECK Constraint**: `valid_provider_kind_mapping`
   - 올바른 Kind와 Provider 조합만 허용
   - 예: `CARD`는 `HMS_CARD` 또는 `TOSS`만 가능

---

## 🔄 사용 시나리오

### 시나리오 1: 멤버십 회비 결제 수단 변경

1. 사용자가 `/mypage/membership/payment-method` 페이지 접속
2. 현재 기본 결제 수단 표시 (HMS_CARD)
3. 다른 결제 수단 목록 표시
4. "멤버십 회비 결제수단으로 변경" 버튼 클릭
5. `PATCH /payments/profiles/:profileId/set-default` 호출
6. 성공 시 목록 새로고침

**요구사항:**

- 변경 대상 프로필은 반드시 `HMS_CARD`여야 함
- 멤버십은 HMS_CARD만 사용하므로, 다른 프로바이더는 변경 버튼 비활성화

### 시나리오 2: 결제 수단 삭제

1. 사용자가 결제 수단 목록에서 삭제 버튼 클릭
2. 확인 다이얼로그 표시
3. 확인 시 `DELETE /payments/profiles/:profileId` 호출
4. 성공 시 목록에서 제거

**주의:**

- 기본 결제 수단 삭제 시 자동 승계하지 않음 (사용자가 명시적으로 새 카드 선택 필요)
- 멤버십 구독 상태 확인은 프론트엔드에서 처리 (Wallet 서비스는 Membership과 직접 통신하지 않음)

---

## 🛠️ 구현 가이드

### 컨트롤러 레이어

```typescript
@Controller('/payments')
export class PaymentController {
  // 기본 결제 수단 변경
  @Patch('profiles/:profileId/set-default')
  @UseGuards(JwtAuthGuard)
  async setDefaultProfile(
    @Param('profileId') profileId: string,
    @User('userId') userId: string,
  ) {
    // 구현 필요
  }

  // 결제 프로필 삭제
  @Delete('profiles/:profileId')
  @UseGuards(JwtAuthGuard)
  async deleteProfile(
    @Param('profileId') profileId: string,
    @User('userId') userId: string,
  ) {
    // 구현 필요
  }
}
```

### 서비스 레이어

```typescript
@Injectable()
export class PaymentProfileService {
  // 기본 결제 수단 변경
  async setDefaultProfile(
    userId: string,
    profileId: string,
  ): Promise<{ profileId: string; isDefault: boolean }> {
    return this.db.db.transaction(async (tx) => {
      // 1. 프로필 조회 및 소유자 확인
      // 2. 프로필 상태 확인 (ACTIVE만 허용)
      // 3. 삭제 여부 확인 (deletedAt IS NULL)
      // 4. HMS_CARD 검증 (provider === 'HMS_CARD')
      // 5. 기존 기본값 해제
      // 6. 새 기본값 설정
    });
  }

  // 결제 프로필 삭제
  async deleteProfile(
    userId: string,
    profileId: string,
  ): Promise<{ profileId: string; deletedAt: Date }> {
    return this.db.db.transaction(async (tx) => {
      // 1. 프로필 조회 및 소유자 확인
      // 2. 이미 삭제된 프로필인지 확인
      // 3. 기본값인 경우 isDefault를 false로 해제 (자동 승계 없음)
      // 4. Soft Delete (deletedAt 설정)
    });
  }
}
```

### Repository 레이어

```typescript
@Injectable()
export class PaymentProfilesRepository {
  // 기본값 변경
  async setDefault(
    userId: string,
    profileId: string,
    tx: WalletExecutor,
  ): Promise<void> {
    // 기존 기본값 해제
    await tx
      .update(schema.paymentProfiles)
      .set({ isDefault: false })
      .where(
        and(
          eq(schema.paymentProfiles.userId, userId),
          eq(schema.paymentProfiles.isDefault, true),
          isNull(schema.paymentProfiles.deletedAt),
        ),
      );

    // 새 기본값 설정
    await tx
      .update(schema.paymentProfiles)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(eq(schema.paymentProfiles.id, profileId));
  }

  // Soft Delete
  async softDelete(profileId: string, tx: WalletExecutor): Promise<void> {
    await tx
      .update(schema.paymentProfiles)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.paymentProfiles.id, profileId));
  }
}
```

---

## ✅ 검증 항목

### 기본 결제 수단 변경

- [ ] 프로필 존재 여부 확인
- [ ] 프로필 소유자 확인
- [ ] 프로필 상태 확인 (ACTIVE만 가능)
- [ ] 삭제 여부 확인 (deletedAt IS NULL)
- [ ] **🚨 HMS_CARD 검증** (provider === 'HMS_CARD')
- [ ] 기존 기본값 해제
- [ ] 새 기본값 설정
- [ ] 트랜잭션 원자성 보장
- [ ] 동시성 처리 (Race Condition 방지)
- [ ] 에러 처리 (404, 403, 400)

### 결제 프로필 삭제

- [ ] 프로필 존재 여부 확인
- [ ] 프로필 소유자 확인
- [ ] 이미 삭제된 프로필인지 확인
- [ ] 기본값인 경우 `isDefault`를 `false`로 해제 (자동 승계 없음)
- [ ] Soft Delete 수행 (deletedAt 설정)
- [ ] 트랜잭션 원자성 보장
- [ ] 에러 처리 (404, 403, 400)

---

## 📝 참고사항

### 멤버십 결제 제약

- 멤버십 구독/회비 결제는 **HMS_CARD만 사용**
- 다른 프로바이더(TOSS, HMS_BNPL 등)는 일반 주문 결제에만 사용
- UI에서 멤버십 결제 수단 변경 시 HMS_CARD 프로필만 표시

### Soft Delete 정책

- 실제 데이터 삭제 없이 `deletedAt` 필드만 설정
- 조회 시 `WHERE deletedAt IS NULL` 조건으로 필터링
- 삭제된 프로필은 결제에 사용 불가
- **복구 시 주의사항**: `deletedAt`을 NULL로 복구할 때는 반드시 `isDefault`를 `false`로 설정
  - Partial Unique Index (`uq_pp_user_default_active`)와 충돌 방지
  - 복구된 프로필이 기존 기본값과 충돌하지 않도록 보장

### 기본값 전략

- 사용자당 최대 1개의 기본 결제 수단만 존재
- 기본값이 없는 상태도 허용 (MVP 정책)
- **기본값 삭제 시 자동 승계하지 않음** (사용자의 명시적 선택 필요)

---

## ⚠️ 동시성 및 엣지 케이스 처리

### Race Condition 방지

**문제 상황:**
- 두 요청이 동시에 들어와서 같은 사용자의 기본값을 변경하려고 할 때
- Partial Unique Index로 인한 Deadlock 또는 한쪽 요청 실패 가능

**해결 방안:**

1. **프론트엔드 측:**
   - Double Submit 방지 (버튼 비활성화, 로딩 상태 표시)
   - 요청 중복 방지 (debounce/throttle)

2. **백엔드 측:**
   - 트랜잭션 격리 수준 활용 (SERIALIZABLE 또는 REPEATABLE READ)
   - 트랜잭션 실패 시 명확한 에러 메시지 반환
   - 재시도 로직 구현 (선택사항, MVP에서는 에러 메시지만으로 충분)

**에러 응답 예시:**
```json
{
  "error": "Concurrent update detected. Please try again.",
  "code": "CONCURRENT_UPDATE"
}
```

### Soft Delete와 Unique Index 충돌 시나리오

**문제 상황:**
1. 카드 A (Default) 삭제 → `deletedAt` 설정
2. 카드 B를 새로 Default로 설정
3. 카드 A 복구 시도 → `deletedAt`을 NULL로 변경
4. **충돌 발생**: 카드 B가 이미 Default 자리를 차지하고 있음

**해결 방안:**

복구(Restore) 기능 구현 시 반드시 다음 정책을 따를 것:

```sql
-- ✅ 올바른 복구 쿼리
UPDATE payment_profiles
SET 
    deleted_at = NULL,
    is_default = false  -- 복구 시 기본값 해제 (충돌 방지)
WHERE id = 'profile-id';
```

**운영 가이드:**
- 백오피스에서 수동 복구 시 `isDefault`를 `false`로 설정
- 복구된 프로필은 일반 카드로 복구됨 (기본값 아님)
- 사용자가 명시적으로 다시 기본값으로 설정해야 함

---

## 🔗 관련 문서

- [Wallet Schema](./wallet-schema.md) - 데이터베이스 스키마 상세
- [Payment Controller](../apps/wallet/src/controllers/payment.controller.ts) - 기존 결제 API
- [Membership Payment Spec](../../almondyoung-client/MEMBERSHIP_PAYMENT_SPEC.md) - 멤버십 결제 명세

---

**작성일**: 2025-01-15  
**수정일**: 2025-01-15 (시니어 엔지니어 피드백 반영)  
**작성자**: Wallet Team  
**버전**: 1.1.0

---

## 📝 변경 이력

### v1.1.0 (2025-01-15)
- **Critical**: HMS_CARD 검증 로직 추가 (set-default API)
- 자동 기본값 승계 로직 제거 (MVP 정책)
- 동시성 처리 및 엣지 케이스 섹션 추가
- Soft Delete 복구 정책 명시
- 아키텍처 결합도 고려사항 추가

### v1.0.0 (2025-01-15)
- 초기 명세서 작성

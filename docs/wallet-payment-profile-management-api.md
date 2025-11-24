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
3. 기존 기본 결제 수단의 `isDefault`를 `false`로 변경
4. 선택한 프로필의 `isDefault`를 `true`로 변경
5. 트랜잭션으로 원자성 보장

**에러 응답:**

| 상태 코드 | 에러 메시지 | 설명 |
|---------|-----------|------|
| 400 | `Profile not found` | 프로필이 존재하지 않음 |
| 400 | `Profile already deleted` | 삭제된 프로필은 기본값으로 설정 불가 |
| 400 | `Profile status is not ACTIVE` | 비활성 프로필은 기본값으로 설정 불가 |
| 403 | `Profile does not belong to user` | 다른 사용자의 프로필에 접근 시도 |
| 404 | `Profile not found` | 프로필을 찾을 수 없음 |

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
3. 기본 결제 수단인 경우:
   - 다른 활성 프로필이 있으면 그 중 하나를 기본값으로 설정
   - 다른 활성 프로필이 없으면 삭제만 수행 (기본값 없음 상태 허용)
4. `deletedAt` 필드에 현재 시각 기록 (Soft Delete)
5. 트랜잭션으로 원자성 보장

**주의사항:**
- Soft Delete이므로 실제 데이터는 삭제되지 않음
- `deletedAt IS NULL` 조건으로 조회 시 제외됨
- 삭제된 프로필은 결제에 사용할 수 없음
- 멤버십 구독 중인 프로필 삭제 시 경고 메시지 권장 (구현 시 추가)

**에러 응답:**

| 상태 코드 | 에러 메시지 | 설명 |
|---------|-----------|------|
| 400 | `Profile not found` | 프로필이 존재하지 않음 |
| 400 | `Profile already deleted` | 이미 삭제된 프로필 |
| 403 | `Profile does not belong to user` | 다른 사용자의 프로필에 접근 시도 |
| 404 | `Profile not found` | 프로필을 찾을 수 없음 |

---

## 📊 데이터베이스 스키마

### `payment_profiles` 테이블

```typescript
{
  id: string;                    // UUIDv7
  userId: string;                // 사용자 ID
  kind: 'CARD' | 'BANK_ACCOUNT' | 'WALLET';
  provider: 'HMS_CARD' | 'HMS_BNPL' | 'TOSS' | 'KAKAOPAY' | 'POINTS';
  status: 'PENDING' | 'ACTIVE' | 'INACTIVE';
  name: string | null;           // 사용자 별칭
  isDefault: boolean;            // 기본 결제 수단 여부
  deletedAt: timestamp | null;  // Soft Delete 시각
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
- 기본 결제 수단 삭제 시 다른 프로필이 있으면 자동으로 기본값 설정
- 멤버십 구독 중인 프로필 삭제 시 경고 메시지 표시 권장

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
      // 2. 기존 기본값 해제
      // 3. 새 기본값 설정
    });
  }

  // 결제 프로필 삭제
  async deleteProfile(
    userId: string,
    profileId: string,
  ): Promise<{ profileId: string; deletedAt: Date }> {
    return this.db.db.transaction(async (tx) => {
      // 1. 프로필 조회 및 소유자 확인
      // 2. 기본값인 경우 다른 프로필로 전환
      // 3. Soft Delete (deletedAt 설정)
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
  async softDelete(
    profileId: string,
    tx: WalletExecutor,
  ): Promise<void> {
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
- [ ] 기존 기본값 해제
- [ ] 새 기본값 설정
- [ ] 트랜잭션 원자성 보장
- [ ] 에러 처리 (404, 403, 400)

### 결제 프로필 삭제

- [ ] 프로필 존재 여부 확인
- [ ] 프로필 소유자 확인
- [ ] 이미 삭제된 프로필인지 확인
- [ ] 기본값인 경우 다른 프로필로 전환
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
- 필요 시 복구 기능 추가 가능 (구현 시 별도 API)

### 기본값 전략

- 사용자당 최대 1개의 기본 결제 수단만 존재
- 기본값이 없는 상태도 허용 (다른 프로필이 없을 경우)
- 기본값 삭제 시 자동으로 다른 프로필을 기본값으로 설정 (있는 경우)

---

## 🔗 관련 문서

- [Wallet Schema](./wallet-schema.md) - 데이터베이스 스키마 상세
- [Payment Controller](../apps/wallet/src/controllers/payment.controller.ts) - 기존 결제 API
- [Membership Payment Spec](../../almondyoung-client/MEMBERSHIP_PAYMENT_SPEC.md) - 멤버십 결제 명세

---

**작성일**: 2025-01-15  
**작성자**: Wallet Team  
**버전**: 1.0.0


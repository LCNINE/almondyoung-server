# Enum 감사 보고서 및 축 분리 계획

> **명령화 문서 실행**: Enum 축 분리 및 값 단순화

## 📊 **현재 Enum 상태 분석**

### ✅ **이미 올바르게 구현된 축들**

#### 1. **PaymentProvider (누가)**

```typescript
export const PAYMENT_PROVIDER = {
  TOSS: 'TOSS',
  KAKAOPAY: 'KAKAOPAY',
  CMS: 'CMS',
  BNPL: 'BNPL',
  POINTS: 'POINTS',
} as const;
```

**상태**: ✅ **완벽** - 접두어 없음, 축 분리 완료

#### 2. **InstrumentKind (어떻게)**

```typescript
export const INSTRUMENT_KIND = {
  STORED: 'STORED', // 저장형 (Profile 기반)
  EPHEMERAL: 'EPHEMERAL', // 일시형 (세션 중 승인키)
} as const;
```

**상태**: ✅ **완벽** - 명확한 구분

#### 3. **PaymentIntentType (무엇)**

```typescript
export const PAYMENT_INTENT_TYPE = {
  ORDER: 'ORDER',
  BNPL_CAPTURE: 'BNPL_CAPTURE',
  MEMBERSHIP_FEE: 'MEMBERSHIP_FEE',
} as const;
```

**상태**: ✅ **완벽** - 비즈니스 맥락별 분리

---

## 🔧 **개선 필요한 축들**

### 1. **PaymentStatus (결과) - 단순화 필요**

#### 현재 상태 (복잡)

```typescript
export const PAYMENT_SESSION_STATUS = {
  PENDING: 'PENDING',
  AUTHORIZED: 'AUTHORIZED',
  CAPTURED: 'CAPTURED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED', // ❌ 복잡
  REFUNDED: 'REFUNDED',
} as const;

export const TRANSACTION_STATUS = {
  AUTHORIZED: 'AUTHORIZED', // ❌ 중복
  CAPTURED: 'CAPTURED', // ❌ 중복
  FAILED: 'FAILED', // ❌ 중복
  CANCELLED: 'CANCELLED', // ❌ 중복
} as const;
```

#### 권장 개선안 (단순화)

```typescript
// 🎯 통합된 PaymentStatus
export const PaymentStatus = {
  PENDING: 'PENDING',
  AUTHORIZED: 'AUTHORIZED',
  CAPTURED: 'CAPTURED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED', // 철자 유지
  REFUNDED: 'REFUNDED',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

// 부분 환불은 금액 필드로 처리
// if (intent.refundedAmount > 0 && intent.refundedAmount < intent.amount) {
//   // 부분 환불 상태
// }
```

### 2. **PaymentEvent (사건) - 새로 정의 필요**

#### 현재 상태 (분산)

```typescript
export const PAYMENT_SESSION_EVENT_TYPE = {
  SESSION_CREATED: 'SESSION_CREATED',
  PAYMENT_AUTHORIZED: 'PAYMENT_AUTHORIZED', // ❌ 접두어 있음
  PAYMENT_CAPTURED: 'PAYMENT_CAPTURED', // ❌ 접두어 있음
  PAYMENT_FAILED: 'PAYMENT_FAILED', // ❌ 접두어 있음
  PAYMENT_CANCELLED: 'PAYMENT_CANCELLED', // ❌ 접두어 있음
  REFUND_REQUESTED: 'REFUND_REQUESTED',
  REFUND_COMPLETED: 'REFUND_COMPLETED',
  REFUND_FAILED: 'REFUND_FAILED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
} as const;
```

#### 권장 개선안 (접두어 제거)

```typescript
// 🎯 단순화된 PaymentEvent
export const PaymentEvent = {
  CREATED: 'CREATED',
  AUTHORIZED: 'AUTHORIZED', // PAYMENT_ 제거
  CAPTURED: 'CAPTURED', // PAYMENT_ 제거
  FAILED: 'FAILED', // PAYMENT_ 제거
  CANCELLED: 'CANCELLED', // PAYMENT_ 제거
  REFUND_REQUESTED: 'REFUND_REQUESTED',
  REFUNDED: 'REFUNDED', // REFUND_COMPLETED → REFUNDED
  EXPIRED: 'EXPIRED', // SESSION_ 제거
} as const;
export type PaymentEvent = (typeof PaymentEvent)[keyof typeof PaymentEvent];
```

### 3. **RefundStatus (환불 결과) - 정리 필요**

#### 현재 상태

```typescript
export const REFUND_STATUS = {
  REQUESTED: 'REQUESTED',
  APPROVED: 'APPROVED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  FAILED: 'FAILED',
} as const;
```

#### 권장 개선안 (단순화)

```typescript
// 🎯 단순화된 RefundStatus
export const RefundStatus = {
  PENDING: 'PENDING', // REQUESTED + APPROVED 통합
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
} as const;
export type RefundStatus = (typeof RefundStatus)[keyof typeof RefundStatus];
```

---

## 📁 **새로운 Enum 파일 구조**

### **src/shared/enums/** 디렉터리 생성

#### 1. **payment-status.enum.ts**

```typescript
/**
 * 결제 상태 - 결과를 나타내는 축
 */
export const PaymentStatus = {
  PENDING: 'PENDING',
  AUTHORIZED: 'AUTHORIZED',
  CAPTURED: 'CAPTURED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED', // 현 DB 철자 유지
  REFUNDED: 'REFUNDED',
} as const;

export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

// 문자열 → Enum 매핑 유틸
export function toPaymentStatus(value: string): PaymentStatus | null {
  const upperValue = value.toUpperCase();
  return Object.values(PaymentStatus).includes(upperValue as PaymentStatus)
    ? (upperValue as PaymentStatus)
    : null;
}

// 유효성 검증 유틸
export function isValidPaymentStatus(value: string): value is PaymentStatus {
  return toPaymentStatus(value) !== null;
}
```

#### 2. **payment-event.enum.ts**

```typescript
/**
 * 결제 이벤트 - 사건을 나타내는 축
 */
export const PaymentEvent = {
  CREATED: 'CREATED',
  AUTHORIZED: 'AUTHORIZED',
  CAPTURED: 'CAPTURED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  REFUND_REQUESTED: 'REFUND_REQUESTED',
  REFUNDED: 'REFUNDED',
  EXPIRED: 'EXPIRED',
} as const;

export type PaymentEvent = (typeof PaymentEvent)[keyof typeof PaymentEvent];

export function toPaymentEvent(value: string): PaymentEvent | null {
  const upperValue = value.toUpperCase();
  return Object.values(PaymentEvent).includes(upperValue as PaymentEvent)
    ? (upperValue as PaymentEvent)
    : null;
}
```

#### 3. **payment-provider.enum.ts**

```typescript
/**
 * 결제 제공자 - 누가 처리하는지를 나타내는 축
 */
export const PaymentProvider = {
  TOSS: 'TOSS',
  KAKAOPAY: 'KAKAYPAY',
  CMS: 'CMS',
  BNPL: 'BNPL',
  POINTS: 'POINTS',
} as const;

export type PaymentProvider =
  (typeof PaymentProvider)[keyof typeof PaymentProvider];

export function toPaymentProvider(value: string): PaymentProvider | null {
  const upperValue = value.toUpperCase();
  return Object.values(PaymentProvider).includes(upperValue as PaymentProvider)
    ? (upperValue as PaymentProvider)
    : null;
}
```

#### 4. **payment-instrument.enum.ts**

```typescript
/**
 * 결제 수단 - 어떻게 처리하는지를 나타내는 축
 */
export const PaymentInstrument = {
  CARD_ONETIME: 'CARD_ONETIME',
  CARD_SAVED: 'CARD_SAVED',
  BNPL_ACCOUNT: 'BNPL_ACCOUNT',
  POINTS_WALLET: 'POINTS_WALLET',
  CMS_ACCOUNT: 'CMS_ACCOUNT',
} as const;

export type PaymentInstrument =
  (typeof PaymentInstrument)[keyof typeof PaymentInstrument];

// InstrumentKind 매핑
export function getInstrumentKind(
  instrument: PaymentInstrument,
): 'STORED' | 'EPHEMERAL' {
  switch (instrument) {
    case PaymentInstrument.CARD_SAVED:
    case PaymentInstrument.BNPL_ACCOUNT:
    case PaymentInstrument.POINTS_WALLET:
    case PaymentInstrument.CMS_ACCOUNT:
      return 'STORED';
    case PaymentInstrument.CARD_ONETIME:
      return 'EPHEMERAL';
    default:
      return 'EPHEMERAL';
  }
}
```

#### 5. **refund-status.enum.ts**

```typescript
/**
 * 환불 상태 - 환불 처리 결과를 나타내는 축
 */
export const RefundStatus = {
  PENDING: 'PENDING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
} as const;

export type RefundStatus = (typeof RefundStatus)[keyof typeof RefundStatus];

export function toRefundStatus(value: string): RefundStatus | null {
  const upperValue = value.toUpperCase();
  return Object.values(RefundStatus).includes(upperValue as RefundStatus)
    ? (upperValue as RefundStatus)
    : null;
}
```

#### 6. **index.ts** (통합 export)

```typescript
// 축별 Enum 통합 export
export * from './payment-status.enum';
export * from './payment-event.enum';
export * from './payment-provider.enum';
export * from './payment-instrument.enum';
export * from './refund-status.enum';

// 레거시 호환 매핑 (점진적 마이그레이션용)
export { PaymentStatus as PAYMENT_SESSION_STATUS } from './payment-status.enum';
export { PaymentStatus as TRANSACTION_STATUS } from './payment-status.enum';
export { PaymentEvent as PAYMENT_SESSION_EVENT_TYPE } from './payment-event.enum';
export { PaymentProvider as PAYMENT_PROVIDER } from './payment-provider.enum';
export { RefundStatus as REFUND_STATUS } from './refund-status.enum';
```

---

## 🔧 **매핑 유틸리티 함수**

### **enum-mapper.util.ts**

```typescript
import {
  PaymentStatus,
  PaymentEvent,
  PaymentProvider,
  RefundStatus,
  toPaymentStatus,
  toPaymentEvent,
} from '../enums';

/**
 * 레거시 문자열을 새 Enum으로 변환
 */
export class EnumMapper {
  // 철자 호환성 매핑
  static readonly LEGACY_STATUS_MAP: Record<string, PaymentStatus> = {
    CANCELED: PaymentStatus.CANCELLED, // 철자 호환
    CANCELLED: PaymentStatus.CANCELLED,
    PARTIAL_REFUNDED: PaymentStatus.REFUNDED, // 단순화
    PARTIALLY_REFUNDED: PaymentStatus.REFUNDED,
  };

  static mapPaymentStatus(legacyStatus: string): PaymentStatus {
    // 1. 직접 매핑 시도
    const direct = toPaymentStatus(legacyStatus);
    if (direct) return direct;

    // 2. 호환성 매핑 시도
    const compatible = this.LEGACY_STATUS_MAP[legacyStatus.toUpperCase()];
    if (compatible) return compatible;

    // 3. 기본값
    throw new Error(`Unknown payment status: ${legacyStatus}`);
  }

  static mapPaymentEvent(legacyEvent: string): PaymentEvent {
    // PAYMENT_ 접두어 제거 후 매핑
    const cleaned = legacyEvent
      .replace(/^PAYMENT_/, '')
      .replace(/^SESSION_/, '');
    const mapped = toPaymentEvent(cleaned);

    if (mapped) return mapped;
    throw new Error(`Unknown payment event: ${legacyEvent}`);
  }

  // 검증 함수들
  static validateEnumValue<T>(
    value: string,
    enumObject: Record<string, T>,
    fieldName: string,
  ): T {
    const upperValue = value.toUpperCase();
    const enumValue = Object.values(enumObject).find((v) => v === upperValue);

    if (!enumValue) {
      throw new Error(
        `Invalid ${fieldName}: ${value}. Allowed values: ${Object.values(enumObject).join(', ')}`,
      );
    }

    return enumValue;
  }
}
```

---

## ✅ **마이그레이션 체크리스트**

### **Phase 1: Enum 파일 생성**

- [ ] `src/shared/enums/` 디렉터리 생성
- [ ] 축별 enum 파일 생성 (5개 파일)
- [ ] `index.ts` 통합 export 파일 생성
- [ ] `enum-mapper.util.ts` 유틸리티 생성

### **Phase 2: 기존 코드 교체**

- [ ] `schema.ts`에서 새 enum import 교체
- [ ] Controller에서 enum 참조 교체
- [ ] Service에서 enum 참조 교체
- [ ] Provider에서 enum 참조 교체

### **Phase 3: 검증 로직 추가**

- [ ] DTO validation에 enum 검증 추가
- [ ] 매핑 유틸 함수 테스트 작성
- [ ] 철자 호환성 테스트 작성

### **Phase 4: 레거시 제거**

- [ ] 기존 enum 상수 제거
- [ ] import 정리
- [ ] 사용하지 않는 타입 정리

---

## 🎯 **핵심 개선 사항**

1. **축 분리 완료**: Type/Provider/Instrument/Status/Event 명확히 분리
2. **값 단순화**: 접두어 제거, 중복 enum 통합
3. **철자 호환**: `CANCELLED` 등 현재 DB 철자 유지
4. **매핑 유틸**: 레거시 → 신규 enum 자동 변환
5. **점진적 마이그레이션**: 기존 코드 호환성 보장

---

_본 감사 보고서는 명령화 문서의 4) Enum 정책에 따라 작성되었으며, 축 분리 원칙과 값 단순화 지침을 준수합니다._

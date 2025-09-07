import { CreateGeneralPaymentMethodDto } from '../../../shared/dtos/create-general-payment-method.dto';
import { PaymentMethodType } from '../../../shared/types/payment-method.types';

/**
 * 테스트 데이터 팩토리 - 필수 필드 누락 방지
 * 아래 DTO를 절대 변경하지 말고, 테스트 데이터는 이 팩토리로만 생성하라.
 */

type CardRegistrationInput = {
  userId: string;
  cardHolderName?: string;
  cardNumber?: string;
  paymentNumber?: string;
  expiryDate?: string; // MM/YY
  phone?: string;
  birthDate?: string; // 6~10자리
  cardPassword?: string;
  billingCycleDay?: number;
  methodName?: string;
  isDefault?: boolean;
};

type PointRegistrationInput = {
  userId: string;
  methodName?: string;
  isDefault?: boolean;
};

/**
 * 카드 결제수단 등록 데이터 생성
 * 필수 필드 전부를 요청 바디에 포함하고, 옵셔널은 명시적으로 필요 없음을 선택
 */
export function buildCardRegistration(
  input: CardRegistrationInput,
): CreateGeneralPaymentMethodDto {
  const userId = input.userId;
  if (!userId) throw new Error('userId required');

  const number = input.cardNumber ?? input.paymentNumber ?? '4111111111111111';
  const expiry = input.expiryDate ?? '12/29';
  const birth = input.birthDate ?? '900101';

  const dto: CreateGeneralPaymentMethodDto = {
    userId,
    methodType: PaymentMethodType.CARD,
    methodName: input.methodName ?? '멤버십 정기결제 카드',
    isDefault: input.isDefault ?? false,
    usage: 'SUBSCRIPTION',
    cardInfo: {
      cardHolderName: input.cardHolderName ?? '테스트사용자',
      cardNumber: number,
      expiryDate: expiry, // MM/YY
      phone: input.phone ?? '01012345678',
      birthDate: birth, // padEnd 가드 전에 문자열 존재 보장
      cardPassword: input.cardPassword ?? '12',
      billingCycleDay: input.billingCycleDay ?? 1,
    },
  };

  // 필수 키 검증 게이트
  assertHasKeys(dto, ['userId', 'methodType', 'usage']);
  assertHasKeys(dto.cardInfo!, [
    'cardHolderName',
    'expiryDate',
    'birthDate',
    'cardPassword',
  ]);
  assertHasOneOf(dto.cardInfo!, ['cardNumber', 'paymentNumber']);

  return dto;
}

/**
 * 포인트 결제수단 등록 데이터 생성
 */
export function buildPointRegistration(
  input: PointRegistrationInput,
): CreateGeneralPaymentMethodDto {
  const userId = input.userId;
  if (!userId) throw new Error('userId required');

  const dto: CreateGeneralPaymentMethodDto = {
    userId,
    methodType: PaymentMethodType.REWARD_POINT,
    methodName: input.methodName ?? '멤버십 포인트',
    isDefault: input.isDefault ?? false,
    usage: 'SUBSCRIPTION',
  };

  // 필수 키 검증 게이트
  assertHasKeys(dto, ['userId', 'methodType', 'usage']);

  return dto;
}

/**
 * Mock 응답 데이터 생성 - 모든 필수 필드 포함
 */
export function buildMockResponse(dto: CreateGeneralPaymentMethodDto) {
  return {
    id: `pm_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    userId: dto.userId,
    methodType: dto.methodType,
    methodName: dto.methodName || '기본 결제수단',
    status: 'PENDING' as const,
    isDefault: dto.isDefault || false,
    hmsMemberId:
      dto.methodType === PaymentMethodType.CARD
        ? `HMS_CARD_${Date.now()}`
        : undefined,
    createdAt: new Date().toISOString(),
  };
}

// 간단한 게이트 유틸
export function assertHasKeys(obj: any, keys: string[]) {
  const missing = keys.filter((k) => obj?.[k] === undefined);
  if (missing.length) {
    throw new Error(`Missing required keys: ${missing.join(', ')}`);
  }
}

export function assertHasOneOf(obj: any, keys: string[]) {
  if (!keys.some((k) => obj?.[k] !== undefined)) {
    throw new Error(`One of keys required: ${keys.join(' | ')}`);
  }
}

/**
 * 키 셋 스냅샷 검증용 헬퍼
 */
export function getCardInfoKeys(dto: CreateGeneralPaymentMethodDto): string[] {
  return Object.keys(dto.cardInfo || {}).sort();
}

export function getDtoKeys(dto: CreateGeneralPaymentMethodDto): string[] {
  return Object.keys(dto).sort();
}

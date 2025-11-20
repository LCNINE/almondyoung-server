import { Injectable } from '@nestjs/common';
import { ProviderHandle, ProviderType } from './payment-provider.interface';
import { HmsCardRegistrar } from './hms-card.registrar';
import { HmsCardChargeProvider } from './hms-card.charge';
import { HmsCardRefundProvider } from './hms-card.refund';
import { HmsBnplRegistrar } from './hms-bnpl.registrar';
import { HmsBnplChargeProvider } from './hms-bnpl.charge';
import { HmsBnplCashReceiptProvider } from './hms-bnpl.cash-receipt';
import { TossChargeProvider } from './toss.charge';

@Injectable()
export class ProviderRegistry {
  // NestJS의 DI 시스템이 생성자(constructor)를 통해 필요한 전문가 인스턴스들을 자동으로 주입해줍니다.
  constructor(
    // HMS Card 전문가 그룹
    private readonly hmsCardRegistrar: HmsCardRegistrar,
    private readonly hmsCardCharge: HmsCardChargeProvider,
    private readonly hmsCardRefund: HmsCardRefundProvider, // HmsCardRefundProvider를 만들었다고 가정

    // HMS BNPL 전문가 그룹
    private readonly hmsBnplRegistrar: HmsBnplRegistrar,
    private readonly hmsBnplCharge: HmsBnplChargeProvider,
    private readonly hmsBnplCashReceipt: HmsBnplCashReceiptProvider,
    // (BNPL 환불/취소 프로바이더가 있다면 여기에 추가)

    // Toss 전문가 그룹
    private readonly tossCharge: TossChargeProvider,
  ) {}

  /**
   * 요청된 ProviderType에 해당하는 능력(Capability) 묶음(ProviderHandle)을 반환합니다.
   * @param provider 가져올 Provider의 타입
   */
  get(provider: ProviderType): ProviderHandle {
    switch (provider) {
      case ProviderType.HMS_CARD:
        // HMS_CARD에 대한 능력들을 조립해서 반환합니다.
        return {
          id: ProviderType.HMS_CARD,
          profile: this.hmsCardRegistrar,
          charge: this.hmsCardCharge,
          refund: this.hmsCardRefund, // 환불/취소 기능 장착
          cancel: this.hmsCardRefund, // 동일 클래스가 CancelPort도 구현
          cashReceipt: null, // HMS CARD는 현금영수증 미지원
          taxInvoice: null, // HMS CARD는 세금계산서 미지원 (범용 TaxInvoiceService 사용)
        };

      case ProviderType.HMS_BNPL:
        // HMS_BNPL에 대한 능력들을 조립해서 반환합니다.
        return {
          id: ProviderType.HMS_BNPL,
          profile: this.hmsBnplRegistrar,
          charge: this.hmsBnplCharge,
          refund: null, // BNPL이 환불을 지원하지 않는다면 null
          cancel: null, // BNPL이 취소를 지원하지 않는다면 null
          cashReceipt: this.hmsBnplCashReceipt, // 현금영수증 발급
        };

      case ProviderType.TOSS:
        // TOSS에 대한 능력들을 조립해서 반환합니다.
        return {
          id: ProviderType.TOSS,
          profile: null, // 토스는 우리 시스템에서 직접 프로필을 등록하지 않음
          charge: this.tossCharge,
          refund: null, // 아직 구현하지 않았다면 null
          cancel: null, // 아직 구현하지 않았다면 null
          cashReceipt: null, // TOSS는 현금영수증 미지원
          taxInvoice: null, // TOSS는 세금계산서 미지원 (범용 TaxInvoiceService 사용)
        };

      case ProviderType.POINTS:
        // POINTS에 대한 능력들을 조립해서 반환합니다.
        return {
          id: ProviderType.POINTS,
          profile: null, // 포인트는 프로필 등록 불필요
          charge: null, // 포인트 차감은 별도 서비스에서 처리
          refund: null, // 포인트 환불은 별도 서비스에서 처리
          cancel: null, // 포인트 취소는 별도 서비스에서 처리
          cashReceipt: null, // 포인트는 현금영수증 미지원
          taxInvoice: null, // 포인트는 세금계산서 미지원
        };

      default:
        throw new Error(`Unknown provider type: ${provider}`);
    }
  }
}

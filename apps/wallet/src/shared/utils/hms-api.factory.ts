// 파일명: shared/utils/hms-api.factory.ts (최종 수정본)
import { HmsAPI, MockHmsAPI } from 'hms-api-wrapper';
import { Logger } from '@nestjs/common';

/**
 * HMS API Factory - 서비스별 환경 분리 및 명시적 초기화
 */
export class HmsApiFactory {
  private static readonly logger = new Logger(HmsApiFactory.name);

  /**
   * BNPL용 HMS API - 항상 Mock 사용
   */
  static createForBnpl(): MockHmsAPI {
    this.logger.log('🔧 BNPL용 HMS Mock API 생성');
    return new MockHmsAPI({
      swKey: 'mock-sw-key',
      custKey: 'mock-cust-key',
      isTest: true,
    });
  }

  /**
   * 신용카드용 HMS API - 환경변수를 직접 사용하여 명시적으로 생성
   */
  static createForCard(): HmsAPI | MockHmsAPI {
    const swKey = process.env.SW_KEY;
    const custKey = process.env.CUST_KEY;
    const isProduction = process.env.NODE_ENV === 'production';

    // 실제 키가 모두 존재하고, 운영 환경이 아닐 때만 Test API 사용
    if (swKey && custKey && !isProduction) {
      this.logger.log(
        '🎯 신용카드용 HMS Test API 생성 (키 직접 주입)',
      );
      return new HmsAPI({
        swKey: swKey,
        custKey: custKey,
        isTest: true,
      });
    }

    // 운영 환경일 경우 isTest: false로 실제 API 사용 (주의!)
    if (swKey && custKey && isProduction) {
      this.logger.warn(
        '🔥 신용카드용 HMS Real API 생성 (운영 환경)',
      );
      return new HmsAPI({
        swKey: swKey,
        custKey: custKey,
        isTest: false,
      });
    }

    // 그 외 모든 경우 (키 누락 등) Mock으로 안전하게 폴백
    this.logger.warn(
      `SW_KEY/CUST_KEY가 없거나 개발 환경이 아니므로 Mock API로 폴백합니다.`,
    );
    return this.createForBnpl();
  }

  /**
   * 통합 API (기존 호환성용 - createForCard와 동일한 로직 사용 권장)
   */
  static createFromEnv(): HmsAPI | MockHmsAPI {
    // 범용 Factory도 Card와 동일한 명시적 로직을 사용하도록 통일
    return this.createForCard();
  }
}
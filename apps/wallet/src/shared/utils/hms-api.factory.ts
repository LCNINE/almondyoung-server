// 파일명: shared/utils/hms-api.factory.ts (최종 수정본)
import { HmsAPI, MockHmsAPI } from 'hms-api-wrapper';
import { Logger } from '@nestjs/common';

/**
 * HMS API Factory - 서비스별 환경 분리 및 명시적 초기화
 */
export class HmsApiFactory {
  private static readonly logger = new Logger(HmsApiFactory.name);

  /**
   * BNPL용 HMS API - 동의서 등록은 add-test 사용
   */
  static createForBnpl(): HmsAPI | MockHmsAPI {
    const swKey = process.env.SW_KEY;
    const custKey = process.env.CUST_KEY;
    const isTest = process.env.NODE_ENV !== 'production';

    if (swKey && custKey) {
      // BNPL 동의서는 add-test를 사용
      const baseURL = isTest
        ? 'https://add-test.hyosungcms.co.kr/v1'
        : 'https://add.hyosungcms.co.kr/v1';

      this.logger.log(`🔧 BNPL용 HMS API 생성 - ${baseURL}`);
      return new HmsAPI({
        swKey: swKey,
        custKey: custKey,
        isTest: isTest,
        baseURL: baseURL,
        timeout: 60000,
      });
    }

    // 키가 없으면 Mock 사용
    this.logger.warn('🔧 BNPL용 HMS Mock API 생성 (키 없음)');
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
    const useRealApi = process.env.USE_REAL_HMS_API === 'true'; // 명시적 플래그

    // 운영 환경일 경우 isTest: false로 실제 API 사용 (주의!)
    if (swKey && custKey && isProduction) {
      this.logger.warn(
        '🔥 신용카드용 HMS Real API 생성 (운영 환경)',
      );
      return new HmsAPI({
        swKey: swKey,
        custKey: custKey,
        isTest: false,
        baseURL: 'https://api.hyosungcms.co.kr/v1',
        timeout: 30000,
      });
    }

    // 개발 환경에서 실제 API 사용 (USE_REAL_HMS_API=true일 때만)
    if (swKey && custKey && !isProduction && useRealApi) {
      this.logger.log(
        '🎯 신용카드용 HMS Test API 생성 (키 직접 주입)',
      );
      return new HmsAPI({
        swKey: swKey,
        custKey: custKey,
        isTest: true,
        baseURL: 'https://api-test.hyosungcms.co.kr/v1',
        timeout: 30000,
      });
    }

    // 그 외 모든 경우 Mock으로 안전하게 폴백
    this.logger.warn(
      `HMS Mock API 사용 (USE_REAL_HMS_API=${useRealApi}, NODE_ENV=${process.env.NODE_ENV})`,
    );
    return new MockHmsAPI({
      swKey: 'mock-sw-key',
      custKey: 'mock-cust-key',
      isTest: true,
    });
  }

  /**
   * 통합 API (기존 호환성용 - createForCard와 동일한 로직 사용 권장)
   */
  static createFromEnv(): HmsAPI | MockHmsAPI {
    // 범용 Factory도 Card와 동일한 명시적 로직을 사용하도록 통일
    return this.createForCard();
  }
}
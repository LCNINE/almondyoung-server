// 파일명: shared/utils/hms-api.factory.ts (최종 수정본)
import { HmsAPI, MockHmsAPI } from 'hms-api-wrapper';
import { Logger } from '@nestjs/common';

/**
 * HMS API Factory - 서비스별 환경 분리 및 프록시 지원
 *
 * 프록시 사용 시 환경변수 설정:
 * HYOSUNG_PROXY_URL=http://15.164.160.156
 *
 * 프록시 라우팅:
 * - /add/* → add-test.hyosungcms.co.kr/* (동의자료 API)
 * - /*     → api-test.hyosungcms.co.kr/*  (일반 API)
 *
 * 주의: 프록시는 테스트 환경만 구축됨 (운영 환경은 직접 호출)
 */
export class HmsApiFactory {
  private static readonly logger = new Logger(HmsApiFactory.name);

  /**
   * BNPL용 HMS API - 동의자료 등록 (add-test)
   */
  static createForBnpl(): HmsAPI | MockHmsAPI {
    const swKey = process.env.SW_KEY;
    const custKey = process.env.CUST_KEY;
    const isTest = process.env.NODE_ENV !== 'production';
    const proxyUrl = process.env.HYOSUNG_PROXY_URL; // http://15.164.160.156

    if (swKey && custKey) {
      let baseURL: string;

      if (isTest && proxyUrl) {
        // 테스트 환경 + 프록시 사용: 프록시 경유 (/add/* 경로)
        baseURL = `${proxyUrl}/add/v1`;
        this.logger.log(`🔧 BNPL용 HMS API 생성 (프록시 경유) - ${baseURL}`);
      } else if (isTest) {
        // 테스트 환경 + 프록시 미사용: 직접 호출
        baseURL = 'https://add-test.hyosungcms.co.kr/v1';
        this.logger.log(`🔧 BNPL용 HMS API 생성 (직접 호출) - ${baseURL}`);
      } else {
        // 운영 환경: 프록시 없이 직접 호출
        baseURL = 'https://add.hyosungcms.co.kr/v1';
        this.logger.warn(`🔥 BNPL용 HMS API 생성 (운영 환경) - ${baseURL}`);
      }

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
   * 신용카드용 HMS API - 일반 API (api-test)
   */
  static createForCard(): HmsAPI | MockHmsAPI {
    const swKey = process.env.SW_KEY;
    const custKey = process.env.CUST_KEY;
    const isProduction = process.env.NODE_ENV === 'production';
    const useRealApi = process.env.USE_REAL_HMS_API === 'true'; // 명시적 플래그
    const proxyUrl = process.env.HYOSUNG_PROXY_URL; // http://15.164.160.156

    // 운영 환경일 경우 isTest: false로 실제 API 사용 (주의!)
    if (swKey && custKey && isProduction) {
      // 운영 환경: 프록시 없이 직접 호출
      this.logger.warn('🔥 신용카드용 HMS Real API 생성 (운영 환경)');
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
      let baseURL: string;

      if (proxyUrl) {
        // 테스트 환경 + 프록시 사용: 프록시 경유 (/* 경로)
        baseURL = `${proxyUrl}/v1`;
        this.logger.log(
          `🎯 신용카드용 HMS Test API 생성 (프록시 경유) - ${baseURL}`,
        );
      } else {
        // 테스트 환경 + 프록시 미사용: 직접 호출
        baseURL = 'https://api-test.hyosungcms.co.kr/v1';
        this.logger.log(
          `🎯 신용카드용 HMS Test API 생성 (직접 호출) - ${baseURL}`,
        );
      }

      return new HmsAPI({
        swKey: swKey,
        custKey: custKey,
        isTest: true,
        baseURL: baseURL,
        timeout: 30000,
      });
    }

    // 그 외 모든 경우 Mock으로 안전하게 폴백
    this.logger.warn(
      `🧪 HMS Mock API 사용 (USE_REAL_HMS_API=${useRealApi}, NODE_ENV=${process.env.NODE_ENV})`,
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

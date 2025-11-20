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
    const isProduction = process.env.NODE_ENV === 'production';
    const proxyUrl = process.env.HYOSUNG_PROXY_URL;

    // 키가 있으면 Real API, 없으면 Mock
    if (swKey && custKey) {
      let baseURL: string;

      if (isProduction) {
        // 운영: 직접 호출
        baseURL = 'https://add.hyosungcms.co.kr/v1';
        this.logger.warn(`🔥 BNPL용 HMS API 생성 (운영) - ${baseURL}`);
      } else if (proxyUrl) {
        // 개발/테스트 + 프록시: 프록시 경유 (/add/* 경로)
        baseURL = `${proxyUrl}/add/v1`;
        this.logger.log(`🔧 BNPL용 HMS API 생성 (프록시) - ${baseURL}`);
      } else {
        // 개발/테스트: 직접 호출
        baseURL = 'https://add-test.hyosungcms.co.kr/v1';
        this.logger.log(`🔧 BNPL용 HMS API 생성 (직접) - ${baseURL}`);
      }

      return new HmsAPI({
        swKey,
        custKey,
        isTest: !isProduction,
        baseURL,
        timeout: 60000,
      });
    }

    // 키 없음 → Mock
    this.logger.warn('🧪 BNPL용 HMS Mock API 사용 (키 없음)');
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
    const proxyUrl = process.env.HYOSUNG_PROXY_URL;

    // 키가 있으면 Real API, 없으면 Mock
    if (swKey && custKey) {
      let baseURL: string;

      if (isProduction) {
        // 운영: 직접 호출
        baseURL = 'https://api.hyosungcms.co.kr/v1';
        this.logger.warn(`🔥 신용카드용 HMS API 생성 (운영) - ${baseURL}`);
      } else if (proxyUrl) {
        // 개발/테스트 + 프록시: 프록시 경유 (/* 경로)
        baseURL = `${proxyUrl}/v1`;
        this.logger.log(`🎯 신용카드용 HMS API 생성 (프록시) - ${baseURL}`);
      } else {
        // 개발/테스트: 직접 호출
        baseURL = 'https://api-test.hyosungcms.co.kr/v1';
        this.logger.log(`🎯 신용카드용 HMS API 생성 (직접) - ${baseURL}`);
      }

      return new HmsAPI({
        swKey,
        custKey,
        isTest: !isProduction,
        baseURL,
        timeout: 30000,
      });
    }

    // 키 없음 → Mock
    this.logger.warn('🧪 신용카드용 HMS Mock API 사용 (키 없음)');
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

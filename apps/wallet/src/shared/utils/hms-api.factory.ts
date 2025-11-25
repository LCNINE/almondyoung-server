// 파일명: shared/utils/hms-api.factory.ts (최종 수정본)
import { HmsAPI } from 'hms-api-wrapper';
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
   * BNPL용 HMS API
   *
   * 실제 테스트 서버만 사용 (Mock 제거)
   * - 기본 API (members 등): api-test 또는 api 사용
   * - 동의서 API (agreements): add-test 또는 add 사용 (HmsAPI 내부에서 자동 처리)
   */
  static createForBnpl(): HmsAPI {
    const swKey = process.env.SW_KEY;
    const custKey = process.env.CUST_KEY;
    const isProduction = process.env.NODE_ENV === 'production';
    const proxyUrl = process.env.HYOSUNG_PROXY_URL;

    // 키가 필수 (실제 테스트 서버 사용)
    if (!swKey || !custKey) {
      this.logger.error(
        '❌ HMS API 키가 설정되지 않았습니다 (SW_KEY, CUST_KEY)',
      );
      throw new Error(
        'HMS API 키가 필요합니다. 환경변수를 확인하세요: SW_KEY, CUST_KEY',
      );
    }

    // BNPL도 기본적으로 api-test/api를 사용 (동의서만 add-test/add 사용)
    let baseURL: string;

    if (isProduction) {
      // 운영: 직접 호출
      baseURL = 'https://api.hyosungcms.co.kr/v1';
      this.logger.warn(`🔥 BNPL용 HMS API 생성 (운영) - ${baseURL}`);
    } else if (proxyUrl) {
      // 개발/테스트 + 프록시: 프록시 경유
      baseURL = `${proxyUrl}/v1`;
      this.logger.log(`🔧 BNPL용 HMS API 생성 (프록시) - ${baseURL}`);
    } else {
      // 개발/테스트: 직접 호출
      baseURL = 'https://api-test.hyosungcms.co.kr/v1';
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

  /**
   * 신용카드용 HMS API - 일반 API (api-test)
   *
   * 카드 결제는 테스트 서버가 자동 응답하므로 Mock 불필요
   * MVP 출시 앞두고 있어 Real API만 지원
   */
  static createForCard(): HmsAPI {
    const swKey = process.env.SW_KEY;
    const custKey = process.env.CUST_KEY;
    const isProduction = process.env.NODE_ENV === 'production';
    const proxyUrl = process.env.HYOSUNG_PROXY_URL;

    // 키가 필수 (MVP 환경이므로)
    if (!swKey || !custKey) {
      this.logger.error(
        '❌ HMS API 키가 설정되지 않았습니다 (SW_KEY, CUST_KEY)',
      );
      throw new Error(
        'HMS API 키가 필요합니다. 환경변수를 확인하세요: SW_KEY, CUST_KEY',
      );
    }

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

  /**
   * 통합 API (기존 호환성용 - createForCard와 동일)
   */
  static createFromEnv(): HmsAPI {
    return this.createForCard();
  }
}

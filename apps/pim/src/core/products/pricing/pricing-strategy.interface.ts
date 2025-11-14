import { PricingStrategyType, DbTransaction } from '../../../types';

/**
 * 가격 계산 전략 인터페이스
 */
export interface PricingStrategy {
  /**
   * 특정 품목의 가격을 계산합니다
   * @param data 가격 계산에 필요한 데이터 (옵션값 배열 또는 품목 ID)
   * @param tx 트랜잭션 (선택사항)
   * @returns 계산된 가격 (원 단위)
   */
  calculatePrice(data: any, tx?: DbTransaction): Promise<number>;

  /**
   * 가격 데이터를 설정합니다
   * @param masterId 마스터 ID
   * @param priceData 가격 데이터
   * @param tx 트랜잭션 (선택사항)
   */
  setPriceData(masterId: string, priceData: any, tx?: DbTransaction): Promise<void>;

  /**
   * 가격 데이터를 조회합니다
   * @param masterId 마스터 ID
   * @param tx 트랜잭션 (선택사항)
   * @returns 가격 데이터
   */
  getPriceData(masterId: string, tx?: DbTransaction): Promise<any>;

  /**
   * 가격 데이터를 업데이트합니다
   * @param masterId 마스터 ID
   * @param priceData 업데이트할 가격 데이터
   * @param tx 트랜잭션 (선택사항)
   */
  updatePriceData(masterId: string, priceData: any, tx?: DbTransaction): Promise<void>;

  /**
   * 가격 데이터를 삭제합니다
   * @param masterId 마스터 ID
   * @param tx 트랜잭션 (선택사항)
   */
  deletePriceData(masterId: string, tx?: DbTransaction): Promise<void>;

  /**
   * 가격 데이터 유효성을 검증합니다
   * @param priceData 가격 데이터
   * @returns 유효성 검증 결과
   */
  validatePriceData(priceData: any): Promise<boolean>;

  /**
   * 다른 전략에서 이 전략으로 마이그레이션
   * @param masterId 마스터 ID
   * @param fromStrategy 기존 전략
   * @param tx 트랜잭션 (선택사항)
   */
  migrateFrom(masterId: string, fromStrategy: PricingStrategy, tx?: DbTransaction): Promise<void>;

  /**
   * 이 전략에서 다른 전략으로 마이그레이션
   * @param masterId 마스터 ID
   * @param toStrategy 대상 전략
   * @param tx 트랜잭션 (선택사항)
   */
  migrateTo(masterId: string, toStrategy: PricingStrategy, tx?: DbTransaction): Promise<void>;
} 
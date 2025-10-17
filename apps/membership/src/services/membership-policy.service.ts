import { Injectable, Logger } from '@nestjs/common';
import { PolicyReader } from './policy/policy.reader';
import { PolicyManager } from './policy/policy.manager';
import {
  PolicyRuleType,
  PolicyValue,
  PolicyResult,
} from '../shared/schemas/policy.type';

// 하위 호환성을 위한 타입 export
export type {
  PolicyRuleType,
  PolicyValue,
  PolicyResult,
} from '../shared/schemas/policy.type';

/**
 * 멤버십 정책 서비스 (Business Layer)
 *
 * 역할: 비즈니스 흐름만 표현 (2-3줄)
 * - 검증 로직 없음 (Manager가 담당)
 * - 상세 구현 없음 (Reader/Manager가 담당)
 * - 협력 도구 클래스들을 중계
 * - 캐싱 레이어 제공
 */
@Injectable()
export class MembershipPolicyService {
  private readonly logger = new Logger(MembershipPolicyService.name);

  // 캐시 (성능 최적화)
  private policyCache = new Map<string, PolicyResult>();
  private cacheExpiry = new Map<string, number>();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5분

  constructor(
    private readonly policyReader: PolicyReader,
    private readonly policyManager: PolicyManager,
  ) {}

  /**
   * 정책 조회 (캐싱 포함)
   *
   * ✅ 흐름만 표현: "캐시 확인 → Reader 조회 → 캐시 저장"
   */
  async getPolicy(
    ruleType: PolicyRuleType,
    tierId?: string,
  ): Promise<PolicyResult | null> {
    const cacheKey = this.getCacheKey(ruleType, tierId);

    // 캐시 확인
    if (this.isCacheValid(cacheKey)) {
      return this.policyCache.get(cacheKey) || null;
    }

    // Reader 조회
    const policy = await this.policyReader.findPolicy(ruleType, tierId);

    // 캐시 저장
    if (policy) {
      this.setCache(cacheKey, policy);
    }

    return policy;
  }

  /**
   * 정책 값 추출 (타입 안전)
   *
   * ✅ 흐름만 표현: "정책 조회 → 값 추출"
   */
  async getPolicyValue<T = PolicyValue>(
    ruleType: PolicyRuleType,
    tierId?: string,
    defaultValue?: T,
  ): Promise<T> {
    const policy = await this.getPolicy(ruleType, tierId);

    if (!policy) {
      if (defaultValue !== undefined) {
        this.logger.warn('Policy not found, using default', {
          ruleType,
          tierId: tierId || 'global',
          defaultValue,
        });
        return defaultValue;
      }
      this.logger.error('Policy not found and no default provided', {
        ruleType,
        tierId,
      });
      throw new Error(`Policy not found: ${ruleType}`);
    }

    return policy.ruleValue as T;
  }

  /**
   * 숫자 정책 값 추출
   *
   * ✅ 흐름만 표현: "정책 값 조회 → 숫자 추출"
   */
  async getNumberPolicy(
    ruleType: PolicyRuleType,
    key: string,
    tierId?: string,
    defaultValue?: number,
  ): Promise<number> {
    const value = await this.getPolicyValue<Record<string, any>>(
      ruleType,
      tierId,
      defaultValue !== undefined ? { [key]: defaultValue } : undefined,
    );

    if (typeof value[key] !== 'number') {
      this.logger.error('Policy value type mismatch', {
        ruleType,
        key,
        expectedType: 'number',
        actualType: typeof value[key],
      });
      throw new Error(
        `Policy value for key '${key}' is not a number: ${ruleType}`,
      );
    }

    return value[key];
  }

  /**
   * 불린 정책 값 추출
   *
   * ✅ 흐름만 표현: "정책 값 조회 → 불린 추출"
   */
  async getBooleanPolicy(
    ruleType: PolicyRuleType,
    key: string,
    tierId?: string,
    defaultValue?: boolean,
  ): Promise<boolean> {
    const value = await this.getPolicyValue<Record<string, any>>(
      ruleType,
      tierId,
      defaultValue !== undefined ? { [key]: defaultValue } : undefined,
    );

    if (typeof value[key] !== 'boolean') {
      this.logger.error('Policy value type mismatch', {
        ruleType,
        key,
        expectedType: 'boolean',
        actualType: typeof value[key],
      });
      throw new Error(
        `Policy value for key '${key}' is not a boolean: ${ruleType}`,
      );
    }

    return value[key];
  }

  /**
   * 정책 생성/업데이트
   *
   * ✅ 흐름만 표현: "Manager 호출 → 캐시 무효화"
   */
  async upsertPolicy(
    ruleType: PolicyRuleType,
    ruleValue: PolicyValue,
    tierId?: string,
    validFrom?: string,
    validUntil?: string,
  ): Promise<PolicyResult> {
    const policy = await this.policyManager.upsertPolicy(
      ruleType,
      ruleValue,
      tierId,
      validFrom,
      validUntil,
    );

    // 캐시 무효화
    this.invalidateCache(ruleType, tierId);

    return policy;
  }

  /**
   * 정책 비활성화
   *
   * ✅ 흐름만 표현: "Manager 호출 → 전체 캐시 무효화"
   */
  async deactivatePolicy(id: string): Promise<void> {
    await this.policyManager.deactivatePolicy(id);

    // 전체 캐시 무효화 (어떤 정책인지 모르므로)
    this.clearAllCache();
  }

  /**
   * 모든 활성 정책 조회
   *
   * ✅ 흐름만 표현: "Reader 조회"
   */
  async getAllActivePolicies(): Promise<PolicyResult[]> {
    return this.policyReader.findAllActive();
  }

  /**
   * 캐시 키 생성
   */
  private getCacheKey(ruleType: PolicyRuleType, tierId?: string): string {
    return `${ruleType}:${tierId || 'global'}`;
  }

  /**
   * 캐시 유효성 확인
   */
  private isCacheValid(key: string): boolean {
    const expiry = this.cacheExpiry.get(key);
    if (!expiry) return false;
    return Date.now() < expiry;
  }

  /**
   * 캐시 저장
   */
  private setCache(key: string, policy: PolicyResult): void {
    this.policyCache.set(key, policy);
    this.cacheExpiry.set(key, Date.now() + this.CACHE_TTL);
  }

  /**
   * 특정 정책 캐시 무효화
   */
  private invalidateCache(ruleType: PolicyRuleType, tierId?: string): void {
    const globalKey = this.getCacheKey(ruleType, undefined);
    const tierKey = this.getCacheKey(ruleType, tierId);

    this.policyCache.delete(globalKey);
    this.policyCache.delete(tierKey);
    this.cacheExpiry.delete(globalKey);
    this.cacheExpiry.delete(tierKey);

    this.logger.debug('Cache invalidated', { ruleType, tierId });
  }

  /**
   * 전체 캐시 무효화
   */
  private clearAllCache(): void {
    this.policyCache.clear();
    this.cacheExpiry.clear();
    this.logger.debug('All cache cleared');
  }
}

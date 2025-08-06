import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { DbService } from '@app/db';
import { eq, and, isNull, desc } from 'drizzle-orm';
import * as schema from '../shared/schemas/entities/schema';
import type {
  PolicyListResponse,
  PolicyResponse,
  TierInfo,
} from '../shared/schemas';
import {
  CreatePolicyRequest,
  GetPoliciesQuery,
  UpdatePolicyRequest,
} from '../shared/schemas';

/**
 * 정책 버전 정보를 나타내는 인터페이스
 *
 * @interface PolicyVersion
 * @property {string} id - 정책의 고유 식별자
 * @property {number} version - 버전 번호 (최신이 1번)
 * @property {Record<string, any>} ruleValue - 정책 규칙 값
 * @property {string} [changeReason] - 변경 사유 (현재 스키마에는 미구현)
 * @property {string} [changedBy] - 변경자 ID (현재 스키마에는 미구현)
 * @property {boolean} isActive - 활성 상태
 * @property {Date} createdAt - 생성 일시
 * @property {Date} updatedAt - 수정 일시
 */
interface PolicyVersion {
  id: string;
  version: number;
  ruleValue: Record<string, any>;
  changeReason?: string;
  changedBy?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 정책 버전 간 비교 결과를 나타내는 인터페이스
 *
 * @interface PolicyVersionComparison
 * @property {string} policyId - 비교 대상 정책 ID
 * @property {PolicyVersion} version1 - 첫 번째 버전
 * @property {PolicyVersion} version2 - 두 번째 버전
 * @property {Array} differences - 버전 간 차이점 목록
 */
interface PolicyVersionComparison {
  policyId: string;
  version1: PolicyVersion;
  version2: PolicyVersion;
  differences: Array<{
    field: string;
    oldValue: any;
    newValue: any;
  }>;
}

/**
 * 정책 관리 서비스
 * 정책의 CRUD 작업과 버전 관리를 담당합니다.
 */
@Injectable()
export class PolicyManagementService {
  private readonly logger = new Logger(PolicyManagementService.name);

  constructor(private readonly dbService: DbService<typeof schema>) {}

  /**
   * 모든 활성 정책을 조회합니다.
   *
   * @param query - 정책 조회 필터 옵션
   * @param query.ruleType - 정책 규칙 타입으로 필터링
   * @param query.tierId - 특정 티어 ID로 필터링
   * @param query.isActive - 활성/비활성 상태로 필터링 (기본값: true)
   * @param query.page - 페이지 번호 (기본값: 1)
   * @param query.limit - 페이지당 항목 수 (기본값: 20)
   * @returns 페이지네이션된 정책 목록과 메타데이터
   * @throws {Error} 데이터베이스 조회 실패 시
   */
  async getAllPolicies(query?: GetPoliciesQuery): Promise<PolicyListResponse> {
    try {
      const {
        ruleType,
        tierId,
        isActive = true,
        page = 1,
        limit = 20,
      } = query || {};

      // 조건 구성 - 타입 안전성을 위해 배열 타입 명시
      const conditions: any[] = [];

      if (isActive !== undefined) {
        conditions.push(eq(schema.subscriptionPolicies.isActive, isActive));
      }

      if (ruleType) {
        conditions.push(eq(schema.subscriptionPolicies.ruleType, ruleType));
      }

      if (tierId) {
        conditions.push(eq(schema.subscriptionPolicies.tierId, tierId));
      }

      const whereClause =
        conditions.length > 0 ? and(...conditions) : undefined;

      // 총 개수 조회
      const totalResult = await this.dbService.db
        .select({ count: schema.subscriptionPolicies.id })
        .from(schema.subscriptionPolicies)
        .where(whereClause);

      const total = totalResult?.length || 0;

      // 페이지네이션된 결과 조회
      const offset = (page - 1) * limit;
      const policies = await this.dbService.db
        .select()
        .from(schema.subscriptionPolicies)
        .where(whereClause)
        .orderBy(desc(schema.subscriptionPolicies.createdAt))
        .limit(limit)
        .offset(offset);

      // 성능 최적화: 티어 정보를 한 번에 조회
      const tierIds = policies
        .map((policy) => policy.tierId)
        .filter((tierId): tierId is string => tierId !== null);

      const tiers =
        tierIds.length > 0
          ? await this.dbService.db
              .select()
              .from(schema.subscriptionTiers)
              .where(eq(schema.subscriptionTiers.id, tierIds[0])) // TODO: Use inArray when available
          : [];

      const tierMap = new Map(tiers.map((tier) => [tier.id, tier]));

      // 티어 정보 포함하여 응답 구성
      const policiesWithTierInfo = policies.map((policy) => {
        let tierInfo: TierInfo | undefined = undefined;
        if (policy.tierId) {
          const tier = tierMap.get(policy.tierId);
          if (tier) {
            tierInfo = {
              id: tier.id,
              code: tier.code,
              name: tier.name,
              priorityLevel: tier.priorityLevel,
            };
          }
        }

        return {
          id: policy.id,
          ruleType: policy.ruleType,
          ruleValue: policy.ruleValue as Record<string, any>,
          tierId: policy.tierId || undefined,
          tierInfo,
          isActive: policy.isActive,
          validFrom: policy.validFrom || undefined,
          validUntil: policy.validUntil || undefined,
          createdAt:
            policy.createdAt?.toISOString() || new Date().toISOString(),
          updatedAt:
            policy.updatedAt?.toISOString() || new Date().toISOString(),
        };
      });

      return {
        policies: policiesWithTierInfo,
        total,
        page,
        limit,
      };
    } catch (error) {
      this.logger.error('Failed to get all policies:', error);
      throw error;
    }
  }

  /**
   * 특정 정책을 ID로 조회합니다.
   *
   * @param policyId - 조회할 정책의 UUID
   * @returns 정책 정보 또는 null (정책이 존재하지 않는 경우)
   * @throws {Error} 데이터베이스 조회 실패 시
   */
  async getPolicyById(policyId: string): Promise<PolicyResponse | null> {
    try {
      const policy = await this.dbService.db
        .select()
        .from(schema.subscriptionPolicies)
        .where(eq(schema.subscriptionPolicies.id, policyId))
        .limit(1)
        .then((results) => results[0] || null);

      if (!policy || !policy.id) {
        return null;
      }

      // 티어 정보 조회
      let tierInfo: TierInfo | undefined = undefined;
      if (policy.tierId) {
        const tier = await this.dbService.db
          .select()
          .from(schema.subscriptionTiers)
          .where(eq(schema.subscriptionTiers.id, policy.tierId))
          .limit(1)
          .then((results) => results[0] || null);

        if (tier) {
          tierInfo = {
            id: tier.id,
            code: tier.code,
            name: tier.name,
            priorityLevel: tier.priorityLevel,
          };
        }
      }

      return {
        id: policy.id,
        ruleType: policy.ruleType,
        ruleValue: policy.ruleValue as Record<string, any>,
        tierId: policy.tierId || undefined,
        tierInfo,
        isActive: policy.isActive,
        validFrom: policy.validFrom || undefined,
        validUntil: policy.validUntil || undefined,
        createdAt: policy.createdAt?.toISOString() || new Date().toISOString(),
        updatedAt: policy.updatedAt?.toISOString() || new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`Failed to get policy ${policyId}:`, error);
      throw error;
    }
  }

  /**
   * 새로운 정책을 생성합니다.
   *
   * @param createPolicyDto - 생성할 정책 정보
   * @param createPolicyDto.ruleType - 정책 규칙 타입
   * @param createPolicyDto.ruleValue - 정책 규칙 값
   * @param createPolicyDto.tierId - 적용할 티어 ID (선택사항, null이면 전체 티어에 적용)
   * @param createPolicyDto.validFrom - 정책 유효 시작일 (선택사항)
   * @param createPolicyDto.validUntil - 정책 유효 종료일 (선택사항)
   * @returns 생성된 정책 정보
   * @throws {BadRequestException} 입력값 검증 실패 또는 중복 정책 존재 시
   * @throws {Error} 데이터베이스 작업 실패 시
   */
  async createPolicy(
    createPolicyDto: CreatePolicyRequest,
  ): Promise<PolicyResponse | null> {
    try {
      // 입력 검증
      await this.validatePolicyInput(createPolicyDto);

      // 중복 정책 확인
      await this.checkDuplicatePolicy(createPolicyDto);

      // 정책 생성
      const newPolicy = await this.dbService.db
        .insert(schema.subscriptionPolicies)
        .values({
          ruleType: createPolicyDto.ruleType,
          ruleValue: createPolicyDto.ruleValue,
          tierId: createPolicyDto.tierId || null,
          validFrom: createPolicyDto.validFrom || null,
          validUntil: createPolicyDto.validUntil || null,
          isActive: true,
        })
        .returning()
        .then((results) => results[0]);

      this.logger.log(`Policy created: ${newPolicy.id}`);

      // 생성된 정책 조회하여 반환
      return this.getPolicyById(newPolicy.id);
    } catch (error) {
      this.logger.error('Failed to create policy:', error);
      throw error;
    }
  }

  /**
   * 기존 정책을 업데이트합니다.
   */
  async updatePolicy(
    policyId: string,
    updatePolicyDto: UpdatePolicyRequest,
  ): Promise<PolicyResponse | null> {
    try {
      // 기존 정책 존재 확인
      const existingPolicy = await this.getPolicyById(policyId);
      if (!existingPolicy) {
        throw new NotFoundException(`Policy with ID ${policyId} not found`);
      }

      // 업데이트할 필드 구성

      const updateData = {
        updatedAt: new Date(),
        ...(updatePolicyDto.ruleValue !== undefined && {
          ruleValue: updatePolicyDto.ruleValue,
        }),
        ...(updatePolicyDto.isActive !== undefined && {
          isActive: updatePolicyDto.isActive,
        }),
        ...(updatePolicyDto.validFrom !== undefined && {
          validFrom: updatePolicyDto.validFrom || null,
        }),
        ...(updatePolicyDto.validUntil !== undefined && {
          validUntil: updatePolicyDto.validUntil || null,
        }),
      };

      // 정책 업데이트
      await this.dbService.db
        .update(schema.subscriptionPolicies)
        .set(updateData)
        .where(eq(schema.subscriptionPolicies.id, policyId));

      this.logger.log(`Policy updated: ${policyId}`);

      // 업데이트된 정책 조회하여 반환
      return this.getPolicyById(policyId);
    } catch (error) {
      this.logger.error(`Failed to update policy ${policyId}:`, error);
      throw error;
    }
  }

  /**
   * 정책을 비활성화합니다.
   */
  async deactivatePolicy(
    policyId: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      // 기존 정책 존재 확인
      const existingPolicy = await this.getPolicyById(policyId);
      if (!existingPolicy) {
        throw new NotFoundException(`Policy with ID ${policyId} not found`);
      }

      if (!existingPolicy.isActive) {
        return {
          success: true,
          message: 'Policy is already inactive',
        };
      }

      // 정책 비활성화
      await this.dbService.db
        .update(schema.subscriptionPolicies)
        .set({
          isActive: false,
          updatedAt: new Date(),
        })
        .where(eq(schema.subscriptionPolicies.id, policyId));

      this.logger.log(`Policy deactivated: ${policyId}`);

      return {
        success: true,
        message: 'Policy successfully deactivated',
      };
    } catch (error) {
      this.logger.error(`Failed to deactivate policy ${policyId}:`, error);
      throw error;
    }
  }

  /**
   * 정책 입력값을 검증합니다.
   */
  private async validatePolicyInput(input: CreatePolicyRequest): Promise<void> {
    // 티어 ID 검증
    if (input.tierId) {
      const tier = await this.dbService.db
        .select()
        .from(schema.subscriptionTiers)
        .where(eq(schema.subscriptionTiers.id, input.tierId))
        .limit(1)
        .then((results) => results[0] || null);

      if (!tier) {
        throw new BadRequestException(`Tier with ID ${input.tierId} not found`);
      }
    }

    // 날짜 검증
    if (input.validFrom && input.validUntil) {
      const fromDate = new Date(input.validFrom);
      const untilDate = new Date(input.validUntil);

      if (fromDate >= untilDate) {
        throw new BadRequestException(
          'validFrom must be earlier than validUntil',
        );
      }
    }

    // 정책 값 검증
    this.validatePolicyRuleValue(input.ruleType, input.ruleValue);
  }

  /**
   * 정책 규칙 값을 검증합니다.
   */
  private validatePolicyRuleValue(
    ruleType: string,
    ruleValue: Record<string, any>,
  ): void {
    switch (ruleType) {
      case 'MAX_PAUSES_PER_YEAR':
        if (
          !ruleValue.maxPauses ||
          typeof ruleValue.maxPauses !== 'number' ||
          ruleValue.maxPauses < 0
        ) {
          throw new BadRequestException(
            'MAX_PAUSES_PER_YEAR requires positive maxPauses number',
          );
        }
        break;

      case 'MIN_PAUSE_DURATION_DAYS':
        if (
          !ruleValue.minDays ||
          typeof ruleValue.minDays !== 'number' ||
          ruleValue.minDays < 1
        ) {
          throw new BadRequestException(
            'MIN_PAUSE_DURATION_DAYS requires positive minDays number',
          );
        }
        break;

      case 'MAX_PAUSE_DURATION_DAYS':
        if (
          !ruleValue.maxDays ||
          typeof ruleValue.maxDays !== 'number' ||
          ruleValue.maxDays < 1
        ) {
          throw new BadRequestException(
            'MAX_PAUSE_DURATION_DAYS requires positive maxDays number',
          );
        }
        break;

      case 'PAUSE_COOLDOWN_DAYS':
        if (
          !ruleValue.cooldownDays ||
          typeof ruleValue.cooldownDays !== 'number' ||
          ruleValue.cooldownDays < 0
        ) {
          throw new BadRequestException(
            'PAUSE_COOLDOWN_DAYS requires non-negative cooldownDays number',
          );
        }
        break;

      default:
        // 다른 정책 타입들은 기본적인 객체 검증만 수행
        if (!ruleValue || typeof ruleValue !== 'object') {
          throw new BadRequestException('ruleValue must be a valid object');
        }
        break;
    }
  }

  /**
   * 중복 정책을 확인합니다.
   */
  private async checkDuplicatePolicy(
    input: CreatePolicyRequest,
  ): Promise<void> {
    const existingPolicy = await this.dbService.db
      .select()
      .from(schema.subscriptionPolicies)
      .where(
        and(
          eq(schema.subscriptionPolicies.ruleType, input.ruleType as any),
          input.tierId
            ? eq(schema.subscriptionPolicies.tierId, input.tierId)
            : isNull(schema.subscriptionPolicies.tierId),
          eq(schema.subscriptionPolicies.isActive, true),
        ),
      )
      .limit(1)
      .then((results) => results[0] || null);

    if (existingPolicy) {
      const tierInfo = input.tierId ? `for tier ${input.tierId}` : 'globally';
      throw new BadRequestException(
        `Active policy of type ${input.ruleType} already exists ${tierInfo}`,
      );
    }
  }

  // =================================================================
  // 정책 버전 관리 메서드들
  // =================================================================

  /**
   * 정책의 새 버전을 생성합니다.
   */
  async createPolicyVersion(
    policyId: string,
    changes: {
      ruleValue: Record<string, any>;
      changeReason?: string;
      changedBy?: string;
    },
  ): Promise<PolicyResponse | null> {
    try {
      // 기존 정책 확인
      const existingPolicy = await this.getPolicyById(policyId);
      if (!existingPolicy) {
        throw new NotFoundException(`Policy with ID ${policyId} not found`);
      }

      // 변경사항이 있는지 확인
      const hasChanges =
        JSON.stringify(existingPolicy.ruleValue) !==
        JSON.stringify(changes.ruleValue);
      if (!hasChanges) {
        throw new BadRequestException(
          'No changes detected in policy rule value',
        );
      }

      // 기존 정책을 비활성화하고 새 버전 생성
      await this.dbService.db.transaction(async (tx) => {
        // 기존 정책 비활성화
        await tx
          .update(schema.subscriptionPolicies)
          .set({ isActive: false, updatedAt: new Date() })
          .where(eq(schema.subscriptionPolicies.id, policyId));

        // 새 버전 생성
        const insertValues = {
          ruleType: existingPolicy.ruleType as any,
          ruleValue: changes.ruleValue,
          tierId: existingPolicy.tierId || null,
          validFrom: existingPolicy.validFrom || null,
          validUntil: existingPolicy.validUntil || null,
          isActive: true,
        };

        await tx.insert(schema.subscriptionPolicies).values(insertValues);
      });

      this.logger.log(`Policy version created for policy: ${policyId}`);

      // 새로 생성된 정책 조회
      const newPolicy = await this.dbService.db
        .select()
        .from(schema.subscriptionPolicies)
        .where(
          and(
            eq(
              schema.subscriptionPolicies.ruleType,
              existingPolicy.ruleType as any,
            ),
            existingPolicy.tierId
              ? eq(schema.subscriptionPolicies.tierId, existingPolicy.tierId)
              : isNull(schema.subscriptionPolicies.tierId),
            eq(schema.subscriptionPolicies.isActive, true),
          ),
        )
        .orderBy(desc(schema.subscriptionPolicies.createdAt))
        .limit(1)
        .then((results) => results[0]);

      return newPolicy ? this.getPolicyById(newPolicy.id) : null;
    } catch (error) {
      this.logger.error(
        `Failed to create policy version for ${policyId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * 정책의 모든 버전을 조회합니다.
   */
  async getPolicyVersions(policyId: string): Promise<PolicyVersion[]> {
    try {
      // 기준 정책 조회
      const basePolicy = await this.getPolicyById(policyId);
      if (!basePolicy) {
        throw new NotFoundException(`Policy with ID ${policyId} not found`);
      }

      // 동일한 타입과 티어의 모든 정책 버전 조회
      const allVersions = await this.dbService.db
        .select()
        .from(schema.subscriptionPolicies)
        .where(
          and(
            eq(schema.subscriptionPolicies.ruleType, basePolicy.ruleType),
            basePolicy.tierId
              ? eq(schema.subscriptionPolicies.tierId, basePolicy.tierId)
              : isNull(schema.subscriptionPolicies.tierId),
          ),
        )
        .orderBy(desc(schema.subscriptionPolicies.createdAt));

      // 버전 번호 할당 (최신이 1번)
      return allVersions.map((policy, index) => ({
        id: policy.id,
        version: index + 1,
        ruleValue: policy.ruleValue as Record<string, any>,
        changeReason: undefined, // 현재 스키마에는 없음
        changedBy: undefined, // 현재 스키마에는 없음
        isActive: policy.isActive,
        createdAt: policy.createdAt,
        updatedAt: policy.updatedAt,
      }));
    } catch (error) {
      this.logger.error(
        `Failed to get policy versions for ${policyId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * 정책을 특정 버전으로 롤백합니다.
   */
  async rollbackToVersion(
    policyId: string,
    targetVersion: number,
  ): Promise<PolicyResponse | null> {
    try {
      // 모든 버전 조회
      const versions = await this.getPolicyVersions(policyId);
      if (versions.length === 0) {
        throw new NotFoundException(`No versions found for policy ${policyId}`);
      }

      // 대상 버전 찾기
      const targetVersionData = versions.find(
        (v) => v.version === targetVersion,
      );
      if (!targetVersionData) {
        throw new NotFoundException(
          `Version ${targetVersion} not found for policy ${policyId}`,
        );
      }

      // 이미 활성 버전인지 확인
      if (targetVersionData.isActive) {
        throw new BadRequestException(
          `Version ${targetVersion} is already active`,
        );
      }

      // 현재 정책 정보 조회
      const currentPolicy = await this.getPolicyById(policyId);
      if (!currentPolicy) {
        throw new NotFoundException(`Policy with ID ${policyId} not found`);
      }

      // 롤백 실행
      await this.dbService.db.transaction(async (tx) => {
        // 모든 버전 비활성화
        await tx
          .update(schema.subscriptionPolicies)
          .set({ isActive: false, updatedAt: new Date() })
          .where(
            and(
              eq(
                schema.subscriptionPolicies.ruleType,
                currentPolicy.ruleType as any,
              ),
              currentPolicy.tierId
                ? eq(schema.subscriptionPolicies.tierId, currentPolicy.tierId)
                : isNull(schema.subscriptionPolicies.tierId),
            ),
          );

        // 대상 버전 활성화
        await tx
          .update(schema.subscriptionPolicies)
          .set({ isActive: true, updatedAt: new Date() })
          .where(eq(schema.subscriptionPolicies.id, targetVersionData.id));
      });

      this.logger.log(
        `Policy ${policyId} rolled back to version ${targetVersion}`,
      );

      return this.getPolicyById(targetVersionData.id);
    } catch (error) {
      this.logger.error(
        `Failed to rollback policy ${policyId} to version ${targetVersion}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * 두 정책 버전을 비교합니다.
   */
  async comparePolicyVersions(
    policyId: string,
    version1: number,
    version2: number,
  ): Promise<PolicyVersionComparison> {
    try {
      const versions = await this.getPolicyVersions(policyId);

      const v1 = versions.find((v) => v.version === version1);
      const v2 = versions.find((v) => v.version === version2);

      if (!v1) {
        throw new NotFoundException(`Version ${version1} not found`);
      }
      if (!v2) {
        throw new NotFoundException(`Version ${version2} not found`);
      }

      // 차이점 분석
      const differences = this.findPolicyDifferences(
        v1.ruleValue,
        v2.ruleValue,
      );

      return {
        policyId,
        version1: v1,
        version2: v2,
        differences,
      };
    } catch (error) {
      this.logger.error(`Failed to compare policy versions:`, error);
      throw error;
    }
  }

  /**
   * 정책 값의 차이점을 찾습니다.
   */
  private findPolicyDifferences(
    value1: Record<string, any>,
    value2: Record<string, any>,
  ): Array<{ field: string; oldValue: any; newValue: any }> {
    const differences: Array<{ field: string; oldValue: any; newValue: any }> =
      [];

    // 모든 키 수집
    const allKeys = new Set([...Object.keys(value1), ...Object.keys(value2)]);

    for (const key of allKeys) {
      const oldValue = value1[key];
      const newValue = value2[key];

      if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        differences.push({
          field: key,
          oldValue,
          newValue,
        });
      }
    }

    return differences;
  }

  /**
   * 정책 변경 이력을 조회합니다.
   */
  async getPolicyChangeHistory(policyId: string): Promise<
    Array<{
      version: number;
      changedAt: Date;
      changes: Array<{ field: string; oldValue: any; newValue: any }>;
    }>
  > {
    try {
      const versions = await this.getPolicyVersions(policyId);
      if (versions.length <= 1) {
        return [];
      }

      const history: Array<{
        version: number;
        changedAt: Date;
        changes: Array<{ field: string; oldValue: any; newValue: any }>;
      }> = [];

      for (let i = 0; i < versions.length - 1; i++) {
        const currentVersion = versions[i];
        const previousVersion = versions[i + 1];

        const changes = this.findPolicyDifferences(
          previousVersion.ruleValue,
          currentVersion.ruleValue,
        );

        if (changes.length > 0) {
          history.push({
            version: currentVersion.version,
            changedAt: currentVersion.createdAt,
            changes,
          });
        }
      }

      return history;
    } catch (error) {
      this.logger.error(
        `Failed to get policy change history for ${policyId}:`,
        error,
      );
      throw error;
    }
  }
}

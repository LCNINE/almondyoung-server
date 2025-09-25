import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { DbService } from '@app/db';
import { eq, and, isNull, desc, SQL } from 'drizzle-orm';
import * as schema from '../shared/schemas/entities/schema';
import type {
  Policy,
  PolicyListResponse,
  CreatePolicyRequest,
  UpdatePolicyRequest,
  GetPoliciesQuery,
} from '../shared/schemas';

/**
 * 정책의 CRUD 작업만 담당하는 서비스
 * 관리자가 정책을 생성, 수정, 조회, 삭제하는 기능 제공
 */
@Injectable()
export class PolicyManagementService {
  constructor(private readonly dbService: DbService<typeof schema>) {}

  /**
   * 새로운 정책을 생성합니다.
   */
  async createPolicy(dto: CreatePolicyRequest): Promise<Policy> {
    // 간단한 중복 체크: 동일 타입, 동일 티어에 활성 정책이 있는지 확인
    const existing =
      await this.dbService.db.query.subscriptionPolicies.findFirst({
        where: and(
          eq(schema.subscriptionPolicies.ruleType, dto.ruleType),
          dto.tierId
            ? eq(schema.subscriptionPolicies.tierId, dto.tierId)
            : isNull(schema.subscriptionPolicies.tierId),
          eq(schema.subscriptionPolicies.isActive, true),
        ),
      });

    if (existing) {
      throw new BadRequestException(
        `Active policy of type ${dto.ruleType} already exists for the specified tier.`,
      );
    }

    const [newPolicy] = await this.dbService.db
      .insert(schema.subscriptionPolicies)
      .values(dto)
      .returning();

    return newPolicy;
  }

  /**
   * 정책 ID로 단일 정책을 조회합니다.
   */
  async getPolicyById(policyId: string): Promise<Policy> {
    const policy = await this.dbService.db.query.subscriptionPolicies.findFirst(
      {
        where: eq(schema.subscriptionPolicies.id, policyId),
      },
    );

    if (!policy) {
      throw new NotFoundException(`Policy with ID ${policyId} not found.`);
    }

    return policy;
  }

  /**
   * 필터 조건에 따라 정책 목록을 조회합니다.
   */
  async getAllPolicies(query: GetPoliciesQuery): Promise<PolicyListResponse> {
    const { ruleType, tierId, isActive = true, page = 1, limit = 20 } = query;
    const conditions: SQL[] = [];

    if (ruleType) {
      conditions.push(eq(schema.subscriptionPolicies.ruleType, ruleType));
    }
    if (tierId) {
      conditions.push(eq(schema.subscriptionPolicies.tierId, tierId));
    }
    conditions.push(eq(schema.subscriptionPolicies.isActive, isActive));

    const result = await this.dbService.db.query.subscriptionPolicies.findMany({
      where: and(...conditions),
      orderBy: [desc(schema.subscriptionPolicies.createdAt)],
      limit: limit,
      offset: (page - 1) * limit,
    });

    // 실제로는 총 개수를 별도 쿼리로 조회해야 하지만, 여기서는 간소화
    return {
      policies: result,
      total: result.length,
      page,
      limit,
    };
  }

  /**
   * 기존 정책을 업데이트합니다.
   */
  async updatePolicy(
    policyId: string,
    dto: UpdatePolicyRequest,
  ): Promise<Policy> {
    const [updatedPolicy] = await this.dbService.db
      .update(schema.subscriptionPolicies)
      .set({
        ...dto,
        updatedAt: new Date(),
      })
      .where(eq(schema.subscriptionPolicies.id, policyId))
      .returning();

    if (!updatedPolicy) {
      throw new NotFoundException(`Policy with ID ${policyId} not found.`);
    }

    return updatedPolicy;
  }

  /**
   * 정책을 비활성화합니다.
   */
  async deactivatePolicy(policyId: string): Promise<{ success: boolean }> {
    await this.updatePolicy(policyId, { isActive: false });
    return { success: true };
  }

  /**
   * 정책을 활성화합니다.
   */
  async activatePolicy(policyId: string): Promise<{ success: boolean }> {
    await this.updatePolicy(policyId, { isActive: true });
    return { success: true };
  }

  /**
   * 정책을 삭제합니다 (하드 삭제).
   * 주의: 감사 로그를 위해 실제로는 소프트 삭제를 권장합니다.
   */
  async deletePolicy(policyId: string): Promise<{ success: boolean }> {
    const result = await this.dbService.db
      .delete(schema.subscriptionPolicies)
      .where(eq(schema.subscriptionPolicies.id, policyId))
      .returning();

    if (result.length === 0) {
      throw new NotFoundException(`Policy with ID ${policyId} not found.`);
    }

    return { success: true };
  }
}

import { Injectable } from '@nestjs/common';
import { MembershipMappingsRepository } from '../repositories/membership-mappings.repository';
import {
  MembershipMapping,
  NewMembershipMapping,
  UpdateMembershipMapping,
  DbTransaction,
} from '../types';
import {
  CreateMembershipMappingDto,
  UpdateMembershipMappingDto,
  MembershipPriceCalculationType,
} from '../schemas/membership-pricing.schema';

export interface PricingContext {
  userId?: string;
  membershipTierId?: string;
  masterId: string;
  variantId?: string;
  requestTime: Date;
}

@Injectable()
export class MembershipPricingService {
  constructor(
    private readonly mappingsRepository: MembershipMappingsRepository,
  ) {}

  /**
   * 멤버십 매핑 생성 (프론트엔드에서 티어 검증 완료 전제)
   */
  async createMapping(
    scope: 'master' | 'variant',
    targetId: string,
    dto: CreateMembershipMappingDto,
    tx?: DbTransaction,
  ): Promise<MembershipMapping> {
    // 1. 중복 매핑 확인
    const existingMapping = await this.mappingsRepository.findByTargetAndTier(
      scope,
      targetId,
      dto.membershipTierId,
      tx,
    );
    if (existingMapping) {
      throw new Error('Mapping already exists for this tier');
    }

    // 2. 타겟 존재 확인 (master 또는 variant)
    await this.validateTarget(scope, targetId, tx);

    // 3. 매핑 생성 (프론트에서 검증된 티어 ID 그대로 저장)
    const mappingData: Partial<NewMembershipMapping> = {
      ...(scope === 'master'
        ? { masterId: targetId }
        : { variantId: targetId }),
      membershipTierId: dto.membershipTierId,
      price: dto.price || null,
      discount: dto.discount || null,
      visibilityOnly: dto.visibilityOnly,
      validFrom: dto.validFrom ? new Date(dto.validFrom) : new Date(),
      validTo: dto.validTo ? new Date(dto.validTo) : null,
    };

    return await this.mappingsRepository.create(mappingData, tx);
  }

  /**
   * 멤버십 매핑 수정
   */
  async updateMapping(
    id: string,
    dto: UpdateMembershipMappingDto,
    tx?: DbTransaction,
  ): Promise<MembershipMapping> {
    // 매핑 존재 확인
    const existingMapping = await this.mappingsRepository.findById(id, tx);
    if (!existingMapping) {
      throw new Error(`Membership mapping not found: ${id}`);
    }

    const updateData: UpdateMembershipMapping = {
      price: dto.price,
      discount: dto.discount,
      visibilityOnly: dto.visibilityOnly,
      validFrom: dto.validFrom ? new Date(dto.validFrom) : undefined,
      validTo: dto.validTo ? new Date(dto.validTo) : undefined,
    };

    return await this.mappingsRepository.update(id, updateData, tx);
  }

  /**
   * 멤버십 매핑 삭제
   */
  async deleteMapping(id: string, tx?: DbTransaction): Promise<void> {
    await this.mappingsRepository.delete(id, tx);
  }

  /**
   * 대상별 매핑 목록 조회
   */
  async getMappings(
    scope: 'master' | 'variant',
    targetId: string,
    tx?: DbTransaction,
  ): Promise<MembershipMapping[]> {
    return await this.mappingsRepository.findByTarget(scope, targetId, tx);
  }

  /**
   * 멤버십 가격 계산 (간소화된 버전 - 티어 정보는 프론트에서 처리)
   */
  async calculateMembershipPrice(context: PricingContext): Promise<{
    originalPrice: number;
    membershipPrice: number;
    discount?: number;
    discountAmount: number;
    policyApplied: MembershipMapping | null;
  }> {
    // 1. 기본 가격 계산
    const originalPrice = await this.calculateOriginalPrice(context);

    // 2. 멤버십 티어가 없으면 원래 가격 반환
    if (!context.membershipTierId) {
      return {
        originalPrice,
        membershipPrice: originalPrice,
        discountAmount: 0,
        policyApplied: null,
      };
    }

    // 3. 적용 가능한 멤버십 매핑 조회
    const applicableMapping = await this.findApplicableMapping(context);

    if (!applicableMapping) {
      return {
        originalPrice,
        membershipPrice: originalPrice,
        discountAmount: 0,
        policyApplied: null,
      };
    }

    // 4. 멤버십 가격 계산
    const membershipPrice = this.calculateFinalPrice(
      originalPrice,
      applicableMapping,
    );
    const discountAmount = originalPrice - membershipPrice;

    return {
      originalPrice,
      membershipPrice,
      discount: applicableMapping.discount || undefined,
      discountAmount,
      policyApplied: applicableMapping,
    };
  }

  /**
   * 상품 가시성 확인 (단순화 - 프론트엔드에서 주로 처리)
   */
  async checkProductVisibility(
    masterId: string,
    membershipTierId?: string,
  ): Promise<{
    visible: boolean;
    reason?: string;
    hasVisibilityPolicy: boolean;
    requiredTierIds: string[];
  }> {
    const visibilityMappings =
      await this.mappingsRepository.findVisibilityMappings(masterId);

    if (visibilityMappings.length === 0) {
      return {
        visible: true,
        hasVisibilityPolicy: false,
        requiredTierIds: [],
      }; // 가시성 정책이 없으면 모든 사용자에게 표시
    }

    const requiredTierIds = visibilityMappings.map((m) => m.membershipTierId);

    if (!membershipTierId) {
      return {
        visible: false,
        reason: '멤버십 전용 상품입니다',
        hasVisibilityPolicy: true,
        requiredTierIds,
      };
    }

    // 단순히 티어 ID가 필요한 목록에 있는지만 확인
    const hasAccess = requiredTierIds.includes(membershipTierId);

    return {
      visible: hasAccess,
      reason: hasAccess ? undefined : '멤버십 등급이 부족합니다',
      hasVisibilityPolicy: true,
      requiredTierIds,
    };
  }

  /**
   * 페이징된 매핑 목록 조회
   */
  async getPaginatedMappings(
    scope?: 'master' | 'variant',
    targetId?: string,
    membershipTierId?: string,
    page = 1,
    limit = 20,
  ): Promise<{
    data: MembershipMapping[];
    total: number;
    page: number;
    limit: number;
  }> {
    return await this.mappingsRepository.findPaginated({
      scope,
      targetId,
      membershipTierId,
      page,
      limit,
    });
  }

  // Private Methods

  private async calculateOriginalPrice(
    context: PricingContext,
  ): Promise<number> {
    // TODO: 실제 가격 계산 로직 구현
    // PricingStrategyFactory를 사용하여 계산
    if (context.variantId) {
      // Variant 기반 가격 계산
      return 50000; // 임시값
    } else {
      // Master 기반 가격 계산
      return 45000; // 임시값
    }
  }

  private async findApplicableMapping(
    context: PricingContext,
  ): Promise<MembershipMapping | null> {
    const now = context.requestTime;

    // 1. Variant 레벨 매핑 우선 확인
    if (context.variantId && context.membershipTierId) {
      const variantMapping = await this.mappingsRepository.findActiveMapping(
        'variant',
        context.variantId,
        context.membershipTierId,
        now,
      );
      if (variantMapping) return variantMapping;
    }

    // 2. Master 레벨 매핑 확인
    if (context.membershipTierId) {
      const masterMapping = await this.mappingsRepository.findActiveMapping(
        'master',
        context.masterId,
        context.membershipTierId,
        now,
      );
      return masterMapping;
    }

    return null;
  }

  private calculateFinalPrice(
    originalPrice: number,
    mapping: MembershipMapping,
  ): number {
    if (mapping.price !== null) {
      return mapping.price; // 고정 가격
    }

    if (mapping.discount !== null) {
      return Math.round(originalPrice * (1 - mapping.discount / 100)); // 할인율 적용
    }

    return originalPrice; // 가시성 전용인 경우
  }

  private async validateTarget(
    scope: 'master' | 'variant',
    targetId: string,
    tx?: DbTransaction,
  ): Promise<void> {
    // TODO: ProductMaster 또는 ProductVariant 존재 확인 로직
    // 실제 구현에서는 해당 repository를 통해 확인
    // 임시로 통과 (관리자 페이지에서 유효한 ID만 전송된다고 가정)
  }
}

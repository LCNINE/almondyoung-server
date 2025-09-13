// payment-profile-v2.service.ts - 정규화된 스키마용 서비스
import { Injectable, Inject } from '@nestjs/common';

import { eq, and } from 'drizzle-orm';
import { generateUUIDv7 } from '../shared/utils/id-generator';
import { getTsid } from 'tsid-ts';

import { DbService } from '@app/db';
import * as schema from '../shared/database/schema';
import {
  PaymentProfileCreateV2RequestDto,
  PaymentProfileV2ResponseDto,
  PaymentProfileStatusUpdateDto,
  CmsStatusUpdateDto,
} from '../shared/dtos/payment-profile-v2.dto';
import {
  maskPhone,
  extractCardLast4,
  maskPayerName,
  getCardBrand,
  generateProfileName,
} from '../shared/utils/masking.util';

@Injectable()
export class PaymentProfileV2Service {
  constructor(private readonly dbService: DbService) {}

  /**
   * 결제프로필 생성 (정규화된 구조)
   */
  async createProfile(
    dto: PaymentProfileCreateV2RequestDto,
  ): Promise<PaymentProfileV2ResponseDto> {
    const profileId = generateUUIDv7();
    const memberId = getTsid().toString().slice(0, 20); // 20자로 제한

    await this.dbService.db.transaction(async (tx) => {
      // 1. 공통 결제프로필 생성
      // 신용카드(CARD)는 실시간이므로 즉시 ACTIVE, CMS 배치(BATCH)는 승인 대기로 PENDING
      const initialStatus = dto.kind === 'CARD' ? 'ACTIVE' : 'PENDING';

      const [baseProfile] = await tx
        .insert(schema.paymentProfiles)
        .values({
          id: profileId,
          userId: dto.userId,
          kind: dto.kind,
          status: initialStatus,
          name:
            dto.name ||
            generateProfileName(
              dto.kind,
              undefined,
              undefined,
              dto.paymentCompany,
            ),
        })
        .returning();

      // 2. 종류별 상세 프로필 생성 및 HMS 등록
      if (dto.kind === 'CARD') {
        await this.createCardProfile(tx, profileId, memberId, dto);
      } else {
        await this.createBatchProfile(tx, profileId, memberId, dto);
      }
    });

    // 3. 트랜잭션 완료 후 프로필 조회 및 반환
    return this.getProfileById(profileId);
  }

  /**
   * 카드 프로필 생성 및 HMS 등록 (Provider 기반)
   */
  private async createCardProfile(
    tx: any,
    profileId: string,
    memberId: string,
    dto: PaymentProfileCreateV2RequestDto,
  ): Promise<void> {
    // HMS 카드 등록 (Mock 환경에서는 시뮬레이션, Test 환경에서는 실제 API 호출)
    const hmsResult = {
      success: true,
      hmsMemberId: memberId,
      message: 'HMS 카드 프로필 등록 성공 (Mock/Test)',
    };

    // 마스킹된 정보로 카드 프로필 생성
    await tx.insert(schema.cmsCardProfiles).values({
      id: profileId,
      memberId,
      cmsStatus: hmsResult.success ? 'REGISTERED' : 'FAILED',
      paymentCompany: dto.paymentCompany,
      cardLast4: dto.paymentNumber
        ? extractCardLast4(dto.paymentNumber)
        : undefined,
      cardBrand: dto.paymentCompany
        ? getCardBrand(dto.paymentCompany)
        : undefined,
      payerName: dto.payerName ? maskPayerName(dto.payerName) : undefined,
      phoneMask: dto.phone ? maskPhone(dto.phone) : undefined,
    });

    if (!hmsResult.success) {
      throw new Error(
        `HMS 카드 프로필 등록 실패: ${hmsResult.message || '알 수 없는 오류'}`,
      );
    }
  }

  /**
   * 배치 프로필 생성 및 HMS 등록 (Mock)
   */
  private async createBatchProfile(
    tx: any,
    profileId: string,
    memberId: string,
    dto: PaymentProfileCreateV2RequestDto,
  ): Promise<void> {
    // Mock HMS 배치 등록 (실제 HMS 연동은 별도 구현)
    const hmsResult = {
      success: true,
      hmsMemberId: memberId,
      message: '성공(테스트)',
    };

    // 마스킹된 정보로 배치 프로필 생성
    await tx.insert(schema.cmsBatchProfiles).values({
      id: profileId,
      memberId,
      cmsStatus: hmsResult.success ? 'REGISTERED' : 'FAILED',
      paymentCompany: dto.paymentCompany,
      payerName: dto.payerName ? maskPayerName(dto.payerName) : undefined,
      phoneMask: dto.phone ? maskPhone(dto.phone) : undefined,
    });

    if (!hmsResult.success) {
      throw new Error(
        `HMS 배치 프로필 등록 실패: ${hmsResult.message || '알 수 없는 오류'}`,
      );
    }
  }

  /**
   * 프로필 조회 (ID로)
   */
  async getProfileById(
    profileId: string,
  ): Promise<PaymentProfileV2ResponseDto> {
    const baseProfile = await this.dbService.db
      .select()
      .from(schema.paymentProfiles)
      .where(eq(schema.paymentProfiles.id, profileId))
      .limit(1);

    if (!baseProfile.length) {
      throw new Error('프로필을 찾을 수 없습니다');
    }

    const profile = baseProfile[0];

    if (profile.kind === 'CARD') {
      const cardDetail = await this.dbService.db
        .select()
        .from(schema.cmsCardProfiles)
        .where(eq(schema.cmsCardProfiles.id, profileId))
        .limit(1);

      const card = cardDetail[0];
      return this.mapToResponseDto(profile, card);
    } else {
      const batchDetail = await this.dbService.db
        .select()
        .from(schema.cmsBatchProfiles)
        .where(eq(schema.cmsBatchProfiles.id, profileId))
        .limit(1);

      const batch = batchDetail[0];
      return this.mapToResponseDto(profile, batch);
    }
  }

  /**
   * 사용자별 프로필 목록 조회
   */
  async getProfilesByUserId(
    userId: string,
  ): Promise<PaymentProfileV2ResponseDto[]> {
    const profiles = await this.dbService.db
      .select()
      .from(schema.paymentProfiles)
      .where(eq(schema.paymentProfiles.userId, userId));

    const results: PaymentProfileV2ResponseDto[] = [];

    for (const profile of profiles) {
      if (profile.kind === 'CARD') {
        const cardDetail = await this.dbService.db
          .select()
          .from(schema.cmsCardProfiles)
          .where(eq(schema.cmsCardProfiles.id, profile.id))
          .limit(1);

        if (cardDetail.length) {
          results.push(this.mapToResponseDto(profile, cardDetail[0]));
        }
      } else {
        const batchDetail = await this.dbService.db
          .select()
          .from(schema.cmsBatchProfiles)
          .where(eq(schema.cmsBatchProfiles.id, profile.id))
          .limit(1);

        if (batchDetail.length) {
          results.push(this.mapToResponseDto(profile, batchDetail[0]));
        }
      }
    }

    return results;
  }

  /**
   * 프로필 상태 업데이트
   */
  async updateProfileStatus(
    profileId: string,
    dto: PaymentProfileStatusUpdateDto,
  ): Promise<PaymentProfileV2ResponseDto> {
    await this.dbService.db
      .update(schema.paymentProfiles)
      .set({
        status: dto.status,
        updatedAt: new Date(),
      })
      .where(eq(schema.paymentProfiles.id, profileId));

    return this.getProfileById(profileId);
  }

  /**
   * CMS 상태 업데이트 (내부용)
   */
  async updateCmsStatus(dto: CmsStatusUpdateDto): Promise<void> {
    // 카드 프로필 업데이트 시도
    const cardResult = await this.dbService.db
      .update(schema.cmsCardProfiles)
      .set({
        cmsStatus: dto.cmsStatus,
        updatedAt: new Date(),
      })
      .where(eq(schema.cmsCardProfiles.memberId, dto.memberId));

    // 배치 프로필 업데이트 시도 (카드 업데이트가 실패한 경우)
    // if (!cardResult.rowCount) { // rowCount 속성이 없으므로 주석 처리
    await this.dbService.db
      .update(schema.cmsBatchProfiles)
      .set({
        cmsStatus: dto.cmsStatus,
        updatedAt: new Date(),
      })
      .where(eq(schema.cmsBatchProfiles.memberId, dto.memberId));
    // }
  }

  /**
   * 프로필 삭제
   */
  async deleteProfile(profileId: string): Promise<void> {
    await this.dbService.db
      .delete(schema.paymentProfiles)
      .where(eq(schema.paymentProfiles.id, profileId));

    // CASCADE 설정으로 인해 상세 프로필도 자동 삭제됨
  }

  /**
   * 응답 DTO 매핑
   */
  private mapToResponseDto(
    baseProfile: any,
    detailProfile: any,
  ): PaymentProfileV2ResponseDto {
    return {
      profileId: baseProfile.id,
      userId: baseProfile.userId,
      provider: baseProfile.provider,
      kind: baseProfile.kind,
      status: baseProfile.status,
      name: baseProfile.name,
      createdAt: baseProfile.createdAt.toISOString(),
      updatedAt: baseProfile.updatedAt.toISOString(),
      memberId: detailProfile.memberId,
      cmsStatus: detailProfile.cmsStatus,
      paymentCompany: detailProfile.paymentCompany,
      cardLast4: detailProfile.cardLast4,
      cardBrand: detailProfile.cardBrand,
      payerName: detailProfile.payerName,
      phoneMask: detailProfile.phoneMask,
      billingDay: detailProfile.billingDay,
    };
  }
}

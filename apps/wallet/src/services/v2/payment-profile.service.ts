// services/v2/payment-profile.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { generateUUIDv7 } from '../../shared/utils/id-generator';
import { DbService } from '@app/db';
import * as schema from '../../shared/database/schema';
import {
  PaymentProfileCreateRequestDto,
  PaymentProfileResponseDto,
  UserPaymentProfilesResponseDto,
  PaymentProfileSummaryDto,
  PaymentProfileTypeDto,
  PaymentProfileStatusDto,
  PaymentProfilePurposeDto,
} from '../../shared/dtos/payment-profile.dto';
import { PaymentProviderFactory } from '../../providers/payment-provider.factory';
import { ProfileRegistrationRequest } from '../../providers/payment-provider.interface';

/**
 * Payment Profile Service v2
 *
 * 책임:
 * - 결제프로필 비즈니스 로직 처리
 * - HMS 연동 결제수단 등록/해지
 * - 프로필 상태 관리 및 검증
 * - 사용자별 프로필 관리
 */
@Injectable()
export class PaymentProfileService {
  private readonly logger = new Logger(PaymentProfileService.name);

  constructor(
    private readonly dbService: DbService<typeof schema>,
    private readonly providerFactory: PaymentProviderFactory,
  ) {}

  /**
   * 결제프로필 등록 (Provider 기반)
   */
  async createProfile(
    dto: PaymentProfileCreateRequestDto,
  ): Promise<PaymentProfileResponseDto> {
    this.logger.log(
      `결제프로필 등록 시작: userId=${dto.userId}, type=${dto.profileType}`,
    );

    // 1. 입력 검증
    await this.validateCreateRequest(dto);

    // 2. Provider 선택 및 HMS 등록 요청 데이터 구성
    const provider = this.getProviderForProfileType(dto.profileType);
    const profileRegistrationRequest: ProfileRegistrationRequest = {
      userId: dto.userId,
      profileType: dto.profileType,
      profileName: dto.profileName,

      // HMS 신용카드 API 필드 매핑 (callableSchema.ts 기준)
      paymentNumber: dto.paymentNumber, // 카드번호
      payerName: dto.payerName, // 카드 소유자명
      payerNumber: dto.payerNumber, // 생년월일
      validUntil: dto.validUntil, // 카드 유효기간 MMYY
      password: dto.password, // 비밀번호 앞 2자리

      // HMS 배치 CMS API 필드 매핑
      paymentCompany: dto.paymentCompany, // 은행 코드
      accountNumber: dto.accountNumber, // 계좌번호 (paymentNumber로도 사용)

      // BNPL 필드
      creditLimit: dto.creditLimit,
      billingCycleDay: dto.billingCycleDay,

      // 공통 필드
      phone: dto.phone,

      metadata: {
        paymentPurpose: dto.paymentPurpose,
        isDefault: dto.isDefault,
        // HMS API 추가 필드들
        smsFlag: 'Y', // SMS 발송 기본값
        joinDate: new Date().toISOString().slice(0, 10).replace(/-/g, ''), // YYYYMMDD
        paymentStartDate: new Date()
          .toISOString()
          .slice(0, 10)
          .replace(/-/g, ''),
        paymentEndDate: '99991231',
        paymentDay: '01',
        defaultAmount: 0,
      },
    };

    // 3. Provider를 통한 HMS 등록
    const registrationResult = await provider.registerProfile!(
      profileRegistrationRequest,
    );

    this.logger.log(
      `Provider 등록 결과: success=${registrationResult.success}, error=${registrationResult.error}`,
    );

    if (!registrationResult.success) {
      throw new Error(
        `결제프로필 등록 실패: ${registrationResult.error || '알 수 없는 오류'}`,
      );
    }

    // 4. 프로필 ID 생성 (HMS 응답 기반)
    const profileId = generateUUIDv7();

    // 5. DB 트랜잭션으로 프로필 저장
    const profile = await this.dbService.db.transaction(async (tx) => {
      // 5-1. 기본 프로필 설정 시 기존 기본값 해제
      if (dto.isDefault) {
        // isDefault 필드가 제거되었으므로 주석 처리
        // await tx
        //   .update(schema.paymentProfiles)
        //   .set({ isDefault: false, updatedAt: new Date() })
        //   .where(
        //     and(
        //       eq(schema.paymentProfiles.userId, dto.userId),
        //       eq(schema.paymentProfiles.isDefault, true),
        //     ),
        //   );
      }

      // 5-2. 새 프로필 생성 (DB 기본값 사용)
      let insertResult;
      try {
        insertResult = await tx.execute(sql`
          INSERT INTO payment_profiles (
            id, user_id, profile_type, profile_name,
            is_default, status, payment_purpose
          ) VALUES (
            ${profileId}, ${dto.userId}, ${dto.profileType}, ${dto.profileName},
            ${dto.isDefault}, ${'ACTIVE'}, ${dto.paymentPurpose}
          ) RETURNING *
        `);
      } catch (insertError: any) {
        const code = insertError?.code || insertError?.cause?.code;
        const detail = insertError?.detail || insertError?.cause?.detail;
        const constraint =
          insertError?.constraint || insertError?.cause?.constraint;
        const msg = [
          'payment_profiles insert failed',
          code && `code=${code}`,
          detail && `detail=${detail}`,
          constraint && `constraint=${constraint}`,
          `profileType=${dto.profileType}`,
          `userId=${dto.userId}`,
        ]
          .filter(Boolean)
          .join(' | ');
        throw new Error(msg);
      }

      const newProfile = insertResult[0] || {
        id: profileId,
        user_id: dto.userId,
        profile_type: dto.profileType,
        profile_name: dto.profileName,
        is_default: dto.isDefault,
        status: 'ACTIVE',
        payment_purpose: dto.paymentPurpose,
      };

      // 5-3. 타입별 추가 테이블 처리 (HMS 응답 포함)
      await this.createTypeSpecificProfile(
        tx,
        newProfile,
        dto,
        registrationResult,
      );

      return newProfile;
    });

    this.logger.log(
      `결제프로필 등록 완료: profileId=${profileId}, hmsMemberId=${registrationResult.hmsMemberId}`,
    );

    return this.mapToResponseDto(profile, registrationResult.hmsMemberId);
  }

  /**
   * 사용자 결제프로필 목록 조회
   */
  async getUserProfiles(
    userId: string,
    status?: string,
    profileType?: string,
  ): Promise<UserPaymentProfilesResponseDto> {
    this.logger.log(`사용자 결제프로필 목록 조회: userId=${userId}`);

    // 조건 구성
    const conditions = [eq(schema.paymentProfiles.userId, userId)];

    if (status) {
      conditions.push(eq(schema.paymentProfiles.status, status as any));
    }
    if (profileType) {
      conditions.push(eq(schema.paymentProfiles.kind, profileType as any));
    }

    // 프로필 목록 조회
    const profiles = await this.dbService.db
      .select()
      .from(schema.paymentProfiles)
      .where(and(...conditions))
      .orderBy(schema.paymentProfiles.createdAt);

    // 요약 정보 계산
    const summary: PaymentProfileSummaryDto = {
      totalCount: profiles.length,
      activeCount: profiles.filter((p) => p.status === 'ACTIVE').length,
      // defaultProfileId: profiles.find((p) => p.isDefault)?.id, // isDefault 필드 제거됨
    };

    return {
      userId,
      profiles: profiles.map((p) => this.mapToResponseDto(p)),
      summary,
    };
  }

  /**
   * 결제프로필 단건 조회
   */
  async getProfile(profileId: string): Promise<PaymentProfileResponseDto> {
    this.logger.log(`결제프로필 조회: profileId=${profileId}`);

    const profiles = await this.dbService.db
      .select()
      .from(schema.paymentProfiles)
      .where(eq(schema.paymentProfiles.id, profileId))
      .limit(1);

    if (profiles.length === 0) {
      throw new Error(`결제프로필을 찾을 수 없습니다: ${profileId}`);
    }

    return this.mapToResponseDto(profiles[0]);
  }

  /**
   * 결제프로필 상태 변경
   */
  async updateProfileStatus(
    profileId: string,
    status: string,
    reason?: string,
  ): Promise<PaymentProfileResponseDto> {
    this.logger.log(
      `결제프로필 상태 변경: profileId=${profileId}, status=${status}`,
    );

    // 상태 검증
    if (!Object.values(PaymentProfileStatusDto).includes(status as any)) {
      throw new Error(`잘못된 상태값입니다: ${status}`);
    }

    // 프로필 존재 확인 및 업데이트
    const [updatedProfile] = await this.dbService.db
      .update(schema.paymentProfiles)
      .set({
        status: status as any,
        updatedAt: new Date(),
        // metadata 필드 제거 (스키마에 없음)
      })
      .where(eq(schema.paymentProfiles.id, profileId))
      .returning();

    if (!updatedProfile) {
      throw new Error(`결제프로필을 찾을 수 없습니다: ${profileId}`);
    }

    this.logger.log(`결제프로필 상태 변경 완료: ${profileId} -> ${status}`);

    return this.mapToResponseDto(updatedProfile);
  }

  /**
   * 결제프로필 삭제
   */
  async deleteProfile(profileId: string, reason: string): Promise<void> {
    this.logger.log(`결제프로필 삭제: profileId=${profileId}`);

    // 프로필 존재 확인
    const profiles = await this.dbService.db
      .select()
      .from(schema.paymentProfiles)
      .where(eq(schema.paymentProfiles.id, profileId))
      .limit(1);

    if (profiles.length === 0) {
      throw new Error(`결제프로필을 찾을 수 없습니다: ${profileId}`);
    }

    const profile = profiles[0];

    // 트랜잭션으로 삭제 처리
    await this.dbService.db.transaction(async (tx) => {
      // 1. 타입별 연관 테이블 정리
      await this.deleteTypeSpecificProfile(tx, profile);

      // 2. 메인 프로필 삭제
      await tx
        .delete(schema.paymentProfiles)
        .where(eq(schema.paymentProfiles.id, profileId));
    });

    this.logger.log(`결제프로필 삭제 완료: ${profileId}`);
  }

  /**
   * 생성 요청 검증 (HMS API 스펙에 맞춘 필수 필드 검증)
   */
  private async validateCreateRequest(
    dto: PaymentProfileCreateRequestDto,
  ): Promise<void> {
    // 공통 필수 필드 검증
    if (!dto.phone) {
      throw new Error('전화번호는 필수입니다');
    }

    // 타입별 필수 필드 검증 (HMS API 스펙 기준)
    switch (dto.profileType) {
      case PaymentProfileTypeDto.CARD:
        // HMS 신용카드 API 필수 필드
        if (!dto.paymentNumber) {
          throw new Error(
            '신용카드 프로필 등록시 카드번호(paymentNumber)는 필수입니다',
          );
        }
        if (!dto.payerName) {
          throw new Error(
            '신용카드 프로필 등록시 카드 소유자명(payerName)은 필수입니다',
          );
        }
        if (!dto.payerNumber) {
          throw new Error(
            '신용카드 프로필 등록시 생년월일(payerNumber)은 필수입니다',
          );
        }
        if (
          !dto.validUntil ||
          dto.validUntil.length !== 4 ||
          !/^\d+$/.test(dto.validUntil)
        ) {
          throw new Error('카드 유효기간은 4자리 숫자(MMYY)로 입력해주세요');
        }
        if (!dto.password) {
          throw new Error(
            '신용카드 프로필 등록시 비밀번호 앞 2자리(password)는 필수입니다',
          );
        }

        // 테스트 환경: 카드번호 끝자리 짝수 검증
        const lastDigit = parseInt(dto.paymentNumber.slice(-1));
        if (lastDigit % 2 !== 0) {
          throw new Error(
            '테스트 환경에서는 카드번호 끝자리가 짝수여야 합니다',
          );
        }
        break;

      case PaymentProfileTypeDto.BANK_ACCOUNT:
        // HMS 배치 CMS API 필수 필드
        if (!dto.paymentCompany) {
          throw new Error(
            '배치 CMS 프로필 등록시 은행 코드(paymentCompany)는 필수입니다',
          );
        }
        if (!dto.accountNumber) {
          throw new Error(
            '배치 CMS 프로필 등록시 계좌번호(accountNumber)는 필수입니다',
          );
        }
        if (!dto.payerName) {
          throw new Error(
            '배치 CMS 프로필 등록시 납부자명(payerName)은 필수입니다',
          );
        }
        if (!dto.payerNumber) {
          throw new Error(
            '배치 CMS 프로필 등록시 납부자번호(payerNumber)는 필수입니다',
          );
        }
        break;

      case PaymentProfileTypeDto.BNPL:
        // BNPL 필수 필드
        if (!dto.creditLimit || !dto.billingCycleDay) {
          throw new Error(
            'BNPL 프로필 등록시 creditLimit과 billingCycleDay는 필수입니다',
          );
        }
        break;
    }

    // 사용자별 동일 타입 프로필 중복 검사 (직접 SQL 사용)
    const existingProfilesResult = await this.dbService.db.execute(sql`
      SELECT COUNT(*) as count
      FROM payment_profiles
      WHERE user_id = ${dto.userId}
      AND profile_type = ${dto.profileType}
      AND status IN ('PENDING', 'ACTIVE')
    `);

    const existingCount = Number(existingProfilesResult[0]?.count || 0);

    if (existingCount >= 5) {
      // 타입별 최대 5개 제한 (정책)
      throw new Error(
        `${dto.profileType} 타입의 결제프로필은 최대 5개까지 등록 가능합니다`,
      );
    }
  }

  /**
   * Provider 타입에 따른 Provider 선택
   */
  private getProviderForProfileType(profileType: PaymentProfileTypeDto) {
    switch (profileType) {
      case PaymentProfileTypeDto.CARD:
        return this.providerFactory.getProvider('HMS_CARD');
      case PaymentProfileTypeDto.BNPL:
        return this.providerFactory.getProvider('HMS_BNPL');
      case PaymentProfileTypeDto.BANK_ACCOUNT:
        return this.providerFactory.getProvider('HMS_CMS');
      default:
        throw new Error(`지원하지 않는 프로필 타입입니다: ${profileType}`);
    }
  }

  /**
   * 타입별 추가 테이블 생성 (HMS 응답 포함)
   */
  private async createTypeSpecificProfile(
    tx: any,
    profile: any,
    dto: PaymentProfileCreateRequestDto,
    registrationResult: any,
  ): Promise<void> {
    switch (dto.profileType) {
      case PaymentProfileTypeDto.BNPL:
        // BNPL 계정 생성 (HMS 응답 포함)
        await tx.insert(schema.bnplAccounts).values({
          id: registrationResult.hmsMemberId || generateUUIDv7(),
          userId: dto.userId,
          paymentProfileId: profile.id,
          creditLimit: dto.creditLimit!,
          availableCredit: dto.creditLimit!,
          billingCycleDay: dto.billingCycleDay!,
          status: 'ACTIVE', // HMS 등록 성공 시 바로 ACTIVE
        });
        break;

      case PaymentProfileTypeDto.CARD:
        // 카드는 paymentProfiles 테이블만으로 충분
        // HMS 빌링키는 registrationResult.metadata에 저장됨
        break;

      case PaymentProfileTypeDto.BANK_ACCOUNT:
        // CMS 계좌 정보는 batchCmsProfile에 저장
        await tx.insert(schema.cmsBatchProfiles).values({
          id: profile.id, // paymentProfiles의 id와 동일
          paymentProfileId: profile.id,
          hmsMemberId: registrationResult.hmsMemberId || generateUUIDv7(),
          creditLimit: dto.creditLimit || 0,
          approvedLimit: dto.creditLimit || 0,
          billingCycleDay: dto.billingCycleDay || 28,
          hmsMetadata: JSON.stringify({
            accountNumber: dto.accountNumber,
            payerName: dto.payerName,
            payerNumber: dto.payerNumber,
          }),
        });
        break;
    }
  }

  /**
   * 타입별 연관 테이블 삭제
   */
  private async deleteTypeSpecificProfile(
    tx: any,
    profile: any,
  ): Promise<void> {
    switch (profile.profileType) {
      case 'BNPL':
        // BNPL 계정 삭제
        await tx
          .delete(schema.bnplAccounts)
          .where(eq(schema.bnplAccounts.paymentProfileId, profile.id));
        break;

      // 다른 타입들은 필요시 추가
    }
  }

  /**
   * DB 엔티티를 응답 DTO로 변환
   */
  private mapToResponseDto(
    profile: any,
    hmsMemberId?: string,
  ): PaymentProfileResponseDto {
    // DB에서 snake_case로 반환되므로 camelCase로 매핑
    const createdAt = profile.createdAt || profile.created_at;
    const updatedAt = profile.updatedAt || profile.updated_at;

    return {
      profileId: profile.id,
      userId: profile.user_id || profile.userId,
      profileType: profile.profile_type || profile.profileType,
      profileName: profile.profile_name || profile.profileName,
      status: profile.status,
      paymentPurpose: profile.payment_purpose || profile.paymentPurpose,
      isDefault:
        profile.is_default !== undefined
          ? profile.is_default
          : profile.isDefault,
      createdAt: createdAt
        ? typeof createdAt === 'string'
          ? createdAt
          : createdAt.toISOString()
        : new Date().toISOString(),
      updatedAt: updatedAt
        ? typeof updatedAt === 'string'
          ? updatedAt
          : updatedAt.toISOString()
        : new Date().toISOString(),
      hmsMemberId: hmsMemberId,
    };
  }
}

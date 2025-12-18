import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DbService } from '@app/db';
import { v4 as uuidv4 } from 'uuid'; // UUID 생성을 위해 라이브러리 사용 (또는 crypto)
import { and, eq, isNull } from 'drizzle-orm';
import { ProviderRegistry } from '../../providers/provider-registry';
import {
  PaymentError,
  ProviderPayloadMap,
  ProviderType,
} from '../../providers/payment-provider.interface';
import {
  PaymentProfilesRepository,
  CmsCardProfilesRepository,
  CmsBatchProfilesRepository,
} from './payment-profile.repository';
import * as schema from '../../shared/database/schema';
import { walletSchema } from '../../shared/database/schema';
import { generateUUIDv7 } from '../../shared/utils/id-generator';
import { getTsid } from 'tsid-ts';
import { CreateHmsCardProfileSchema } from '../../controllers/payment.controller.zod';
import z from 'zod';

import { HmsBnplRegisterInput } from '../../providers/hms-bnpl.registrar';
import { BnplService } from '../bnpl/bnpl.service';

// ✨ 해결 2: 헬퍼 함수 정의 추가
function maskPhone(phone: string): string {
  if (!phone) return '';
  return phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
}

@Injectable()
export class PaymentProfileService {
  private readonly logger = new Logger(PaymentProfileService.name);

  constructor(
    private readonly db: DbService<typeof walletSchema>, // for transactions
    private readonly registry: ProviderRegistry,
    private readonly profilesRepo: PaymentProfilesRepository,
    private readonly cmsCardRepo: CmsCardProfilesRepository,
    private readonly cmsBatchRepo: CmsBatchProfilesRepository,
    private readonly configService: ConfigService,
    private readonly bnplService: BnplService,
  ) { }

  // 결제 프로필 목록 조회 (상세 정보 포함)
  async getPaymentProfiles(userId: string) {
    return this.db.db.transaction(async (tx) => {
      // 사용자의 활성 결제 프로필만 조회 (soft delete 된 것 제외)
      const profiles = await tx
        .select({
          id: schema.paymentProfiles.id,
          userId: schema.paymentProfiles.userId,
          kind: schema.paymentProfiles.kind,
          provider: schema.paymentProfiles.provider,
          status: schema.paymentProfiles.status,
          name: schema.paymentProfiles.name,
          paymentNumber: schema.paymentProfiles.paymentNumber,
          isDefault: schema.paymentProfiles.isDefault,
          createdAt: schema.paymentProfiles.createdAt,
          updatedAt: schema.paymentProfiles.updatedAt,
        })
        .from(schema.paymentProfiles)
        .where(
          and(
            eq(schema.paymentProfiles.userId, userId),
            isNull(schema.paymentProfiles.deletedAt),
          ),
        );

      // 각 프로필에 대해 상세 정보 조회
      const profilesWithDetails = await Promise.all(
        profiles.map(async (profile) => {
          let details: {
            paymentCompany: string | null;
            paymentCompanyName: string;
            paymentNumber: string | null;
            cardLast4: string | null;
            cardBrand: string | null;
            payerName: string | null;
            phoneMask: string | null;
            cmsStatus: string | null;
          } | null = null;

          // HMS 카드 프로필인 경우 cms_card_profiles 테이블 조인
          if (profile.provider === 'HMS_CARD' && profile.kind === 'CARD') {
            const [cardProfile] = await tx
              .select()
              .from(schema.cmsCardProfiles)
              .where(eq(schema.cmsCardProfiles.id, profile.id))
              .limit(1);

            if (cardProfile) {
              details = {
                paymentCompany: cardProfile.paymentCompany,
                // HMS API는 이미 한글 카드사명을 반환함 (예: "신한카드")
                paymentCompanyName: cardProfile.paymentCompany || '알 수 없음',
                paymentNumber: cardProfile.cardLast4
                  ? `****-****-****-${cardProfile.cardLast4}`
                  : null,
                cardLast4: cardProfile.cardLast4,
                cardBrand: cardProfile.cardBrand,
                payerName: cardProfile.payerName,
                phoneMask: cardProfile.phoneMask,
                cmsStatus: cardProfile.cmsStatus,
              };
            }
          }

          // HMS BNPL 프로필인 경우 cms_batch_profiles 테이블 조인
          if (profile.provider === 'HMS_BNPL' && profile.kind === 'BANK_ACCOUNT') {
            const [batchProfile] = await tx
              .select()
              .from(schema.cmsBatchProfiles)
              .where(eq(schema.cmsBatchProfiles.id, profile.id))
              .limit(1);


            if (batchProfile) {
              details = {
                paymentCompany: batchProfile.paymentCompany,
                paymentCompanyName: batchProfile.paymentCompany || '알 수 없음', // 은행 코드를 리턴함 ex) 090
                paymentNumber: profile.paymentNumber,
                cardLast4: null, // BNPL은 카드 정보 없음
                cardBrand: null, // BNPL은 카드 브랜드 없음
                payerName: batchProfile.payerName,
                phoneMask: batchProfile.phoneMask,
                cmsStatus: batchProfile.cmsStatus,
              };
            }
          }

          return {
            id: profile.id,
            kind: profile.kind,
            provider: profile.provider,
            status: profile.status,
            name: profile.name,
            isDefault: profile.isDefault,
            details,
            createdAt: profile.createdAt,
          };
        }),
      );

      return profilesWithDetails;
    });
  }

  // HMS 카드 프로필 등록
  async createHmsCardProfile(dto: z.infer<typeof CreateHmsCardProfileSchema>) {
    return this.db.db.transaction(async (tx) => {
      const handle = this.registry.get(ProviderType.HMS_CARD);
      if (!handle.profile)
        throw new PaymentError('PROFILE_NOT_SUPPORTED_FOR_HMS_CARD');

      // ✨ [개선] 서비스 내부에서 HMS 규약에 맞는 memberId를 직접 생성합니다.
      const memberId = getTsid().toBigInt().toString().slice(0, 20);

      // 이제 dto에는 모든 정보가 타입 안전하게 포함되어 있습니다.
      // 추후 userid를 jwt토큰에서 추출하는것으로 바꿀것.
      const ext = await handle.profile.register({ ...dto, memberId }, { tx });

      // ✨ [개선] 내부 DB용 ID는 그대로 uuidv7을 사용합니다.
      const profileId = generateUUIDv7();

      await this.profilesRepo.create(
        {
          id: profileId,
          userId: dto.userId!, // controller에서 이미 userId를 주입했으므로 non-null assertion
          kind: 'CARD',
          provider: ProviderType.HMS_CARD,
          name: dto.memberName ?? null,
        },
        tx,
      );

      await this.cmsCardRepo.insert(
        {
          id: profileId,
          memberId: ext.externalId!,
          cmsStatus: ext.status,
          paymentCompany: dto.paymentCompany ?? null,
          payerName: dto.payerName,
          phoneMask: maskPhone(dto.phone),
          cardBrand: ext.meta?.cardBrand ?? null,
          // ✨ [수정] DB 스키마에 맞게 마지막 4자리만 잘라서 저장합니다.
          cardLast4: ext.meta?.last4?.slice(-4) ?? null,
        },
        tx,
      );

      await this.profilesRepo.updateStatus(profileId, 'ACTIVE', tx);
      return profileId;
    });
  }

  // HMS BNPL 프로필 등록 (동일한 패턴으로 수정)
  async createHmsBnplProfileWithAgreement(
    userId: string,
    // DTO는 컨트롤러 계층에서 넘어오는 데이터입니다.
    dto: {
      payerName: string;
      phone: string;
      paymentCompany: string;
      paymentNumber: string;
      payerNumber: string;
      name?: string | null;
      agreementFile: {
        file: Buffer;
        filename: string;
      };
    },
  ) {
    // 모든 과정은 하나의 DB 트랜잭션으로 묶습니다.
    return this.db.db.transaction(async (tx) => {
      // 중복 등록 방지: HMS_BNPL 프로필이 이미 있는지 확인
      const existingBnplProfiles = await tx
        .select()
        .from(schema.paymentProfiles)
        .where(
          and(
            eq(schema.paymentProfiles.userId, userId),
            eq(schema.paymentProfiles.provider, 'HMS_BNPL'),
            isNull(schema.paymentProfiles.deletedAt),
          ),
        )
        .limit(1);

      if (existingBnplProfiles.length > 0) {
        // 멱등성 확보: 이미 존재하면 조용히 기존 프로필 정보 반환
        const existing = existingBnplProfiles[0];
        const [batchProfile] = await tx
          .select()
          .from(schema.cmsBatchProfiles)
          .where(eq(schema.cmsBatchProfiles.id, existing.id))
          .limit(1);

        this.logger.log(`HMS_BNPL 프로필이 이미 존재함 - userId: ${userId}, profileId: ${existing.id}`);

        return {
          profileId: existing.id,
          memberId: batchProfile?.memberId || 'unknown',
        };
      }

      const handle = this.registry.get(ProviderType.HMS_BNPL);
      if (!handle.profile) {
        throw new PaymentError('PROFILE_NOT_SUPPORTED_FOR_HMS_BNPL');
      }

      // 외부 API 호출을 위한 Input 객체 조립
      const memberId = `m_${crypto.randomUUID().substring(0, 18)}`; // ID 생성 전략

      // HMS_CUST_ID 환경 변수 확인
      const custId = this.configService.get<string>('HMS_CUST_ID');
      if (!custId) {
        this.logger.error('❌ HMS_CUST_ID 환경 변수가 설정되지 않았습니다.');
        throw new PaymentError(
          'HMS_CUST_ID 환경 변수가 필요합니다. 환경 변수를 확인하세요.',
        );
      }

      const registerInput: HmsBnplRegisterInput = {
        userId,
        custId,
        memberId,
        memberName: dto.name ?? dto.payerName,
        payerName: dto.payerName,
        paymentCompany: dto.paymentCompany,
        paymentNumber: dto.paymentNumber,
        payerNumber: dto.payerNumber,
        phone: dto.phone,
        agreementFile: dto.agreementFile,
      };

      // Registrar 호출
      const ext = await handle.profile.register(registerInput, { tx });

      // Registrar 실패 시 롤백 및 에러 처리
      if (ext.status !== 'SUCCESS') {
        const reason = ext.meta?.reason ?? 'BNPL 프로필 등록 실패';
        throw new PaymentError('PROVIDER_FAILED', reason);
      }

      // --- DB 저장 로직 (기존 컨트롤러에 있던 코드) ---
      const profileId = await this.profilesRepo.create(
        {
          id: generateUUIDv7(),
          userId,
          kind: 'BANK_ACCOUNT',
          provider: ProviderType.HMS_BNPL,
          paymentNumber: dto.paymentNumber,
          name: dto.name?.trim() || null, // 빈 문자열도 null로 변환
        },
        tx,
      );

      await this.cmsBatchRepo.insert(
        {
          id: profileId,
          memberId: ext.externalId!,
          cmsStatus: ext.status, // Registrar가 반환한 상태
          paymentCompany: dto.paymentCompany,
          payerName: dto.payerName,
          phoneMask: maskPhone(dto.phone),
          billingDay: null, // 필요시 DTO에 추가
        },
        tx,
      );

      // agreementKey 같은 추가 정보는 별도 테이블 또는 cmsBatchProfiles에 저장
      // 예: await tx.update(...).set({ agreementKey: ext.meta.agreementKey });

      await this.profilesRepo.updateStatus(profileId, 'ACTIVE', tx);

      // 🎯 BNPL 계정 생성 (프로필 등록 시 자동 생성)
      // 기존 계정이 있는지 확인 (트랜잭션 컨텍스트 사용)
      try {
        const existingAccount = await this.bnplService.findAccountByUserId(
          userId,
          tx,
        );
        if (!existingAccount) {
          // 기본 신용한도는 환경변수에서 가져오거나 기본값 사용
          const creditLimitEnv = this.configService.get<string>(
            'BNPL_DEFAULT_CREDIT_LIMIT',
          );
          const defaultCreditLimit = creditLimitEnv
            ? parseInt(creditLimitEnv, 10)
            : 1000000; // 기본 100만원

          this.logger.log(
            `🔄 BNPL 계정 자동 생성 시작 - userId: ${userId}, creditLimit: ${defaultCreditLimit}`,
          );

          const createdAccount = await this.bnplService.createAccount(
            userId,
            defaultCreditLimit,
            tx,
          );

          this.logger.log(
            `✅ BNPL 계정 자동 생성 완료 - userId: ${userId}, accountId: ${createdAccount.id}`,
          );
        } else {
          this.logger.log(
            `ℹ️ BNPL 계정이 이미 존재함 - userId: ${userId}, accountId: ${existingAccount.id}`,
          );
        }
      } catch (accountError) {
        // 계정 생성 실패는 프로필 등록을 막지 않지만, 로그는 남김
        const errorMessage =
          accountError instanceof Error
            ? accountError.message
            : String(accountError);
        this.logger.error(
          `❌ BNPL 계정 생성 실패 - userId: ${userId}, error: ${errorMessage}`,
        );
        // 계정 생성 실패는 프로필 등록을 롤백하지 않음 (프로필은 성공했으므로)
        // 하지만 경고 로그는 남김
        this.logger.warn(
          `⚠️ 프로필은 등록되었지만 BNPL 계정 생성에 실패했습니다. 수동으로 계정을 생성해야 합니다.`,
        );
      }

      return { profileId, memberId: ext.externalId! };
    });
  }

  // Toss: 가상 프로필 보장 (동일한 패턴으로 수정)
  async ensureTossVirtualProfile(userId: string, name = 'Toss') {
    return this.db.db.transaction(async (tx) => {
      const existed = await this.profilesRepo.findOneByUserAndProvider(
        userId,
        tx,
      );
      if (existed) return existed.id;

      const profileId = uuidv4();
      await this.profilesRepo.create(
        {
          id: profileId,
          userId,
          kind: 'WALLET',
          provider: ProviderType.TOSS,
          name,
        },
        tx,
      );

      await this.profilesRepo.updateStatus(profileId, 'ACTIVE', tx);
      return profileId;
    });
  }

  // 실행용 Payload 보강(Resolver)
  async resolvePayload<K extends ProviderType>(
    profileId: string,
    providerType: K,
    amount: number,
    ctx: { tx?: any } = {},
  ): Promise<ProviderPayloadMap[K]> {
    const tx = ctx.tx ?? this.db.db;

    if (providerType === ProviderType.HMS_CARD) {
      const card = await this.cmsCardRepo.findById(profileId, tx);
      if (!card?.memberId)
        throw new PaymentError(
          'HMS_MEMBER_ID_INVALID',
          `Profile ID ${profileId} not found or invalid`,
        );
      return { memberId: card.memberId, amount } as ProviderPayloadMap[K];
    }

    if (providerType === ProviderType.HMS_BNPL) {
      const bnpl = await this.cmsBatchRepo.findById(profileId, tx);
      if (!bnpl?.memberId)
        throw new PaymentError(
          'HMS_MEMBER_ID_INVALID',
          `Profile ID ${profileId} not found or invalid`,
        );
      const invoiceId = 'INV-' + Date.now();
      return {
        memberId: bnpl.memberId,
        captureAmount: amount,
        invoiceId,
      } as ProviderPayloadMap[K];
    }

    if (providerType === ProviderType.TOSS) {
      return { amount } as ProviderPayloadMap[K];
    }

    throw new PaymentError(
      'UNKNOWN_PROVIDER_FOR_PAYLOAD_RESOLUTION',
      `Provider ${providerType} not supported`,
    );
  }

  /**
   * 기본 결제 수단 변경
   * @param userId 사용자 ID
   * @param profileId 변경할 프로필 ID
   * @returns 변경된 프로필 정보
   */
  async setDefaultProfile(
    userId: string,
    profileId: string,
  ): Promise<{ profileId: string; isDefault: boolean }> {
    return this.db.db.transaction(async (tx) => {
      // 1. 프로필 조회 및 소유자 확인
      const profile = await this.profilesRepo.findById(profileId, tx);
      if (!profile) {
        throw new Error('Profile not found');
      }

      if (profile.userId !== userId) {
        throw new Error('Profile does not belong to user');
      }

      // 2. 프로필 상태 확인 (ACTIVE만 허용)
      if (profile.status !== 'ACTIVE') {
        throw new Error('Profile status is not ACTIVE');
      }

      // 3. 삭제 여부 확인 (deletedAt IS NULL만 허용)
      if (profile.deletedAt !== null) {
        throw new Error('Profile already deleted');
      }

      // 4. 프로바이더 검증
      // 멤버십 결제: HMS_CARD만 사용
      // BNPL 출금: HMS_BNPL만 사용
      // 다른 프로바이더는 기본값 설정 불필요
      const allowedProviders = ['HMS_CARD', 'HMS_BNPL'];
      if (!allowedProviders.includes(profile.provider)) {
        throw new Error('Only HMS_CARD and HMS_BNPL can be set as default');
      }

      // 5. 기본값 변경
      await this.profilesRepo.setDefault(userId, profileId, tx);

      this.logger.log(
        `✅ 기본 결제 수단 변경 성공 - userId: ${userId}, profileId: ${profileId}`,
      );

      return {
        profileId,
        isDefault: true,
      };
    });
  }

  /**
   * 결제 프로필 삭제 (Soft Delete)
   * @param userId 사용자 ID
   * @param profileId 삭제할 프로필 ID
   * @returns 삭제된 프로필 정보
   */
  async deleteProfile(
    userId: string,
    profileId: string,
  ): Promise<{ profileId: string; deletedAt: Date }> {
    return this.db.db.transaction(async (tx) => {
      // 1. 프로필 조회 및 소유자 확인
      const profile = await this.profilesRepo.findById(profileId, tx);
      if (!profile) {
        throw new Error('Profile not found');
      }

      if (profile.userId !== userId) {
        throw new Error('Profile does not belong to user');
      }

      // 2. 이미 삭제된 프로필인지 확인
      if (profile.deletedAt !== null) {
        throw new Error('Profile already deleted');
      }

      // 3. 기본값인 경우 isDefault를 false로 해제 (자동 승계 없음)
      // softDelete 메서드 내부에서 처리됨

      // 4. Soft Delete 수행
      const deletedAt = new Date();
      await this.profilesRepo.softDelete(profileId, tx);

      this.logger.log(
        `✅ 결제 프로필 삭제 성공 - userId: ${userId}, profileId: ${profileId}`,
      );

      return {
        profileId,
        deletedAt,
      };
    });
  }
}

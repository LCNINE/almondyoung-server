import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { v4 as uuidv4 } from 'uuid'; // UUID 생성을 위해 라이브러리 사용 (또는 crypto)
import { eq } from 'drizzle-orm';
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
  ) { }

  // 결제 프로필 목록 조회 (payment_profiles 테이블만 조회)
  async getPaymentProfiles(userId: string) {
    return this.db.db.transaction(async (tx) => {
      // 사용자의 모든 결제 프로필 조회
      const profiles = await tx
        .select()
        .from(schema.paymentProfiles)
        .where(eq(schema.paymentProfiles.userId, userId));

      // 프로필 정보만 반환 (하위 테이블 조회 없음)
      return profiles.map((profile) => ({
        id: profile.id,
        kind: profile.kind,
        provider: profile.provider,
        status: profile.status,
        name: profile.name,
        createdAt: profile.createdAt,
      }));
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
      const handle = this.registry.get(ProviderType.HMS_BNPL);
      if (!handle.profile) {
        throw new PaymentError('PROFILE_NOT_SUPPORTED_FOR_HMS_BNPL');
      }

      // 외부 API 호출을 위한 Input 객체 조립
      const memberId = `m_${crypto.randomUUID().substring(0, 18)}`; // ID 생성 전략
      const registerInput: HmsBnplRegisterInput = {
        userId,
        // custId는 설정(Config)에서 가져오는 것이 좋습니다.
        custId: 'YOUR_CUST_ID',
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
          name: dto.name ?? null,
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
}

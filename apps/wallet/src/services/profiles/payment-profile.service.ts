import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { v4 as uuidv4 } from 'uuid'; // UUID 생성을 위해 라이브러리 사용 (또는 crypto)
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
import { generateUUIDv7 } from '../../shared/utils/id-generator';
import { getTsid } from 'tsid-ts';
import { CreateHmsCardProfileSchema } from '../../controllers/payment.controller';
import z from 'zod';

// ✨ 해결 2: 헬퍼 함수 정의 추가
function maskPhone(phone: string): string {
  if (!phone) return '';
  return phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
}

@Injectable()
export class PaymentProfileService {
  private readonly logger = new Logger(PaymentProfileService.name);

  constructor(
    private readonly db: DbService<typeof schema>, // for transactions
    private readonly registry: ProviderRegistry,
    private readonly profilesRepo: PaymentProfilesRepository,
    private readonly cmsCardRepo: CmsCardProfilesRepository,
    private readonly cmsBatchRepo: CmsBatchProfilesRepository,
  ) {}

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
          userId: dto.userId,
          kind: 'CARD',

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
  async createHmsBnplProfile(
    userId: string,
    dto: {
      payerName: string;
      phone: string;
      billingDay?: number | null;
      name?: string | null;
    },
  ) {
    return this.db.db.transaction(async (tx) => {
      const handle = this.registry.get(ProviderType.HMS_BNPL);
      if (!handle.profile)
        throw new PaymentError('PROFILE_NOT_SUPPORTED_FOR_HMS_BNPL');

      const ext = await handle.profile.register({ userId, ...dto }, { tx });

      const profileId = uuidv4();
      await this.profilesRepo.create(
        {
          id: profileId,
          userId,
          kind: 'BANK_ACCOUNT',
          name: dto.name ?? null,
        },
        tx,
      );

      await this.cmsBatchRepo.insert(
        {
          id: profileId,
          memberId: ext.externalId!,
          cmsStatus: ext.status,
          payerName: dto.payerName,
          phoneMask: maskPhone(dto.phone),
          billingDay: dto.billingDay ?? null,
          // paymentCompany는 스키마에 따라 필요 시 추가
        },
        tx,
      );

      await this.profilesRepo.updateStatus(profileId, 'ACTIVE', tx);
      return profileId;
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

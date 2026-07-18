import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DbService } from '@app/db';
import { desc, eq } from 'drizzle-orm';
import { WalletSchema, billingMethods, cmsAgreements, cmsMembers } from '../schema';
import { isCmsAgreementRegistered } from '../cms/cms-agreement-status';
import { CmsMember } from '../types';

export interface DevCmsStateResponseDto {
  cmsMember: {
    id: string;
    cmsMemberId: string;
    billingMethodId: string;
    status: string;
    resultCode: string | null;
    resultMessage: string | null;
  };
  agreementStatus: string | null;
  billingMethodStatus: string | null;
  isSelectableForRecurringBilling: boolean;
}

@Injectable()
export class CmsDevStateService {
  private readonly logger = new Logger(CmsDevStateService.name);

  constructor(private readonly dbService: DbService<WalletSchema>) {}

  async markMemberRegistered(
    id: string,
    idType: 'cmsMemberId' | 'id' | 'billingMethodId',
    agreement: 'leave' | 'register' | 'fail',
    resultCode?: string,
    resultMessage?: string,
  ): Promise<DevCmsStateResponseDto> {
    const member = await this.resolveCmsMember(id, idType);
    const appliedCode = resultCode ?? 'DEV_REGISTERED';
    const appliedMsg = resultMessage ?? 'dev helper: marked registered for testing';

    this.logger.warn(
      `[DEV] markMemberRegistered cmsMemberId=${member.cmsMemberId} before=${member.status} resultCode=${appliedCode}`,
    );

    await this.dbService.db
      .update(cmsMembers)
      .set({ status: 'REGISTERED', resultCode: appliedCode, resultMessage: appliedMsg, updatedAt: new Date() })
      .where(eq(cmsMembers.id, member.id));

    if (agreement === 'register') {
      await this.upsertAgreement(member.cmsMemberId, '등록', 'DEV_AGREEMENT_REGISTERED', 'dev helper: agreement registered');
    } else if (agreement === 'fail') {
      await this.upsertAgreement(member.cmsMemberId, '실패', 'DEV_AGREEMENT_FAILED', 'dev helper: agreement failed');
    }

    return this.buildResponse(member.id);
  }

  async markMemberFailed(
    id: string,
    idType: 'cmsMemberId' | 'id' | 'billingMethodId',
    resultCode?: string,
    resultMessage?: string,
  ): Promise<DevCmsStateResponseDto> {
    const member = await this.resolveCmsMember(id, idType);
    const appliedCode = resultCode ?? 'DEV_FAILED';
    const appliedMsg = resultMessage ?? 'dev helper: marked failed for testing';

    this.logger.warn(
      `[DEV] markMemberFailed cmsMemberId=${member.cmsMemberId} before=${member.status} resultCode=${appliedCode}`,
    );

    await this.dbService.db
      .update(cmsMembers)
      .set({ status: 'FAILED', resultCode: appliedCode, resultMessage: appliedMsg, updatedAt: new Date() })
      .where(eq(cmsMembers.id, member.id));

    return this.buildResponse(member.id);
  }

  async markAgreementRegistered(
    id: string,
    idType: 'cmsMemberId' | 'id' | 'billingMethodId',
  ): Promise<DevCmsStateResponseDto> {
    const member = await this.resolveCmsMember(id, idType);

    this.logger.warn(
      `[DEV] markAgreementRegistered cmsMemberId=${member.cmsMemberId}`,
    );

    await this.upsertAgreement(member.cmsMemberId, '등록', 'DEV_AGREEMENT_REGISTERED', 'dev helper: agreement registered');
    return this.buildResponse(member.id);
  }

  async markAgreementFailed(
    id: string,
    idType: 'cmsMemberId' | 'id' | 'billingMethodId',
    resultCode?: string,
    resultMessage?: string,
  ): Promise<DevCmsStateResponseDto> {
    const member = await this.resolveCmsMember(id, idType);
    const appliedCode = resultCode ?? 'DEV_AGREEMENT_FAILED';
    const appliedMsg = resultMessage ?? 'dev helper: agreement failed for testing';

    this.logger.warn(
      `[DEV] markAgreementFailed cmsMemberId=${member.cmsMemberId} resultCode=${appliedCode}`,
    );

    await this.upsertAgreement(member.cmsMemberId, '실패', appliedCode, appliedMsg);
    return this.buildResponse(member.id);
  }

  async resetToPending(
    id: string,
    idType: 'cmsMemberId' | 'id' | 'billingMethodId',
  ): Promise<DevCmsStateResponseDto> {
    const member = await this.resolveCmsMember(id, idType);

    this.logger.warn(
      `[DEV] resetToPending cmsMemberId=${member.cmsMemberId} before=${member.status}`,
    );

    await this.dbService.db
      .update(cmsMembers)
      .set({ status: 'PENDING', resultCode: null, resultMessage: null, updatedAt: new Date() })
      .where(eq(cmsMembers.id, member.id));

    return this.buildResponse(member.id);
  }

  private async resolveCmsMember(
    id: string,
    idType: 'cmsMemberId' | 'id' | 'billingMethodId',
  ): Promise<CmsMember> {
    let rows: CmsMember[];

    if (idType === 'cmsMemberId') {
      rows = await this.dbService.db.select().from(cmsMembers).where(eq(cmsMembers.cmsMemberId, id)).limit(1);
    } else if (idType === 'id') {
      rows = await this.dbService.db.select().from(cmsMembers).where(eq(cmsMembers.id, id)).limit(1);
    } else {
      rows = await this.dbService.db.select().from(cmsMembers).where(eq(cmsMembers.billingMethodId, id)).limit(1);
    }

    if (!rows[0]) {
      throw new NotFoundException(`CMS member not found: id=${id} idType=${idType}`);
    }
    return rows[0];
  }

  private async upsertAgreement(
    cmsMemberId: string,
    status: string,
    resultCode: string,
    resultMessage: string,
  ): Promise<void> {
    const existing = await this.dbService.db
      .select()
      .from(cmsAgreements)
      .where(eq(cmsAgreements.cmsMemberId, cmsMemberId))
      .orderBy(desc(cmsAgreements.createdAt))
      .limit(1);

    if (existing[0]) {
      await this.dbService.db
        .update(cmsAgreements)
        .set({ status, resultCode, resultMessage, updatedAt: new Date() })
        .where(eq(cmsAgreements.id, existing[0].id));
    } else {
      await this.dbService.db.insert(cmsAgreements).values({
        cmsMemberId,
        agreementKey: `dev-${cmsMemberId}`,
        fileType: '전자서명',
        fileExtension: 'png',
        status,
        resultCode,
        resultMessage,
      });
    }
  }

  private async buildResponse(cmsMemberRowId: string): Promise<DevCmsStateResponseDto> {
    const memberRows = await this.dbService.db
      .select()
      .from(cmsMembers)
      .where(eq(cmsMembers.id, cmsMemberRowId))
      .limit(1);
    const member = memberRows[0];

    const agreementRows = await this.dbService.db
      .select()
      .from(cmsAgreements)
      .where(eq(cmsAgreements.cmsMemberId, member.cmsMemberId))
      .orderBy(desc(cmsAgreements.createdAt))
      .limit(1);
    const latestAgreement = agreementRows[0];

    const bmRows = await this.dbService.db
      .select()
      .from(billingMethods)
      .where(eq(billingMethods.id, member.billingMethodId))
      .limit(1);
    const bm = bmRows[0];

    const agreementStatus = latestAgreement?.status ?? null;
    const billingMethodStatus = bm?.status ?? null;
    const isSelectableForRecurringBilling =
      billingMethodStatus === 'ACTIVE' && member.status === 'REGISTERED' && isCmsAgreementRegistered(agreementStatus);

    return {
      cmsMember: {
        id: member.id,
        cmsMemberId: member.cmsMemberId,
        billingMethodId: member.billingMethodId,
        status: member.status,
        resultCode: member.resultCode ?? null,
        resultMessage: member.resultMessage ?? null,
      },
      agreementStatus,
      billingMethodStatus,
      isSelectableForRecurringBilling,
    };
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DbService } from '@app/db';
import { BadRequestError } from '@app/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { membershipSchema } from '../../shared/schemas/entities/schema';
import * as schema from '../../shared/schemas/entities/schema';
import { isKnownMembershipTermsVersion } from './membership-terms';

export type TermsBillingMode = 'recurring' | 'one_time';

export interface RecordTermsAgreementInput {
  userId: string;
  termsVersion: string;
  billingMode: TermsBillingMode;
  planId: string;
}

/**
 * 가입 약관 동의 이력의 쓰기와, 가입 요청이 가져온 동의가 쓸 수 있는 것인지의 판정.
 *
 * 동의는 가입 폼을 제출한 순간에 적는다. 가입 완성은 그보다 늦고(자동이체 등록으로 화면을 떠났다
 * 돌아오는 경로가 있다), 가입 요청은 그때 받은 동의 id 를 들고 온다.
 */
@Injectable()
export class TermsAgreementManager {
  private readonly logger = new Logger(TermsAgreementManager.name);

  constructor(
    private readonly dbService: DbService<typeof membershipSchema>,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 동의 없는 가입을 거절할지. 스토어프론트가 동의 id 를 보내기 시작한 «뒤에» 켠다 —
   * 먼저 켜면 옛 화면으로 들어온 가입이 전부 막힌다.
   */
  private isRequired(): boolean {
    return this.configService.get<string>('MEMBERSHIP_TERMS_AGREEMENT_REQUIRED') === 'true';
  }

  async record(input: RecordTermsAgreementInput): Promise<{ agreementId: string }> {
    if (!isKnownMembershipTermsVersion(input.termsVersion)) {
      throw new BadRequestError(`알 수 없는 약관 버전입니다: ${input.termsVersion}`);
    }
    const [plan] = await this.dbService.db
      .select({ id: schema.plan.id })
      .from(schema.plan)
      .where(eq(schema.plan.id, input.planId))
      .limit(1);
    if (!plan) throw new BadRequestError('플랜을 찾을 수 없습니다.');

    const [row] = await this.dbService.db
      .insert(schema.membershipTermsAgreements)
      .values({
        userId: input.userId,
        termsVersion: input.termsVersion,
        billingMode: input.billingMode,
        planId: input.planId,
      })
      .returning({ id: schema.membershipTermsAgreements.id });
    if (!row) throw new Error('약관 동의 기록 후 행이 반환되지 않았습니다.');
    return { agreementId: row.id };
  }

  /**
   * 가입 요청이 가져온 동의를 확인한다. 쓸 수 있으면 그 id, 동의 없이 와도 되는 동안(플래그 꺼짐)엔 null.
   *
   * 본인의 동의 · 같은 플랜 · 같은 결제 방식 · 아직 어느 가입에도 안 쓰인 동의만 받는다.
   * 결제 방식까지 보는 이유: 1회결제 약관에는 제5조(미납 요금)가 없다 — 그 동의로 정기결제에
   * 가입시키면 미납 조항에 동의받지 않은 정기결제가 생긴다.
   */
  async resolveForSubscription(
    userId: string,
    agreementId: string | undefined,
    planId: string,
    billingMode: TermsBillingMode,
  ): Promise<string | null> {
    if (!agreementId) {
      if (this.isRequired()) throw new BadRequestError('약관 동의가 필요합니다.');
      return null;
    }

    const [row] = await this.dbService.db
      .select({
        planId: schema.membershipTermsAgreements.planId,
        billingMode: schema.membershipTermsAgreements.billingMode,
        contractId: schema.membershipTermsAgreements.contractId,
      })
      .from(schema.membershipTermsAgreements)
      .where(
        and(
          eq(schema.membershipTermsAgreements.id, agreementId),
          eq(schema.membershipTermsAgreements.userId, userId),
        ),
      )
      .limit(1);

    if (!row || row.planId !== planId || row.billingMode !== billingMode || row.contractId !== null) {
      throw new BadRequestError('약관 동의를 다시 해 주세요.');
    }
    return agreementId;
  }

  /**
   * 완성된 가입을 동의에 이어 붙인다. 실패해도 가입은 되돌리지 않는다 — 동의 행은 이미 있고
   * (누가·언제·어느 버전·어느 플랜), 이 연결은 그 위의 보조 정보다. 결제까지 끝난 가입을 이것 때문에
   * 무르면 고객에게 더 나쁘다.
   */
  async linkContract(userId: string, agreementId: string, contractId: string): Promise<void> {
    try {
      const rows = await this.dbService.db
        .update(schema.membershipTermsAgreements)
        .set({ contractId })
        .where(
          and(
            eq(schema.membershipTermsAgreements.id, agreementId),
            eq(schema.membershipTermsAgreements.userId, userId),
            isNull(schema.membershipTermsAgreements.contractId),
          ),
        )
        .returning({ id: schema.membershipTermsAgreements.id });
      if (rows.length === 0) {
        this.logger.warn(`약관 동의 연결 대상 없음 (agreementId=${agreementId}, contractId=${contractId})`);
      }
    } catch (err: unknown) {
      this.logger.error(
        `약관 동의 연결 실패 (agreementId=${agreementId}, contractId=${contractId})`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}

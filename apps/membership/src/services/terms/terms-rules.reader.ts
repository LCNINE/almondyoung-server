import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DbService } from '@app/db';
import { eq } from 'drizzle-orm';
import { membershipSchema } from '../../shared/schemas/entities/schema';
import * as schema from '../../shared/schemas/entities/schema';

/**
 * 이 계약에 «새 약관»의 미납 요금 조항(제5조)이 적용되는가 — 기존 회원에게 불리한 새 의무다.
 *
 * 웰컴딜을 「혜택 사용」으로 세는 것은 여기에 걸지 않는다. 옛 약관도 웰컴딜을 혜택으로 적고 있었고
 * 코드가 세지 않았을 뿐이라, 새 의무가 아니라 원래 약관의 이행이다.
 *
 * 불리한 변경은 기존 회원에게 적용일 30일 전에 알린 뒤에만 적용할 수 있다(약관의 변경 고지 조항).
 * 그래서 둘 중 하나일 때만 적용한다:
 *   ① 새 약관에 동의하고 들어온 가입(동의 이력이 이 계약에 이어져 있다)
 *   ② 기존 회원 적용일(`MEMBERSHIP_TERMS_EXISTING_MEMBERS_EFFECTIVE_AT`)이 지났다
 * 적용일이 비어 있으면 기존 회원에게는 적용하지 않는다. 이용약관 제3조 제6항(개정약관은 개정 후
 * 체결되는 계약에만 적용)과 부딪히므로 법무 검토 없이 설정하지 않는다.
 *
 * 유리한 변경(연간 정산에서 할인액 공제 폐지, 청약철회 대상 주기엔 미납 요금을 안 적음)은 이 판정과
 * 무관하게 모두에게 바로 적용된다.
 */
@Injectable()
export class TermsRulesReader {
  constructor(
    private readonly dbService: DbService<typeof membershipSchema>,
    private readonly configService: ConfigService,
  ) {}

  async newRulesApply(contractId: string, now: Date = new Date()): Promise<boolean> {
    const effectiveAt = this.existingMembersEffectiveAt();
    if (effectiveAt && now.getTime() >= effectiveAt.getTime()) return true;

    const [agreed] = await this.dbService.db
      .select({ id: schema.membershipTermsAgreements.id })
      .from(schema.membershipTermsAgreements)
      .where(eq(schema.membershipTermsAgreements.contractId, contractId))
      .limit(1);
    return !!agreed;
  }

  private existingMembersEffectiveAt(): Date | null {
    const raw = this.configService.get<string>('MEMBERSHIP_TERMS_EXISTING_MEMBERS_EFFECTIVE_AT');
    if (!raw) return null;
    const at = new Date(raw);
    return Number.isNaN(at.getTime()) ? null : at;
  }
}

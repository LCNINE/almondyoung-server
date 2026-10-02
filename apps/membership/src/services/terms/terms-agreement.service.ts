import { Injectable } from '@nestjs/common';
import { ArrearsGate } from '../arrears/arrears.gate';
import { RecordTermsAgreementInput, TermsAgreementManager } from './terms-agreement.manager';

@Injectable()
export class TermsAgreementService {
  constructor(
    private readonly termsAgreementManager: TermsAgreementManager,
    private readonly arrearsGate: ArrearsGate,
  ) {}

  /**
   * 동의는 가입 폼 제출 «순간» 적힌다 — 자동이체 계좌를 등록하러 사이트를 떠나기 전이다.
   * 미납 관문을 여기에도 세워, 계좌 등록까지 마치고 돌아와서야 거절당하는 일을 막는다.
   */
  async record(input: RecordTermsAgreementInput): Promise<{ agreementId: string }> {
    await this.arrearsGate.assertNoOutstanding(input.userId);
    return this.termsAgreementManager.record(input);
  }
}

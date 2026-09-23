import { Injectable } from '@nestjs/common';
import { RecordTermsAgreementInput, TermsAgreementManager } from './terms-agreement.manager';

@Injectable()
export class TermsAgreementService {
  constructor(private readonly termsAgreementManager: TermsAgreementManager) {}

  async record(input: RecordTermsAgreementInput): Promise<{ agreementId: string }> {
    return this.termsAgreementManager.record(input);
  }
}

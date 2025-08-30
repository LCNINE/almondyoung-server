import {
  AgreementFileResponseDto,
  RegisterAgreementRequest,
} from 'hms-api-wrapper';

import * as schema from '../shared/database/schema';
import { WalletTx } from '../shared/database';
export interface MemberStatusResult {
  status: 'PENDING' | 'REGISTERED' | 'FAILED';
  registeredAt?: Date;
}

export interface MethodManagementPort {
  registerMember(
    request: typeof schema.paymentMethod.$inferSelect,
    tx: WalletTx,
    paymentMethod: typeof schema.paymentMethod.$inferSelect,
  ): Promise<any>;

  submitConsent(
    request: RegisterAgreementRequest,
  ): Promise<{ success: boolean; rawResponse: AgreementFileResponseDto }>;

  getMemberStatus(memberId: string): Promise<MemberStatusResult>;
}

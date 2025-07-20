import { CreatePaymentMethodPayload } from '../../shared/zod/payment-method.zod';

export abstract class MethodManagementPort {
  abstract registerMember(request: CreatePaymentMethodPayload): Promise<any>;
  abstract getMemberStatus(memberId: string): Promise<any>;
}

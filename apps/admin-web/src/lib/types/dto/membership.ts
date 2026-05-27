export interface AdminRecurringContractSummary {
  contractId: string;
  userId: string;
  status: string;
  planId: string;
  tierCode: string;
  planDurationDays: number;
  autoRenewal: boolean;
  nextBillingDate: string | null;
  startsAt: string | null;
  endsAt: string | null;
  lastPaymentIntentId: string | null;
}

export interface AdminRecurringContractListItem {
  contractId: string;
  userId: string;
  status: string;
  tierCode: string;
  planDurationDays: number;
  autoRenewal: boolean;
  nextBillingDate: string | null;
  startsAt: string | null;
  endsAt: string | null;
  lastPaymentIntentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminRecurringContractsResponse {
  data: AdminRecurringContractListItem[];
  total: number;
  page: number;
  limit: number;
}

export interface AgreementStateEntry {
  billingAgreementId: string;
  billingMethodId: string;
  providerType: string;
  cmsMemberId: string | null;
  cmsMemberRowId: string | null;
  cmsMemberStatus: string | null;
  agreementStatus: string | null;
}

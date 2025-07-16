// HMS API 서비스들의 인터페이스 정의

export interface IPaymentProfileService {
  create(profileData: any): Promise<any>;
  update(profileId: string, profileData: any): Promise<any>;
  get(profileId: string): Promise<any>;
  delete(profileId: string): Promise<any>;
}

export interface IPaymentTransactionService {
  approve(transactionData: any): Promise<any>;
  cancel(transactionId: string, cancelData?: any): Promise<any>;
  partialCancel(transactionId: string, cancelData: any): Promise<any>;
  get(transactionId: string): Promise<any>;
}

export interface IBatchCmsMemberService {
  create(memberData: any): Promise<any>;
  update(memberId: string, memberData: any): Promise<any>;
  get(memberId: string): Promise<any>;
  delete(memberId: string): Promise<void>;
}

export interface IBatchCmsAgreementService {
  register(custId: string, memberId: string, fileInput: any): Promise<any>;
  get(custId: string, agreementKey: string): Promise<any>;
}

export interface IBatchCmsWithdrawalService {
  request(paymentData: any): Promise<any>;
  get(transactionId: string): Promise<any>;
  update(transactionId: string, updateData: any): Promise<any>;
  delete(transactionId: string): Promise<void>;
  list(query?: any): Promise<any>;
}
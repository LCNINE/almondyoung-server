import { Injectable } from '@nestjs/common';
import { MockHmsAPI } from 'hms-api-wrapper';
import { 
  IBatchCmsMemberService, 
  IBatchCmsAgreementService, 
  IBatchCmsWithdrawalService 
} from '../interfaces/hms-api.interface';

/**
 * 배치 CMS 회원 서비스 (목업서버 사용)
 */
@Injectable()
export class BatchCmsMemberService implements IBatchCmsMemberService {
  private mockApi: MockHmsAPI;

  constructor() {
    this.mockApi = new MockHmsAPI({
      swKey: process.env.HMS_SW_KEY || 'mock-sw',
      custKey: process.env.HMS_CUST_KEY || 'mock-cust',
      isTest: process.env.NODE_ENV !== 'production',
    });
    console.log('🔧 BatchCmsMemberService - 목업서버 사용');
  }

  async create(memberData: any): Promise<any> {
    return this.mockApi.members.create(memberData);
  }

  async update(memberId: string, memberData: any): Promise<any> {
    return this.mockApi.members.update(memberId, memberData);
  }

  async get(memberId: string): Promise<any> {
    return this.mockApi.members.get(memberId);
  }

  async delete(memberId: string): Promise<void> {
    return this.mockApi.members.delete(memberId);
  }
}

/**
 * 배치 CMS 동의서 서비스 (목업서버 사용)
 */
@Injectable()
export class BatchCmsAgreementService implements IBatchCmsAgreementService {
  private mockApi: MockHmsAPI;

  constructor() {
    this.mockApi = new MockHmsAPI({
      swKey: process.env.HMS_SW_KEY || 'mock-sw',
      custKey: process.env.HMS_CUST_KEY || 'mock-cust',
      isTest: process.env.NODE_ENV !== 'production',
    });
    console.log('🔧 BatchCmsAgreementService - 목업서버 사용');
  }

  async register(custId: string, memberId: string, fileInput: any): Promise<any> {
    return this.mockApi.agreements.register(custId, memberId, fileInput);
  }

  async get(custId: string, agreementKey: string): Promise<any> {
    return this.mockApi.agreements.get(custId, agreementKey);
  }
}

/**
 * 배치 CMS 출금 서비스 (목업서버 사용)
 */
@Injectable()
export class BatchCmsWithdrawalService implements IBatchCmsWithdrawalService {
  private mockApi: MockHmsAPI;

  constructor() {
    this.mockApi = new MockHmsAPI({
      swKey: process.env.HMS_SW_KEY || 'mock-sw',
      custKey: process.env.HMS_CUST_KEY || 'mock-cust',
      isTest: process.env.NODE_ENV !== 'production',
    });
    console.log('🔧 BatchCmsWithdrawalService - 목업서버 사용');
  }

  async request(paymentData: any): Promise<any> {
    return this.mockApi.withdrawals.request(paymentData);
  }

  async get(transactionId: string): Promise<any> {
    return this.mockApi.withdrawals.get(transactionId);
  }

  async update(transactionId: string, updateData: any): Promise<any> {
    return this.mockApi.withdrawals.update(transactionId, updateData);
  }

  async delete(transactionId: string): Promise<void> {
    return this.mockApi.withdrawals.delete(transactionId);
  }

  async list(query?: any): Promise<any> {
    return this.mockApi.withdrawals.list(query);
  }

  async healthCheck(): Promise<any> {
    return this.mockApi.healthCheck();
  }
}
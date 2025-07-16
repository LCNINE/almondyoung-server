import { Injectable } from '@nestjs/common';
import { HmsAPI } from 'hms-api-wrapper';
import {
  IPaymentProfileService,
  IPaymentTransactionService,
} from '../interfaces/hms-api.interface';

/**
 * 카드 결제 프로필 서비스 (실제 HMS API 사용)
 */
@Injectable()
export class CardPaymentProfileService implements IPaymentProfileService {
  private hmsApi: HmsAPI;

  constructor() {
    this.hmsApi = new HmsAPI({
      swKey: process.env.HMS_SW_KEY || 'mock-sw',
      custKey: process.env.HMS_CUST_KEY || 'mock-cust',
      isTest: process.env.NODE_ENV !== 'production',
    });
    console.log('🔥 CardPaymentProfileService - 실제 HMS API 사용');
  }

  async create(profileData: any): Promise<any> {
    return this.hmsApi.paymentProfiles.create(profileData);
  }

  async update(profileId: string, profileData: any): Promise<any> {
    return this.hmsApi.paymentProfiles.update(profileId, profileData);
  }

  async get(profileId: string): Promise<any> {
    return this.hmsApi.paymentProfiles.get(profileId);
  }

  async delete(profileId: string): Promise<any> {
    return this.hmsApi.paymentProfiles.delete(profileId);
  }
}

/**
 * 카드 결제 거래 서비스 (실제 HMS API 사용)
 */
@Injectable()
export class CardPaymentTransactionService
  implements IPaymentTransactionService
{
  private hmsApi: HmsAPI;

  constructor() {
    this.hmsApi = new HmsAPI({
      swKey: process.env.HMS_SW_KEY || 'mock-sw',
      custKey: process.env.HMS_CUST_KEY || 'mock-cust',
      isTest: process.env.NODE_ENV !== 'production',
    });
    console.log('🔥 CardPaymentTransactionService - 실제 HMS API 사용');
  }

  async approve(transactionData: any): Promise<any> {
    return this.hmsApi.paymentTryansactions.requestTryansaction(
      transactionData,
    );
  }

  async cancel(transactionId: string, cancelData?: any): Promise<any> {
    return this.hmsApi.paymentTryansactions.cancelTryansaction(transactionId);
  }

  async partialCancel(transactionId: string, cancelData: any): Promise<any> {
    const { cancelAmount } = cancelData;
    return this.hmsApi.paymentTryansactions.cancelPartialTryansaction(
      transactionId,
      cancelAmount,
    );
  }

  async get(transactionId: string): Promise<any> {
    return this.hmsApi.paymentTryansactions.getTryansaction(transactionId);
  }
}

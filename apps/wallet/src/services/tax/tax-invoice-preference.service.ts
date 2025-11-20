import { Injectable, Logger } from '@nestjs/common';
import { TaxInvoiceRepository } from './tax-invoice.repository';
import type {
  UserTaxInvoicePreference,
  BusinessInfo,
} from '../../shared/database/types';
import type { WalletExecutor } from '../../shared/database';

/**
 * TaxInvoicePreferenceService
 *
 * 책임: 사용자 세금계산서 기본 설정 관리
 */
@Injectable()
export class TaxInvoicePreferenceService {
  private readonly logger = new Logger(TaxInvoicePreferenceService.name);

  constructor(private readonly repo: TaxInvoiceRepository) {}

  /**
   * 사용자 기본 설정 조회
   */
  async getPreference(
    userId: string,
    tx?: WalletExecutor,
  ): Promise<UserTaxInvoicePreference | null> {
    return await this.repo.findPreferenceByUserId(userId, tx);
  }

  /**
   * 사용자 기본 설정 조회 (없으면 기본값 반환)
   */
  async getPreferenceOrDefault(
    userId: string,
    tx?: WalletExecutor,
  ): Promise<UserTaxInvoicePreference> {
    const preference = await this.repo.findPreferenceByUserId(userId, tx);

    if (preference) return preference;

    // 기본값 반환 (DB에 저장하지 않음)
    return {
      userId,
      defaultEnabled: 0, // false
      defaultBusinessInfo: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  /**
   * 기본 설정 업데이트 (Upsert)
   */
  async updatePreference(
    userId: string,
    defaultEnabled: boolean,
    defaultBusinessInfo?: BusinessInfo,
    tx?: WalletExecutor,
  ): Promise<UserTaxInvoicePreference> {
    // 검증
    if (defaultEnabled && !defaultBusinessInfo) {
      throw new Error('기본 사업자 정보가 필요합니다');
    }

    if (defaultBusinessInfo) {
      this.validateBusinessInfo(defaultBusinessInfo);
    }

    // Upsert
    const result = await this.repo.upsertPreference(
      {
        userId,
        defaultEnabled: defaultEnabled ? 1 : 0,
        defaultBusinessInfo: defaultBusinessInfo as any,
      },
      tx,
    );

    this.logger.log(`TaxInvoicePreference updated for user: ${userId}`);
    return result;
  }

  /**
   * 사업자 정보 검증
   */
  private validateBusinessInfo(businessInfo: BusinessInfo): void {
    if (!businessInfo.name) {
      throw new Error('사업자명이 필요합니다');
    }
    if (!businessInfo.businessNumber) {
      throw new Error('사업자등록번호가 필요합니다');
    }
    if (!businessInfo.address) {
      throw new Error('사업장 주소가 필요합니다');
    }
    if (!businessInfo.ownerName) {
      throw new Error('대표자명이 필요합니다');
    }

    // 사업자등록번호 형식 검증 (000-00-00000)
    const numberPattern = /^\d{3}-?\d{2}-?\d{5}$/;
    if (!numberPattern.test(businessInfo.businessNumber)) {
      throw new Error('사업자등록번호 형식이 올바르지 않습니다');
    }
  }

  /**
   * 기본 설정 삭제
   */
  async deletePreference(userId: string, tx?: WalletExecutor): Promise<void> {
    await this.repo.deletePreference(userId, tx);
    this.logger.log(`TaxInvoicePreference deleted for user: ${userId}`);
  }
}

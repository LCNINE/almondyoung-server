import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { eq } from 'drizzle-orm';
import { WalletSchema, cmsAgreements } from '../schema';
import { CmsAgreementRecord } from '../types';
import { CmsApiClient } from './cms-api.client';
import { CmsMemberService } from './cms-member.service';

/** 효성 API 5xx/네트워크 일시 장애 — 재시도 가능. 영구 실패로 기록하지 않는다. */
export class CmsAgreementRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CmsAgreementRetryableError';
  }
}

@Injectable()
export class CmsAgreementService {
  private readonly logger = new Logger(CmsAgreementService.name);

  constructor(
    private readonly dbService: DbService<WalletSchema>,
    private readonly cmsApi: CmsApiClient,
    private readonly cmsMemberService: CmsMemberService,
  ) {}

  /**
   * 동의자료 업로드.
   * wallet-web에서 결제 시도 전 동의자료 등록 여부를 확인하고, 미등록이면 업로드 UI를 제공한다.
   */
  async uploadAgreement(
    cmsMemberId: string,
    file: Buffer,
    fileType: string,
    fileExtension: string,
  ): Promise<CmsAgreementRecord> {
    // 회원 존재 확인
    const member = await this.cmsMemberService.findByCmsMemberId(cmsMemberId);
    if (!member) {
      throw new Error('CMS member not found');
    }

    const result = await this.cmsApi.uploadAgreement(cmsMemberId, file, fileType, fileExtension);
    if (!result.ok) {
      if (result.statusCode >= 500) {
        throw new CmsAgreementRetryableError(
          `CMS agreement upload API error: ${result.error.code} ${result.error.message}`,
        );
      }
      throw new Error(`CMS agreement upload failed: ${result.error.code} ${result.error.message}`);
    }

    const agreementFile = result.data.agreementFile;
    const rows = await this.dbService.db
      .insert(cmsAgreements)
      .values({
        cmsMemberId,
        agreementKey: agreementFile.agreementKey ?? null,
        fileType,
        fileExtension,
        status: agreementFile.registerStatus ?? '등록',
        resultCode: agreementFile.result?.code ?? null,
        resultMessage: agreementFile.result?.message ?? null,
      })
      .returning();

    return rows[0];
  }

  /**
   * 동의자료 조회 (agreementKey 기준).
   */
  async getAgreement(agreementKey: string): Promise<CmsAgreementRecord | undefined> {
    const rows = await this.dbService.db
      .select()
      .from(cmsAgreements)
      .where(eq(cmsAgreements.agreementKey, agreementKey))
      .limit(1);
    return rows[0];
  }

  /**
   * 특정 회원의 동의자료 목록 조회.
   */
  async findByCmsMemberId(cmsMemberId: string): Promise<CmsAgreementRecord[]> {
    return this.dbService.db
      .select()
      .from(cmsAgreements)
      .where(eq(cmsAgreements.cmsMemberId, cmsMemberId));
  }

  /**
   * 동의자료 업로드 실패를 DB에 기록.
   * 회원등록 성공 후 업로드가 실패한 경우 관리자 처리 필요 상태로 남긴다.
   */
  async recordAgreementFailure(
    cmsMemberId: string,
    fileType: string,
    fileExtension: string,
    reason: string,
  ): Promise<CmsAgreementRecord> {
    const rows = await this.dbService.db
      .insert(cmsAgreements)
      .values({
        cmsMemberId,
        agreementKey: null,
        fileType,
        fileExtension,
        status: '실패',
        resultCode: 'UPLOAD_FAILED',
        resultMessage: reason.slice(0, 255),
      })
      .returning();
    return rows[0];
  }

  /**
   * 동의자료 상태를 효성 API로 확인하여 갱신.
   */
  async refreshStatus(agreementKey: string): Promise<CmsAgreementRecord | undefined> {
    const existing = await this.getAgreement(agreementKey);
    if (!existing) return undefined;

    const result = await this.cmsApi.getAgreement(agreementKey);
    if (!result.ok) {
      this.logger.warn(`CMS agreement query failed for ${agreementKey}: ${result.error.code}`);
      return existing;
    }

    const agreementFile = result.data.agreementFile;
    const newStatus = agreementFile.registerStatus ?? existing.status;
    const resultCode = agreementFile.result?.code ?? null;
    const resultMessage = agreementFile.result?.message ?? null;

    await this.dbService.db
      .update(cmsAgreements)
      .set({ status: newStatus, resultCode, resultMessage, updatedAt: new Date() })
      .where(eq(cmsAgreements.agreementKey, agreementKey));

    return { ...existing, status: newStatus, resultCode, resultMessage };
  }
}

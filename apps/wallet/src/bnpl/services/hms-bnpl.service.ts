import { Injectable, Logger } from '@nestjs/common';
import { MockHmsAPI } from 'hms-api-wrapper';
import { CreateBnplAccountPayload } from '../../shared/zod';

/**
 * HMS 배치 CMS 연동 서비스
 *
 * 주요 기능:
 * 1. HMS 배치 CMS 회원 등록/삭제
 * 2. 동의자료 제출
 * 3. 출금 요청
 */
@Injectable()
export class HmsBnplService {
  private readonly logger = new Logger(HmsBnplService.name);
  private readonly mockApi: MockHmsAPI;

  constructor() {
    this.mockApi = new MockHmsAPI({
      swKey: process.env.HMS_SW_KEY || 'mock-sw',
      custKey: process.env.HMS_CUST_KEY || 'mock-cust',
      isTest: process.env.NODE_ENV !== 'production',
    });
    this.logger.log('🔧 HMS BNPL 서비스 초기화 완료 (목업서버 사용)');
  }

  /**
   * HMS 배치 CMS 회원 등록
   */
  async registerMember(dto: CreateBnplAccountPayload) {
    this.logger.log(`[HMS] 배치 CMS 회원 등록: ${dto.userId}`);

    const payload = this.toHmsMemberDto(dto);
    const result = await this.mockApi.members.create(payload);

    this.logger.log(`[HMS] 배치 CMS 회원 등록 성공: ${result.member.memberId}`);
    return result;
  }

  /**
   * HMS 배치 CMS 회원 삭제
   */
  async deleteMember(memberId: string) {
    this.logger.log(`[HMS] 배치 CMS 회원 삭제: ${memberId}`);

    await this.mockApi.members.delete(memberId);

    this.logger.log(`[HMS] 배치 CMS 회원 삭제 성공`);
    return { success: true };
  }

  /**
   * HMS 배치 CMS 동의자료 제출
   */
  async submitAgreement({
    memberId,
    custId,
    agreementText,
    filename,
    mimetype,
    buffer,
  }: {
    memberId: string;
    custId: string;
    agreementText: string;
    filename: string;
    mimetype: string;
    buffer: Buffer;
  }) {
    this.logger.log(`[HMS] 배치 CMS 동의자료 제출: ${memberId}`);

    // 1. Buffer → Blob 변환 (글로벌 Blob)
    const blob = new Blob([buffer], { type: mimetype });
    // 2. FormData 생성 (글로벌 FormData)
    const formData = new FormData();
    formData.append('file', blob, filename);
    formData.append('memberId', memberId);
    if (custId) formData.append('custId', custId);
    if (agreementText) formData.append('agreementText', agreementText);

    // 3. fetch로 MockHmsAPI(목업서버)에 동의자료 제출
    const response = await fetch(
      `http://localhost:3005/v1/custs/${custId}/agreements`,
      {
        method: 'POST',
        body: formData,
        // Content-Type은 fetch가 자동으로 생성
      },
    );
    const result = await response.json();

    this.logger.log(
      `[HMS] 배치 CMS 동의자료 제출 성공: ${result.agreementFile?.agreementKey}`,
    );
    return result;
  }

  /**
   * HMS 배치 CMS 출금 요청ㅋ
   */
  async requestWithdrawal(withdrawalData: any) {
    this.logger.log(`[HMS] 배치 CMS 출금 요청: ${withdrawalData.memberId}`);

    const result = await this.mockApi.withdrawals.request(withdrawalData);

    this.logger.log(
      `[HMS] 배치 CMS 출금 요청 성공: ${result.payment.transactionId}`,
    );
    return result;
  }

  /**
   * HMS 배치 CMS 상태 확인
   */
  async checkHealth() {
    try {
      await this.mockApi.healthCheck();

      return {
        status: 'ok',
        message: 'HMS BNPL Service is connected',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`[HMS] 배치 CMS 상태 확인 실패: ${error.message}`);

      return {
        status: 'error',
        message: 'HMS BNPL Service connection failed',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * DTO를 HMS CMS 회원 등록 요청으로 변환
   */
  private toHmsMemberDto(dto: any) {
    const timestamp = Date.now();
    return {
      memberId: dto.userId, // 타임스탬프 추가하여 고유한 ID 생성
      memberName: dto.methodName,
      payerName: dto.methodName,
      paymentKind: 'CMS' as const, // 문자열 리터럴 타입으로 명시적 지정
      paymentCompany: dto.institutionCode,
      paymentNumber: `${dto.userId}${timestamp}`, // 고유한 계좌번호 생성
      payerNumber: '9001011234', // 임시 생년월일
      phone: dto.phone || '01012345678',
      email: `bnpl_${dto.userId}_${timestamp}@example.com`,
    };
  }
}

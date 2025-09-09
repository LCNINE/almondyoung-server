// controllers/v2/bnpl-profile.controller.ts

import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Req,
} from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { MultipartFile } from '@fastify/multipart';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiInternalServerErrorResponse,
} from '@nestjs/swagger';
import {
  BnplProfileRegistrationDto,
  ProfileRegistrationResponseDto,
  ConsentStatusResponseDto,
} from '../../shared/dtos/profile-registration.dto';
import { PaymentProviderFactory } from '../../providers/payment-provider.factory';
import { hasWithdrawalConsentCapability } from '../../providers/capabilities/withdrawal-consent.capability';

/**
 * BNPL Profile Controller
 *
 * 책임:
 * - BNPL 출금동의서 제출 및 심사 관리
 * - 승인된 동의서로 정식 결제프로필 생성
 * - Capability 기반 Provider 호출
 * - Discriminated Union DTO 처리
 */
@ApiTags('BNPL Profile v2')
@Controller('v2/bnpl-profiles')
export class BnplProfileController {
  private readonly logger = new Logger(BnplProfileController.name);

  constructor(private readonly providerFactory: PaymentProviderFactory) {}

  /**
   * 서비스에서 던진 Error를 HTTP 상태코드로 매핑 (CTO 스타일)
   */
  private mapErrorToHttpException(error: Error): HttpException {
    const message = error.message.toLowerCase();

    if (message.includes('not found')) {
      return new HttpException(error.message, HttpStatus.NOT_FOUND);
    }

    if (
      message.includes('not approved') ||
      message.includes('invalid') ||
      message.includes('insufficient') ||
      message.includes('failed') ||
      message.includes('rejected')
    ) {
      return new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }

    if (message.includes('already processed')) {
      return new HttpException(error.message, HttpStatus.CONFLICT);
    }

    // 기본: 서버 내부 오류
    return new HttpException(
      'Internal server error',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  // -------------------------------
  // BNPL 출금동의서 제출 (Fastify 파일 업로드)
  // -------------------------------
  @Post(':memberId/consent')
  @HttpCode(200)
  @ApiOperation({
    summary: 'BNPL 출금동의서 제출 (파일 업로드)',
    description: `
BNPL 후불결제 이용을 위한 출금동의서를 파일과 함께 제출합니다:
- Fastify multipart/form-data 파일 업로드
- HMS BatchCMS API를 통한 회원 등록 및 동의서 파일 업로드
- Mock 서버 30초 스케줄러로 자동 승인 처리

**Mock 서버 특징**: 제출 후 30초 후 자동으로 승인 상태로 변경
**실제 환경**: 2-3일 심사 과정
    `,
  })
  @ApiResponse({
    status: 200,
    description: '출금동의서 제출 성공',
    type: ProfileRegistrationResponseDto,
  })
  async submitConsent(
    @Param('memberId') memberId: string,
    @Req() request: FastifyRequest,
  ): Promise<ProfileRegistrationResponseDto> {
    this.logger.log(`BNPL 출금동의서 제출: memberId=${memberId}`);

    try {
      // Fastify 파일 업로드 처리
      const data: MultipartFile | undefined = await (request as any).file();
      if (!data) {
        throw new Error('출금동의서 파일이 필요합니다');
      }

      // 파일 스트림을 Buffer로 변환
      const buffer = await data.toBuffer();

      this.logger.log(
        `파일 업로드 완료: ${data.filename} (${buffer.length} bytes)`,
      );

      // HMS BNPL Provider 가져오기
      const provider = this.providerFactory.getProvider('HMS_BNPL');

      if (!hasWithdrawalConsentCapability(provider)) {
        throw new Error(
          'HMS BNPL Provider가 출금동의서 기능을 지원하지 않습니다',
        );
      }

      // 출금동의서 제출 (Mock 회원 정보 사용)
      const result = await provider.submitWithdrawalConsent({
        userId: `user_${memberId}`,
        memberInfo: {
          memberId: memberId,
          memberName: '테스트사용자',
          payerName: '테스트사용자',
          paymentKind: 'CMS',
          paymentCompany: '088', // 신한은행
          paymentNumber: '1234567890123456',
          payerNumber: '1234567890',
          phone: '01012345678',
        },
        agreementFiles: [
          {
            memberId: memberId, // HMS API 요구사항
            file: buffer,
            filename: data.filename,
          },
        ],
        metadata: {
          applicationReason: 'BNPL 후불결제 서비스 이용',
          expectedUsage: 'E2E 테스트용',
          uploadedAt: new Date().toISOString(),
        },
      });

      const response: ProfileRegistrationResponseDto = {
        success: result.success,
        status:
          result.status === 'UNDER_REVIEW'
            ? 'UNDER_REVIEW'
            : result.status === 'REJECTED'
              ? 'REJECTED'
              : 'PENDING_REVIEW',
        consentId: result.consentId,
        expectedReviewDays: result.expectedReviewDays,
        registeredAt: result.submittedAt,
        error: result.error,
        metadata: {
          hmsMemberId: result.hmsMemberId,
          reviewMessage: result.reviewMessage,
          filename: data.filename,
          fileSize: buffer.length,
          mockScheduler: 'Mock 서버에서 30초 후 자동 승인 처리됩니다',
          ...result.metadata,
        },
      };

      this.logger.log(`BNPL 출금동의서 제출 완료: ${result.consentId}`);
      return response;
    } catch (error) {
      this.logger.error(`BNPL 출금동의서 제출 실패: ${error.message}`);
      throw this.mapErrorToHttpException(error);
    }
  }

  // -------------------------------
  // BNPL 출금동의서 제출 (기존 JSON 방식 - 테스트용)
  // -------------------------------
  @Post('withdrawal-consent')
  @HttpCode(200) // v4 아키텍처 규칙: 모든 POST는 200
  @ApiOperation({
    summary: 'BNPL 출금동의서 제출 (JSON)',
    description: `
BNPL 후불결제 이용을 위한 출금동의서를 JSON으로 제출합니다 (테스트용):
- HMS BatchCMS API를 통한 회원 등록
- 동의서 파일 Mock 처리
- 2-3일 심사 과정 시작

**권장**: \`POST /:memberId/consent\` 파일 업로드 방식 사용
    `,
  })
  @ApiResponse({
    status: 200,
    description: '출금동의서 제출 성공',
    type: ProfileRegistrationResponseDto,
  })
  @ApiBadRequestResponse({ description: '잘못된 요청 데이터' })
  @ApiInternalServerErrorResponse({ description: 'HMS API 오류' })
  async submitWithdrawalConsent(
    @Body() dto: BnplProfileRegistrationDto,
  ): Promise<ProfileRegistrationResponseDto> {
    this.logger.log(`BNPL 출금동의서 제출 요청: userId=${dto.userId}`);

    try {
      // HMS BNPL Provider 가져오기
      const provider = this.providerFactory.getProvider('HMS_BNPL');

      if (!hasWithdrawalConsentCapability(provider)) {
        throw new Error(
          'HMS BNPL Provider가 출금동의서 기능을 지원하지 않습니다',
        );
      }

      // 출금동의서 제출
      const result = await provider.submitWithdrawalConsent({
        userId: dto.userId,
        memberInfo: dto.bnplData.memberInfo,
        agreementFiles: dto.bnplData.agreementFiles,
        metadata: {
          applicationReason: dto.bnplData.applicationReason,
          expectedUsage: dto.bnplData.expectedUsage,
        },
      });

      const response: ProfileRegistrationResponseDto = {
        success: result.success,
        status:
          result.status === 'UNDER_REVIEW'
            ? 'UNDER_REVIEW'
            : result.status === 'REJECTED'
              ? 'REJECTED'
              : 'PENDING_REVIEW',
        consentId: result.consentId,
        expectedReviewDays: result.expectedReviewDays,
        registeredAt: result.submittedAt,
        error: result.error,
        metadata: {
          hmsMemberId: result.hmsMemberId,
          reviewMessage: result.reviewMessage,
          ...result.metadata,
        },
      };

      this.logger.log(`BNPL 출금동의서 제출 완료: ${result.consentId}`);
      return response;
    } catch (error) {
      this.logger.error(`BNPL 출금동의서 제출 실패: ${error.message}`);
      throw this.mapErrorToHttpException(error);
    }
  }

  // -------------------------------
  // 출금동의서 심사 상태 조회
  // -------------------------------
  @Get('consent/:consentId/status')
  @ApiOperation({
    summary: '출금동의서 심사 상태 조회',
    description: `
제출된 출금동의서의 심사 상태를 조회합니다:
- SUBMITTED: 제출됨
- UNDER_REVIEW: 심사 중
- APPROVED: 승인됨 (프로필 생성 가능)
- REJECTED: 거절됨 (재제출 필요)

**승인된 경우**: \`nextAction: 'CREATE_PROFILE'\` 확인 후 프로필 생성 진행
    `,
  })
  @ApiResponse({
    status: 200,
    description: '심사 상태 조회 성공',
    type: ConsentStatusResponseDto,
  })
  @ApiNotFoundResponse({ description: '출금동의서를 찾을 수 없음' })
  async getConsentStatus(
    @Param('consentId') consentId: string,
  ): Promise<ConsentStatusResponseDto> {
    this.logger.log(`출금동의서 상태 조회: ${consentId}`);

    try {
      // HMS BNPL Provider 가져오기
      const provider = this.providerFactory.getProvider('HMS_BNPL');

      if (!hasWithdrawalConsentCapability(provider)) {
        throw new Error(
          'HMS BNPL Provider가 출금동의서 기능을 지원하지 않습니다',
        );
      }

      // 심사 상태 조회
      const result = await provider.checkConsentStatus(consentId);

      const response: ConsentStatusResponseDto = {
        consentId: result.consentId,
        status: result.status,
        submittedAt: result.submittedAt,
        reviewedAt: result.reviewedAt,
        approvedAt: result.approvedAt,
        rejectionReason: result.rejectionReason,
        canCreateProfile: result.canCreateProfile,
        nextAction: result.nextAction,
        metadata: result.metadata,
      };

      return response;
    } catch (error) {
      this.logger.error(`출금동의서 상태 조회 실패: ${error.message}`);
      throw this.mapErrorToHttpException(error);
    }
  }

  // -------------------------------
  // 승인된 동의서로 정식 프로필 생성
  // -------------------------------
  @Post('consent/:consentId/create-profile')
  @HttpCode(200)
  @ApiOperation({
    summary: '승인된 출금동의서로 정식 결제프로필 생성',
    description: `
심사가 승인된 출금동의서를 기반으로 정식 BNPL 결제프로필을 생성합니다:
- 승인 상태 확인
- HMS 회원 정보 연동
- 결제프로필 DB 저장

**사전 조건**: 출금동의서 상태가 \`APPROVED\` 이고 \`canCreateProfile: true\`
    `,
  })
  @ApiResponse({
    status: 200,
    description: '결제프로필 생성 성공',
    type: ProfileRegistrationResponseDto,
  })
  @ApiBadRequestResponse({ description: '동의서가 승인되지 않음' })
  @ApiNotFoundResponse({ description: '출금동의서를 찾을 수 없음' })
  async createProfileFromConsent(
    @Param('consentId') consentId: string,
    @Body()
    profileOptions: {
      profileName: string;
      paymentPurpose: 'ORDER' | 'RECURRING' | 'BOTH';
      isDefault?: boolean;
      userId?: string;
    },
  ): Promise<ProfileRegistrationResponseDto> {
    this.logger.log(`승인된 출금동의서로 프로필 생성: consentId=${consentId}`);

    try {
      // HMS BNPL Provider 가져오기
      const provider = this.providerFactory.getProvider('HMS_BNPL');

      if (!hasWithdrawalConsentCapability(provider)) {
        throw new Error(
          'HMS BNPL Provider가 출금동의서 기능을 지원하지 않습니다',
        );
      }

      // 승인된 동의서로 프로필 생성 (userId 포함)
      const result = await provider.createProfileFromApprovedConsent(
        consentId,
        {
          profileName: profileOptions.profileName,
          paymentPurpose: profileOptions.paymentPurpose,
          isDefault: profileOptions.isDefault,
          userId: profileOptions.userId || 'temp_user_from_consent', // 실제로는 JWT에서 가져와야 함
        },
      );

      if (!result.success) {
        throw new Error(result.error || '프로필 생성에 실패했습니다');
      }

      const response: ProfileRegistrationResponseDto = {
        success: true,
        profileId: result.profileId,
        status: 'ACTIVE',
        registeredAt: new Date().toISOString(),
        metadata: {
          consentId,
          profileOptions,
        },
      };

      this.logger.log(`BNPL 프로필 생성 완료: ${result.profileId}`);
      return response;
    } catch (error) {
      this.logger.error(`BNPL 프로필 생성 실패: ${error.message}`);
      throw this.mapErrorToHttpException(error);
    }
  }
}

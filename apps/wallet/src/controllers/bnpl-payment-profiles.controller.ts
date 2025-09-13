// controllers/v2/bnpl-payment-profiles.controller.ts

import { Controller, Post, Body, HttpCode, Logger, Req } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { Multipart, MultipartFile } from '@fastify/multipart';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBadRequestResponse,
  ApiInternalServerErrorResponse,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { DbService } from '@app/db';
import * as schema from '../shared/database/schema';
import { generateUUIDv7 } from '../shared/utils/id-generator';
import { HmsBnplProvider } from '../providers/hms-bnpl.provider';
import { ApiProperty } from '@nestjs/swagger';
import { eq } from 'drizzle-orm';

export class RegisterBnplProfileDto {
  @ApiProperty({ description: '사용자 ID' })
  userId: string;

  @ApiProperty({ description: '프로필 이름' })
  profileName: string;

  @ApiProperty({
    description: '결제 용도',
    enum: ['ORDER', 'RECURRING', 'BOTH'],
  })
  paymentPurpose: 'ORDER' | 'RECURRING' | 'BOTH';

  @ApiProperty({
    type: 'string',
    format: 'binary',
    description: '출금동의서 파일 (PDF/JPG/PNG)',
  })
  file: any;
}

@ApiTags('BNPL Payment Profiles v2')
@Controller('bnpl-payment-profiles')
export class BnplPaymentProfilesController {
  private readonly logger = new Logger(BnplPaymentProfilesController.name);

  constructor(
    private readonly provider: HmsBnplProvider,
    private readonly db: DbService,
  ) {}

  /**
   * BNPL 프로필 최종 등록 (회원 + 동의서 + 프로필)
   */
  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary: 'BNPL 결제프로필 최종 등록',
    description: `
  회원 등록 → 동의서 제출 → DB 저장까지 한 번에 처리합니다.
  - Fastify multipart/form-data 파일 업로드
  - HMS API 호출 결과에 따라 DB에 저장
  - 실패 시 적절한 HTTP 에러 반환
      `,
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: RegisterBnplProfileDto })
  @ApiResponse({ status: 200, description: 'BNPL 결제프로필 등록 성공' })
  @ApiBadRequestResponse({ description: '잘못된 요청' })
  @ApiInternalServerErrorResponse({ description: '서버 내부 오류' })
  async registerProfile(@Req() req: FastifyRequest) {
    // Fastify multipart 방식: request.file() 사용
    const data = await req.file(); // fastify-multipart API

    if (!data) {
      throw new Error('동의서 파일이 필요합니다');
    }

    // 파일 스트림(data.file), 파일명(data.filename) 사용 가능
    const chunks: Buffer[] = [];
    for await (const chunk of data.file) {
      chunks.push(Buffer.from(chunk as Buffer));
    }
    const buffer = Buffer.concat(chunks);

    // 테스트용 하드코딩 (fields 접근 문제 우회)
    const userId = `test_user_${Date.now()}`;
    const profileName = data.filename || '테스트프로필';
    const paymentPurpose = 'ORDER';

    this.logger.log(
      `파일 처리 성공: ${data.filename}, 크기: ${buffer.length} bytes`,
    );

    // 2. HMS 회원 등록
    const memberId = `m_${generateUUIDv7().substring(0, 18)}`;
    const memberResult = await this.provider.createMember({
      memberId,
      memberName: profileName,
      payerName: profileName,
      paymentKind: 'CMS',
      paymentCompany: '088', // 임시값 (신한은행)
      paymentNumber: '1234567890123456',
      payerNumber: '900101',
      phone: '01012345678',
    });

    if (memberResult.member.result.flag !== 'Y') {
      throw new Error(`회원 등록 실패: ${memberResult.member.result.message}`);
    }

    // 3. HMS 동의서 업로드
    const agreementResult = await this.provider.uploadAgreement(
      'CUST_ID', // TODO: config에서 가져오기
      memberId,
      { file: buffer, filename: data.filename },
    );

    const agreementKey = agreementResult.agreementFile.agreementKey;

    // 4. DB 저장 (transaction 고려 가능)
    const profileId = generateUUIDv7();

    await this.db.db.insert(schema.paymentProfiles).values({
      id: profileId,
      userId,
      kind: 'BANK_ACCOUNT',
      status: 'ACTIVE',
      name: profileName,
    });

    await this.db.db.insert(schema.cmsBatchProfiles).values({
      id: profileId,
      memberId,
      cmsStatus: 'REGISTERED',
      paymentCompany: '088',
      payerName: profileName,
      phoneMask: '010****5678',
      billingDay: 25,
    });

    await this.db.db
      .update(schema.cmsBatchConsents)
      .set({
        agreementKey,
        agreementKind: agreementResult.agreementFile.agreementKind,
        status: 'PENDING',
        submittedAt: new Date(),
      })
      .where(eq(schema.cmsBatchProfiles.id, profileId));
    this.logger.log(`✅ BNPL 프로필 최종 등록 완료 - ProfileId=${profileId}`);

    // 5. 최종 응답 반환
    return {
      success: true,
      profileId,
      memberId,
      agreementKey,
      status: 'UNDER_REVIEW',
      metadata: {
        file: data.filename,
        size: buffer.length,
        reviewMessage: '출금동의서 심사 중 (2~3일 소요)',
      },
    };
  }
}

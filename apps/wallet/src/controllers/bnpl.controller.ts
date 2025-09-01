// controllers/bnpl.controller.ts
import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  BadRequestException,
  Req,
} from '@nestjs/common';

import { FastifyRequest } from 'fastify';

// Fastify multipart 타입 확장
interface FastifyRequestWithMultipart extends FastifyRequest {
  parts(): AsyncIterableIterator<{
    type: 'field' | 'file';
    fieldname: string;
    value?: string;
    filename?: string;
    mimetype?: string;
    file?: NodeJS.ReadableStream;
    toBuffer?(): Promise<Buffer>;
  }>;
}

import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiConsumes,
  ApiBody,
  ApiParam,
} from '@nestjs/swagger';
import { CreateBNPLMethodDto } from '../shared/dtos/bnpl/create-bnpl-method.dto';
import {
  ConsentResponseDto,
  MemberStatusResponseDto,
  PaymentMethodResponseDto,
} from '../shared/dtos/bnpl/submit-consent.dto';
import { BNPLService, type UploadedFileInfo } from '../services/bnpl.service';

@ApiTags('BNPL 후불결제')
@Controller('bnpl')
export class BNPLController {
  constructor(private readonly bnplService: BNPLService) {}

  @Post('register')
  @ApiOperation({
    summary: 'BNPL 회원 등록',
    description:
      'BNPL 후불결제 서비스 회원으로 등록합니다. 이후 출금동의서 제출이 필요합니다.',
  })
  @ApiResponse({
    status: 201,
    description: '회원 등록 성공',
    type: PaymentMethodResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: '잘못된 요청 데이터',
  })
  async registerMember(@Body() dto: CreateBNPLMethodDto) {
    return await this.bnplService.registerMember(dto);
  }

  @Post('consent')
  @ApiOperation({
    summary: '출금동의서 제출',
    description: 'BNPL 서비스 이용을 위한 출금동의서를 제출합니다.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: '출금동의서 파일과 회원 정보',
    schema: {
      type: 'object',
      properties: {
        memberId: {
          type: 'string',
          description: 'HMS 회원 ID',
          example: 'HMS_MEMBER_123456789',
        },
        consentFile: {
          type: 'string',
          format: 'binary',
          description: '출금동의서 파일 (PDF, 이미지)',
        },
      },
      required: ['memberId', 'consentFile'],
    },
  })
  @ApiResponse({
    status: 201,
    description: '동의서 제출 성공',
    type: ConsentResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: '파일이 없거나 잘못된 회원 ID',
  })
  async submitConsent(
    @Req() request: FastifyRequestWithMultipart,
  ): Promise<ConsentResponseDto> {
    try {
      // Fastify multipart 파싱 - 효율적인 스트림 처리
      const parts = request.parts();
      let memberId: string | undefined;
      let fileInfo: UploadedFileInfo | undefined;

      for await (const part of parts) {
        if (
          part.type === 'field' &&
          part.fieldname === 'memberId' &&
          part.value
        ) {
          memberId = part.value;
        } else if (
          part.type === 'file' &&
          part.fieldname === 'consentFile' &&
          part.toBuffer
        ) {
          // 파일 크기 제한 (5MB) - BNPL 서비스와 일치
          const maxSize = 5 * 1024 * 1024;

          // 스트림을 Buffer로 효율적 변환
          const buffer = await part.toBuffer();

          if (buffer.length > maxSize) {
            throw new BadRequestException('파일 크기가 5MB를 초과했습니다');
          }

          fileInfo = {
            buffer,
            filename: part.filename || 'consent-file',
            mimetype: part.mimetype || 'application/octet-stream',
            size: buffer.length,
          };
        }
      }

      if (!memberId) {
        throw new BadRequestException('memberId가 필요합니다');
      }

      if (!fileInfo) {
        throw new BadRequestException('consentFile이 필요합니다');
      }

      return await this.bnplService.submitConsent(memberId, fileInfo);
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException('파일 처리 중 오류가 발생했습니다');
    }
  }

  @Get('status/:memberId')
  @ApiOperation({
    summary: 'BNPL 회원 심사 상태 조회',
    description: 'HMS에서 BNPL 회원 심사 상태를 조회합니다.',
  })
  @ApiParam({
    name: 'memberId',
    description: 'HMS 회원 ID',
    example: 'HMS_MEMBER_123456789',
  })
  @ApiResponse({
    status: 200,
    description: '상태 조회 성공',
    type: MemberStatusResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '회원을 찾을 수 없음',
  })
  async getMemberStatus(
    @Param('memberId') memberId: string,
  ): Promise<MemberStatusResponseDto> {
    return await this.bnplService.getMemberStatus(memberId);
  }

  @Get('account/:userId')
  @ApiOperation({
    summary: 'BNPL 계정 정보 조회',
    description: '사용자의 BNPL 계정 정보를 조회합니다.',
  })
  @ApiParam({
    name: 'userId',
    description: '사용자 ID',
    example: 'user_123456789',
  })
  @ApiResponse({
    status: 200,
    description: 'BNPL 계정 정보',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        userId: { type: 'string' },
        creditLimit: { type: 'number' },
        approvedLimit: { type: 'number' },
        status: { type: 'string', enum: ['ACTIVE', 'SUSPENDED', 'OVERDUE'] },
        billingCycleDay: { type: 'number' },
        createdAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'BNPL 계정을 찾을 수 없음',
  })
  async getBNPLAccount(@Param('userId') userId: string) {
    return await this.bnplService.getBNPLAccount(userId);
  }
}

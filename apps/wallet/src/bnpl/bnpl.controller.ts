import {
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseInterceptors,
  Body,
  Req,
  HttpException,
  HttpStatus,
  UploadedFile,
} from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { BnplService } from './bnpl.service';
import {
  CreateBnplAccountDto,
  BnplAccountResponse,
} from './dto/bnpl-account.dto';
import { DeactivateBnplAccountDto } from './dto/deactivate-bnpl-account.dto';
import { FileInterceptor } from '@nestjs/platform-express';

@Controller('bnpl')
export class BnplController {
  constructor(private readonly bnplService: BnplService) {}

  /**
   * BNPL 계좌 등록 (배치 CMS 회원 등록)
   * - PG사(HMS)에 회원 등록
   * - 내부 DB에 BNPL 계정 생성
   */
  @Post('accounts')
  async createBnplAccount(@Body() dto: CreateBnplAccountDto) {
    return this.bnplService.createBnplAccount(dto);
  }

  /**
   * 사용자의 BNPL 계좌 정보 조회
   */
  @Get('accounts/:userId')
  async getBnplAccount(
    @Param('userId', ParseIntPipe) userId: string,
  ): Promise<BnplAccountResponse | null> {
    return this.bnplService.getBnplAccount(userId);
  }

  /**
   * 사용자의 모든 BNPL 계좌 목록 조회
   */
  @Get('accounts/:userId/all')
  async getBnplAccounts(@Param('userId', ParseIntPipe) userId: string) {
    return this.bnplService.getBnplAccounts(userId);
  }

  /**
   * BNPL 계좌 비활성화
   * - PG사(HMS)에서 회원 삭제
   * - 내부 DB에서 비활성화 처리 (삭제 아님)
   * - 이벤트 기록 남김
   */
  @Delete('accounts/:accountId')
  async deactivateBnplAccount(
    @Param('accountId') accountId: string,
    @Body() dto: DeactivateBnplAccountDto,
  ) {
    return this.bnplService.deactivateBnplAccount({
      ...dto,
      accountId,
    });
  }

  /**
   * BNPL 이벤트 히스토리 조회
   */
  @Get('accounts/:userId/history')
  async getBnplHistory(@Param('userId', ParseIntPipe) userId: string) {
    return this.bnplService.getBnplEventHistory(userId);
  }

  /**
   * BNPL 상태 확인 (목업서버 연결 테스트)
   */
  @Get('test/health')
  async checkBnplHealth() {
    return this.bnplService.checkBnplHealth();
  }

  /**
   * BNPL 출금신청 테스트
   */
  @Post('test/withdrawal')
  async testBnplWithdrawal(@Body() withdrawalData: any) {
    return this.bnplService.requestWithdrawal(withdrawalData);
  }

  /**
   * BNPL 동의자료 제출 (Express 환경 전용, supertest E2E 테스트용)
   */
  @Post('agreements')
  @UseInterceptors(FileInterceptor('agreementFile'))
  async submitAgreement(@Req() req: any) {
    let memberId: string;
    let file: any;

    // Fastify 환경: req.file이 함수
    if (typeof req.file === 'function') {
      const data = await req.file();
      if (!data) {
        throw new HttpException(
          'agreementFile이 업로드되지 않았습니다',
          HttpStatus.BAD_REQUEST,
        );
      }
      memberId = data.fields?.memberId?.value || data.fields?.memberId;
      file = {
        filename: data.filename,
        mimetype: data.mimetype,
        value: await data.toBuffer(),
      };
    }
    // Express 환경: req.file은 객체
    else if (req.file) {
      memberId = req.body.memberId;
      file = {
        filename: req.file.originalname,
        mimetype: req.file.mimetype,
        value: req.file.buffer,
      };
    } else {
      throw new HttpException(
        'agreementFile이 업로드되지 않았습니다',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!memberId) {
      throw new HttpException(
        'memberId가 누락되었습니다',
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.bnplService.submitAgreement({
      memberId,
      agreementFile: file,
      custId: '',
      agreementText: '',
    });
  }
  // Fastify 방식(복구 필요시 참고)
  // async submitAgreement(@Req() req: FastifyRequest) {
  //   const data = await (req as any).file();
  //   if (!data) {
  //     throw new HttpException('agreementFile이 업로드되지 않았습니다', HttpStatus.BAD_REQUEST);
  //   }
  //   const buffer = await data.toBuffer();
  //   const memberId = data.fields?.memberId?.value || data.fields?.memberId;
  //   return this.bnplService.submitAgreement({
  //     memberId,
  //     agreementFile: {
  //       filename: data.filename,
  //       mimetype: data.mimetype,
  //       value: buffer,
  //     },
  //     custId: '',
  //     agreementText: '',
  //   });
  // }
}

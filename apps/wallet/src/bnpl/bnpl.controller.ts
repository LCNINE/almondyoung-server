import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { BnplService } from './bnpl.service';
import { CreateBnplAccountDto, BnplAccountResponseDto } from './dto/bnpl-account.dto';
import { DeactivateBnplAccountDto } from './dto/deactivate-bnpl-account.dto';

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
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<BnplAccountResponseDto | null> {
    return this.bnplService.getBnplAccount(userId);
  }

  /**
   * 사용자의 모든 BNPL 계좌 목록 조회
   */
  @Get('accounts/:userId/all')
  async getBnplAccounts(
    @Param('userId', ParseIntPipe) userId: number,
  ) {
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
  async getBnplHistory(
    @Param('userId', ParseIntPipe) userId: number,
  ) {
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
}
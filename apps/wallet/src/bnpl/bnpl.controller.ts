import {
  Controller,
  Get,
  Param,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
  BadRequestException,
} from '@nestjs/common';
import { BnplAccountService } from './services/bnpl-account.service';

/**
 * BNPL 도메인 컨트롤러
 * - 사용자의 BNPL 계정 정보 조회
 * - 사용자의 BNPL 거래 내역 조회
 * - 정산 배치 정보 조회
 */
@Controller('bnpl')
export class BnplController {
  constructor(private readonly bnplAccountService: BnplAccountService) { }

  /**
   * 사용자의 BNPL 계정 정보 조회
   * GET /bnpl/accounts/me?userId=123 (임시로 쿼리 파라미터 사용)
   * TODO: JWT 인증 구현 후 @Req()에서 userId 추출하도록 변경
   */
  @Get('accounts/me')
  async getMyBnplAccount(@Query('userId') userId: string) {
    if (!userId) {
      throw new BadRequestException('userId가 필요합니다.');
    }

    const data = await this.bnplAccountService.getMyBnplAccount(userId);
    return {
      success: true,
      data,
    };
  }

  /**
   * 사용자의 BNPL 거래 내역 조회
   * GET /bnpl/accounts/me/transactions?userId=123&limit=20&offset=0
   */
  @Get('accounts/me/transactions')
  async getMyTransactions(
    @Query('userId') userId: string,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ) {
    if (!userId) {
      throw new BadRequestException('userId가 필요합니다.');
    }

    const limitNum = Math.min(limit, 100); // 최대 100개로 제한
    const { transactions, total } = await this.bnplAccountService.getMyTransactions(userId, limitNum, offset);

    return {
      success: true,
      data: {
        transactions,
        pagination: {
          total,
          limit: limitNum,
          offset,
          hasMore: offset + limitNum < total,
        },
      },
    };
  }

  /**
   * 사용자의 정산 배치 내역 조회
   * GET /bnpl/accounts/me/settlements?userId=123
   */
  @Get('accounts/me/settlements')
  async getMySettlements(@Query('userId') userId: string) {
    if (!userId) {
      throw new BadRequestException('userId가 필요합니다.');
    }

    const settlements = await this.bnplAccountService.getMySettlements(userId);
    return {
      success: true,
      data: {
        settlements,
      },
    };
  }

  /**
   * 특정 정산 배치 상세 조회
   * GET /bnpl/settlements/:batchId?userId=123
   */
  @Get('settlements/:batchId')
  async getSettlementDetail(
    @Param('batchId') batchId: string,
    @Query('userId') userId: string,
  ) {
    if (!userId) {
      throw new BadRequestException('userId가 필요합니다.');
    }

    const data = await this.bnplAccountService.getSettlementDetail(userId, batchId);
    return {
      success: true,
      data,
    };
  }
}

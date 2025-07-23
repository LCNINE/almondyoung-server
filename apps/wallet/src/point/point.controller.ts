import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Logger,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { PointService, PointHistoryOptions, AddPointsRequest } from './point.service';
import { PointTransactionType } from '../shared/schemas/schema';

/**
 * 포인트(Point) 컨트롤러
 * - GET /points/balance: 포인트 잔액 조회
 * - GET /points/history: 포인트 변동 내역 조회
 */
@Controller('points')
export class PointController {
  private readonly logger = new Logger(PointController.name);

  constructor(private readonly pointService: PointService) {}

  /**
   * 사용자 포인트 잔액 조회 API
   * 매우 빠른 조회를 위해 points 테이블만 조회
   */
  @Get('balance')
  async getPointBalance(@Query('userId') userId: string) {
    this.logger.log(`포인트 잔액 조회 API 호출: userId=${userId}`);

    try {
      if (!userId) {
        return {
          success: false,
          message: 'userId가 필요합니다.',
        };
      }

      const balance = await this.pointService.getPointBalance(userId);

      return {
        success: true,
        data: {
          userId,
          balance,
        },
      };
    } catch (error) {
      this.logger.error('포인트 잔액 조회 API 오류:', error);
      return {
        success: false,
        message: '포인트 잔액 조회에 실패했습니다.',
      };
    }
  }

  /**
   * 포인트 충전 API (테스트용)
   * 실제 서비스에서는 결제 완료 이벤트로 자동 적립되지만, 테스트를 위해 수동 충전 API 제공
   */
  @Post('charge')
  async chargePoints(@Body() chargeRequest: { userId: string; amount: number; reason: string }) {
    this.logger.log(`포인트 충전 API 호출: ${JSON.stringify(chargeRequest)}`);

    try {
      if (!chargeRequest.userId || !chargeRequest.amount || !chargeRequest.reason) {
        return {
          success: false,
          message: 'userId, amount, reason이 모두 필요합니다.',
        };
      }

      if (chargeRequest.amount <= 0) {
        return {
          success: false,
          message: '충전 금액은 0보다 커야 합니다.',
        };
      }

      const result = await this.pointService.addPoints({
        userId: chargeRequest.userId,
        amount: chargeRequest.amount,
        reason: chargeRequest.reason,
      });

      return result;
    } catch (error) {
      this.logger.error('포인트 충전 API 오류:', error);
      return {
        success: false,
        message: '포인트 충전에 실패했습니다.',
      };
    }
  }

  /**
   * 사용자 포인트 변동 내역 조회 API
   * 포인트 적립/사용/차감 등 모든 변동 내역을 조회
   */
  @Get('history')
  async getPointHistory(
    @Query('userId') userId: string,
    @Query('type') type?: PointTransactionType,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit?: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset?: number,
  ) {
    this.logger.log(
      `포인트 내역 조회 API 호출: userId=${userId}, type=${type || 'ALL'}, limit=${limit}, offset=${offset}`,
    );

    try {
      if (!userId) {
        return {
          success: false,
          message: 'userId가 필요합니다.',
        };
      }

      const options: PointHistoryOptions = {
        userId,
        type,
        limit: limit || 20,
        offset: offset || 0,
      };

      const result = await this.pointService.getPointHistory(options);

      return result;
    } catch (error) {
      this.logger.error('포인트 내역 조회 API 오류:', error);
      return {
        success: false,
        message: '포인트 내역 조회에 실패했습니다.',
      };
    }
  }
}

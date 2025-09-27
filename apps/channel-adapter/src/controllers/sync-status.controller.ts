import {
  Controller,
  Get,
  Query,
  Param,
  Logger,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { SyncStatusService } from '../services/sync-status.service';
import { DataType } from '../types';
import { ChannelType } from '../services/strategies/channel-strategy.factory';

/**
 * 동기화 상태 및 통계 조회 컨트롤러
 *
 * 판매채널별 동기화 상태, 성능 통계, 이력 조회를 위한 REST API를 제공합니다.
 *
 * @author CTO Team
 * @since 2025-09-18
 */
@ApiTags('adapter-sync-status')
@Controller('adapter/sync-status')
export class SyncStatusController {
  private readonly logger = new Logger(SyncStatusController.name);

  constructor(private readonly syncStatusService: SyncStatusService) {}

  @Get('overview')
  @ApiOperation({ summary: '전체 채널 동기화 통계 조회' })
  async getOverview() {
    try {
      this.logger.log('📊 전체 채널 동기화 통계 조회 요청');
      const allStats = await this.syncStatusService.getAllChannelStats();

      const summary = {
        totalChannels: Object.keys(allStats).length,
        activeChannels: Object.values(allStats).filter(
          (s) => s.status === 'active',
        ).length,
        errorChannels: Object.values(allStats).filter(
          (s) => s.status === 'error',
        ).length,
      };

      return {
        success: true,
        summary,
        channels: allStats,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('전체 동기화 통계 조회 실패', error.stack);
      throw new HttpException(
        '전체 동기화 통계 조회 중 오류가 발생했습니다.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('channel/:channel')
  @ApiOperation({ summary: '특정 채널의 상세 통계 조회' })
  async getChannelStats(@Param('channel') channel: ChannelType) {
    try {
      this.logger.log(`📈 채널별 통계 조회: ${channel}`);
      if (!channel) {
        throw new HttpException(
          '조회할 채널(channel)은 필수 파라미터입니다.',
          HttpStatus.BAD_REQUEST,
        );
      }

      const stats = await this.syncStatusService.getChannelStats(channel);
      if (!stats) {
        throw new NotFoundException(
          `'${channel}' 채널의 통계 정보를 찾을 수 없습니다.`,
        );
      }

      return {
        success: true,
        channel,
        stats,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`채널 통계 조회 실패: ${channel}`, error.stack);
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        '채널 통계 조회 중 오류가 발생했습니다.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('history/:channel/:dataType')
  @ApiOperation({ summary: '특정 채널의 동기화 히스토리 조회' })
  async getSyncHistory(
    @Param('channel') channel: ChannelType,
    @Param('dataType') dataType: DataType,
    @Query('limit') limit: string = '50',
  ) {
    try {
      this.logger.log(
        `📜 동기화 히스토리 조회: ${channel}/${dataType} (limit: ${limit})`,
      );
      if (!channel || !dataType) {
        throw new HttpException(
          '채널(channel)과 데이터 타입(dataType)은 필수입니다.',
          HttpStatus.BAD_REQUEST,
        );
      }

      const limitNum = Math.min(parseInt(limit) || 50, 200);
      const history = await this.syncStatusService.getSyncHistory(
        channel,
        dataType,
        limitNum,
      );

      return {
        success: true,
        channel,
        dataType,
        history,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(
        `동기화 히스토리 조회 실패: ${channel}/${dataType}`,
        error.stack,
      );
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        '동기화 히스토리 조회 중 오류가 발생했습니다.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}

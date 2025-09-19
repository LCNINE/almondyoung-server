import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiQuery,
} from '@nestjs/swagger';
import { ChannelType } from '../services/strategies/channel-strategy.factory';
import { DataType, ChannelCommand, SyncToChannelPayload } from '../types';
import { ChannelAdapterService } from '../services/channel-adapter.service';
import { AdapterOrchestrationService } from '../services/adapter-orchestration.service';

/**
 * 채널 어댑터 HTTP API 컨트롤러 (CTO 스타일 적용)
 *
 * 각 채널의 데이터 동기화 및 명령 실행을 위한 REST API 제공.
 * 컨트롤러 계층에서 명시적인 try-catch를 통해 HTTP 응답과 에러를 직접 제어합니다.
 *
 * @author CTO Team
 * @since 2025-09-18
 */
@ApiTags('adapter')
@Controller('adapter')
export class ChannelAdapterController {
  private readonly logger = new Logger(ChannelAdapterController.name);

  constructor(
    private readonly channelAdapterService: ChannelAdapterService,
    private readonly orchestrationService: AdapterOrchestrationService,
  ) {}

  @Get('health')
  @ApiOperation({ summary: '서비스 상태 확인' })
  @ApiResponse({ status: 200, description: '서비스가 정상 상태입니다.' })
  getHealth() {
    // 이 엔드포인트는 간단하여 예외 처리보다 즉시 반환이 더 효율적입니다.
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'channel-adapter',
      version: '1.1.0', // CTO 스타일 적용 버전
    };
  }

  @Get('poll')
  @ApiOperation({ summary: '채널 데이터 폴링' })
  @ApiQuery({ name: 'channel', enum: ['naver_smartstore', 'coupang'] })
  @ApiQuery({ name: 'type', enum: ['orders', 'products'] })
  @ApiResponse({ status: 200, description: '폴링 성공' })
  async poll(
    @Query('channel') channel: ChannelType,
    @Query('type') dataType: DataType,
  ) {
    try {
      if (!channel || !dataType) {
        throw new HttpException(
          '채널(channel)과 타입(type)은 필수 파라미터입니다.',
          HttpStatus.BAD_REQUEST,
        );
      }

      this.logger.log(`📥 폴링 요청: ${channel}/${dataType}`);
      const result = await this.channelAdapterService.poll(channel, dataType);
      this.logger.log(
        `✅ 폴링 완료: ${channel}/${dataType} - ${result?.length || 0}건`,
      );

      return {
        success: true,
        channel,
        dataType,
        count: result?.length || 0,
        data: result,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`❌ 폴링 실패: ${channel}/${dataType}`, error.stack);
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        '데이터 폴링 중 오류가 발생했습니다.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('sync/:channel/:dataType')
  @ApiOperation({ summary: '오케스트레이션을 통한 데이터 동기화' })
  @ApiResponse({
    status: 201,
    description: '데이터 동기화 작업이 성공적으로 시작되었습니다.',
  })
  async syncData(
    @Param('channel') channel: ChannelType,
    @Param('dataType') dataType: DataType,
  ) {
    try {
      if (!channel || !dataType) {
        throw new HttpException(
          '채널과 데이터 타입은 필수입니다.',
          HttpStatus.BAD_REQUEST,
        );
      }

      this.logger.log(`🔄 동기화 요청: ${channel}/${dataType}`);
      await this.orchestrationService.pollAndPublish(channel, dataType);
      this.logger.log(`✅ 동기화 완료: ${channel}/${dataType}`);

      return {
        success: true,
        message: `${channel} 채널의 ${dataType} 데이터 동기화가 완료되었습니다.`,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`❌ 동기화 실패: ${channel}/${dataType}`, error.stack);
      if (error instanceof HttpException) throw error;
      // 서비스에서 발생한 특정 비즈니스 예외를 여기서 HTTP 예외로 변환할 수 있습니다.
      if (error.message.includes('찾을 수 없습니다')) {
        throw new HttpException(error.message, HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        '데이터 동기화 중 오류가 발생했습니다.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('webhook/:channel')
  @ApiOperation({ summary: '외부 채널 웹훅 수신' })
  @ApiResponse({
    status: 201,
    description: '웹훅 처리가 성공적으로 완료되었습니다.',
  })
  async handleWebhook(
    @Param('channel') channel: ChannelType,
    @Body() payload: any,
  ) {
    try {
      this.logger.log(`🔔 웹훅 수신: ${channel}`);
      await this.channelAdapterService.incoming(channel, payload);
      this.logger.log(`✅ 웹훅 처리 완료: ${channel}`);

      return {
        success: true,
        message: `${channel} 채널의 웹훅이 성공적으로 처리되었습니다.`,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`❌ 웹훅 처리 실패: ${channel}`, error.stack);
      if (error instanceof HttpException) throw error;
      if (error.message.includes('유효하지 않은')) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException(
        '웹훅 처리 중 오류가 발생했습니다.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('sync-to/:channel')
  @ApiOperation({ summary: '내부 데이터를 외부 채널로 동기화 (송신)' })
  @ApiBody({
    description: '동기화할 데이터 페이로드',
    examples: {
      inventory: {
        summary: '재고 동기화',
        value: {
          dataType: 'inventory',
          payload: {
            productId: '12345',
            stockQuantity: 100,
            isOptionProduct: false,
          },
        },
      },
      optionInventory: {
        summary: '옵션 상품 재고 동기화',
        value: {
          dataType: 'inventory',
          payload: {
            productId: '67890',
            stockQuantity: 50,
            isOptionProduct: true,
            optionInfo: {
              optionCombinations: [{ id: 1001, stockQuantity: 25 }],
            },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: '동기화가 성공적으로 완료되었습니다.',
  })
  async syncToChannel(
    @Param('channel') channel: ChannelType,
    @Body() payload: SyncToChannelPayload,
  ) {
    try {
      if (!payload || !payload.dataType || !payload.payload) {
        throw new HttpException(
          '동기화할 데이터 페이로드가 올바르지 않습니다.',
          HttpStatus.BAD_REQUEST,
        );
      }

      this.logger.log(`📤 송신 동기화 요청: ${channel}/${payload.dataType}`);
      const result = await this.channelAdapterService.syncToChannel(
        channel,
        payload,
      );
      this.logger.log(`✅ 송신 동기화 완료: ${channel}/${payload.dataType}`);

      return {
        success: true,
        dataType: payload.dataType,
        result,
        message: `${channel} 채널에 ${payload.dataType} 데이터가 성공적으로 동기화되었습니다.`,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(
        `❌ 송신 동기화 실패: ${channel}/${payload?.dataType}`,
        error.stack,
      );
      if (error instanceof HttpException) throw error;
      if (error.message.includes('찾을 수 없습니다')) {
        throw new HttpException(error.message, HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        '송신 동기화 중 오류가 발생했습니다.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('command/:channel')
  @ApiOperation({ summary: '채널별 특정 명령 실행' })
  @ApiBody({ type: Object })
  @ApiResponse({
    status: 200,
    description: '명령이 성공적으로 실행되었습니다.',
  })
  async executeCommand(
    @Param('channel') channel: ChannelType,
    @Body() cmd: ChannelCommand,
  ) {
    try {
      if (!cmd || !cmd.type) {
        throw new HttpException(
          '실행할 명령(command) 정보가 올바르지 않습니다.',
          HttpStatus.BAD_REQUEST,
        );
      }

      this.logger.log(`⚡ 명령 실행 요청: ${channel}/${cmd.type}`);
      const result = await this.channelAdapterService.command(channel, cmd);
      this.logger.log(`✅ 명령 실행 완료: ${channel}/${cmd.type}`);

      return {
        success: true,
        commandType: cmd.type,
        result,
        message: `${channel} 채널에 ${cmd.type} 명령이 성공적으로 실행되었습니다.`,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(
        `❌ 명령 실행 실패: ${channel}/${cmd?.type}`,
        error.stack,
      );
      if (error instanceof HttpException) throw error;
      if (error.message.includes('권한이 없습니다')) {
        throw new HttpException(error.message, HttpStatus.FORBIDDEN);
      }
      throw new HttpException(
        '명령 실행 중 오류가 발생했습니다.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}

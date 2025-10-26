import { Injectable, Logger } from '@nestjs/common';
import { StreamPublisher } from '@app/events';
import { ChannelAdapterEvents } from '@app/shared/streams';
import {
  ChannelAdapterFactory,
  ChannelType,
} from './adapters/channel-adapter.factory';
import { ChannelCommand, SyncResult } from '../types';
import { ChannelsConfig } from '../config/channels.config';

/**
 * 채널 명령 Manager
 *
 * 책임:
 * - 명령 실행
 * - 검증 로직 (Manager 책임!)
 * - 이벤트 발행
 *
 * 특징:
 * - 비즈니스 로직 포함
 * - 검증 로직 포함
 * - DB 접근 없음 (필요시 Repository 추가)
 */
@Injectable()
export class ChannelCommandManager {
  private readonly logger = new Logger(ChannelCommandManager.name);

  constructor(
    private readonly adapterFactory: ChannelAdapterFactory,
    private readonly eventPublisher: StreamPublisher<ChannelAdapterEvents>,
  ) {}

  /**
   * 명령 실행
   *
   * 책임: 검증 + 실행 + 이벤트 발행
   *
   * @param channel - 대상 채널
   * @param command - 실행할 명령
   * @returns 실행 결과
   */
  async execute(
    channel: ChannelType,
    command: ChannelCommand,
  ): Promise<SyncResult> {
    const startTime = Date.now();

    // 1️⃣ 검증 (Manager 책임!)
    this.validateCommand(command);

    // 로깅용 컨텍스트
    const logContext: any = {};
    if ('orderId' in command) logContext.orderId = command.orderId;
    if ('orderIds' in command) logContext.orderIds = command.orderIds;
    if ('claimId' in command) logContext.claimId = command.claimId;

    this.logger.log(`⚡ [${channel}] 명령 실행: ${command.type}`, logContext);

    // 2️⃣ 명령 실행
    const adapter = this.adapterFactory.getAdapter(channel);
    const result = await adapter.executeCommand(command);

    const duration = Date.now() - startTime;

    // 3️⃣ 이벤트 발행
    const targetId = this.extractTargetId(command);

    await this.eventPublisher.publishEvent({
      eventType: 'CommandExecuted',
      aggregateId: `${channel}-${targetId}`,
      payload: {
        channelType: channel,
        commandType: command.type,
        targetId,
        executionResult: result.success ? 'success' : 'failed',
        processedCount: result.processedCount || 0,
        failedCount: result.failedCount || 0,
        executionDurationMs: duration,
      },
    });

    if (result.success) {
      this.logger.log(
        `✅ [${channel}] 명령 실행 성공: ${command.type} (${duration}ms)`,
      );
    } else {
      this.logger.warn(
        `⚠️ [${channel}] 명령 실행 실패: ${command.type} (${duration}ms)`,
        { errors: result.errors },
      );
    }

    return result;
  }

  /**
   * 전체 채널 명령 실행
   *
   * @param command - 실행할 명령
   * @returns 채널별 실행 결과
   */
  async executeOnAllChannels(command: ChannelCommand): Promise<
    Array<{
      channel: ChannelType;
      result: SyncResult;
      success: boolean;
      error?: string;
    }>
  > {
    const channels = ChannelsConfig.getActiveChannels();

    this.logger.log(`🌐 전체 채널 명령 실행: ${command.type}`);

    // 병렬 처리로 성능 개선
    const settledResults = await Promise.allSettled(
      channels.map((channel) => this.execute(channel, command)),
    );

    const results = settledResults.map((settled, index) => {
      const channel = channels[index];

      if (settled.status === 'fulfilled') {
        return {
          channel,
          result: settled.value,
          success: settled.value.success,
        };
      } else {
        this.logger.error(
          `❌ [${channel}] 명령 실행 실패:`,
          settled.reason?.message,
        );
        return {
          channel,
          result: {
            success: false,
            errors: [{ message: settled.reason?.message || 'Unknown error' }],
          },
          success: false,
          error: settled.reason?.message || 'Unknown error',
        };
      }
    });

    const successCount = results.filter((r) => r.success).length;
    this.logger.log(
      `🎯 전체 채널 명령 실행 완료: ${successCount}/${channels.length}개 성공`,
    );

    return results;
  }

  /**
   * 명령 검증 (Private)
   *
   * @param command - 검증할 명령
   * @throws {Error} 검증 실패 시
   */
  private validateCommand(command: ChannelCommand): void {
    switch (command.type) {
      case 'dispatch.ship':
        if (!command.tracking) {
          throw new Error('Tracking information required');
        }
        if (!command.tracking.companyCode || !command.tracking.number) {
          throw new Error('Tracking company code and number required');
        }
        break;

      case 'order.prepare':
        if (!command.orderIds || command.orderIds.length === 0) {
          throw new Error('Order IDs required');
        }
        break;

      case 'order.cancel':
        if (!command.orderId) {
          throw new Error('Order ID required');
        }
        break;

      case 'exchange.confirm_receipt':
      case 'exchange.reject':
      case 'exchange.upload_invoice':
        if (!command.claimId) {
          throw new Error('Claim ID required');
        }
        break;

      case 'return.approve':
      case 'return.hold':
      case 'return.release_hold':
        if (!command.claimId) {
          throw new Error('Claim ID required');
        }
        break;

      default:
        // 다른 명령은 adapter에서 검증
        break;
    }
  }

  /**
   * 명령에서 대상 ID 추출 (Private)
   *
   * @param command - 명령
   * @returns 대상 ID
   */
  private extractTargetId(command: ChannelCommand): string {
    if ('orderId' in command) return command.orderId;
    if ('orderIds' in command && command.orderIds?.length)
      return command.orderIds[0];
    if ('claimId' in command) return command.claimId;
    return 'unknown';
  }
}

/**
 * Graceful Shutdown Service
 *
 * Kafka producer/consumer를 안전하게 종료
 */

import { Injectable, Logger, OnApplicationShutdown, Inject, Optional } from '@nestjs/common';
import { ClientKafka } from '@nestjs/microservices';
import { stopConsumerLagCollectors } from '../consumers/consumer-lag.collector';

@Injectable()
export class GracefulShutdownService implements OnApplicationShutdown {
  private readonly logger = new Logger(GracefulShutdownService.name);
  private isShuttingDown = false;

  constructor(
    @Optional()
    @Inject('KAFKA_CLIENT')
    private readonly kafkaClient?: ClientKafka,
  ) {}

  /**
   * 애플리케이션 종료 시 호출
   *
   * - In-flight 메시지 처리 완료 대기
   * - Kafka producer/consumer graceful disconnect
   */
  async onApplicationShutdown(signal?: string): Promise<void> {
    if (this.isShuttingDown) {
      this.logger.warn('Shutdown already in progress');
      return;
    }

    this.isShuttingDown = true;

    this.logger.log(`🛑 Graceful shutdown initiated (signal: ${signal || 'unknown'})`);

    // lag 폴러(#815)는 DI 밖에 살아 자기 종료 훅이 없다 — 브로커 연결을 끊기 전에 여기서 멈춘다.
    await stopConsumerLagCollectors();

    if (!this.kafkaClient) {
      this.logger.warn('No Kafka client found, skipping shutdown');
      return;
    }

    try {
      // Kafka 연결 종료 (타임아웃: 30초)
      await Promise.race([this.disconnectKafka(), this.timeout(30000)]);

      this.logger.log('✅ Graceful shutdown completed');
    } catch (error) {
      this.logger.error('❌ Graceful shutdown failed', error instanceof Error ? error.stack : String(error));
      // 에러가 발생해도 종료는 계속 진행
    }
  }

  /**
   * Kafka 연결 종료
   */
  private async disconnectKafka(): Promise<void> {
    if (!this.kafkaClient) {
      return;
    }

    this.logger.log('Disconnecting Kafka client...');

    try {
      // ClientKafka의 close 메서드 호출
      await this.kafkaClient.close();

      this.logger.log('✅ Kafka client disconnected');
    } catch (error) {
      this.logger.error('Failed to disconnect Kafka client', error instanceof Error ? error.stack : String(error));
      throw error;
    }
  }

  /**
   * 타임아웃 헬퍼
   */
  private timeout(ms: number): Promise<never> {
    return new Promise((_, reject) => setTimeout(() => reject(new Error(`Shutdown timeout after ${ms}ms`)), ms));
  }

  /**
   * 수동으로 shutdown 트리거 (테스트용)
   */
  async triggerShutdown(): Promise<void> {
    await this.onApplicationShutdown('manual');
  }
}

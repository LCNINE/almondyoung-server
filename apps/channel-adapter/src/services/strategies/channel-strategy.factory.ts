import { Injectable, Logger } from '@nestjs/common';
import { ChannelStrategy } from './channel-strategy.interface';
import { NaverSmartstoreStrategy } from './naver-smartstore.strategy';
import { CoupangStrategy } from './coupang.strategy';
import { MedusaStrategy } from './medusa.strategy';

/**
 * 지원되는 판매채널 타입
 *
 * - `naver_smartstore`: 네이버 스마트스토어
 * - `coupang`: 쿠팡
 */
export type ChannelType = 'naver_smartstore' | 'coupang' | 'medusa';

/**
 * 채널별 전략 팩토리 서비스
 *
 * 팩토리 패턴을 사용하여 각 판매채널에 맞는 전략 객체를 생성하고 관리합니다.
 * 새로운 판매채널 추가 시 이 팩토리에 전략을 등록하면 됩니다.
 *
 * @example
 * ```typescript
 * // 네이버 스마트스토어 전략 가져오기
 * const naverStrategy = factory.getStrategy('naver_smartstore');
 * const events = await naverStrategy.syncFromChannel('orders');
 *
 * // 지원되는 모든 채널 확인
 * const channels = factory.getSupportedChannels();
 * console.log('지원 채널:', channels); // ['naver_smartstore', 'coupang']
 * ```
 */
@Injectable()
export class ChannelStrategyFactory {
  private readonly logger = new Logger(ChannelStrategyFactory.name);

  constructor(
    private readonly naver: NaverSmartstoreStrategy,
    private readonly coupang: CoupangStrategy,
    private readonly medusa: MedusaStrategy,
  ) {
    this.logger.log(
      `📦 채널 전략 팩토리 초기화 완료 (${this.getSupportedChannels().length}개 채널)`,
    );
  }

  /**
   * 채널 타입에 따른 전략 객체 반환
   *
   * @param channelType - 대상 판매채널 타입
   * @returns 해당 채널의 전략 객체
   * @throws {Error} 지원하지 않는 채널 타입인 경우
   *
   * @example
   * ```typescript
   * // 네이버 스마트스토어 전략 가져오기
   * const strategy = factory.getStrategy('naver_smartstore');
   *
   * // 쿠팡 전략 가져오기
   * const coupangStrategy = factory.getStrategy('coupang');
   * ```
   */
  getStrategy(channelType: ChannelType): ChannelStrategy {
    this.logger.debug(`🔍 채널 전략 요청: ${channelType}`);

    switch (channelType) {
      case 'naver_smartstore':
        return this.naver;
      case 'coupang':
        return this.coupang;
      case 'medusa':
        return this.medusa;
      default:
        const error = `지원하지 않는 채널 타입: ${channelType}`;
        this.logger.error(`❌ ${error}`);
        throw new Error(error);
    }
  }

  /**
   * 지원되는 모든 채널 타입 목록 반환
   *
   * @returns 지원되는 채널 타입 배열
   *
   * @example
   * ```typescript
   * const supportedChannels = factory.getSupportedChannels();
   * console.log(supportedChannels); // ['naver_smartstore', 'coupang']
   *
   * // 모든 채널에서 데이터 동기화
   * for (const channel of supportedChannels) {
   *   const strategy = factory.getStrategy(channel);
   *   const events = await strategy.syncFromChannel('orders');
   *   console.log(`${channel}: ${events.length}건 동기화`);
   * }
   * ```
   */
  getSupportedChannels(): ChannelType[] {
    return ['naver_smartstore', 'coupang', 'medusa'];
  }

  /**
   * 특정 채널이 지원되는지 확인
   *
   * @param channelType - 확인할 채널 타입
   * @returns 지원 여부
   *
   * @example
   * ```typescript
   * if (factory.isChannelSupported('naver_smartstore')) {
   *   console.log('네이버 스마트스토어가 지원됩니다.');
   * }
   *
   * if (!factory.isChannelSupported('amazon')) {
   *   console.log('아마존은 아직 지원되지 않습니다.');
   * }
   * ```
   */
  isChannelSupported(channelType: string): channelType is ChannelType {
    return this.getSupportedChannels().includes(channelType as ChannelType);
  }

  /**
   * 팩토리 상태 정보 반환 (디버깅/모니터링 용도)
   *
   * @returns 팩토리 상태 정보
   */
  getFactoryStatus() {
    const supportedChannels = this.getSupportedChannels();

    return {
      supportedChannels,
      totalChannels: supportedChannels.length,
      strategies: {
        naver_smartstore: !!this.naver,
        coupang: !!this.coupang,
      },
      isHealthy: supportedChannels.length > 0,
    };
  }
}

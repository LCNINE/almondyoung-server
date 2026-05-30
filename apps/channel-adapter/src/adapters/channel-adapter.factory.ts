import { Injectable, Logger } from '@nestjs/common';
import { ChannelAdapter } from './channel-adapter.interface';
import { NaverSmartstoreAdapter } from './naver/naver-smartstore.adapter';
import { CoupangAdapter } from './coupang/coupang.adapter';

/**
 * 지원되는 판매채널 타입
 *
 * - `naver_smartstore`: 네이버 스마트스토어
 * - `coupang`: 쿠팡
 * - `medusa`: 자사몰 채널. 주문 수집은 이 factory 가 아니라 OrderPollerOrchestrator provider 경로를 사용한다.
 */
export type ChannelType = 'naver_smartstore' | 'coupang' | 'medusa';
export type LegacyAdapterChannelType = Exclude<ChannelType, 'medusa'>;

/**
 * 채널 어댑터 팩토리 서비스
 *
 * 팩토리 패턴을 사용하여 각 판매채널에 맞는 어댑터 객체를 생성하고 관리합니다.
 * 새로운 판매채널 추가 시 이 팩토리에 어댑터를 등록하면 됩니다.
 *
 * 🔌 어댑터 패턴: 각 채널의 서로 다른 API 인터페이스를 내부 표준 인터페이스로 변환
 *
 * @example
 * ```typescript
 * // 네이버 스마트스토어 어댑터 가져오기
 * const naverAdapter = factory.getAdapter('naver_smartstore');
 * const events = await naverAdapter.syncFromChannel('orders');
 *
 * // 지원되는 모든 채널 확인
 * const channels = factory.getSupportedChannels();
 * console.log('지원 채널:', channels); // ['naver_smartstore', 'coupang']
 * ```
 */
@Injectable()
export class ChannelAdapterFactory {
  private readonly logger = new Logger(ChannelAdapterFactory.name);

  constructor(
    private readonly naver: NaverSmartstoreAdapter,
    private readonly coupang: CoupangAdapter,
  ) {
    this.logger.log(`📦 채널 어댑터 팩토리 초기화 완료 (${this.getSupportedChannels().length}개 채널)`);
  }

  /**
   * 채널 타입에 따른 어댑터 객체 반환
   *
   * @param channelType - 대상 판매채널 타입
   * @returns 해당 채널의 어댑터 객체
   * @throws {Error} 지원하지 않는 채널 타입인 경우
   *
   * @example
   * ```typescript
   * // 네이버 스마트스토어 어댑터 가져오기
   * const adapter = factory.getAdapter('naver_smartstore');
   *
   * // 쿠팡 어댑터 가져오기
   * const coupangAdapter = factory.getAdapter('coupang');
   * ```
   */
  getAdapter(channelType: ChannelType): ChannelAdapter {
    this.logger.debug(`🔍 채널 어댑터 요청: ${channelType}`);

    switch (channelType) {
      case 'naver_smartstore':
        return this.naver;
      case 'coupang':
        return this.coupang;
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
   *   const adapter = factory.getAdapter(channel);
   *   const events = await adapter.syncFromChannel('orders');
   *   console.log(`${channel}: ${events.length}건 동기화`);
   * }
   * ```
   */
  getSupportedChannels(): LegacyAdapterChannelType[] {
    return ['naver_smartstore', 'coupang'];
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
  isChannelSupported(channelType: string): channelType is LegacyAdapterChannelType {
    return this.getSupportedChannels().includes(channelType as LegacyAdapterChannelType);
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
      adapters: {
        naver_smartstore: !!this.naver,
        coupang: !!this.coupang,
      },
      isHealthy: supportedChannels.length > 0,
    };
  }
}

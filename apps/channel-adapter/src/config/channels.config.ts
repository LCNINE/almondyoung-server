import { ChannelType } from '../adapters/channel-adapter.factory';

/**
 * 활성화된 채널 목록
 *
 * 환경변수로 오버라이드 가능:
 * ACTIVE_CHANNELS=naver_smartstore,coupang
 */
export const ACTIVE_CHANNELS: ChannelType[] = (process.env.ACTIVE_CHANNELS || 'naver_smartstore,coupang')
  .split(',')
  .map((ch) => ch.trim()) as ChannelType[];

/**
 * 채널 설정 헬퍼
 */
export class ChannelsConfig {
  /**
   * 활성화된 채널 목록 반환
   */
  static getActiveChannels(): ChannelType[] {
    return ACTIVE_CHANNELS;
  }

  /**
   * 특정 채널이 활성화되어 있는지 확인
   */
  static isChannelActive(channel: ChannelType): boolean {
    return ACTIVE_CHANNELS.includes(channel);
  }

  /**
   * 활성화된 채널 수 반환
   */
  static getActiveChannelCount(): number {
    return ACTIVE_CHANNELS.length;
  }
}

import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';

@Injectable()
export class EventChainService {
  constructor(private readonly cls: ClsService) {}

  getChainId(): string | undefined {
    return this.cls.get('chainId');
  }

  getEventId(): string | undefined {
    return this.cls.get('eventId');
  }

  setChainId(id: string): void {
    this.cls.set('chainId', id);
  }

  setEventId(id: string): void {
    this.cls.set('eventId', id);
  }

  /**
   * InboxWorkerService에서 inbox 이벤트 처리 시작 시 사용
   * chainId와 eventId를 CLS 컨텍스트에 설정하고 fn을 실행
   */
  async runWithChain<T>(chainId: string, eventId: string, fn: () => Promise<T>): Promise<T> {
    return this.cls.run(async () => {
      this.cls.set('chainId', chainId);
      this.cls.set('eventId', eventId);
      return fn();
    });
  }
}

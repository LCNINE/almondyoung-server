import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { v7 } from 'uuid';

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
   * chainId 를 읽되, **없으면 만들어서 CLS 에 심는다.**
   *
   * 발행부의 옛 `getChainId() ?? v7()` 로는 사슬이 시작되지 않았다 — 심는 주체가 없어
   * 같은 요청·같은 핸들러 안의 두 발행이 서로 다른 id 를 받았기 때문이다. 여기서 심어야
   * "한 컨텍스트 = 한 사슬" 이 성립한다.
   *
   * CLS 컨텍스트 밖(크론·부트스트랩 스크립트)에서는 심을 곳이 없다. 그때는 생성만 해서
   * 돌려주므로 **던지지 않고**, 발행마다 새 사슬이 된다는 점은 이 변경 전과 같다.
   * `cls.set` 이 컨텍스트 없이 던지는 것이 #612 의 무증상 실패 경로였으므로, 이 가드가
   * 그 실패를 되풀이하지 않는 유일한 이유다.
   */
  ensureChainId(): string {
    if (!this.cls.isActive()) {
      return v7();
    }

    const existing = this.getChainId();
    if (existing) {
      return existing;
    }

    const generated = v7();
    this.cls.set('chainId', generated);
    return generated;
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

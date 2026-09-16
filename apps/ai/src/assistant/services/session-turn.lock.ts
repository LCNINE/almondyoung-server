import { ConflictError } from '@app/shared';
import { Injectable } from '@nestjs/common';

/**
 * 한 대화에서 턴 하나만 돌게 한다.
 *
 * 없으면 두 탭이 동시에 보낼 때 양쪽 runner 가 모두 두 발화를 다 읽고, 같은 요청에 대한
 * 도구 실행이 두 번 나간다 — 상품 등록이면 두 개가 만들어진다.
 *
 * ponytail: 프로세스 로컬 락이다. 태스크가 여럿이면(scaling.max > 1, 롤링 배포 중)
 * 다른 태스크의 동시 턴은 못 막는다. 그때는 세션 행에 postgres advisory lock 을 걸거나
 * in_flight 컬럼을 CAS 로 선점해야 한다. 현재 ai 는 태스크 1개라 여기서 충분하다.
 */
@Injectable()
export class SessionTurnLock {
  private readonly running = new Set<string>();

  acquire(sessionId: string): void {
    if (this.running.has(sessionId)) {
      throw new ConflictError('이 대화에서 이미 처리 중인 요청이 있습니다. 끝난 뒤에 보내주세요.');
    }
    this.running.add(sessionId);
  }

  release(sessionId: string): void {
    this.running.delete(sessionId);
  }
}

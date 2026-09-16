import { NotFoundError } from '@app/shared';
import { Injectable } from '@nestjs/common';
import { AssistantChatRepository, type MessageRow, type SessionRow } from '../repositories/assistant-chat.repository';
import { restoreConversation, type Message } from '../lib/conversation';

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;

/**
 * 대화 조회. 소유 판정이 여기 있다 — 남의 대화가 보이면 상품 원가·매입가 같은 내부
 * 정보가 그대로 새어 나간다.
 */
@Injectable()
export class AssistantSessionReader {
  constructor(private readonly repository: AssistantChatRepository) {}

  /** 목록이 지나치게 길어지지 않게 여기서 자른다. 컨트롤러는 원문 문자열만 넘긴다. */
  async listSessions(userId: string, rawLimit?: string) {
    const parsed = Number(rawLimit);
    const limit = Number.isFinite(parsed)
      ? Math.min(Math.max(Math.trunc(parsed), 1), MAX_LIST_LIMIT)
      : DEFAULT_LIST_LIMIT;

    return this.repository.findSessionsByUser(userId, limit);
  }

  /** 내 세션이 아니면 없는 것으로 답한다 — 남의 세션 존재 여부도 알려주지 않는다. */
  async requireOwnedSession(userId: string, sessionId: string): Promise<SessionRow> {
    const session = await this.repository.findSessionOwnedBy(userId, sessionId);
    if (!session) throw new NotFoundError(`대화를 찾을 수 없습니다: ${sessionId}`);
    return session;
  }

  async listMessages(userId: string, sessionId: string): Promise<MessageRow[]> {
    await this.requireOwnedSession(userId, sessionId);
    return this.repository.findMessages(sessionId);
  }

  /**
   * 모델에게 그대로 되돌려줄 형태로 대화를 읽는다.
   *
   * 접어 둔 요약이 있으면 그 시각 이후 메시지만 읽고, 앞에 요약 한 덩이를 놓는다.
   * 대화는 매 턴 통째로 다시 실리므로, 접지 않으면 입력 토큰이 턴 수에 비례해 늘어난다.
   *
   * 소유 확인을 다시 하지 않는다 — 스트리밍 경로가 이미 세션을 손에 들고 들어온다.
   */
  async loadConversation(session: Pick<SessionRow, 'id' | 'summary' | 'summarizedThrough'>): Promise<Message[]> {
    if (!session.summary || !session.summarizedThrough) {
      return restoreConversation(await this.repository.findMessages(session.id));
    }

    const rows = await this.repository.findMessagesAfter(session.id, session.summarizedThrough);

    // 요약을 system 이 아니라 첫 user 턴으로 놓는다. system 은 캐시되는 접두사의 맨 앞이라
    // 요약이 갱신될 때마다 그 뒤 전부가 캐시 미스가 된다.
    return [
      {
        role: 'user',
        content: `[앞선 대화 요약 — 원문은 접혔다. 여기 적힌 식별자를 그대로 쓴다]\n${session.summary}`,
      },
      ...restoreConversation(rows),
    ];
  }
}

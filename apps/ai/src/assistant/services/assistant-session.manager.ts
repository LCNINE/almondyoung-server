import { BadRequestError } from '@app/shared';
import { Injectable } from '@nestjs/common';
import { AssistantChatRepository, type NewMessage } from '../repositories/assistant-chat.repository';
import { AssistantSessionReader } from './assistant-session.reader';

const MAX_TITLE_LENGTH = 40;

/** 목록에서 어떤 대화인지 알아볼 정도면 된다. */
export function titleFrom(text: string): string {
  const line = text.trim().split('\n')[0] ?? '';
  return line.length > MAX_TITLE_LENGTH ? `${line.slice(0, MAX_TITLE_LENGTH)}…` : line || '새 대화';
}

/** 대화 기록의 쓰기와 그 검증. */
@Injectable()
export class AssistantSessionManager {
  constructor(
    private readonly repository: AssistantChatRepository,
    private readonly reader: AssistantSessionReader,
  ) {}

  async createSession(userId: string, title?: string) {
    return this.repository.insertSession(userId, title?.trim() || null);
  }

  async deleteSession(userId: string, sessionId: string) {
    await this.reader.requireOwnedSession(userId, sessionId);
    await this.repository.deleteSession(sessionId);
    return { deleted: true };
  }

  /** 사용자 발화. 빈 발화는 첨부라도 있어야 한다 — 둘 다 없으면 모델에게 보낼 것이 없다. */
  async appendUserMessage(sessionId: string, content: string, hasAttachments: boolean) {
    if (!content.trim() && !hasAttachments) {
      throw new BadRequestError('보낼 메시지가 없습니다.');
    }
    return this.repository.insertMessage({ sessionId, role: 'user', content });
  }

  async appendAssistantMessage(message: Omit<NewMessage, 'role'>) {
    return this.repository.insertMessage({ ...message, role: 'assistant' });
  }

  /**
   * 제목이 아직 없을 때만 첫 발화에서 딴다. 돌려준 값이 있으면 그것을 클라이언트에 알린다.
   * 이미 제목이 있으면 덮지 않는다 — 사용자가 이어 말할 때마다 제목이 바뀌면 목록을 못 읽는다.
   */
  async ensureTitle(sessionId: string, currentTitle: string | null, firstUtterance: string): Promise<string | null> {
    if (currentTitle || !firstUtterance.trim()) return null;

    const title = titleFrom(firstUtterance);
    await this.repository.updateTitle(sessionId, title);
    return title;
  }
}

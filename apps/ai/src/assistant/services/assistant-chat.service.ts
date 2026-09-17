import { Injectable } from '@nestjs/common';
import type { SkillContext } from '../../skills/types';
import type { IncomingTurn } from '../lib/multipart';
import { AssistantRunnerService, type RunEvent } from './assistant-runner.service';
import { AssistantSessionManager } from './assistant-session.manager';
import { AssistantSessionReader } from './assistant-session.reader';
import { ConversationCompactorService } from './conversation-compactor.service';
import { SessionTurnLock } from './session-turn.lock';

export type TurnEvent = RunEvent | { type: 'title'; title: string };

export type TurnInput = {
  userId: string;
  sessionId: string;
  turn: IncomingTurn;
  coreHeaders: SkillContext['coreHeaders'];
  signal: AbortSignal;
  /** 가드가 통과시킨 스코프. 모델이 부를 수 있는 도구를 이것으로 가른다. */
  grantedScopes: readonly string[];
};

/**
 * 한 턴의 흐름: 소유 확인 → 발화 저장 → 대화 복원 → 모델 → 답변 저장.
 *
 * 대화 원본은 이 서버가 들고 있다. 클라이언트가 통째로 되돌려주던 방식은 그 사본이
 * DB 와 갈릴 수 있었고, tool_result 를 고쳐 보내면 모델이 그대로 믿었다.
 */
@Injectable()
export class AssistantChatService {
  constructor(
    private readonly reader: AssistantSessionReader,
    private readonly manager: AssistantSessionManager,
    private readonly runner: AssistantRunnerService,
    private readonly lock: SessionTurnLock,
    private readonly compactor: ConversationCompactorService,
  ) {}

  async *runTurn(input: TurnInput): AsyncGenerator<TurnEvent> {
    const { userId, sessionId, turn, coreHeaders, signal, grantedScopes } = input;

    // 소유 확인이 먼저다 — 남의 세션 id 로 락을 잡게 두면 그 대화를 막을 수 있다.
    const session = await this.reader.requireOwnedSession(userId, sessionId);

    this.lock.acquire(sessionId);
    try {
      await this.manager.appendUserMessage(sessionId, turn.content, turn.attachments.length > 0);

      const title = await this.manager.ensureTitle(sessionId, session.title, turn.content);
      if (title) yield { type: 'title', title };

      const history = await this.reader.loadConversation(session);

      for await (const event of this.runner.run({
        history,
        attachments: turn.attachments,
        coreHeaders,
        signal,
        grantedScopes,
        sessionId,
      })) {
        if (event.type !== 'settled') {
          yield event;
          continue;
        }

        // 끊긴 턴도 저장한다 — 이미 실행된 도구(업로드한 fileId 등)를 잃으면
        // 다음 턴에 같은 작업을 처음부터 다시 하게 된다.
        await this.manager.appendAssistantMessage({
          sessionId,
          content: event.payload.message ?? null,
          contentBlocks: event.payload.turnBlocks,
          toolCalls: event.payload.toolCalls,
        });

        yield event;

        // 답변을 다 보낸 뒤에 접는다. 접기는 모델을 한 번 더 부르므로 스트리밍 도중에
        // 하면 사용자가 그만큼 기다린다. 여기서는 이미 done 이 나간 뒤다.
        await this.compactor.compactIfNeeded(session);
      }
    } finally {
      this.lock.release(sessionId);
    }
  }
}

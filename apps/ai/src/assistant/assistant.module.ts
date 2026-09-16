import { Module } from '@nestjs/common';
import { AssistantChatController } from './controllers/assistant-chat.controller';
import { AssistantSessionController } from './controllers/assistant-session.controller';
import { AssistantChatRepository } from './repositories/assistant-chat.repository';
import { AssistantChatService } from './services/assistant-chat.service';
import { AssistantRunnerService } from './services/assistant-runner.service';
import { ConversationCompactorService } from './services/conversation-compactor.service';
import { AssistantSessionManager } from './services/assistant-session.manager';
import { AssistantSessionReader } from './services/assistant-session.reader';
import { AssistantSessionService } from './services/assistant-session.service';
import { SessionTurnLock } from './services/session-turn.lock';

@Module({
  controllers: [AssistantSessionController, AssistantChatController],
  providers: [
    AssistantSessionService,
    AssistantChatService,
    AssistantRunnerService,
    AssistantSessionReader,
    AssistantSessionManager,
    AssistantChatRepository,
    SessionTurnLock,
    ConversationCompactorService,
  ],
})
export class AssistantModule {}

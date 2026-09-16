import { Module } from '@nestjs/common';
import { UserPermanentDeletedConsumer } from './consumers/user-permanent-deleted.consumer';
import { AssistantChatController } from './controllers/assistant-chat.controller';
import { AssistantSessionController } from './controllers/assistant-session.controller';
import { AssistantChatRepository } from './repositories/assistant-chat.repository';
import { AssistantChatPurgeService } from './services/assistant-chat-purge.service';
import { AssistantChatService } from './services/assistant-chat.service';
import { AssistantRunnerService } from './services/assistant-runner.service';
import { ConversationCompactorService } from './services/conversation-compactor.service';
import { AssistantSessionManager } from './services/assistant-session.manager';
import { AssistantSessionReader } from './services/assistant-session.reader';
import { AssistantSessionService } from './services/assistant-session.service';
import { SessionTurnLock } from './services/session-turn.lock';

@Module({
  controllers: [AssistantSessionController, AssistantChatController, UserPermanentDeletedConsumer],
  providers: [
    AssistantSessionService,
    AssistantChatService,
    AssistantChatPurgeService,
    AssistantRunnerService,
    AssistantSessionReader,
    AssistantSessionManager,
    AssistantChatRepository,
    SessionTurnLock,
    ConversationCompactorService,
  ],
})
export class AssistantModule {}

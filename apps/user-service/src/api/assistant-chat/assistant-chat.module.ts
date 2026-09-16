import { Module } from '@nestjs/common';
import { AssistantChatController } from './assistant-chat.controller';
import { AssistantChatService } from './assistant-chat.service';

@Module({
  controllers: [AssistantChatController],
  providers: [AssistantChatService],
})
export class AssistantChatModule {}

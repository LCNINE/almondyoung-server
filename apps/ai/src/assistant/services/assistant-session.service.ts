import { Injectable } from '@nestjs/common';
import { CreateSessionDto } from '../dto/create-session.dto';
import { AssistantSessionManager } from './assistant-session.manager';
import { AssistantSessionReader } from './assistant-session.reader';

/** 대화 기록의 업무 흐름. 검증과 DB 접근은 Reader/Manager 에 있다. */
@Injectable()
export class AssistantSessionService {
  constructor(
    private readonly reader: AssistantSessionReader,
    private readonly manager: AssistantSessionManager,
  ) {}

  createSession(userId: string, dto: CreateSessionDto) {
    return this.manager.createSession(userId, dto.title);
  }

  listSessions(userId: string, limit?: string) {
    return this.reader.listSessions(userId, limit);
  }

  listMessages(userId: string, sessionId: string) {
    return this.reader.listMessages(userId, sessionId);
  }

  deleteSession(userId: string, sessionId: string) {
    return this.manager.deleteSession(userId, sessionId);
  }
}

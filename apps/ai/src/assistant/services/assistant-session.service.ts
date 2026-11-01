import { Injectable } from '@nestjs/common';
import { CreateSessionDto } from '../dto/create-session.dto';
import { AssistantSessionManager } from './assistant-session.manager';
import type { RequestTenantId } from '../../tenancy/request-tenant';
import { AssistantSessionReader } from './assistant-session.reader';

/** 대화 기록의 업무 흐름. 검증과 DB 접근은 Reader/Manager 에 있다. */
@Injectable()
export class AssistantSessionService {
  constructor(
    private readonly reader: AssistantSessionReader,
    private readonly manager: AssistantSessionManager,
  ) {}

  createSession(userId: string, tenant: RequestTenantId, dto: CreateSessionDto) {
    return this.manager.createSession(userId, tenant, dto.title);
  }

  listSessions(userId: string, tenant: RequestTenantId, limit?: string) {
    return this.reader.listSessions(userId, tenant, limit);
  }

  listMessages(userId: string, tenant: RequestTenantId, sessionId: string) {
    return this.reader.listMessages(userId, tenant, sessionId);
  }

  deleteSession(userId: string, tenant: RequestTenantId, sessionId: string) {
    return this.manager.deleteSession(userId, tenant, sessionId);
  }
}

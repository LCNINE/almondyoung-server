import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import fastifyMultipart from '@fastify/multipart';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { join } from 'node:path';
import { createCheckpointsForTesting, IS_PUBLIC_KEY, PermissionCheckpoints } from '@app/authorization';
import { connectionStringFor, DbModule } from '@app/db';
import { GlobalExceptionFilter } from '@app/shared';
import { parseTenantList, TenancyConfig, TENANT_HEADER, type TenantGateMode } from '@app/tenancy';
import { AssistantChatController } from '../assistant/controllers/assistant-chat.controller';
import { AssistantSessionController } from '../assistant/controllers/assistant-session.controller';
import { AssistantChatRepository } from '../assistant/repositories/assistant-chat.repository';
import { AssistantChatService } from '../assistant/services/assistant-chat.service';
import { AssistantRunnerService } from '../assistant/services/assistant-runner.service';
import { AssistantSessionManager } from '../assistant/services/assistant-session.manager';
import { AssistantSessionReader } from '../assistant/services/assistant-session.reader';
import { AssistantSessionService } from '../assistant/services/assistant-session.service';
import { ConversationCompactorService } from '../assistant/services/conversation-compactor.service';
import { SessionTurnLock } from '../assistant/services/session-turn.lock';
import { aiSchema } from '../db/schema';
import { UploadedFileRepository } from '../files/uploaded-file.repository';
import { AiRequestTenantInterceptor } from './ai-request-tenant.interceptor';

/**
 * ai 의 대화·업로드 추적이 테넌트로 갈리는지를 실 Postgres 로 본다 — 목록·열기·수거 후보의 테넌트 조건은 SQL 에 있어
 * 메모리 가짜로는 못 잰다.
 * 스펙이 ai 마이그를 마친 스크래치 DB 를 만들고 끝나면 지운다. 접속 정보는 DATABASE_URL 의 것을 쓴다(DB 이름만 바꾼다).
 *
 * 실행: `npx dotenv -e apps/ai/.env -- npx jest apps/ai/src/tenancy`
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const PROBE_DB = 'ai_tenant_axis_probe';
const urlOf = (database: string): string => connectionStringFor(DATABASE_URL ?? '', database);

const tenants = parseTenantList(
  JSON.stringify([
    { id: '1', slug: 'one', coreDb: 'core', publicBucket: 'one-shared', privateBucket: 'one-shared' },
    { id: '2', slug: 'two', coreDb: 'core_two', publicBucket: 'two-pub', privateBucket: 'two-priv' },
  ]),
);

/** 두 테넌트에 소속된 계정 하나. 토큰마다 `tenant` 만 다르다. */
const ACCOUNT = '00000000-0000-4000-8000-0000000000a1';
const OTHER = '00000000-0000-4000-8000-0000000000b2';
const token = (tenant: string | undefined, userId = ACCOUNT) =>
  JSON.stringify({ userId, email: 'a@x', roles: ['admin'], ...(tenant ? { tenant } : {}) });

/** 전역 JwtAuthGuard 자리 — `x-test-user` 헤더의 JSON 이 검증된 사용자다. */
@Injectable()
class FakeAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (Reflect.getMetadata(IS_PUBLIC_KEY, context.getHandler()) === true) return true;
    const req = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined>; user?: object }>();
    const raw = req.headers['x-test-user'];
    const user: unknown = raw ? JSON.parse(raw) : undefined;
    if (typeof user === 'object' && user !== null) req.user = user;
    return true;
  }
}

/** 응답 본문의 문자열 칸. 모양이 다르면 그 자리에서 실패한다. */
function idOf(body: unknown): string {
  const value: unknown = typeof body === 'object' && body !== null ? Reflect.get(body, 'id') : undefined;
  if (typeof value !== 'string') throw new Error('응답에 id 가 없다');
  return value;
}

function idsOf(body: unknown): string[] {
  if (!Array.isArray(body)) throw new Error('목록이 아니다');
  return body.map(idOf);
}

describeIfDb('ai 테넌트 축 — 대화는 (계정, 테넌트)로 갈린다 (실 Postgres)', () => {
  jest.setTimeout(120_000);

  let admin: postgres.Sql;
  let probe: postgres.Sql;
  const apps: NestFastifyApplication[] = [];

  async function boot(mode: TenantGateMode): Promise<NestFastifyApplication> {
    const module = await Test.createTestingModule({
      imports: [DbModule.forRoot({ config: { connectionString: urlOf(PROBE_DB) }, schema: aiSchema })],
      controllers: [AssistantSessionController, AssistantChatController],
      providers: [
        AssistantSessionService,
        AssistantSessionReader,
        AssistantSessionManager,
        AssistantChatRepository,
        UploadedFileRepository,
        AssistantChatService,
        SessionTurnLock,
        // 소유 확인에서 끝나는 요청만 보낸다 — 모델까지 가면 이 스펙의 실패다.
        { provide: AssistantRunnerService, useValue: { run: () => Promise.reject(new Error('모델까지 갔다')) } },
        { provide: ConversationCompactorService, useValue: { compactIfNeeded: () => Promise.resolve() } },
        { provide: PermissionCheckpoints, useValue: createCheckpointsForTesting() },
        { provide: TenancyConfig, useValue: new TenancyConfig(tenants, mode) },
        { provide: APP_GUARD, useClass: FakeAuthGuard },
        { provide: APP_INTERCEPTOR, useClass: AiRequestTenantInterceptor },
      ],
    }).compile();

    const app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.register(fastifyMultipart);
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    apps.push(app);
    return app;
  }

  let warn: NestFastifyApplication;
  let reject: NestFastifyApplication;

  beforeAll(async () => {
    admin = postgres(urlOf('postgres'), { max: 1, onnotice: () => undefined });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${PROBE_DB} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${PROBE_DB}`);
    probe = postgres(urlOf(PROBE_DB), { max: 1, onnotice: () => undefined });
    await migrate(drizzle(probe), { migrationsFolder: join(__dirname, '../db') });

    warn = await boot('warn');
    reject = await boot('reject');
  });

  afterAll(async () => {
    await Promise.all(apps.map((app) => app.close()));
    await probe?.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${PROBE_DB} WITH (FORCE)`);
    await admin?.end();
  });

  type Call = { method: 'GET' | 'POST' | 'DELETE'; url: string; user?: string; headers?: Record<string, string> };
  const call = (app: NestFastifyApplication, { method, url, user, headers }: Call) =>
    app.inject({ method, url, headers: { ...(user ? { 'x-test-user': user } : {}), ...headers } });

  const create = async (app: NestFastifyApplication, user: string, title: string): Promise<string> => {
    const res = await app.inject({
      method: 'POST',
      url: '/assistant/sessions',
      headers: { 'x-test-user': user, 'content-type': 'application/json' },
      payload: { title },
    });
    expect(res.statusCode).toBe(201);
    return idOf(res.json());
  };
  const list = async (app: NestFastifyApplication, user: string): Promise<string[]> => {
    const res = await call(app, { method: 'GET', url: '/assistant/sessions?limit=100', user });
    expect(res.statusCode).toBe(200);
    return idsOf(res.json());
  };
  const send = (app: NestFastifyApplication, user: string, sessionId: string) =>
    app.inject({
      method: 'POST',
      url: `/assistant/sessions/${sessionId}/messages`,
      headers: { 'x-test-user': user, 'content-type': 'multipart/form-data; boundary=x' },
      payload: '--x\r\nContent-Disposition: form-data; name="content"\r\n\r\n안녕\r\n--x--\r\n',
    });
  const tenantOf = async (sessionId: string): Promise<string | null> => {
    const [row] = await probe<{ tenant_id: string | null }[]>`
      SELECT tenant_id FROM assistant_chat_sessions WHERE id = ${sessionId}`;
    return row?.tenant_id ?? null;
  };

  describe('같은 계정의 테넌트 1·2 토큰', () => {
    let one: string;
    let two: string;

    beforeAll(async () => {
      one = await create(reject, token('1'), '테넌트 1 대화');
      two = await create(reject, token('2'), '테넌트 2 대화');
    });

    it('대화에 토큰 테넌트가 적힌다', async () => {
      expect(await tenantOf(one)).toBe('1');
      expect(await tenantOf(two)).toBe('2');
    });

    it('목록은 자기 테넌트 대화만 보인다', async () => {
      const ofOne = await list(reject, token('1'));
      const ofTwo = await list(reject, token('2'));

      expect(ofOne).toContain(one);
      expect(ofOne).not.toContain(two);
      expect(ofTwo).toContain(two);
      expect(ofTwo).not.toContain(one);
    });

    it('다른 테넌트 대화의 내용·삭제·메시지 보내기는 없는 대화로 답한다(404)', async () => {
      const messages = await call(reject, { method: 'GET', url: `/assistant/sessions/${one}/messages`, user: token('2') });
      const removed = await call(reject, { method: 'DELETE', url: `/assistant/sessions/${one}`, user: token('2') });
      const sent = await send(reject, token('2'), one);

      expect([messages.statusCode, removed.statusCode, sent.statusCode]).toEqual([404, 404, 404]);
      expect(await tenantOf(one)).toBe('1');
    });

    it('자기 테넌트 대화의 내용은 연다', async () => {
      const res = await call(reject, { method: 'GET', url: `/assistant/sessions/${two}/messages`, user: token('2') });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('옛 대화(마이그 전 행)', () => {
    let legacy: string;

    beforeAll(async () => {
      // 테넌트를 싣지 않는 쓰기 = 옛 코드의 INSERT. DB 기본값이 테넌트 1 로 채운다.
      const [row] = await probe<{ id: string }[]>`
        INSERT INTO assistant_chat_sessions (user_id, title) VALUES (${ACCOUNT}, '옛 대화') RETURNING id`;
      if (!row) throw new Error('옛 대화 INSERT 가 행을 돌려주지 않았다');
      legacy = row.id;
    });

    it('테넌트 1 토큰에는 지금처럼 보이고 열린다', async () => {
      expect(await tenantOf(legacy)).toBe('1');
      expect(await list(reject, token('1'))).toContain(legacy);
      const res = await call(reject, { method: 'GET', url: `/assistant/sessions/${legacy}/messages`, user: token('1') });
      expect(res.statusCode).toBe(200);
    });

    it('테넌트 2 토큰에는 안 보인다', async () => {
      expect(await list(reject, token('2'))).not.toContain(legacy);
    });
  });

  describe('요청 문', () => {
    it('남의 계정 대화는 같은 테넌트라도 안 보인다(지금 그대로)', async () => {
      const mine = await create(reject, token('1'), '내 대화');
      expect(await list(reject, token('1', OTHER))).not.toContain(mine);
    });

    it('헤더가 토큰 테넌트와 다르면 403', async () => {
      const res = await call(reject, {
        method: 'GET',
        url: '/assistant/sessions',
        user: token('1'),
        headers: { [TENANT_HEADER]: '2' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('목록에 없는 테넌트 토큰은 두 모드 모두 403', async () => {
      const inWarn = await call(warn, { method: 'GET', url: '/assistant/sessions', user: token('9') });
      const inReject = await call(reject, { method: 'GET', url: '/assistant/sessions', user: token('9') });
      expect([inWarn.statusCode, inReject.statusCode]).toEqual([403, 403]);
    });

    it('② 에서 테넌트 없는 토큰은 403', async () => {
      const res = await call(reject, { method: 'GET', url: '/assistant/sessions', user: token(undefined) });
      expect(res.statusCode).toBe(403);
    });

    it('① 에서 테넌트 없는 토큰은 지금처럼 통과한다 — 쓰기는 DB 기본값, 목록은 테넌트로 거르지 않는다', async () => {
      const made = await create(warn, token(undefined), '클레임 전 토큰');

      expect(await tenantOf(made)).toBe('1');
      expect(await list(warn, token(undefined))).toEqual(expect.arrayContaining([made]));
    });
  });

  describe('탈퇴 회원 파기(계정 이벤트 — 테넌트를 가리지 않는다)', () => {
    const LEAVER = '00000000-0000-4000-8000-0000000000c3';

    it('감추기는 그 계정의 모든 테넌트 대화에 닿고, 유예가 지나면 지워진다', async () => {
      const repository = reject.get(AssistantChatRepository);
      const one = await create(reject, token('1', LEAVER), '테넌트 1');
      const two = await create(reject, token('2', LEAVER), '테넌트 2');

      await expect(repository.softDeleteSessionsByUser(LEAVER, new Date())).resolves.toBe(2);
      expect(await list(reject, token('1', LEAVER))).toEqual([]);
      expect(await list(reject, token('2', LEAVER))).toEqual([]);

      await repository.purgeSoftDeletedBefore(new Date(Date.now() + 1000));
      expect([await tenantOf(one), await tenantOf(two)]).toEqual([null, null]);
    });
  });

  describe('업로드 추적', () => {
    it('수거 후보는 그 테넌트의 행만이고, 테넌트 모르는 기록(①)은 테넌트 1 이다', async () => {
      const files = reject.get(UploadedFileRepository);
      const [one, two, untenanted] = [
        '00000000-0000-4000-8000-0000000000f1',
        '00000000-0000-4000-8000-0000000000f2',
        '00000000-0000-4000-8000-0000000000f3',
      ];
      await files.record(one, 'product-image', null, '1');
      await files.record(two, 'product-image', null, '2');
      await files.record(untenanted, 'product-image', null, null);
      const later = new Date(Date.now() + 1000);

      const ofOne = (await files.findUnchecked('1', later, 100)).map((r) => r.fileId);
      const ofTwo = (await files.findUnchecked('2', later, 100)).map((r) => r.fileId);

      expect(ofOne.sort()).toEqual([one, untenanted].sort());
      expect(ofTwo).toEqual([two]);

      await files.markReleased([two]);
      expect((await files.findReleasedBefore('1', later, 100)).map((r) => r.fileId)).toEqual([]);
      expect((await files.findReleasedBefore('2', later, 100)).map((r) => r.fileId)).toEqual([two]);
    });
  });
});

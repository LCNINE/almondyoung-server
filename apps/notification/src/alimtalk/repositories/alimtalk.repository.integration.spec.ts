/**
 * 알림톡 대량 발송 저장소 — 실제 Postgres 통합.
 *
 * CAS 로 집기·같은 id 재요청·jsonb 키는 목으로는 확인할 수 없다. DATABASE_URL 이 없으면 통째로 skip 된다.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- postgres publishes `export =`; Jest compiles CJS.
import postgres = require('postgres');
import { randomUUID } from 'crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, inArray } from 'drizzle-orm';
import * as schema from '../../../database/schemas/notification-schema';
import { SmsGateRepository } from '../../sms-gate/repositories/sms-gate.repository';
import { ALIMTALK_CAMPAIGN_PROVIDER, ALIMTALK_CAMPAIGN_PROVIDER_ID } from '../alimtalk.constants';
import { AlimtalkRepository } from './alimtalk.repository';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('AlimtalkRepository (PostgreSQL 통합)', () => {
  jest.setTimeout(60_000);

  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let repository: AlimtalkRepository;
  let smsGate: SmsGateRepository;
  const campaignIds: string[] = [];

  const campaign = (campaignId: string) => ({
    campaignId,
    name: 'it-alimtalk',
    category: 'INFORMATIONAL' as const,
    channels: ['KAKAO' as const],
    status: 'PROCESSING' as const,
    metadata: { provider: ALIMTALK_CAMPAIGN_PROVIDER, templateCode: 'IT_NOTICE', recipients: 3 },
    createdBy: 'it-admin',
  });

  const rows = (campaignId: string, n: number) =>
    Array.from({ length: n }, (_, i) => ({
      userId: `manual:+8210000000${i}`,
      campaignId,
      category: 'INFORMATIONAL' as const,
      channel: 'KAKAO' as const,
      language: 'ko' as const,
      providerId: ALIMTALK_CAMPAIGN_PROVIDER_ID,
      status: 'PENDING' as const,
      payload: { phoneNumber: `0100000000${i}`, username: `이름${i}` },
      metadata: { templateCode: 'IT_NOTICE', templateParameters: { name: `이름${i}` } },
    }));

  const newCampaign = async (n: number) => {
    const id = randomUUID();
    campaignIds.push(id);
    await repository.createCampaign(campaign(id), rows(id, n));
    return id;
  };

  beforeAll(async () => {
    client = postgres(DATABASE_URL as string, { max: 4, prepare: false });
    db = drizzle(client, { schema });
    const dbService = {
      db,
      run: <T>(fn: (tx: unknown) => Promise<T>) => db.transaction((tx) => fn(tx)),
    };
    repository = new AlimtalkRepository(dbService as never);
    smsGate = new SmsGateRepository(dbService as never);
  });

  afterAll(async () => {
    if (campaignIds.length > 0) {
      await db.delete(schema.notifications).where(inArray(schema.notifications.campaignId, campaignIds));
      await db
        .delete(schema.notificationCampaigns)
        .where(inArray(schema.notificationCampaigns.campaignId, campaignIds));
    }
    await client.end();
  });

  it('자동 발송 기록은 이벤트로 나간 카카오 행만 최신 순으로, 이벤트 이름과 함께 준다', async () => {
    const run = randomUUID().slice(0, 8);
    const eventKey = `IT_AUTO_${run}`;
    await db.insert(schema.notificationEvents).values({
      eventKey,
      name: '통합 테스트 자동 알림',
      description: 'it',
      templateKey: eventKey,
      category: 'TRANSACTIONAL',
      defaultChannels: ['KAKAO'],
    });
    const base = {
      userId: `it-auto-${run}`,
      category: 'TRANSACTIONAL' as const,
      language: 'ko' as const,
      payload: { name: '홍길동', phoneNumber: '01000000000' },
    };
    const inserted = await db
      .insert(schema.notifications)
      .values([
        { ...base, eventKey, channel: 'KAKAO', status: 'SENT', createdAt: new Date('2031-01-01T00:00:00Z') },
        { ...base, eventKey, channel: 'KAKAO', status: 'FAILED', createdAt: new Date('2031-01-02T00:00:00Z') },
        { ...base, eventKey, channel: 'EMAIL', status: 'SENT', createdAt: new Date('2031-01-03T00:00:00Z') },
      ])
      .returning({ id: schema.notifications.notificationId });
    const campaignId = await newCampaign(1); // 캠페인 행은 빠져야 한다
    try {
      const rows = await repository.listAutoSends(50, new Date('2031-01-04T00:00:00Z'));
      const mine = rows.filter((r) => r.eventKey === eventKey);
      expect(mine.map((r) => r.status)).toEqual(['FAILED', 'SENT']);
      expect(mine[0].eventName).toBe('통합 테스트 자동 알림');
      const campaignRows = await db
        .select({ id: schema.notifications.notificationId })
        .from(schema.notifications)
        .where(eq(schema.notifications.campaignId, campaignId));
      expect(rows.some((r) => campaignRows.some((c) => c.id === r.notificationId))).toBe(false);

      const older = await repository.listAutoSends(50, new Date('2031-01-02T00:00:00Z'));
      expect(older.filter((r) => r.eventKey === eventKey).map((r) => r.status)).toEqual(['SENT']);

      expect(await repository.findAutoSend(inserted[2].id)).toBeUndefined(); // 이메일
      expect((await repository.findAutoSend(inserted[0].id))?.status).toBe('SENT');
    } finally {
      await db.delete(schema.notifications).where(
        inArray(
          schema.notifications.notificationId,
          inserted.map((r) => r.id),
        ),
      );
      await db.delete(schema.notificationEvents).where(eq(schema.notificationEvents.eventKey, eventKey));
    }
  });

  it('같은 campaignId 로 두 번 만들면 두 번째는 아무것도 만들지 않는다', async () => {
    const id = randomUUID();
    campaignIds.push(id);
    expect(await repository.createCampaign(campaign(id), rows(id, 3))).toBe(true);
    expect(await repository.createCampaign(campaign(id), rows(id, 3))).toBe(false);
    const saved = await db.select().from(schema.notifications).where(eq(schema.notifications.campaignId, id));
    expect(saved).toHaveLength(3);
  });

  it('다른 인스턴스가 집는 중(커밋 전)에 같은 행을 고른 쪽은 커밋 뒤에 아무것도 가져가지 못한다', async () => {
    const id = await newCampaign(5);
    const now = new Date();
    let second: Promise<unknown[]> | undefined;
    const first = await db.transaction(async (tx) => {
      const inTx = new AlimtalkRepository({ db: tx } as never);
      const claimed = await inTx.claimBatch(id, now, 5);
      // 두 번째는 같은 PENDING 행을 골라 놓고 첫 번째의 행 잠금에 걸려 기다린다.
      second = repository.claimBatch(id, now, 5);
      await new Promise((resolve) => setTimeout(resolve, 300));
      return claimed;
    });
    expect(first).toHaveLength(5);
    expect(await second).toEqual([]);
  });

  it('접수된 행에는 요청 id 를 nhnRequestId 로 남긴다 — 기존 웹훅이 찾는 requestId 키와 겹치지 않게', async () => {
    const id = await newCampaign(2);
    const claimed = await repository.claimBatch(id, new Date(), 10);
    await repository.markSent(
      claimed.map((r) => r.notificationId),
      'req-it-1',
    );
    const saved = await db.select().from(schema.notifications).where(eq(schema.notifications.campaignId, id));
    for (const row of saved) {
      expect(row.status).toBe('SENT');
      expect(row.metadata?.nhnRequestId).toBe('req-it-1');
      expect(row.metadata?.requestId).toBeUndefined();
      expect(row.metadata?.templateCode).toBe('IT_NOTICE');
      expect(row.attempts).toBe(1);
    }
    expect(await repository.requestIdsOf(id)).toEqual(['req-it-1']);
  });

  it('문자(발송폰) 디스패처는 알림톡 행을 집지 않는다', async () => {
    const id = await newCampaign(2);
    const due = await smsGate.findDue(new Date(), 1000, true, true);
    expect(due.some((r) => r.campaignId === id)).toBe(false);
  });

  it('중지하면 남은 행만 CANCELLED 가 되고, 템플릿을 쓰는 대기 건 수에서 빠진다', async () => {
    const id = await newCampaign(3);
    await repository.claimBatch(id, new Date(), 1);
    expect(await repository.countPendingByTemplate('IT_NOTICE')).toBeGreaterThanOrEqual(3);
    expect(await repository.cancelCampaign(id)).toBe(2);
    const counts = await repository.countByCampaign([id]);
    expect(counts.find((c) => c.status === 'CANCELLED')?.count).toBe(2);
    expect(counts.find((c) => c.status === 'PROCESSING')?.count).toBe(1);
  });

  it('오래 PROCESSING 에 남은 행은 결과 불명 실패로 닫는다', async () => {
    const id = await newCampaign(1);
    const [claimed] = await repository.claimBatch(id, new Date(), 1);
    await db
      .update(schema.notifications)
      .set({ updatedAt: new Date(Date.now() - 60 * 60 * 1000) })
      .where(eq(schema.notifications.notificationId, claimed.notificationId));
    expect(
      await repository.failStaleProcessing(new Date(Date.now() - 10 * 60 * 1000), '결과 불명'),
    ).toBeGreaterThanOrEqual(1);
    expect(await repository.failureReasons(id)).toEqual([{ message: '결과 불명', count: 1 }]);
  });

  it('예약 시각 전의 행은 집지 않는다', async () => {
    const id = randomUUID();
    campaignIds.push(id);
    const later = new Date(Date.now() + 60 * 60 * 1000);
    await repository.createCampaign(
      campaign(id),
      rows(id, 2).map((r) => ({ ...r, sendAt: later })),
    );
    expect(await repository.claimBatch(id, new Date(), 10)).toEqual([]);
    expect(await repository.claimBatch(id, new Date(later.getTime() + 1000), 10)).toHaveLength(2);
  });
  describe('자동 알림 연결', () => {
    const keys: string[] = [];
    const key = () => {
      const k = `IT_NOTICE_${randomUUID().slice(0, 8)}`;
      keys.push(k);
      return k;
    };
    const link = (eventKey: string, templateCode: string, templateBody: string) => ({
      eventKey,
      name: '통합 테스트 자동 알림',
      description: '통합 테스트',
      variables: ['name', 'period'],
      templateCode,
      templateName: '통합 테스트 템플릿',
      templateBody,
    });

    afterAll(async () => {
      if (keys.length === 0) return;
      await db.delete(schema.notificationEvents).where(inArray(schema.notificationEvents.eventKey, keys));
      await db.delete(schema.templates).where(inArray(schema.templates.templateKey, keys));
    });

    it('설정 행이 없으면 시드와 같은 모양으로 꺼진 채 만들고, 다시 이으면 코드와 본문만 바꾼다', async () => {
      const k = key();
      await repository.linkAutoNotice(link(k, 'IT_A', '#{name}님 첫 본문'));
      expect(await repository.findAutoNoticeSettings([k])).toEqual([
        { eventKey: k, templateKey: k, isActive: false, kakaoTemplateCode: 'IT_A' },
      ]);
      const [event] = await db
        .select()
        .from(schema.notificationEvents)
        .where(eq(schema.notificationEvents.eventKey, k));
      expect(event).toMatchObject({ defaultChannels: ['KAKAO'], category: 'TRANSACTIONAL', priority: 'HIGH' });

      await db
        .update(schema.notificationEvents)
        .set({ isActive: true })
        .where(eq(schema.notificationEvents.eventKey, k));
      await repository.linkAutoNotice(link(k, 'IT_B', '#{name}님 바뀐 본문'));
      const tpl = await db.select().from(schema.templates).where(eq(schema.templates.templateKey, k));
      expect(tpl).toHaveLength(1);
      expect(tpl[0]).toMatchObject({
        kakaoTemplateCode: 'IT_B',
        contents: { KAKAO: { ko: { body: '#{name}님 바뀐 본문' } } },
      });
      // 이어 붙이기는 켜고 끄는 상태를 건드리지 않는다
      expect((await repository.findAutoNoticeSettings([k]))[0].isActive).toBe(true);
    });

    it('본문 사본은 알림톡 칸만 갈아 끼우고 다른 채널 본문은 남긴다', async () => {
      const k = key();
      await db.insert(schema.templates).values({
        templateKey: k,
        name: '기존',
        category: 'TRANSACTIONAL',
        contents: { SMS: { ko: { body: '문자 본문' } } },
        variablesSchema: {},
      });
      await repository.linkAutoNotice(link(k, 'IT_C', '알림톡 본문'));
      const [tpl] = await db.select().from(schema.templates).where(eq(schema.templates.templateKey, k));
      expect(tpl.contents).toEqual({ SMS: { ko: { body: '문자 본문' } }, KAKAO: { ko: { body: '알림톡 본문' } } });
    });

    it('떼면 코드만 비운다', async () => {
      const k = key();
      await repository.linkAutoNotice(link(k, 'IT_D', '본문'));
      await repository.unlinkAutoNotice(k);
      expect((await repository.findAutoNoticeSettings([k]))[0].kakaoTemplateCode).toBeNull();
    });
  });
});

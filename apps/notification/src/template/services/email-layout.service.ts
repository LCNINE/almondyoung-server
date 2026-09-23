import { Injectable } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { eq } from 'drizzle-orm';
import { DEFAULT_EMAIL_LAYOUT, type EmailLayoutSettings } from '@packages/email-layout';
import { emailLayoutSettings, notificationTables } from '../../../database/schemas/notification-schema';

const ROW_ID = 'default';
const CACHE_MS = 60_000;

@Injectable()
export class EmailLayoutService {
  private cached: { at: number; value: EmailLayoutSettings } | null = null;

  constructor(@InjectTypedDb<typeof notificationTables>() private readonly dbService: DbService<typeof notificationTables>) {}

  async get(): Promise<EmailLayoutSettings> {
    const [row] = await this.dbService.db
      .select()
      .from(emailLayoutSettings)
      .where(eq(emailLayoutSettings.id, ROW_ID))
      .limit(1);

    return row
      ? {
          logoUrl: row.logoUrl,
          brandColor: row.brandColor,
          textColor: row.textColor,
          backgroundColor: row.backgroundColor,
          footerContact: row.footerContact,
          footerBusiness: row.footerBusiness,
        }
      : DEFAULT_EMAIL_LAYOUT;
  }

  /** 발송 경로용. 메일 한 통마다 조회하지 않게 짧게 들고 있는다. */
  async getCached(): Promise<EmailLayoutSettings> {
    if (this.cached && Date.now() - this.cached.at < CACHE_MS) return this.cached.value;
    const value = await this.get().catch(() => DEFAULT_EMAIL_LAYOUT);
    this.cached = { at: Date.now(), value };
    return value;
  }

  async update(values: Partial<EmailLayoutSettings>): Promise<EmailLayoutSettings> {
    // ValidationPipe 는 안 보낸 필드도 undefined 로 만들어 준다. 그대로 펼치면 저장값이 지워진다.
    const given = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
    const next = { ...(await this.get()), ...given };
    await this.dbService.db
      .insert(emailLayoutSettings)
      .values({ id: ROW_ID, ...next, updatedAt: new Date() })
      .onConflictDoUpdate({ target: emailLayoutSettings.id, set: { ...next, updatedAt: new Date() } });

    this.cached = null;
    return next;
  }
}

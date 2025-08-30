import { Injectable } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import * as schema from '../shared/database/schema';
import { eq } from 'drizzle-orm';

@Injectable()
export class PaymentEventsService {
  constructor(
    @InjectDb() private readonly dbService: DbService<typeof schema>,
  ) {}

  async createEvent(data: typeof schema.paymentEvents.$inferInsert) {
    const [event] = await this.dbService.db
      .insert(schema.paymentEvents)
      .values(data)
      .returning();
    return event;
  }

  async getEventById(id: string) {
    const [event] = await this.dbService.db
      .select()
      .from(schema.paymentEvents)
      .where(eq(schema.paymentEvents.id, id));
    return event;
  }

  async getEventsBySession(sessionId: string) {
    return await this.dbService.db
      .select()
      .from(schema.paymentEvents)
      .where(eq(schema.paymentEvents.paymentSessionId, sessionId));
  }

  async deleteEvent(id: string) {
    await this.dbService.db
      .delete(schema.paymentEvents)
      .where(eq(schema.paymentEvents.id, id));
  }
}

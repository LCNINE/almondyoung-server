import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import * as schema from '../shared/schemas/schema';
import { ulid } from 'ulid';
import { and, eq, SQL, desc, lt } from 'drizzle-orm';
import { UpdateInvoiceStatusDto } from './dto/update-invoice-status.dto';
import { Cron } from '@nestjs/schedule';
import {
  InvoiceEventResponseDto,
  InvoiceResponseDto,
} from './dto/invoice.response.dto';

const INVOICE_EXPIRATION_MINUTES = 30;

type InvoiceWithEvents = typeof schema.invoice.$inferSelect & {
  events: Array<typeof schema.invoiceEvent.$inferSelect>;
};

@Injectable()
export class InvoiceService {
  constructor(
    @InjectDb() private readonly dbService: DbService<typeof schema>,
  ) {}

  private calculateExpirationTime(): Date {
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + INVOICE_EXPIRATION_MINUTES);
    return expiresAt;
  }

  private async generateInvoiceNumber(userId: string): Promise<string> {
    // Get the current date components
    const now = new Date();
    const yearMonth =
      now.getFullYear().toString() +
      (now.getMonth() + 1).toString().padStart(2, '0');

    // Find the latest invoice number for this year-month
    const latestInvoice = await this.dbService.db.query.invoice.findFirst({
      where: and(
        eq(schema.invoice.userId, userId),
        eq(schema.invoice.invoiceNumber, `${yearMonth}-${userId}`),
      ),
      orderBy: [desc(schema.invoice.invoiceNumber)],
    });

    let sequence = 1;
    if (latestInvoice) {
      const lastSequence = parseInt(latestInvoice.invoiceNumber.split('-')[2]);
      sequence = lastSequence + 1;
    }

    // Format: YYYYMM-USERID-SEQUENCE
    return `${yearMonth}-${userId}-${sequence.toString().padStart(4, '0')}`;
  }

  private mapToResponseDto(
    invoice: InvoiceWithEvents | null,
  ): InvoiceResponseDto | null {
    if (!invoice) {
      return null;
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { issuedAt, ...rest } = invoice;
    const response: InvoiceResponseDto = {
      ...rest,
      events: rest.events.map(
        (e): InvoiceEventResponseDto => ({
          id: e.id,
          eventUuid: e.eventUuid,
          eventType: e.eventType as schema.InvoiceStatus,
          reason: e.reason,
          occurredAt: e.occurredAt,
        }),
      ),
    };
    return response;
  }

  private async findOneRaw(id: number): Promise<InvoiceWithEvents | null> {
    const result = await this.dbService.db.query.invoice.findFirst({
      where: eq(schema.invoice.id, id),
      with: {
        events: true,
      },
    });
    return result ?? null;
  }

  async create(
    createInvoiceDto: CreateInvoiceDto,
  ): Promise<InvoiceResponseDto> {
    const { userId, invoiceType, amount, currency, dueAt } = createInvoiceDto;
    const invoiceNumber = await this.generateInvoiceNumber(userId);
    const now = new Date();

    const result = await this.dbService.db.transaction(async (tx) => {
      const [newInvoice] = await tx
        .insert(schema.invoice)
        .values({
          userId,
          invoiceNumber,
          invoiceType,
          amount,
          currency,
          status: schema.INVOICE_STATUS.ISSUED,
          issuedAt: now,
          expiresAt: this.calculateExpirationTime(),
          dueAt: dueAt ? new Date(dueAt) : null,
        })
        .returning();

      await tx.insert(schema.invoiceEvent).values({
        invoiceId: newInvoice.id,
        eventType: schema.INVOICE_STATUS.ISSUED,
        occurredAt: now,
        eventUuid: ulid(),
      });

      return newInvoice;
    });

    const fullInvoice = await this.findOneRaw(result.id);
    if (!fullInvoice) {
      throw new InternalServerErrorException(
        'Could not retrieve invoice after creation.',
      );
    }
    return this.mapToResponseDto(fullInvoice)!;
  }

  @Cron('0 * * * * *')
  async handleExpiredInvoices() {
    const now = new Date();
    const expiredInvoices = await this.dbService.db.query.invoice.findMany({
      where: and(
        eq(schema.invoice.status, schema.INVOICE_STATUS.ISSUED),
        lt(schema.invoice.expiresAt, now),
      ),
    });

    for (const invoice of expiredInvoices) {
      await this.updateStatus(invoice.id, {
        status: schema.INVOICE_STATUS.EXPIRED,
        reason: 'Invoice expired due to payment timeout',
      });
    }
  }

  async findOne(id: number): Promise<InvoiceResponseDto | null> {
    const invoice = await this.findOneRaw(id);
    return this.mapToResponseDto(invoice);
  }

  async findAll(
    userId?: string,
    status?: schema.InvoiceStatus,
  ): Promise<InvoiceResponseDto[]> {
    const conditions: SQL[] = [];
    if (userId) {
      conditions.push(eq(schema.invoice.userId, userId));
    }
    if (status) {
      conditions.push(eq(schema.invoice.status, status));
    }

    const results = await this.dbService.db.query.invoice.findMany({
      where: conditions.length > 0 ? and(...conditions) : undefined,
      with: {
        events: true,
      },
    });

    return results
      .map((invoice) => this.mapToResponseDto(invoice))
      .filter((invoice): invoice is InvoiceResponseDto => invoice !== null);
  }

  async updateStatus(
    id: number,
    updateInvoiceStatusDto: UpdateInvoiceStatusDto,
  ): Promise<InvoiceResponseDto | null> {
    const { status, reason } = updateInvoiceStatusDto;

    const result = await this.dbService.db.transaction(async (tx) => {
      const [updatedInvoice] = await tx
        .update(schema.invoice)
        .set({ status })
        .where(eq(schema.invoice.id, id))
        .returning();

      if (updatedInvoice) {
        await tx.insert(schema.invoiceEvent).values({
          invoiceId: updatedInvoice.id,
          eventType: status,
          reason,
          occurredAt: new Date(),
          eventUuid: ulid(),
        });

        return updatedInvoice;
      }

      return null;
    });

    if (!result) {
      return null;
    }

    const fullInvoice = await this.findOneRaw(result.id);
    return this.mapToResponseDto(fullInvoice);
  }
}

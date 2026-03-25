// apps/notification/src/shared/services/event-mapping.service.ts
import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { notificationEvents, notificationTables } from '../../../database/schemas/notification-schema';
import { eq } from 'drizzle-orm';
import { CreateEventDto, UpdateEventDto, TriggerEventDto } from '../dto/event.dto';

export interface NotificationEvent {
  eventId: string;
  eventKey: string;
  name: string;
  description: string;
  templateKey: string;
  category: string;
  defaultChannels: string[];
  priority: string;
  conditions: any;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface NewNotificationEvent {
  eventKey: string;
  name: string;
  description: string;
  templateKey: string;
  category: string;
  defaultChannels: string[];
  priority: string;
  conditions: any;
  isActive: boolean;
}

@Injectable()
export class EventMappingService {
  constructor(@InjectTypedDb<typeof notificationTables>() private readonly db: DbService<typeof notificationTables>) {}

  async createEvent(dto: CreateEventDto): Promise<NotificationEvent> {
    try {
      const [newEvent] = await this.db.db
        .insert(notificationEvents)
        .values({
          eventKey: dto.eventKey,
          name: dto.name,
          description: dto.description,
          templateKey: dto.templateKey,
          category: dto.category as any,
          defaultChannels: dto.defaultChannels as any,
          priority: (dto.priority || 'NORMAL') as any,
          conditions: dto.conditions,
          isActive: true,
        })
        .returning();

      return {
        eventId: newEvent.eventId,
        eventKey: newEvent.eventKey,
        name: newEvent.name,
        description: newEvent.description,
        templateKey: newEvent.templateKey,
        category: newEvent.category,
        defaultChannels: newEvent.defaultChannels as string[],
        priority: newEvent.priority,
        conditions: newEvent.conditions,
        isActive: newEvent.isActive,
        createdAt: newEvent.createdAt,
        updatedAt: newEvent.updatedAt,
      } as NotificationEvent;
    } catch (error: any) {
      // PostgreSQL unique constraint violation (error code 23505)
      // 또는 다른 DB의 unique constraint 에러 처리
      if (
        error.code === '23505' ||
        error.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
        (error.message && error.message.includes('UNIQUE constraint'))
      ) {
        throw new ConflictException(`Event key "${dto.eventKey}" already exists`);
      }
      throw error;
    }
  }

  async getAllEvents(): Promise<NotificationEvent[]> {
    const events = await this.db.db.select().from(notificationEvents).where(eq(notificationEvents.isActive, true));

    return events.map((event) => ({
      eventId: event.eventId,
      eventKey: event.eventKey,
      name: event.name,
      description: event.description,
      templateKey: event.templateKey,
      category: event.category,
      defaultChannels: event.defaultChannels as string[],
      priority: event.priority,
      conditions: event.conditions,
      isActive: event.isActive,
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
    })) as NotificationEvent[];
  }

  async getEventByKey(eventKey: string): Promise<NotificationEvent> {
    const [event] = await this.db.db.select().from(notificationEvents).where(eq(notificationEvents.eventKey, eventKey));

    if (!event) {
      throw new NotFoundException(`Event with key ${eventKey} not found`);
    }

    return {
      eventId: event.eventId,
      eventKey: event.eventKey,
      name: event.name,
      description: event.description,
      templateKey: event.templateKey,
      category: event.category,
      defaultChannels: event.defaultChannels as string[],
      priority: event.priority,
      conditions: event.conditions,
      isActive: event.isActive,
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
    } as NotificationEvent;
  }

  async getEventMapping(eventKey: string): Promise<NotificationEvent | null> {
    try {
      return await this.getEventByKey(eventKey);
    } catch (error) {
      return null;
    }
  }

  async updateEvent(eventKey: string, dto: UpdateEventDto): Promise<NotificationEvent> {
    // undefined 필드는 업데이트하지 않도록 필터링
    const updateData: any = {
      updatedAt: new Date(),
    };

    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.templateKey !== undefined) updateData.templateKey = dto.templateKey;
    if (dto.category !== undefined) updateData.category = dto.category as any;
    if (dto.defaultChannels !== undefined) updateData.defaultChannels = dto.defaultChannels as any;
    if (dto.priority !== undefined) updateData.priority = dto.priority as any;
    if (dto.conditions !== undefined) updateData.conditions = dto.conditions;
    if (dto.isActive !== undefined) updateData.isActive = dto.isActive;

    const [updatedEvent] = await this.db.db
      .update(notificationEvents)
      .set(updateData)
      .where(eq(notificationEvents.eventKey, eventKey))
      .returning();

    if (!updatedEvent) {
      throw new NotFoundException(`Event with key ${eventKey} not found`);
    }

    return {
      eventId: updatedEvent.eventId,
      eventKey: updatedEvent.eventKey,
      name: updatedEvent.name,
      description: updatedEvent.description,
      templateKey: updatedEvent.templateKey,
      category: updatedEvent.category,
      defaultChannels: updatedEvent.defaultChannels as string[],
      priority: updatedEvent.priority,
      conditions: updatedEvent.conditions,
      isActive: updatedEvent.isActive,
      createdAt: updatedEvent.createdAt,
      updatedAt: updatedEvent.updatedAt,
    } as NotificationEvent;
  }

  /**
     * @deprecated 이 메서드는 실제로 알림을 발송하지 않음
     * HTTP 엔드포인트에서 이벤트를 트리거하려면 NotificationDispatcherService.processEvent()를 사용
     * 

     */
  async triggerEvent(dto: TriggerEventDto): Promise<any> {
    const event = await this.getEventByKey(dto.eventKey);

    // 실제 알림 발송은 하지 않고 이벤트 정보만 반환
    // TODO: NotificationDispatcherService.processEvent()로 리팩토링 필요
    return {
      message: `Event ${dto.eventKey} triggered successfully`,
      eventKey: event.eventKey,
      eventId: event.eventId,
      notificationIds: [],
      warning:
        'This endpoint does not actually send notifications. Use NotificationDispatcherService.processEvent() instead.',
    };
  }
}

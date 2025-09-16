// apps/notification/src/shared/services/event-mapping.service.ts
import { Injectable } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { notificationTables } from '../../../database/schemas/notification-schema';
import { DbService } from '@app/db';
import { eq } from 'drizzle-orm';
import { notificationEvents, NotificationEvent, NewNotificationEvent, Channel } from '../../../database/schemas/notification-schema';
import { CreateEventDto, UpdateEventDto, TriggerEventDto } from '../dto/event.dto';
import { NotificationDispatcherService } from '../../dispatcher/services/notification-dispatcher.service';

@Injectable()
export class EventMappingService {
    constructor(
        @InjectTypedDb<typeof notificationTables>() private readonly dbService: DbService<typeof notificationTables>,
        private readonly dispatcherService: NotificationDispatcherService,
    ) { }

    private get db() {
        return this.dbService.db;
    }

    async createEvent(dto: CreateEventDto): Promise<NotificationEvent> {
        const newEvent: NewNotificationEvent = {
            name: dto.name,
            eventKey: dto.eventKey,
            description: dto.description,
            templateKey: dto.templateKey,
            category: dto.category as any,
            priority: dto.priority as any || 'NORMAL',
            defaultChannels: dto.defaultChannels as Channel[],
            conditions: dto.conditions,
            isActive: dto.isActive ?? true,
            metadata: dto.metadata,
        };

        const [result] = await this.db
            .insert(notificationEvents)
            .values(newEvent)
            .returning();

        return result;
    }

    async getEventByKey(eventKey: string): Promise<NotificationEvent | null> {
        const event = await this.db.query.notificationEvents.findFirst({
            where: eq(notificationEvents.eventKey, eventKey)
        });

        return event || null;
    }

    async getAllEvents(): Promise<NotificationEvent[]> {
        return this.db.query.notificationEvents.findMany({
            where: eq(notificationEvents.isActive, true)
        });
    }

    async updateEvent(eventKey: string, dto: UpdateEventDto): Promise<NotificationEvent> {
        const [result] = await this.db
            .update(notificationEvents)
            .set({
                ...dto,
                updatedAt: new Date(),
            })
            .where(eq(notificationEvents.eventKey, eventKey))
            .returning();

        return result[0];
    }

    async deleteEvent(eventKey: string): Promise<void> {
        await this.db
            .update(notificationEvents)
            .set({ isActive: false })
            .where(eq(notificationEvents.eventKey, eventKey));
    }

    async triggerEvent(dto: TriggerEventDto): Promise<{ message: string; notificationIds: string[] }> {
        const event = await this.getEventByKey(dto.eventKey);
        if (!event) {
            throw new Error(`Event ${dto.eventKey} not found`);
        }

        if (!event.isActive) {
            throw new Error(`Event ${dto.eventKey} is not active`);
        }

        // 이벤트가 정보성 알림인 경우 마케팅 동의 확인 불필요
        const channels = event.defaultChannels;
        
        const notificationIds = await this.dispatcherService.send({
            userId: dto.userId,
            eventKey: dto.eventKey,
            templateKey: event.templateKey,
            channels: channels as any[],
            payload: dto.payload || {},
            category: event.category as any,
            priority: event.priority as any,
            metadata: {
                ...dto.metadata,
                triggeredBy: 'event',
            },
        });

        return {
            message: `Event ${dto.eventKey} triggered successfully`,
            notificationIds,
        };
    }
}

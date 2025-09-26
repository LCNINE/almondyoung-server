// apps/notification/src/shared/services/event-mapping.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '@app/db';
import { notificationEvents } from '../../database/schemas/notification-schema';
import { eq } from 'drizzle-orm';
import { CreateEventDto, UpdateEventDto, TriggerEventDto } from '../dto/event.dto';

interface NotificationEvent {
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
    constructor(private readonly db: DbService) {}

    async createEvent(dto: CreateEventDto): Promise<NotificationEvent> {
        const [newEvent] = await this.db.db
            .insert(notificationEvents)
            .values({
                eventKey: dto.eventKey,
                name: dto.name,
                description: dto.description,
                templateKey: dto.templateKey,
                category: dto.category as any,
                defaultChannels: dto.defaultChannels as any,
                priority: (dto.priority || "NORMAL") as any,
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
    }

    async getAllEvents(): Promise<NotificationEvent[]> {
        const events = await this.db.db
            .select()
            .from(notificationEvents)
            .where(eq(notificationEvents.isActive, true));

        return events.map(event => ({
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
        const [event] = await this.db.db
            .select()
            .from(notificationEvents)
            .where(eq(notificationEvents.eventKey, eventKey));

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
        const [updatedEvent] = await this.db.db
            .update(notificationEvents)
            .set({
                name: dto.name,
                description: dto.description,
                templateKey: dto.templateKey,
                category: dto.category as any,
                defaultChannels: dto.defaultChannels as any,
                priority: dto.priority as any,
                conditions: dto.conditions,
                isActive: dto.isActive,
                updatedAt: new Date(),
            })
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

    async triggerEvent(dto: TriggerEventDto): Promise<any> {
        const event = await this.getEventByKey(dto.eventKey);
        
        return {
            message: `Event ${dto.eventKey} triggered successfully`,
            notificationIds: [],
        };
    }
}

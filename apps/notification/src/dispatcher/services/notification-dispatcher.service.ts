// apps/notification/src/dispatcher/services/notification-dispatcher.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { SendNotificationDto } from '../dto/send-notification.dto';

interface Notification {
    notificationId: string;
    userId: string;
    category: string;
    priority: string;
    channel: string;
    language: string;
    status: string;
    attempts: number;
    createdAt: Date;
    updatedAt: Date;
}

@Injectable()
export class NotificationDispatcherService {
    private readonly logger = new Logger(NotificationDispatcherService.name);

    constructor(
        private readonly db: DbService,
    ) {}

    async send(dto: SendNotificationDto): Promise<{ notificationIds: string[] }> {
        this.logger.log('Sending notification', { dto });
        
        // 간단한 구현
        const notificationIds = ['temp-notification-id'];
        
        return { notificationIds };
    }

    async getNotification(id: string): Promise<Notification> {
        // 간단한 구현
        return {
            notificationId: id,
            userId: 'temp-user',
            category: 'INFORMATIONAL',
            priority: 'NORMAL',
            channel: 'EMAIL',
            language: 'ko',
            status: 'SENT',
            attempts: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
        } as Notification;
    }

    async getUserNotifications(userId: string, limit = 50): Promise<Notification[]> {
        // 간단한 구현
        return [];
    }

    private getPriorityValue(priority: string): number {
        const priorityMap = {
            'URGENT': 1,
            'HIGH': 2,
            'NORMAL': 3,
            'LOW': 4,
        };
        return priorityMap[priority] || 3;
    }
}

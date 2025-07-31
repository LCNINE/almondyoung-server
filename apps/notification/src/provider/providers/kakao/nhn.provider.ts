// apps/notification/src/provider/providers/kakao/nhn.provider.ts
// TODO: MHN 프로바이더 구현

import { ConfigService } from "@nestjs/config";
import { BulkNotificationResult, NotificationMessage, NotificationProvider, NotificationResult } from "../../interfaces/notification-provider.interface";

export class NHNProvider implements NotificationProvider {
    constructor(private readonly configService: ConfigService) {
        this.configService = configService;
    }
    getName(): string {
        throw new Error("Method not implemented.");
    }
    getProviderId(): string {
        throw new Error("Method not implemented.");
    }
    isAvailable(): Promise<boolean> {
        throw new Error("Method not implemented.");
    }
    send(message: NotificationMessage): Promise<NotificationResult> {
        throw new Error("Method not implemented.");
    }
    sendBulk(messages: NotificationMessage[]): Promise<BulkNotificationResult> {
        throw new Error("Method not implemented.");
    }
}
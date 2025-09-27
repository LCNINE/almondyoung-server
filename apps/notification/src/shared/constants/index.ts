// apps/notification/src/shared/constants/index.ts
export const NOTIFICATION_CONSTANTS = {
    BATCH_SIZE: 1000,
    MAX_RETRIES: 3,
    RETRY_DELAYS: [60000, 300000, 900000], // 1min, 5min, 15min
    HEALTH_CHECK_INTERVAL: 5 * 60 * 1000, // 5분
    MAX_BULK_RECIPIENTS: 10000,
    WEBHOOK_TIMEOUT: 30000,
} as const;
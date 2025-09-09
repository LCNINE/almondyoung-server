// apps/notification/database/schemas/notification-schema.ts
import { pgTable, pgEnum, uuid, varchar, text, jsonb, timestamp, integer, boolean, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const channelEnum = pgEnum('channel', ['EMAIL', 'SMS', 'KAKAO', 'PUSH']);
export const languageEnum = pgEnum('language', ['ko', 'en']);
export const notificationStatusEnum = pgEnum('notification_status', [
    'PENDING',
    'PROCESSING',
    'SENT',
    'DELIVERED',
    'FAILED',
    'CANCELLED',
    'RETRYING'
]);
export const providerStatusEnum = pgEnum('provider_status', ['ACTIVE', 'INACTIVE', 'ERROR']);
export const campaignStatusEnum = pgEnum('campaign_status', ['DRAFT', 'SCHEDULED', 'PROCESSING', 'COMPLETED', 'CANCELLED']);
export const targetTypeEnum = pgEnum('target_type', ['all', 'filter', 'excel', 'search']);
export const membershipTypeEnum = pgEnum('membership_type', ['general', 'premium']);
export const devicePlatformEnum = pgEnum('device_platform', ['ios', 'android', 'web']);

// 알림 카테고리
export const notificationCategoryEnum = pgEnum('notification_category', [
    'TRANSACTIONAL',    // 거래 관련 (주문, 결제 등)
    'MARKETING',        // 마케팅/프로모션
    'SYSTEM',          // 시스템 알림 (비밀번호 변경 등)
    'ADMIN',           // 관리자 알림
    'OPERATIONAL',     // 운영 알림 (점검 등)
    'CUSTOMER_SERVICE' // 고객 서비스 (문의 답변 등)
]);

// 알림 우선순위
export const notificationPriorityEnum = pgEnum('notification_priority', [
    'URGENT',    // 긴급 (즉시 발송)
    'HIGH',      // 높음
    'NORMAL',    // 보통
    'LOW'        // 낮음
]);

// 템플릿 테이블
export const templates = pgTable('templates', {
    templateId: uuid('template_id').defaultRandom().primaryKey(),
    templateKey: varchar('template_key', { length: 100 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    category: notificationCategoryEnum('category').notNull(),
    contents: jsonb('contents').notNull().$type<TemplateContents>(),
    variablesSchema: jsonb('variables_schema').notNull().$type<VariableSchema>(),
    version: integer('version').default(1).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    metadata: jsonb('metadata').$type<Record<string, any>>(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
    templateKeyIdx: index('idx_template_key_active').on(table.templateKey, table.isActive),
    categoryIdx: index('idx_template_category').on(table.category),
}));

// 알림 발송 테이블
export const notifications = pgTable('notifications', {
    notificationId: uuid('notification_id').defaultRandom().primaryKey(),
    correlationId: varchar('correlation_id', { length: 100 }),
    userId: varchar('user_id', { length: 100 }).notNull(),
    eventKey: varchar('event_key', { length: 100 }),
    templateKey: varchar('template_key', { length: 100 }),
    templateId: uuid('template_id'),
    campaignId: uuid('campaign_id'),
    category: notificationCategoryEnum('category').notNull(),
    priority: notificationPriorityEnum('priority').default('NORMAL').notNull(),
    channel: channelEnum('channel').notNull(),
    providerId: uuid('provider_id'),
    language: languageEnum('language').notNull(),
    payload: jsonb('payload').$type<Record<string, any>>(),
    renderedContent: jsonb('rendered_content').$type<RenderedContent>(),
    status: notificationStatusEnum('status').default('PENDING').notNull(),
    sendAt: timestamp('send_at'),
    sentAt: timestamp('sent_at'),
    attempts: integer('attempts').default(0).notNull(),
    nextRetryAt: timestamp('next_retry_at'),
    errorDetails: jsonb('error_details').$type<ErrorDetails>(),
    metadata: jsonb('metadata').$type<Record<string, any>>(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
    userStatusIdx: index('idx_user_status_created').on(
        table.userId,
        table.status,
        table.createdAt
    ),
    statusSendAtIdx: index('idx_status_send_at').on(table.status, table.sendAt),
    statusRetryIdx: index('idx_status_retry').on(table.status, table.nextRetryAt),
    campaignIdx: index('idx_campaign').on(table.campaignId),
    categoryPriorityIdx: index('idx_category_priority').on(table.category, table.priority),
}));

// 대량 발송 캠페인 테이블
export const notificationCampaigns = pgTable('notification_campaigns', {
    campaignId: uuid('campaign_id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    category: notificationCategoryEnum('category').notNull(),
    channels: jsonb('channels').notNull().$type<Channel[]>(),
    templateId: uuid('template_id'),
    content: jsonb('content').$type<CampaignContent>(),
    sendAt: timestamp('send_at'),
    priority: notificationPriorityEnum('priority').default('NORMAL').notNull(),
    status: campaignStatusEnum('status').default('DRAFT').notNull(),
    stats: jsonb('stats').default('{"sent":0,"delivered":0,"failed":0,"opened":0,"clicked":0}').$type<CampaignStats>(),
    metadata: jsonb('metadata').$type<Record<string, any>>(),
    createdBy: varchar('created_by', { length: 100 }).notNull(),
    approvedBy: varchar('approved_by', { length: 100 }),
    approvedAt: timestamp('approved_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
    statusIdx: index('idx_campaign_status').on(table.status),
    sendAtIdx: index('idx_campaign_send_at').on(table.sendAt),
    categoryIdx: index('idx_campaign_category').on(table.category),
}));

// 캠페인 타겟 그룹 테이블
export const campaignTargetGroups = pgTable('campaign_target_groups', {
    groupId: uuid('group_id').defaultRandom().primaryKey(),
    campaignId: uuid('campaign_id').notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    type: targetTypeEnum('type').notNull(),
    criteria: jsonb('criteria'),
    userList: jsonb('user_list'),
    userCount: integer('user_count').default(0),
    createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
    campaignIdx: index('idx_campaign_target').on(table.campaignId),
}));

// 대량 발송 수신자 테이블
export const campaignRecipients = pgTable('campaign_recipients', {
    recipientId: uuid('recipient_id').defaultRandom().primaryKey(),
    campaignId: uuid('campaign_id').notNull(),
    userId: varchar('user_id', { length: 100 }).notNull(),
    channel: channelEnum('channel').notNull(),
    status: varchar('status', { length: 50 }).notNull(),
    errorMessage: text('error_message'),
    attemptedAt: timestamp('attempted_at').notNull(),
    metadata: jsonb('metadata'),
}, (table) => ({
    campaignUserIdx: index('idx_campaign_user').on(table.campaignId, table.userId),
}));

// 사용자 정보 캐시 테이블
export const userProfiles = pgTable('user_profiles', {
    userId: varchar('user_id', { length: 100 }).primaryKey(),
    email: varchar('email', { length: 255 }),
    phoneNumber: varchar('phone_number', { length: 20 }),
    pushToken: varchar('push_token', { length: 255 }),
    membershipType: membershipTypeEnum('membership_type').default('general'),
    shopCategories: jsonb('shop_categories'),
    deviceInfo: jsonb('device_info').$type<DeviceInfo>(),
    metadata: jsonb('metadata'),
    syncedAt: timestamp('synced_at').defaultNow().notNull(),
}, (table) => ({
    membershipIdx: index('idx_membership_type').on(table.membershipType),
    emailIdx: index('idx_email').on(table.email),
    phoneIdx: index('idx_phone').on(table.phoneNumber),
    pushTokenIdx: index('idx_push_token').on(table.pushToken),
}));

// FCM 토큰 관리 테이블
export const fcmTokens = pgTable('fcm_tokens', {
    tokenId: uuid('token_id').defaultRandom().primaryKey(),
    userId: varchar('user_id', { length: 100 }).notNull(),
    token: varchar('token', { length: 500 }).notNull(),
    deviceId: varchar('device_id', { length: 255 }),
    platform: devicePlatformEnum('platform').notNull(),
    appVersion: varchar('app_version', { length: 50 }),
    osVersion: varchar('os_version', { length: 50 }),
    deviceModel: varchar('device_model', { length: 100 }),
    deviceName: varchar('device_name', { length: 255 }),
    isActive: boolean('is_active').default(true).notNull(),
    isPrimary: boolean('is_primary').default(false).notNull(),
    lastUsedAt: timestamp('last_used_at').defaultNow().notNull(),
    topics: jsonb('topics').$type<string[]>(),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
    userIdIdx: index('idx_fcm_user_id').on(table.userId),
    tokenIdx: uniqueIndex('idx_fcm_token').on(table.token),
    userDeviceIdx: uniqueIndex('idx_user_device').on(table.userId, table.deviceId),
    activeTokensIdx: index('idx_active_tokens').on(table.userId, table.isActive),
    platformIdx: index('idx_fcm_platform').on(table.platform),
}));

// FCM 주제 구독 관리 테이블
export const fcmTopicSubscriptions = pgTable('fcm_topic_subscriptions', {
    subscriptionId: uuid('subscription_id').defaultRandom().primaryKey(),
    userId: varchar('user_id', { length: 100 }).notNull(),
    tokenId: uuid('token_id'),
    topic: varchar('topic', { length: 255 }).notNull(),
    subscribedAt: timestamp('subscribed_at').defaultNow().notNull(),
    metadata: jsonb('metadata'),
}, (table) => ({
    userTopicIdx: uniqueIndex('idx_user_topic').on(table.userId, table.topic),
    tokenTopicIdx: index('idx_token_topic').on(table.tokenId, table.topic),
    topicIdx: index('idx_topic').on(table.topic),
}));

// 사용자 알림 설정 테이블
export const userNotificationSettings = pgTable('user_notification_settings', {
    settingId: uuid('setting_id').defaultRandom().primaryKey(),
    userId: varchar('user_id', { length: 100 }).unique().notNull(),
    // 마케팅 알림 수신 동의 (모든 채널 통합)
    isMarketingEnabled: boolean('is_marketing_enabled').default(false).notNull(),
    // 시스템/정보성 알림은 항상 발송 (동의 불필요)
    preferredLanguage: languageEnum('preferred_language').default('ko').notNull(),
    // 푸시 알림 세부 설정 (소리, 진동 등)
    pushSettings: jsonb('push_settings').$type<PushSettings>(),
    // 기타 설정
    settings: jsonb('settings').$type<GeneralSettings>(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
    userIdx: uniqueIndex('idx_user_notification_settings').on(table.userId),
}));

// 알림 프로바이더 테이블
export const notificationProviders = pgTable('notification_providers', {
    providerId: uuid('provider_id').defaultRandom().primaryKey(),
    channel: channelEnum('channel').notNull(),
    providerName: varchar('provider_name', { length: 50 }).notNull(),
    config: jsonb('config').notNull(),
    status: providerStatusEnum('status').default('ACTIVE').notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    priority: integer('priority').default(0).notNull(),
    capabilities: jsonb('capabilities'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
    channelActiveIdx: index('idx_channel_active_priority').on(
        table.channel,
        table.isActive,
        table.priority
    ),
}));

// 이벤트 구독 테이블
export const notificationEvents = pgTable('notification_events', {
    eventId: uuid('event_id').defaultRandom().primaryKey(),
    eventKey: varchar('event_key', { length: 100 }).unique().notNull(),
    description: text('description').notNull(),
    templateKey: varchar('template_key', { length: 100 }).notNull(),
    category: notificationCategoryEnum('category').notNull(),
    defaultChannels: jsonb('default_channels').notNull().$type<Channel[]>(),
    priority: notificationPriorityEnum('priority').default('NORMAL').notNull(),
    conditions: jsonb('conditions'),
    isActive: boolean('is_active').default(true).notNull(),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
    eventKeyActiveIdx: index('idx_event_key_active').on(table.eventKey, table.isActive),
}));

// 발송 결과 수신 테이블
export const receipts = pgTable('receipts', {
    receiptId: uuid('receipt_id').defaultRandom().primaryKey(),
    notificationId: uuid('notification_id'),
    campaignId: uuid('campaign_id'),
    provider: varchar('provider', { length: 50 }).notNull(),
    status: varchar('status', { length: 50 }).notNull(),
    providerResponse: jsonb('provider_response'),
    latencyMs: integer('latency_ms'),
    metadata: jsonb('metadata'),
    timestamp: timestamp('timestamp').defaultNow().notNull(),
}, (table) => ({
    notificationIdx: index('idx_receipt_notification').on(table.notificationId),
    campaignIdx: index('idx_receipt_campaign').on(table.campaignId),
    timestampIdx: index('idx_receipt_timestamp').on(table.timestamp),
}));

// 알림 로그 테이블
export const notificationLogs = pgTable('notification_logs', {
    logId: uuid('log_id').defaultRandom().primaryKey(),
    notificationId: uuid('notification_id'),
    campaignId: uuid('campaign_id'),
    userId: varchar('user_id', { length: 100 }),
    eventKey: varchar('event_key', { length: 100 }),
    channel: channelEnum('channel').notNull(),
    provider: varchar('provider', { length: 50 }).notNull(),
    status: notificationStatusEnum('status').notNull(),
    request: jsonb('request').notNull(),
    response: jsonb('response'),
    latencyMs: integer('latency_ms'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
    userCreatedIdx: index('idx_log_user_created').on(table.userId, table.createdAt),
    eventCreatedIdx: index('idx_log_event_created').on(table.eventKey, table.createdAt),
    campaignIdx: index('idx_log_campaign').on(table.campaignId),
    createdIdx: index('idx_log_created').on(table.createdAt),
}));

// 운영 알림 테이블
export const alerts = pgTable('alerts', {
    alertId: uuid('alert_id').defaultRandom().primaryKey(),
    type: varchar('type', { length: 50 }).notNull(),
    severity: varchar('severity', { length: 20 }).notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    message: text('message').notNull(),
    context: jsonb('context').notNull(),
    isResolved: boolean('is_resolved').default(false).notNull(),
    resolvedAt: timestamp('resolved_at'),
    resolvedBy: varchar('resolved_by', { length: 100 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
    unresolvedIdx: index('idx_alert_unresolved').on(table.isResolved, table.createdAt),
}));

// Types
export type Channel = 'EMAIL' | 'SMS' | 'KAKAO' | 'PUSH';
export type Language = 'ko' | 'en';
export type NotificationCategory = 'TRANSACTIONAL' | 'MARKETING' | 'SYSTEM' | 'ADMIN' | 'OPERATIONAL' | 'CUSTOMER_SERVICE';
export type NotificationPriority = 'URGENT' | 'HIGH' | 'NORMAL' | 'LOW';
export type DevicePlatform = 'ios' | 'android' | 'web';

// Interfaces
export interface DeviceInfo {
    platform?: DevicePlatform;
    deviceId?: string;
    deviceModel?: string;
    osVersion?: string;
    appVersion?: string;
    lastActiveAt?: Date;
}

export interface PushSettings {
    sound?: boolean;
    vibration?: boolean;
    showPreview?: boolean;
    quietHours?: {
        enabled: boolean;
        startTime?: string;
        endTime?: string;
    };
}

export interface GeneralSettings {
    timezone?: string;
    locale?: string;
    [key: string]: any;
}

export interface ChannelContent {
    ko?: {
        subject?: string;
        body: string;
        metadata?: Record<string, any>;
    };
    en?: {
        subject?: string;
        body: string;
        metadata?: Record<string, any>;
    };
}

export interface TemplateContents {
    EMAIL?: ChannelContent;
    SMS?: ChannelContent;
    KAKAO?: ChannelContent;
    PUSH?: ChannelContent;
}

export interface VariableSchema {
    [key: string]: {
        type: 'string' | 'number' | 'boolean' | 'object' | 'array';
        required?: boolean;
        description?: string;
    }
}

export interface RenderedContent {
    subject?: string;
    body: string;
    metadata?: Record<string, any>;
}

export interface ErrorDetails {
    message: string;
    stack?: string;
    timestamp: Date;
}

export interface CampaignContent {
    EMAIL?: {
        subject?: string;
        body: string;
        metadata?: Record<string, any>;
    };
    SMS?: {
        subject?: string;
        body: string;
        metadata?: Record<string, any>;
    };
    KAKAO?: {
        subject?: string;
        body: string;
        metadata?: Record<string, any>;
    };
    PUSH?: {
        subject?: string;
        body: string;
        metadata?: Record<string, any>;
    };
}

export interface CampaignStats {
    sent: number;
    delivered: number;
    failed: number;
    opened: number;
    clicked: number;
    [key: string]: number;
}

// Export tables
export const notificationTables = {
    templates,
    notifications,
    notificationCampaigns,
    campaignTargetGroups,
    campaignRecipients,
    userProfiles,
    userNotificationSettings,
    notificationProviders,
    notificationEvents,
    receipts,
    notificationLogs,
    alerts,
    fcmTokens,
    fcmTopicSubscriptions,
};

// Export types
export type Template = typeof templates.$inferSelect;
export type NewTemplate = typeof templates.$inferInsert;
export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
export type NotificationCampaign = typeof notificationCampaigns.$inferSelect;
export type NewNotificationCampaign = typeof notificationCampaigns.$inferInsert;
export type CampaignTargetGroup = typeof campaignTargetGroups.$inferSelect;
export type NewCampaignTargetGroup = typeof campaignTargetGroups.$inferInsert;
export type CampaignRecipient = typeof campaignRecipients.$inferSelect;
export type NewCampaignRecipient = typeof campaignRecipients.$inferInsert;
export type UserProfile = typeof userProfiles.$inferSelect;
export type NewUserProfile = typeof userProfiles.$inferInsert;
export type UserNotificationSetting = typeof userNotificationSettings.$inferSelect;
export type NewUserNotificationSetting = typeof userNotificationSettings.$inferInsert;
export type NotificationProvider = typeof notificationProviders.$inferSelect;
export type NewNotificationProvider = typeof notificationProviders.$inferInsert;
export type NotificationEvent = typeof notificationEvents.$inferSelect;
export type NewNotificationEvent = typeof notificationEvents.$inferInsert;
export type Receipt = typeof receipts.$inferSelect;
export type NewReceipt = typeof receipts.$inferInsert;
export type NotificationLog = typeof notificationLogs.$inferSelect;
export type NewNotificationLog = typeof notificationLogs.$inferInsert;
export type Alert = typeof alerts.$inferSelect;
export type NewAlert = typeof alerts.$inferInsert;
export type FcmToken = typeof fcmTokens.$inferSelect;
export type NewFcmToken = typeof fcmTokens.$inferInsert;
export type FcmTopicSubscription = typeof fcmTopicSubscriptions.$inferSelect;
export type NewFcmTopicSubscription = typeof fcmTopicSubscriptions.$inferInsert;
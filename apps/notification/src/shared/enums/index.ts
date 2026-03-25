// apps/notification/src/shared/enums/index.ts
export enum Channel {
  EMAIL = 'EMAIL',
  SMS = 'SMS',
  KAKAO = 'KAKAO',
  PUSH = 'PUSH',
}

export enum Language {
  KO = 'ko',
  EN = 'en',
}

export enum NotificationStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  SENT = 'SENT',
  DELIVERED = 'DELIVERED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  RETRYING = 'RETRYING',
}

export enum MembershipType {
  GENERAL = 'general',
  PREMIUM = 'premium',
}

export enum NotificationCategory {
  TRANSACTIONAL = 'TRANSACTIONAL',
  MARKETING = 'MARKETING',
  SYSTEM = 'SYSTEM',
  ADMIN = 'ADMIN',
  OPERATIONAL = 'OPERATIONAL',
  CUSTOMER_SERVICE = 'CUSTOMER_SERVICE',
}

export enum NotificationPriority {
  URGENT = 'URGENT',
  HIGH = 'HIGH',
  NORMAL = 'NORMAL',
  LOW = 'LOW',
}

export enum CampaignStatus {
  DRAFT = 'DRAFT',
  SCHEDULED = 'SCHEDULED',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum ProviderStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  ERROR = 'ERROR',
}

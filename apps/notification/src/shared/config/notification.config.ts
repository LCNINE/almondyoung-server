// apps/notification/src/shared/config/notification.config.ts
export const notificationConfig = {
    providers: {
        email: {
            sendgrid: {
                apiKey: process.env.SENDGRID_API_KEY,
                fromEmail: process.env.SENDGRID_FROM_EMAIL,
                fromName: process.env.SENDGRID_FROM_NAME || 'Notification Service',
            },
        },
        sms: {
            twilio: {
                accountSid: process.env.TWILIO_ACCOUNT_SID,
                authToken: process.env.TWILIO_AUTH_TOKEN,
                fromNumber: process.env.TWILIO_FROM_NUMBER,
            },
        },
        kakao: {
            alimtalk: {
                apiKey: process.env.KAKAO_API_KEY,
                senderKey: process.env.KAKAO_SENDER_KEY,
                plusFriendId: process.env.KAKAO_PLUS_FRIEND_ID,
            },
        },
        push: {
            fcm: {
                serviceAccount: process.env.FIREBASE_SERVICE_ACCOUNT,
            },
        },
    },
    queue: {
        redis: {
            host: process.env.REDIS_HOST ?? 'localhost',
            port: process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT, 10) : 6379,
        },
    },
    retry: {
        maxAttempts: 3,
        delays: [60000, 300000, 900000], // 1min, 5min, 15min
    },
    batch: {
        size: 1000,
        concurrency: 10,
    },
};
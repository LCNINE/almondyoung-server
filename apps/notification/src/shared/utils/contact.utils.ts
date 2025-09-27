// apps/notification/src/shared/utils/contact.utils.ts
import { Channel } from '../enums';
import { UserProfile } from '../../../database/schemas/notification-schema';

export const getContactForChannel = (
    userProfile: UserProfile,
    channel: Channel
): string | null => {
    switch (channel) {
        case Channel.EMAIL:
            return userProfile.email;
        case Channel.SMS:
        case Channel.KAKAO:
            return userProfile.phoneNumber;
        case Channel.PUSH:
            return userProfile.pushToken;
        default:
            return null;
    }
};

export const validateContactForChannel = (
    contact: string,
    channel: Channel
): boolean => {
    switch (channel) {
        case Channel.EMAIL:
            return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact);
        case Channel.SMS:
        case Channel.KAKAO:
            return /^01[0-9]-?[0-9]{3,4}-?[0-9]{4}$/.test(contact);
        case Channel.PUSH:
            return contact.length > 0;
        default:
            return false;
    }
};
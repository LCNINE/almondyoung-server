// apps/notification/src/shared/utils/validation.utils.ts
export const validationUtils = {
    isValidEmail: (email: string): boolean => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    },

    isValidPhoneNumber: (phone: string): boolean => {
        // Korean phone number validation
        const phoneRegex = /^01[0-9]-?[0-9]{3,4}-?[0-9]{4}$/;
        return phoneRegex.test(phone);
    },

    isValidKakaoUserId: (userId: string): boolean => {
        // Kakao user ID is typically numeric
        return /^\d+$/.test(userId);
    },

    sanitizeHtml: (html: string): string => {
        // Basic HTML sanitization
        return html
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');
    },
};
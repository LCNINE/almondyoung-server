// apps/notification/src/shared/utils/template-helpers.ts
export const templateHelpers = {
    formatPhoneNumber: (phone: string): string => {
        // Format Korean phone number
        return phone.replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3');
    },

    truncate: (text: string, length: number): string => {
        if (text.length <= length) return text;
        return text.substring(0, length) + '...';
    },

    capitalize: (text: string): string => {
        return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
    },

    formatOrderNumber: (orderId: string): string => {
        return `ORD-${orderId.toUpperCase()}`;
    },
};
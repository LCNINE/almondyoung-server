/** 추적 링크를 누른 브라우저의 계정을 어느 순간에 알았는지. */
export const SMS_LINK_ATTRIBUTION_KINDS = ['clicked_signed_in', 'login', 'signup'] as const;
export type SmsLinkAttributionKind = (typeof SMS_LINK_ATTRIBUTION_KINDS)[number];

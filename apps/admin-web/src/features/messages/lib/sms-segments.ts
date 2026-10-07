const SINGLE_SMS_LENGTH = 70;
const MULTIPART_SMS_LENGTH = 67;
const TRACKED_LINK = 'https://almondyoung.com/r/xxxxxxxx';
const URL_PATTERN = /https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/g;

export const CARRIER_DAILY_SMS = 150;

export function smsSegments(body: string, trackedLinks = false): { length: number; segments: number } {
  const { length } = trackedLinks ? body.replace(URL_PATTERN, TRACKED_LINK) : body;
  return { length, segments: length <= SINGLE_SMS_LENGTH ? 1 : Math.ceil(length / MULTIPART_SMS_LENGTH) };
}

export function overSingleSms(length: number): number {
  return Math.max(0, length - SINGLE_SMS_LENGTH);
}

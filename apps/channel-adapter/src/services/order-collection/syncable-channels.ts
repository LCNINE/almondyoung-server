/** 즉시 끌어오기(`syncOrder`)를 지원하는 채널. HTTP 입구와 명령 소비자가 같이 쓴다(#1016 5·6번 행). */
export const SYNCABLE_CHANNELS = ['medusa', 'naver'] as const;
export type SyncableChannel = (typeof SYNCABLE_CHANNELS)[number];

export function isSyncableChannel(value: string): value is SyncableChannel {
  return SYNCABLE_CHANNELS.some((channel) => channel === value);
}

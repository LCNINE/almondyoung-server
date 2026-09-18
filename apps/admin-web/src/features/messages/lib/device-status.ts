const timeFormat = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
const dateTimeFormat = new Intl.DateTimeFormat('ko-KR', {
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function formatDisconnectedSince(lastSeen: string | null, now: Date): string {
  if (!lastSeen) return '연결 기록 없음';
  const lastConnectedAt = new Date(lastSeen);
  const sameDay = lastConnectedAt.toDateString() === now.toDateString();
  return `${(sameDay ? timeFormat : dateTimeFormat).format(lastConnectedAt)} 이후 연결 없음`;
}

const KST_DATE = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' });
const KST_DATE_TIME = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

export const formatKstDate = (iso: string | null | undefined): string => (iso ? KST_DATE.format(new Date(iso)) : '-');
export const formatKstDateTime = (iso: string | null | undefined): string =>
  iso ? KST_DATE_TIME.format(new Date(iso)) : '-';
export const formatWon = (n: number): string => `${n.toLocaleString('ko-KR')}원`;

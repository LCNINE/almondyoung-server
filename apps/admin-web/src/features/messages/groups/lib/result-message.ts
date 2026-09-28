import type { SmsGroupRecipientsResult } from '@/lib/api/domains/sms-gate';

export const resultMessage = (result: SmsGroupRecipientsResult) =>
  [
    `${result.added.toLocaleString()}명을 넣었습니다.`,
    result.duplicated > 0 &&
      `이미 있던 번호 ${result.duplicated.toLocaleString()}개`,
    result.skipped > 0 &&
      `휴대폰이 아니거나 겹친 번호 ${result.skipped.toLocaleString()}개는 뺐습니다`,
  ]
    .filter(Boolean)
    .join(' ');

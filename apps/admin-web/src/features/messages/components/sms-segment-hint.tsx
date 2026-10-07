import { NAME_VARIABLE } from '../lib/sms-body';
import { CARRIER_DAILY_SMS, overSingleSms, smsSegments } from '../lib/sms-segments';

export function SmsSegmentHint({ body, trackedLinks = false }: { body: string; trackedLinks?: boolean }) {
  const { length, segments } = smsSegments(body, trackedLinks);
  const nameNote = body.includes(NAME_VARIABLE) && (
    <span className="block font-normal text-neutral-500">
      {NAME_VARIABLE} 은 받는 사람 이름으로 바뀌어 이름 길이만큼 늘어날 수 있어요. 대량 발송은 발송 확인에서 정확한 통 수를
      보여드려요.
    </span>
  );
  if (segments === 1) {
    return (
      <span>
        {length}자 · 1통{nameNote}
      </span>
    );
  }
  return (
    <span className="font-medium text-neutral-900">
      <span className="text-destructive">
        {length}자 · {segments}통
      </span>
      으로 나뉘어 발송됩니다. {overSingleSms(length)}자 줄이면 1통입니다. 통신사는 폰 1대 하루{' '}
      {CARRIER_DAILY_SMS}통을 넘으면 안내를 보내고 반복되면 요금을 매기니, 이 문구는 폰 1대 하루{' '}
      {Math.floor(CARRIER_DAILY_SMS / segments)}건까지가 안전합니다.
      {nameNote}
    </span>
  );
}

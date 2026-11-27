'use client';

import { CircleAlert } from 'lucide-react';
import { useWaybillSenderPreview } from '@/lib/services/orders';
import {
  SENDER_UNKNOWN_TEXT,
  senderGroupsOf,
  reissueSenderText,
  senderLineOf,
} from './sender-preview-model';

/** 상자 상세 운송장 칸 — 이 상자 송장에 찍힐 보내는 분 */
export function SenderPreviewLine({ shipmentId }: { shipmentId: string }) {
  const query = useWaybillSenderPreview([shipmentId]);

  if (query.isPending) {
    return (
      <p className="text-xs text-muted-foreground">
        보내는 분을 확인하고 있어요…
      </p>
    );
  }

  const preview = query.isError ? undefined : query.data?.[0];
  const line = senderLineOf(preview);
  const reissue = reissueSenderText(preview);

  return (
    <div className="space-y-0.5">
      <p className="flex flex-wrap items-center gap-x-1.5 text-sm">
        <span className="text-muted-foreground">보내는 분</span>
        {line.unknown ? (
          <span className="flex items-center gap-1 font-medium text-amber-700">
            <CircleAlert className="size-3.5" aria-hidden />
            {SENDER_UNKNOWN_TEXT}
          </span>
        ) : (
          <span className="font-medium">{line.name}</span>
        )}
        {line.note && (
          <span className="text-xs text-muted-foreground">({line.note})</span>
        )}
      </p>
      {reissue && <p className="text-xs text-amber-700">{reissue}</p>}
    </div>
  );
}

/** 출고 준비 확인창 — 고른 상자들이 어느 보내는 분으로 찍히는지 묶어 보인다 */
export function SenderPreviewSummary({
  shipmentIds,
}: {
  shipmentIds: readonly string[];
}) {
  const query = useWaybillSenderPreview(shipmentIds);

  if (query.isPending) {
    return (
      <p className="text-sm text-muted-foreground">
        송장 보내는 분을 확인하고 있어요…
      </p>
    );
  }

  const groups = senderGroupsOf(
    shipmentIds,
    query.isError ? undefined : query.data
  );

  return (
    <section aria-label="송장 보내는 분" className="space-y-1 text-sm">
      <p className="text-muted-foreground">송장 보내는 분</p>
      <ul className="space-y-0.5">
        {groups.map((group) => (
          <li key={group.key} className="flex flex-wrap items-center gap-x-1.5">
            {group.unknown ? (
              <span className="flex items-center gap-1 font-medium text-amber-700">
                <CircleAlert className="size-3.5" aria-hidden />
                {SENDER_UNKNOWN_TEXT}
              </span>
            ) : (
              <span className="font-medium">{group.name}</span>
            )}
            <span>{group.count}상자</span>
            {group.note && (
              <span className="text-xs text-muted-foreground">
                ({group.note})
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

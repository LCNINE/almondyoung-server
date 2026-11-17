'use client';

import { useId } from 'react';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  OPERATION_REASONS,
  REQUEST_CHANNEL_OPTIONS,
  isCustomerRequestReason,
  type OperationReasonValue,
  type ReasonedOperationType,
} from './operation-reasons';

type Props = {
  type: ReasonedOperationType;
  value: OperationReasonValue;
  onChange: (next: OperationReasonValue) => void;
  /** 제출을 눌렀는데 비어 있는 칸에 안내를 보인다 */
  showErrors?: boolean;
};

export function OperationReasonFields({
  type,
  value,
  onChange,
  showErrors = false,
}: Props) {
  const uid = useId();
  const reasonLabelId = `${uid}-reason-label`;
  const channelLabelId = `${uid}-channel-label`;
  const otherId = `${uid}-other`;
  const noteId = `${uid}-note`;
  const reasonErrorId = `${uid}-reason-error`;
  const channelErrorId = `${uid}-channel-error`;
  const otherErrorId = `${uid}-other-error`;

  const needsChannel = isCustomerRequestReason(type, value.reasonCode);
  const isOther = value.reasonCode === 'other';
  const reasonMissing = showErrors && !value.reasonCode;
  const channelMissing = showErrors && needsChannel && !value.requestChannel;
  const otherMissing = showErrors && isOther && !value.otherText.trim();

  function selectReason(code: string) {
    const customer = isCustomerRequestReason(type, code);
    onChange({
      ...value,
      reasonCode: code,
      requestChannel: customer ? value.requestChannel : undefined,
    });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label id={reasonLabelId}>작업 사유 (필수)</Label>
        <div
          role="group"
          aria-labelledby={reasonLabelId}
          aria-describedby={reasonMissing ? reasonErrorId : undefined}
        >
          <RadioGroup
            aria-labelledby={reasonLabelId}
            aria-invalid={reasonMissing || undefined}
            aria-required
            value={value.reasonCode ?? ''}
            onValueChange={selectReason}
            className="gap-2"
          >
            {OPERATION_REASONS[type].map((option) => {
              const id = `${uid}-reason-${option.code}`;
              return (
                <div key={option.code} className="flex items-center gap-2">
                  <RadioGroupItem value={option.code} id={id} />
                  <Label htmlFor={id} className="font-normal">
                    {option.label}
                  </Label>
                </div>
              );
            })}
          </RadioGroup>
        </div>
        {reasonMissing && (
          <p
            id={reasonErrorId}
            role="alert"
            className="text-xs text-destructive"
          >
            작업 사유를 골라 주세요.
          </p>
        )}
      </div>

      {needsChannel && (
        <div className="space-y-1.5">
          <Label id={channelLabelId}>고객이 요청한 경로 (필수)</Label>
          <div
            role="group"
            aria-labelledby={channelLabelId}
            aria-describedby={channelMissing ? channelErrorId : undefined}
          >
            <RadioGroup
              aria-labelledby={channelLabelId}
              aria-invalid={channelMissing || undefined}
              aria-required
              value={value.requestChannel ?? ''}
              onValueChange={(code) =>
                onChange({ ...value, requestChannel: code })
              }
              className="gap-2"
            >
              {REQUEST_CHANNEL_OPTIONS.map((channel) => {
                const id = `${uid}-channel-${channel.code}`;
                return (
                  <div key={channel.code} className="flex items-center gap-2">
                    <RadioGroupItem value={channel.code} id={id} />
                    <Label htmlFor={id} className="font-normal">
                      {channel.label}
                    </Label>
                  </div>
                );
              })}
            </RadioGroup>
          </div>
          {channelMissing && (
            <p
              id={channelErrorId}
              role="alert"
              className="text-xs text-destructive"
            >
              고객이 요청한 경로를 골라 주세요.
            </p>
          )}
        </div>
      )}

      {isOther && (
        <div className="space-y-1.5">
          <Label htmlFor={otherId}>기타 사유 (필수)</Label>
          <Input
            id={otherId}
            value={value.otherText}
            onChange={(event) =>
              onChange({ ...value, otherText: event.target.value })
            }
            aria-required
            aria-invalid={otherMissing || undefined}
            aria-describedby={otherMissing ? otherErrorId : undefined}
          />
          {otherMissing && (
            <p
              id={otherErrorId}
              role="alert"
              className="text-xs text-destructive"
            >
              기타 사유를 적어 주세요.
            </p>
          )}
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor={noteId}>운영 메모 (선택)</Label>
        <Textarea
          id={noteId}
          value={value.note}
          onChange={(event) => onChange({ ...value, note: event.target.value })}
          rows={2}
        />
      </div>
    </div>
  );
}

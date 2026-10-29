'use client';

import { useState } from 'react';
import { Check, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { usePermissionCheck } from '@/hooks/use-permission';
import { cn } from '@/lib/utils/ui';
import {
  getServerDenyMessage,
  useCreateShipmentConsolidation,
} from '@/lib/services/orders';
import { useConsolidationOptions } from '@/lib/services/orders/queries';
import type {
  ConsolidationOption,
  ConsolidationOptionShipment,
  ShipmentConsolidationResponse,
} from '@/lib/types/dto/fulfillment';
import { buildConsolidationRequest, memoChoices } from './consolidation-model';
import {
  freshCommand,
  isStaleVersionConflict,
  keptAfterFailure,
  needsUnwindSteps,
  optionCard,
  orderNoText,
  progressLabel,
  recipientView,
  step2Blocker,
  togglePick,
  type OptionCard,
  type PendingCommand,
} from './consolidation-sheet-model';

type Step = 1 | 2;

const UNWIND_STEPS: Array<{ title: string; hint: string; who: string }> = [
  { title: '배치에서 빼기', hint: '요청한 뒤 이 화면에서 버튼으로', who: '나' },
  {
    title: '담아 둔 상품 되돌려 놓기',
    hint: '창고에 전할 문구를 화면이 알려 줘요',
    who: '창고',
  },
  { title: '기존 운송장 취소', hint: '이 화면에서 버튼으로', who: '나' },
  { title: '자동으로 합쳐짐', hint: '10분 안에. 누를 것 없음', who: '자동' },
];

const NOTE_TONE: Record<OptionCard['tone'], string> = {
  ok: 'text-green-700',
  memo: 'text-foreground',
  blocked: 'text-muted-foreground',
};

function createdAtText(value: string): string {
  return new Date(value).toLocaleString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function RecipientRows({
  shipment,
  addressMark = '',
  memoMark = '',
}: {
  shipment: ConsolidationOptionShipment;
  addressMark?: string;
  memoMark?: string;
}) {
  const view = recipientView(shipment.recipientSnapshot);

  return (
    <span className="grid grid-cols-[72px_1fr] gap-1 text-[13px] text-zinc-700 dark:text-zinc-300">
      <span className="text-muted-foreground">배송지</span>
      <span>
        {view.address} {addressMark}
      </span>
      <span className="text-muted-foreground">배송 메모</span>
      <span>
        {view.memo} {memoMark}
      </span>
    </span>
  );
}

function OptionCheckCard({
  option,
  card,
  checked,
  onToggle,
}: {
  option: ConsolidationOption;
  card: OptionCard;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-disabled={!card.pickable}
      aria-label={`주문 ${orderNoText(option)} 같이 보내기`}
      onClick={onToggle}
      className={cn(
        'block w-full rounded-lg p-4 text-left',
        checked && 'border-2 border-blue-700 bg-blue-50 dark:bg-blue-950/30',
        !checked && card.pickable && 'border bg-background',
        !card.pickable && 'cursor-not-allowed border bg-muted/40 opacity-70'
      )}
    >
      <span className="flex items-start gap-3">
        <span
          className={cn(
            'mt-[3px] inline-flex size-[18px] flex-none items-center justify-center rounded border',
            checked
              ? 'border-blue-700 bg-blue-700'
              : 'border-zinc-400 bg-background',
            !card.pickable && 'invisible'
          )}
        >
          {checked && <Check className="size-3 text-white" strokeWidth={3.5} />}
        </span>
        <span className="flex flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center justify-between gap-2">
            <b className="text-[15px]">주문 {orderNoText(option)}</b>
            <span className="text-xs text-muted-foreground">
              {createdAtText(option.createdAt)}
            </span>
          </span>
          <span className="text-sm text-zinc-700 dark:text-zinc-300">
            {option.itemSummary}
          </span>
          <RecipientRows
            shipment={option}
            addressMark={card.addressMark}
            memoMark={card.memoMark}
          />
          <span className={cn('text-[13px] font-medium', NOTE_TONE[card.tone])}>
            {card.note}
          </span>
        </span>
      </span>
    </button>
  );
}

export function ConsolidationSheet({
  shipmentId,
  open,
  onOpenChange,
  onRequested,
}: {
  shipmentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRequested?: (result: ShipmentConsolidationResponse) => void;
}) {
  const { can } = usePermissionCheck();
  const canOverrideRecipient = can(['fulfillment.shipment.override_recipient']);
  const options = useConsolidationOptions(shipmentId, open);
  const create = useCreateShipmentConsolidation();
  const [step, setStep] = useState<Step>(1);
  const [picked, setPicked] = useState<string[]>([]);
  const [memoChoice, setMemoChoice] = useState('');
  const [reason, setReason] = useState('');
  const [lostCommand, setLostCommand] = useState<PendingCommand | null>(null);

  const source = options.data?.source ?? null;
  const allOptions = options.data?.options ?? [];

  // 다시 읽은 뒤 고를 수 없게 된 주문은 고른 목록에서 빠진다.
  const pickedOptions = allOptions.filter(
    (option) =>
      picked.includes(option.shipmentId) &&
      optionCard(option, canOverrideRecipient).pickable
  );
  const choices = source ? memoChoices(source, pickedOptions) : [];
  const memoFrom =
    choices.length === 0
      ? (source?.shipmentId ?? '')
      : choices.some((choice) => choice.shipmentId === memoChoice)
        ? memoChoice
        : '';
  const blocker = step2Blocker({
    hasLostCommand: lostCommand !== null,
    pickedCount: pickedOptions.length,
    hasMemoChoices: choices.length > 0,
    memoFrom,
    reason,
  });
  const pickedNos = pickedOptions.map(orderNoText).join(', ');

  const reset = () => {
    setStep(1);
    setPicked([]);
    setMemoChoice('');
    setReason('');
  };

  const changeOpen = (next: boolean) => {
    if (!next) {
      reset();
    }

    onOpenChange(next);
  };

  const send = async (command: PendingCommand) => {
    try {
      const result = await create.mutateAsync(command);

      setLostCommand(null);

      if (result.operationStatus === 'completed') {
        toast.success('합포장했어요.');
      } else {
        toast.success(
          '합포장을 요청했어요. 상자 화면에서 다음 할 일을 알려 줘요.'
        );
      }

      onRequested?.(result);
      changeOpen(false);
    } catch (error) {
      setLostCommand(keptAfterFailure(command, error));

      if (isStaleVersionConflict(error)) {
        toast.info('그사이 상자가 바뀌었어요. 다시 불러올게요');
        setStep(1);
        await options.refetch();
        return;
      }

      toast.error(getServerDenyMessage(error, '합포장 요청에 실패했어요.'));
    }
  };

  const submit = async () => {
    if (!source || blocker || pickedOptions.length === 0) {
      return;
    }

    await send(
      freshCommand(
        buildConsolidationRequest({
          source,
          picked: pickedOptions,
          memoFrom,
          reason: reason.trim(),
        })
      )
    );
  };

  const retryLost = async () => {
    if (!lostCommand) {
      return;
    }

    await send(lostCommand);
  };

  const sourceNo = source ? orderNoText(source) : '';
  const sourceView = source ? recipientView(source.recipientSnapshot) : null;

  return (
    <Sheet open={open} onOpenChange={changeOpen}>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-[640px]">
        <SheetHeader className="gap-2.5 border-b px-6 py-4">
          <SheetTitle>합포장</SheetTitle>
          <SheetDescription className="flex items-center gap-2 text-[13px]">
            <span className={cn(step === 1 && 'font-semibold text-blue-700')}>
              1 합칠 주문 고르기
            </span>
            <span>›</span>
            <span className={cn(step === 2 && 'font-semibold text-blue-700')}>
              2 확인하고 요청
            </span>
          </SheetDescription>
        </SheetHeader>

        {lostCommand && (
          <Alert className="mx-6 mt-4 w-auto border-amber-300 bg-amber-50 dark:bg-amber-950/20">
            <RefreshCw />
            <AlertTitle>합포장 요청의 응답을 받지 못했어요</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
              <span>
                서버가 이미 처리했을 수 있어요. 처음 보낸 요청을 그대로 다시
                보내요.
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={retryLost}
                disabled={create.isPending}
              >
                같은 요청 다시 보내기
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {options.isLoading && (
          <p className="flex-1 px-6 py-8 text-center text-sm text-muted-foreground">
            같은 고객의 주문을 불러오고 있어요.
          </p>
        )}

        {options.isError && (
          <p className="flex-1 px-6 py-8 text-center text-sm text-destructive">
            {getServerDenyMessage(
              options.error,
              '같이 보낼 주문을 불러오지 못했어요.'
            )}
          </p>
        )}

        {source && sourceView && step === 1 && (
          <>
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
              <div className="flex flex-col gap-2">
                <span className="text-[13px] font-medium text-muted-foreground">
                  지금 보고 있는 주문
                </span>
                <div className="flex flex-col gap-1.5 rounded-lg bg-muted p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <b className="text-[15px]">
                      주문 {sourceNo}
                      {sourceView.name && ` · ${sourceView.name}`}
                    </b>
                    <Badge variant="outline" className="bg-background">
                      {progressLabel(source)}
                    </Badge>
                  </div>
                  <span className="text-sm text-zinc-700 dark:text-zinc-300">
                    {source.itemSummary}
                  </span>
                  <RecipientRows shipment={source} />
                </div>
              </div>

              <div>
                <div className="text-lg font-semibold">
                  이 주문과 같이 보낼 주문을 골라 주세요
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  같은 고객의 다른 주문이에요. 고른 주문은 위 주문과 한 상자,
                  송장 한 장으로 나가요. 배송지가 같은 주문만 고를 수 있어요.
                  배송 메모가 다르면 다음 단계에서 하나를 골라요.
                </p>
              </div>

              {allOptions.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  같은 고객의 다른 주문이 없어요.
                </p>
              )}

              {allOptions.map((option) => (
                <OptionCheckCard
                  key={option.shipmentId}
                  option={option}
                  card={optionCard(option, canOverrideRecipient)}
                  checked={pickedOptions.some(
                    (entry) => entry.shipmentId === option.shipmentId
                  )}
                  onToggle={() =>
                    setPicked(togglePick(picked, option, canOverrideRecipient))
                  }
                />
              ))}
            </div>

            <div className="flex items-center justify-between gap-2 border-t px-6 py-4">
              <span className="text-[13px] text-muted-foreground">
                {pickedOptions.length === 0
                  ? '같이 보낼 주문을 골라 주세요'
                  : `${pickedNos} 을 골랐어요`}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => changeOpen(false)}>
                  닫기
                </Button>
                <Button
                  onClick={() => setStep(2)}
                  disabled={pickedOptions.length === 0}
                >
                  다음
                </Button>
              </div>
            </div>
          </>
        )}

        {source && sourceView && step === 2 && (
          <>
            <div className="flex flex-1 flex-col gap-[18px] overflow-y-auto px-6 py-5">
              <div>
                <div className="text-lg font-semibold">
                  요청 전에 확인해 주세요
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  주문 {sourceNo}, {pickedNos} → 상자 1개, 송장 1장
                </p>
              </div>

              {needsUnwindSteps(source) && (
                <>
                  <p className="text-sm text-zinc-700 dark:text-zinc-300">
                    지금 보고 있는 주문 {sourceNo} 은 이미 출고 준비가 시작돼
                    바로 합쳐지지 않아요. 요청하면 이 순서로 진행돼요.
                  </p>
                  <ol className="divide-y rounded-lg border">
                    {UNWIND_STEPS.map((entry, index) => (
                      <li key={entry.title} className="flex gap-3 px-4 py-3">
                        <b className="w-5">{index + 1}</b>
                        <div className="flex-1">
                          <div className="font-medium">{entry.title}</div>
                          <div className="text-[13px] text-muted-foreground">
                            {entry.hint}
                          </div>
                        </div>
                        <Badge variant="secondary">{entry.who}</Badge>
                      </li>
                    ))}
                  </ol>
                </>
              )}

              {choices.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <Label id="consolidation-memo-label">
                    합친 상자에 붙일 배송 메모를 골라 주세요
                  </Label>
                  <p className="text-[13px] text-muted-foreground">
                    한 상자에는 메모를 하나만 붙일 수 있어요. 원래 주문들의
                    메모는 바뀌지 않고, 합친 상자에만 붙어요.
                  </p>
                  <RadioGroup
                    aria-labelledby="consolidation-memo-label"
                    value={memoFrom}
                    onValueChange={setMemoChoice}
                    className="gap-2"
                  >
                    {choices.map((choice) => (
                      <Label
                        key={choice.shipmentId}
                        className={cn(
                          'flex cursor-pointer items-start gap-3 rounded-lg px-3.5 py-3 font-normal',
                          memoFrom === choice.shipmentId
                            ? 'border-2 border-blue-700 bg-blue-50 dark:bg-blue-950/30'
                            : 'border'
                        )}
                      >
                        <RadioGroupItem
                          value={choice.shipmentId}
                          className="mt-0.5"
                        />
                        <span className="flex flex-col gap-0.5">
                          <span className="text-sm font-medium">
                            {choice.label}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {choice.shipmentId === source.shipmentId
                              ? `지금 보고 있는 주문 #${choice.orderNo} 의 메모`
                              : `주문 #${choice.orderNo} 의 메모`}
                          </span>
                        </span>
                      </Label>
                    ))}
                  </RadioGroup>
                </div>
              ) : (
                <p className="text-sm">
                  <span className="text-muted-foreground">
                    합친 상자의 배송 메모
                  </span>{' '}
                  · {sourceView.memo} (고른 주문 모두 같아요)
                </p>
              )}

              <div
                role="note"
                className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-zinc-700 dark:bg-amber-950/20 dark:text-zinc-300"
              >
                <b className="text-foreground">요청하면 취소할 수 없어요.</b>{' '}
                합쳐질 때까지 {sourceNo} 은 출고되지 않아요. 오늘 꼭 나가야 하는
                주문이면 합치지 말고 따로 보내는 게 나아요.
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="consolidation-reason">작업 사유</Label>
                <Textarea
                  id="consolidation-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="예: 고객이 CS로 추가 주문 합포장 요청"
                  className="min-h-16"
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 border-t px-6 py-4">
              <span className="text-[13px] text-muted-foreground">
                {blocker ?? '요청하면 상자 화면에서 다음 할 일을 알려 줘요'}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setStep(1)}>
                  이전
                </Button>
                <Button
                  onClick={submit}
                  disabled={blocker !== null || create.isPending}
                >
                  {create.isPending ? '요청 중...' : '합포장 요청'}
                </Button>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

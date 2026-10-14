'use client';

import { CalendarDays, Info, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { StockPolicyDto } from '@/lib/types/dto/matching';
import { toLocalDateString } from '@/lib/utils/date';

interface RestockPolicySectionProps {
  value: StockPolicyDto;
  onChange: (policy: StockPolicyDto) => void;
}

export function RestockPolicySection({
  value,
  onChange,
}: RestockPolicySectionProps) {
  const today = toLocalDateString(new Date());
  const manualDate = value.restockDate ?? null;
  const isPastDate = !!manualDate && manualDate < today;
  const usesManualDate = !!manualDate && !isPastDate;
  const formattedDate = usesManualDate
    ? new Date(`${manualDate}T00:00:00`).toLocaleDateString('ko-KR', {
        month: 'long',
        day: 'numeric',
      })
    : null;

  const useAutomaticSchedule = () => {
    onChange({ ...value, restockDate: null, restockApproximate: false });
  };

  return (
    <section
      aria-labelledby="restock-policy-title"
      className="overflow-hidden rounded-lg border"
    >
      <div className="flex items-center justify-between gap-3 border-b bg-muted/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <CalendarDays
            className="h-4 w-4 text-muted-foreground"
            aria-hidden="true"
          />
          <h3 id="restock-policy-title" className="text-sm font-semibold">
            재입고 예정일
          </h3>
        </div>
        <Badge
          variant="outline"
          className={
            usesManualDate ? 'border-blue-200 bg-blue-50 text-blue-700' : ''
          }
        >
          {usesManualDate ? '수동 일정 우선' : '도착 예정일 자동'}
        </Badge>
      </div>

      <div className="space-y-4 p-4">
        <p className="text-xs leading-5 text-muted-foreground">
          발주서에 입력한 도착 예정일을 자동으로 반영합니다. 발주가 없거나 별도
          안내가 필요하면 날짜를 직접 지정하세요.
        </p>

        <div className="space-y-2">
          <Label htmlFor="restockDate" className="text-xs font-medium">
            직접 지정할 날짜{' '}
            <span className="font-normal text-muted-foreground">(선택)</span>
          </Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="restockDate"
              type="date"
              min={today}
              value={manualDate ?? ''}
              aria-describedby="restock-date-help"
              className="h-9 w-44"
              onChange={(event) =>
                onChange({
                  ...value,
                  restockDate: event.target.value || null,
                  restockApproximate: event.target.value
                    ? (value.restockApproximate ?? false)
                    : false,
                })
              }
            />
            {manualDate && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 text-xs"
                onClick={useAutomaticSchedule}
              >
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                자동 적용으로 전환
              </Button>
            )}
          </div>
          <p id="restock-date-help" className="text-xs text-muted-foreground">
            직접 지정한 날짜가 우선합니다. 비우면 발주서의 도착 예정일을 자동
            적용합니다.
          </p>
          {isPastDate && (
            <p role="alert" className="text-xs text-destructive">
              지난 날짜는 고객에게 표시되지 않습니다. 유효한 발주 일정이 있으면
              대신 표시됩니다.
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="restockApproximate"
            checked={!!value.restockApproximate && !!manualDate}
            disabled={!usesManualDate}
            onCheckedChange={(checked) =>
              onChange({ ...value, restockApproximate: checked === true })
            }
          />
          <Label
            htmlFor="restockApproximate"
            className="cursor-pointer text-xs font-normal"
          >
            대략적인 일정으로 안내{' '}
            <span className="text-muted-foreground">(변동 가능)</span>
          </Label>
        </div>

        <div className="rounded-md bg-muted/40 px-3 py-2.5">
          <p className="mb-1 text-[11px] font-medium text-muted-foreground">
            고객 표시 · 품절 상태일 때
          </p>
          <p className="text-sm font-medium">
            {formattedDate
              ? `재입고 : ${formattedDate} 예정`
              : '발주서의 도착 예정일이 있으면 표시합니다'}
          </p>
          {usesManualDate && value.restockApproximate && (
            <p className="mt-1 text-xs text-muted-foreground">
              입고 일정은 변동될 수 있습니다.
            </p>
          )}
        </div>

        <div className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <p>
            저장하면 고객 화면에 자동 반영됩니다. 발주서의 도착 예정일 변경도
            자동 반영되며, 지난 일정과 입고완료·취소된 발주는 제외됩니다. 날짜를
            지정해도 판매가 열리지는 않습니다.
          </p>
        </div>
      </div>
    </section>
  );
}

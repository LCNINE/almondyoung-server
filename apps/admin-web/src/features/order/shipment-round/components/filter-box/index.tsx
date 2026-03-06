/** @format */

'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils/ui';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import {
  CalendarDays,
  Hash,
  Package,
  Search,
  ShoppingBag,
  Truck,
  User,
  X,
} from 'lucide-react';
import { useFormContext } from 'react-hook-form';
import {
  SearchType,
  ShipmentRoundFilter,
  shippingBatch,
} from '../../schema/shipment-round.schema';

// 빠른 날짜 선택 버튼 컴포넌트
function QuickDateButtons({
  onSelectRange,
}: {
  onSelectRange: (start: Date, end: Date) => void;
}) {
  const ranges = [
    { label: '오늘', days: 0 },
    { label: '어제', days: -1 },
    { label: '최근 7일', days: -7 },
    { label: '최근 30일', days: -30 },
    { label: '이번 달', days: 'month' as const },
  ];

  const handleClick = (range: (typeof ranges)[0]) => {
    const end = new Date();
    const start = new Date();

    if (range.days === 'month') {
      start.setDate(1);
    } else if (range.days === -1) {
      start.setDate(start.getDate() - 1);
      end.setDate(end.getDate() - 1);
    } else {
      start.setDate(start.getDate() + range.days);
    }

    onSelectRange(start, end);
  };

  return (
    <div className="flex gap-1">
      {ranges.map((range) => (
        <Button
          key={range.label}
          variant="ghost"
          size="sm"
          onClick={() => handleClick(range)}
          className="h-7 px-2 text-xs"
        >
          {range.label}
        </Button>
      ))}
    </div>
  );
}

// 검색 타입별 아이콘 매핑 - FilterContext에 맞게 수정
const searchTypeIcons = {
  운송장번호: <Truck className="h-4 w-4" />,
  주문번호: <Hash className="h-4 w-4" />,
  상품명: <ShoppingBag className="h-4 w-4" />,
};

export default function ShipmentRoundFilterBox() {
  const form = useFormContext<ShipmentRoundFilter>();

  // 활성 필터 개수 계산
  const activeFiltersCount = [
    form.watch('startDate'),
    form.watch('endDate'),
    form.watch('shippingBatch'),
    form.watch('pickingManager'),
    form.watch('receiverName'),
    form.watch('searchValue'),
  ].filter(Boolean).length;

  const handleDateRangeSelect = (start: Date, end: Date) => {
    form.setValue('startDate', start);
    form.setValue('endDate', end);
  };

  return (
    <Card className="border-slate-200 bg-gradient-to-b from-slate-50 to-white">
      <CardContent className="p-6">
        {/* 헤더 영역 */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-semibold">검색 필터</h3>
            {activeFiltersCount > 0 && (
              <Badge variant="secondary" className="gap-1">
                {activeFiltersCount}개 필터 적용됨
              </Badge>
            )}
          </div>
          {activeFiltersCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => form.reset()}
              className="gap-1 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
              초기화
            </Button>
          )}
        </div>

        <Separator className="mb-4" />

        <div className="space-y-4">
          {/* 조회기간 섹션 */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold">조회기간</Label>

            {/* 빠른 선택 버튼들 */}
            <QuickDateButtons onSelectRange={handleDateRangeSelect} />

            <div className="flex items-center gap-2">
              {/* 시작일 */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      'w-[180px] justify-start text-left font-normal',
                      !form.watch('startDate') && 'text-muted-foreground',
                      form.formState.errors.startDate && 'border-red-500'
                    )}
                  >
                    <CalendarDays className="mr-2 h-4 w-4" />
                    {form.watch('startDate')
                      ? format(form.watch('startDate') as Date, 'PPP', {
                          locale: ko,
                        })
                      : '시작일 선택'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 bg-white" align="start">
                  <Calendar
                    locale={ko}
                    mode="single"
                    selected={form.watch('startDate')}
                    onSelect={(date) =>
                      date && form.setValue('startDate', date)
                    }
                    modifiersStyles={{
                      selected: {
                        backgroundColor: '#3b82f6',
                        color: 'white',
                        borderRadius: '6px',
                        fontWeight: '600',
                      },
                      today: {
                        fontWeight: 'bold',
                        fontSize: '105%',
                        color: '#3b82f6',
                      },
                    }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>

              <span className="text-muted-foreground">~</span>

              {/* 종료일 */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      'w-[180px] justify-start text-left font-normal',
                      !form.watch('endDate') && 'text-muted-foreground'
                    )}
                  >
                    <CalendarDays className="mr-2 h-4 w-4" />
                    {form.watch('endDate')
                      ? format(form.watch('endDate') as Date, 'PPP', {
                          locale: ko,
                        })
                      : '종료일 선택'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 bg-white" align="start">
                  <Calendar
                    locale={ko}
                    mode="single"
                    selected={form.watch('endDate')}
                    onSelect={(date) => date && form.setValue('endDate', date)}
                    disabled={(date) =>
                      form.watch('startDate')
                        ? date < form.watch('startDate')!
                        : false
                    }
                    modifiersStyles={{
                      selected: {
                        backgroundColor: '#3b82f6',
                        color: 'white',
                        borderRadius: '6px',
                        fontWeight: '600',
                      },
                      disabled: {
                        color: '#9ca3af',
                        opacity: 0.5,
                        cursor: 'not-allowed',
                      },
                      today: {
                        fontWeight: 'bold',
                        fontSize: '105%',
                        color: '#3b82f6',
                      },
                    }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <Separator />

          {/* 나머지 필터들 */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* 회차 */}
            <div className="space-y-2">
              <Label
                htmlFor="shippingBatch"
                className="flex items-center gap-2"
              >
                <Package className="h-4 w-4 text-muted-foreground" />
                회차
              </Label>
              <Select
                value={form.watch('shippingBatch') || ''}
                onValueChange={(value: shippingBatch) =>
                  form.setValue('shippingBatch', value)
                }
              >
                <SelectTrigger id="shippingBatch">
                  <SelectValue placeholder="회차 선택" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={shippingBatch.BATCH1}>1회차</SelectItem>
                  <SelectItem value={shippingBatch.BATCH2}>2회차</SelectItem>
                  <SelectItem value={shippingBatch.BATCH3}>3회차</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* 피킹 담당자 */}
            <div className="space-y-2">
              <Label
                htmlFor="pickingManager"
                className="flex items-center gap-2"
              >
                <User className="h-4 w-4 text-muted-foreground" />
                피킹 담당자
              </Label>
              <Input
                id="pickingManager"
                type="text"
                value={form.watch('pickingManager') || ''}
                onChange={(e) =>
                  form.setValue('pickingManager', e.target.value)
                }
                placeholder="담당자 이름 입력"
              />
            </div>

            {/* 받는 분 이름 */}
            <div className="space-y-2">
              <Label htmlFor="receiverName" className="flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground" />
                받는 분
              </Label>
              <Input
                id="receiverName"
                type="text"
                value={form.watch('receiverName')}
                onChange={(e) => form.setValue('receiverName', e.target.value)}
                placeholder="수취인 이름 입력"
              />
            </div>

            {/* 조건검색 */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Search className="h-4 w-4 text-muted-foreground" />
                조건 검색
              </Label>
              <div className="flex gap-2">
                <Select
                  value={form.watch('searchType')}
                  onValueChange={(value: SearchType) =>
                    form.setValue('searchType', value)
                  }
                >
                  <SelectTrigger className="w-[140px]">
                    <div className="flex items-center gap-2">
                      <SelectValue placeholder="조건 선택" />
                    </div>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SearchType.COURIER_NUMBER}>
                      <div className="flex items-center gap-2">
                        <Truck className="h-4 w-4" />
                        운송장번호
                      </div>
                    </SelectItem>
                    <SelectItem value={SearchType.ORDER_NUMBER}>
                      <div className="flex items-center gap-2">
                        <Hash className="h-4 w-4" />
                        주문번호
                      </div>
                    </SelectItem>
                    <SelectItem value={SearchType.PRODUCT_NAME}>
                      <div className="flex items-center gap-2">
                        <ShoppingBag className="h-4 w-4" />
                        상품명
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>

                <div className="relative flex-1">
                  <Input
                    type="text"
                    value={form.watch('searchValue')}
                    onChange={(e) =>
                      form.setValue('searchValue', e.target.value)
                    }
                    disabled={!form.watch('searchType')}
                    placeholder={
                      !form.watch('searchType')
                        ? '조건을 먼저 선택해주세요'
                        : form.watch('searchType') === SearchType.COURIER_NUMBER
                        ? '운송장번호 입력'
                        : form.watch('searchType') === SearchType.ORDER_NUMBER
                        ? '주문번호 입력'
                        : '상품명 입력'
                    }
                    className={cn(
                      'pr-10',
                      form.formState.errors.searchValue && 'border-red-500'
                    )}
                  />
                  {form.watch('searchValue') && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => form.setValue('searchValue', '')}
                      className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** @format */
'use client';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils/ui';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { CalendarIcon, Search } from 'lucide-react';
import { useFormContext } from 'react-hook-form';
import {
  ConditionField,
  PeriodType,
  PrintInvoicesByOrderFilter,
  SearchType,
  SellerOnlineOrOffline,
  SellerType,
  ShippingBatch,
  ShippingMethod
} from '../../schemas/print-invoices-by-order-filter.schema';

const STATUS_OPTIONS = [
  { value: 'request', label: '출고요청' },
  { value: 'order', label: '출고지시' },
  { value: 'working', label: '출고작업' },
  { value: 'done', label: '출고완료' },
  { value: 'cancel', label: '출고취소' },
] as const;

export default function PrintInvoicesByOrderFilterBox() {
  const form = useFormContext<PrintInvoicesByOrderFilter>();

  return (
    <section>
      <Card>
        <CardContent className="space-y-4 flex flex-col gap-4 pt-6">
          {/* 1행 */}
          <div className="flex gap-4 items-start">
            {/* 판매처 분류 */}
            <div className="flex flex-col gap-2">
              <Label className="font-bold">판매처 분류</Label>
              <Select
                value={form.watch('sellerOnlineOrOffline') || ''}
                onValueChange={(value: SellerOnlineOrOffline) =>
                  form.setValue('sellerOnlineOrOffline', value)
                }
              >
                <SelectTrigger className="min-w-[168px]">
                  <SelectValue placeholder="선택" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SellerOnlineOrOffline.ALL}>
                    전체
                  </SelectItem>
                  <SelectItem value={SellerOnlineOrOffline.ONLINE}>
                    온라인
                  </SelectItem>
                  <SelectItem value={SellerOnlineOrOffline.OFFLINE}>
                    오프라인
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* 판매처 전체 */}
            <div className="flex flex-col gap-2">
              <Label className="font-bold">판매처 전체</Label>
              <Select
                value={form.watch('seller') || ''}
                onValueChange={(value: SellerType) =>
                  form.setValue('seller', value)
                }
              >
                <SelectTrigger className="min-w-[180px]">
                  <SelectValue placeholder="선택" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SellerType.ALL}>전체</SelectItem>
                  <SelectItem value={SellerType.NAVER}>네이버</SelectItem>
                  <SelectItem value={SellerType.CUPANG}>쿠팡</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* 조회기간 */}
            <div className="flex flex-col gap-2">
              <Label className="font-bold">조회기간</Label>
              <Select
                value={form.watch('periodType') || ''}
                onValueChange={(value: PeriodType) =>
                  form.setValue('periodType', value)
                }
              >
                <SelectTrigger className="min-w-[115px]">
                  <SelectValue placeholder="선택" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={PeriodType.REQUESTED_SHIPMENT_DATE}>
                    출고요청일
                  </SelectItem>
                  <SelectItem value={PeriodType.ORDER_DATE}>주문일</SelectItem>
                  <SelectItem value={PeriodType.DELIVERY_DATE}>
                    배송완료일
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* 시작 ~ 종료 날짜 */}
            <div className="flex flex-col gap-2">
              <Label className="font-bold invisible">날짜</Label>
              <div className="flex gap-2 items-center">
                {/* 시작 날짜 */}
                <Popover>
                  <PopoverTrigger asChild className="min-w-[160px]">
                    <Button
                      variant="outline"
                      className={cn(
                        'justify-start text-left font-normal flex-1',
                        !form.watch('startDate') && 'text-muted-foreground'
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {form.watch('startDate')
                        ? format(form.watch('startDate') as Date, 'PPP', {
                            locale: ko,
                          })
                        : '시작 날짜'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0 bg-white" align="start">
                    <Calendar
                      mode="single"
                      selected={form.watch('startDate')}
                      onSelect={(date) => form.setValue('startDate', date)}
                      locale={ko}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>

                <span className="text-muted-foreground">~</span>

                {/* 종료 날짜 */}
                <Popover>
                  <PopoverTrigger asChild className="min-w-[160px]">
                    <Button
                      variant="outline"
                      className={cn(
                        'justify-start text-left font-normal flex-1',
                        !form.watch('endDate') && 'text-muted-foreground'
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {form.watch('endDate')
                        ? format(form.watch('endDate') as Date, 'PPP', {
                            locale: ko,
                          })
                        : '종료 날짜'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0 bg-white" align="start">
                    <Calendar
                      mode="single"
                      selected={form.watch('endDate')}
                      onSelect={(date) => form.setValue('endDate', date)}
                      locale={ko}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {/* 출고방식 */}
            <div className="flex flex-col gap-2 ">
              <Label className="font-bold">출고방식</Label>
              <Select
                value={form.watch('shippingMethod') || ''}
                onValueChange={(value: ShippingMethod) =>
                  form.setValue('shippingMethod', value, {
                    shouldValidate: true,
                  })
                }
              >
                <SelectTrigger
                  className={cn(
                    'min-w-[130px]',
                    form.formState.errors.shippingMethod && 'border-red-500'
                  )}
                >
                  <SelectValue placeholder="선택" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ShippingMethod.PARCEL_DELIVERY}>
                    택배
                  </SelectItem>
                  <SelectItem value={ShippingMethod.QUICK_SERVICE}>
                    퀵
                  </SelectItem>
                  <SelectItem value={ShippingMethod.VISIT_PICKUP}>
                    방문수령
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* 출고회차 */}
            <div className="flex flex-col gap-2">
              <Label className="font-bold">출고회차</Label>
              <Select
                value={form.watch('shippingBatch') || ''}
                onValueChange={(value: ShippingBatch) =>
                  form.setValue('shippingBatch', value, {
                    shouldValidate: true,
                  })
                }
              >
                <SelectTrigger
                  className={cn(
                    'min-w-[130px]',
                    form.formState.errors.shippingBatch && 'border-red-500'
                  )}
                >
                  <SelectValue placeholder="선택" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ShippingBatch.BATCH1}>1회차</SelectItem>
                  <SelectItem value={ShippingBatch.BATCH2}>2회차</SelectItem>
                  <SelectItem value={ShippingBatch.BATCH3}>3회차</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* 2행 */}
          <div className="flex gap-4">
            {/* 조건검색 */}
            <div className="flex flex-col gap-2">
              <Label className="font-bold">조건검색</Label>
              <div className="flex gap-2">
                <Select
                  value={form.watch('conditionField') || ''}
                  onValueChange={(value: ConditionField) => {
                    form.setValue('conditionField', value);
                    form.clearErrors('conditionField');
                  }}
                >
                  <SelectTrigger
                    className={cn(
                      'min-w-[210px]',
                      form.formState.errors.conditionField && 'border-red-500'
                    )}
                  >
                    <SelectValue placeholder="조건 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ConditionField.ORDER_NUMBER}>
                      주문번호
                    </SelectItem>
                    <SelectItem value={ConditionField.PHONE_NUMBER}>
                      전화번호
                    </SelectItem>
                    <SelectItem value={ConditionField.ADDRESS}>주소</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  placeholder="검색어 입력"
                  className="max-w-[300px]"
                  value={form.watch('conditionValue')}
                  onChange={(e) =>
                    form.setValue('conditionValue', e.target.value)
                  }
                />
              </div>
            </div>

            {/* 받는분 이름 */}
            <div className="flex flex-col gap-2">
              <Label className="font-bold">받는분 이름</Label>
              <Input
                placeholder="이름"
                className="max-w-[180px]"
                value={form.watch('receiverName')}
                onChange={(e) => form.setValue('receiverName', e.target.value)}
              />
            </div>

            {/* 상품 수 */}
            <div className="flex gap-2 flex-col">
              <Label className="font-bold">상품 수</Label>
              <div className="flex items-center gap-2">
                <Input
                  placeholder="최소"
                  className={cn(
                    'max-w-20',
                    form.formState.errors.productCountMin && 'border-red-500'
                  )}
                  type="number"
                  value={form.watch('productCountMin') || ''}
                  onChange={(e) =>
                    form.setValue('productCountMin', Number(e.target.value), {
                      shouldValidate: true,
                    })
                  }
                />
                <span className="text-muted-foreground">~</span>
                <Input
                  placeholder="최대"
                  className={cn(
                    'max-w-20',
                    form.formState.errors.productCountMax && 'border-red-500'
                  )}
                  type="number"
                  value={form.watch('productCountMax') || ''}
                  onChange={(e) =>
                    form.setValue('productCountMax', Number(e.target.value), {
                      shouldValidate: true,
                    })
                  }
                />
              </div>
            </div>

            {/* 진행 상태 */}
            <div className="flex flex-col gap-2 justify-around">
              <Label className="font-bold">진행상태</Label>
              <div className="flex gap-4">
                {/* 전체 */}
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="all"
                    checked={
                      form.watch('progressStatus')
                        ? Object.values(form.watch('progressStatus')).every(
                            Boolean
                          )
                        : false
                    }
                    onCheckedChange={(v: boolean) => {
                      form.setValue(
                        'progressStatus',
                        {
                          request: v,
                          order: v,
                          working: v,
                          done: v,
                          cancel: v,
                        },
                        {
                          shouldValidate: true,
                        }
                      );
                    }}
                    className={`
              border-gray-400
              data-[state=checked]:bg-blue-600 
              data-[state=checked]:text-white
              ${
                form.watch('progressStatus') &&
                Object.values(form.watch('progressStatus')).some(Boolean)
                  ? 'data-[state=indeterminate]:bg-blue-300'
                  : ''
              }
            `}
                  />
                  <Label htmlFor="all">전체</Label>
                </div>

                {STATUS_OPTIONS.map((s) => (
                  <div key={s.value} className="flex items-center space-x-2">
                    <Checkbox
                      id={s.value}
                      checked={form.watch('progressStatus')?.[s.value] ?? false}
                      onCheckedChange={(v: boolean) =>
                        form.setValue(
                          'progressStatus',
                          {
                            ...(form.watch('progressStatus') || {}),
                            [s.value]: v,
                          },
                          {
                            shouldValidate: true,
                          }
                        )
                      }
                      className={cn(
                        'border-gray-400,data-[state=checked]:bg-blue-600,data-[state=checked]:text-white',
                        form.formState.errors.progressStatus && 'border-red-500'
                      )}
                    />
                    <Label htmlFor={s.value}>{s.label}</Label>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 3행 - 상품 지정 검색 */}
          <div className="flex flex-col gap-2 max-w-96">
            <div className="flex justify-between">
              <Label className="font-bold whitespace-nowrap">
                상품 지정 검색
              </Label>
              <RadioGroup
                value={form.watch('searchType') || SearchType.INCLUDE}
                onValueChange={(value: SearchType) =>
                  form.setValue('searchType', value)
                }
                className="flex gap-4"
              >
                <div className="flex items-center space-x-1">
                  <RadioGroupItem
                    value={SearchType.EXACT}
                    id="exact"
                    className="data-[state=checked]:bg-[#3B82F6] data-[state=checked]:text-white"
                  />
                  <Label htmlFor="exact" className="text-sm">
                    완전일치
                  </Label>
                </div>
                <div className="flex items-center space-x-1">
                  <RadioGroupItem
                    value={SearchType.INCLUDE}
                    id="include"
                    className="data-[state=checked]:bg-[#3B82F6] data-[state=checked]:text-white"
                  />
                  <Label htmlFor="include" className="text-sm">
                    포함
                  </Label>
                </div>
              </RadioGroup>
            </div>

            <div className="flex gap-2 justify-between">
              <div className="relative flex-1">
                <Input
                  type="text"
                  placeholder="검색어 입력"
                  value={form.watch('keyword')}
                  onChange={(e) => form.setValue('keyword', e.target.value)}
                  className="pr-8"
                />
                <Button
                  size="icon"
                  variant="ghost"
                  className="absolute right-0 top-0 h-full cursor-pointer hover:bg-gray-100"
                >
                  <Search className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

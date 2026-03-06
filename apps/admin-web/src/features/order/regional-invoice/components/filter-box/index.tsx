/** @format */
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
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
import { AddressSearchDialog } from '@/components/common/address-search-dialog';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils/cn';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { CalendarIcon, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { useFormContext } from 'react-hook-form';
import {
  FilterPeriod,
  RegionalInvoiceFilter,
} from '../../schema/regional-invoice-filter.schema';
import { regions } from '@/lib';

export function FilterBox() {
  const form = useFormContext<RegionalInvoiceFilter>();

  const [addressSearchOpen, setAddressSearchOpen] = useState(false);
  const [startDatePopoverOpen, setStartDatePopoverOpen] = useState(false);
  const [endDatePopoverOpen, setEndDatePopoverOpen] = useState(false);

  // Input refs for error focus
  const productCountMinRef = useRef<HTMLInputElement>(null);
  const productCountMaxRef = useRef<HTMLInputElement>(null);

  const sidoList = Object.keys(regions);
  const sigunguList = form?.watch('sido')
    ? regions[form?.watch('sido') as keyof typeof regions]
    : [];

  // 시/도가 변경되면 시/군/구 초기화
  const handleSidoChange = (value: string) => {
    form.setValue('sido', value);
    form.setValue('sigungu', ''); // 시/군/구 초기화
  };

  // 주소 선택
  const handleAddressSelect = (address: {
    zipcode: string;
    address: string;
  }) => {
    setAddressSearchOpen(false);
  };

  return (
    <>
      {/* 주소 검색 다이얼로그 */}
      <AddressSearchDialog
        open={addressSearchOpen}
        onOpenChange={setAddressSearchOpen}
        onSelect={handleAddressSelect}
        title="우편번호 찾기"
      />

      <div className="flex flex-wrap items-end gap-[21px] rounded-md border py-4 px-8 bg-[#F5F5F5]">
        {/* 시/도 */}
        <div className="flex flex-col">
          <label className="mb-1 text-sm font-bold">시/도</label>
          <Select value={form?.watch('sido')} onValueChange={handleSidoChange}>
            <SelectTrigger className="w-[218px] bg-white transition-all hover:bg-gray-100">
              <SelectValue placeholder="선택" />
            </SelectTrigger>
            <SelectContent>
              {sidoList.map((sido) => (
                <SelectItem
                  key={sido}
                  value={sido}
                  className="hover:bg-gray-100"
                >
                  {sido}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* 시/군/구 */}
        <div className="flex flex-col">
          <label className="mb-1 text-sm font-bold">시/군/구</label>
          <Select
            value={form?.watch('sigungu')}
            onValueChange={(value) => form.setValue('sigungu', value)}
            disabled={!form?.watch('sido')} // 시/도가 선택되지 않으면 비활성화
          >
            <SelectTrigger className="w-[218px] bg-white transition-all hover:bg-gray-100">
              <SelectValue
                placeholder={!form?.watch('sido') ? '시/도 먼저 선택' : '선택'}
              />
            </SelectTrigger>
            <SelectContent>
              {sigunguList.map((sigungu: any) => (
                <SelectItem
                  key={sigungu}
                  value={sigungu}
                  className="hover:bg-gray-100"
                >
                  {sigungu}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {/* 도로명 */}
        <div className="flex flex-col">
          <label className="mb-1 text-sm font-bold">도로명</label>
          <Button
            variant="outline"
            onClick={() => setAddressSearchOpen(true)}
            className="text-[#71717A] w-[218px]"
          >
            도로명 주소로 검색
          </Button>
        </div>

        {/* 조회기간 */}
        <div className="flex flex-col">
          <label className="mb-1 text-sm font-bold">조회기간</label>
          <div className="flex items-center gap-2">
            <Select
              value={form.watch('filterPeriod') ?? ''}
              onValueChange={(value: FilterPeriod) =>
                form.setValue('filterPeriod', value, {
                  shouldValidate: true,
                })
              }
            >
              <SelectTrigger
                className={cn(
                  form?.formState.errors.filterPeriod && 'border-red-500',
                  'w-[115px] bg-white transition-all hover:bg-gray-100'
                )}
              >
                <SelectValue placeholder="기준 선택" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  value={FilterPeriod.REQUESTED_SHIPMENT_DATE}
                  className="hover:bg-gray-100"
                >
                  출고요청일
                </SelectItem>
                <SelectItem
                  value={FilterPeriod.DESIRED_SHIPMENT_DATE}
                  className="hover:bg-gray-100"
                >
                  출고희망일
                </SelectItem>
              </SelectContent>
            </Select>

            {/* 시작일 */}
            <div className="relative">
              <Popover
                open={startDatePopoverOpen}
                onOpenChange={setStartDatePopoverOpen}
              >
                <PopoverTrigger asChild>
                  <div className="relative">
                    <Input
                      readOnly
                      value={
                        form?.watch('startDate')
                          ? format(
                              form.watch('startDate') ?? new Date(),
                              'yyyy-MM-dd',
                              { locale: ko }
                            )
                          : ''
                      }
                      placeholder="날짜 선택"
                      className={cn(
                        form?.formState.errors.startDate && 'border-red-500',
                        'w-[161px] pl-10 pr-8 bg-white transition-all hover:bg-gray-100 cursor-pointer'
                      )}
                    />
                    <CalendarIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                  </div>
                </PopoverTrigger>
                <PopoverContent className="bg-white">
                  <Calendar
                    locale={ko}
                    mode="single"
                    selected={form?.watch('startDate')}
                    onSelect={(date) => {
                      form.setValue('startDate', date);
                      setStartDatePopoverOpen(false);
                    }}
                  />
                </PopoverContent>
              </Popover>

              {form?.watch('startDate') && (
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-100 rounded z-10 cursor-pointer"
                  onClick={() =>
                    form.setValue('startDate', undefined, {
                      shouldValidate: true,
                    })
                  }
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            <span>~</span>

            {/* 종료일 */}
            <div className="relative">
              <Popover
                open={endDatePopoverOpen}
                onOpenChange={setEndDatePopoverOpen}
              >
                <PopoverTrigger asChild>
                  <div className="relative">
                    <Input
                      readOnly
                      value={
                        form?.watch('endDate')
                          ? format(
                              form.watch('endDate') ?? new Date(),
                              'yyyy-MM-dd',
                              { locale: ko }
                            )
                          : ''
                      }
                      placeholder="날짜 선택"
                      className="w-[161px] pl-10 pr-8 bg-white transition-all hover:bg-gray-100 cursor-pointer"
                    />
                    <CalendarIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                  </div>
                </PopoverTrigger>
                <PopoverContent className="bg-white">
                  <Calendar
                    locale={ko}
                    mode="single"
                    selected={form?.watch('endDate') ?? undefined}
                    onSelect={(date) => {
                      form.setValue('endDate', date);
                      setEndDatePopoverOpen(false);
                    }}
                  />
                </PopoverContent>
              </Popover>

              {form?.watch('endDate') && (
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-100 rounded z-10 cursor-pointer"
                  onClick={() =>
                    form.setValue('endDate', undefined, {
                      shouldValidate: true,
                    })
                  }
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* 상품 수 */}
        <div className="flex flex-col">
          <label className="mb-1 text-sm  font-bold">상품 수</label>
          <div className="flex items-center gap-2">
            <Input
              ref={productCountMinRef}
              type="number"
              placeholder="최소"
              className={cn(
                form?.formState.errors.productCountMin && 'border-red-500',
                'w-20 bg-white pl-2'
              )}
              value={form?.watch('productCountMin') ?? ''}
              onChange={(e) =>
                form.setValue('productCountMin', Number(e.target.value), {
                  shouldValidate: true,
                })
              }
            />
            <span>~</span>
            <Input
              ref={productCountMaxRef}
              type="number"
              placeholder="최대"
              className={cn(
                form?.formState.errors.productCountMax && 'border-red-500',
                'w-20 bg-white pl-2'
              )}
              value={form?.watch('productCountMax') ?? ''}
              onChange={(e) =>
                form.setValue('productCountMax', Number(e.target.value), {
                  shouldValidate: true,
                })
              }
            />
          </div>
        </div>
      </div>
    </>
  );
}

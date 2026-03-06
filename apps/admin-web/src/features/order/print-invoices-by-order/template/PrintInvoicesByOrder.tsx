/** @format */
'use client';

import SearchActions from '@/components/search-actions';
import { Form } from '@/components/ui/form';
import FormErrorMessage from '@/features/order/error-message';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import PrintInvoicesByOrderFilterBox from '../components/filter-box';
import PrintInvoicesByOrderTable from '../components/table/indext';
import {
  PrintInvoicesByOrderFilter,
  printInvoicesByOrderFilterSchema,
  SearchType,
  ShippingBatch,
} from '../schemas/print-invoices-by-order-filter.schema';
import { useEffect } from 'react';

// 주문별 송장 출력 템플릿
export default function PrintInvoicesByOrderTemplate({
  params,
}: {
  params?: {
    shippingBatch?: ShippingBatch;
    orderId?: string;
  };
}) {
  const form = useForm<PrintInvoicesByOrderFilter>({
    resolver: zodResolver(printInvoicesByOrderFilterSchema),
    defaultValues: {
      startDate: undefined,
      endDate: undefined,
      sellerOnlineOrOffline: undefined,
      seller: undefined,
      periodType: undefined,
      shippingMethod: undefined,
      shippingBatch: params?.shippingBatch,
      conditionField: undefined,
      conditionValue: '',
      receiverName: '',
      productCountMin: undefined,
      productCountMax: undefined,
      progressStatus: {
        request: true,
        order: true,
        working: true,
        done: true,
        cancel: true,
      },
      searchType: SearchType.INCLUDE,
      keyword: '',
    },
  });

  const handleSubmit = (data: PrintInvoicesByOrderFilter) => {
    console.log(data);
  };

  const handleResetFilters = () => {
    form.reset();
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="pb-4">
        <PrintInvoicesByOrderFilterBox />

        <div className="flex gap-2 items-center justify-center py-6 relative ">
          <SearchActions onReset={handleResetFilters} />

          <FormErrorMessage<PrintInvoicesByOrderFilter>
            errors={form.formState.errors}
            errorFields={[
              'shippingBatch',
              'shippingMethod',
              'conditionField',
              'productCountMin',
              'productCountMax',
              'progressStatus',
            ]}
            className="absolute bottom-0"
          />
        </div>

        <PrintInvoicesByOrderTable />
      </form>
    </Form>
  );
}

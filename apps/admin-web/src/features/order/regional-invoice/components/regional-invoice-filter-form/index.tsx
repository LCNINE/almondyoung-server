/** @format */
'use client';

import SearchActions from '@/components/search-actions';
import { Form } from '@/components/ui/form';
import FormErrorMessage from '@/features/order/error-message';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import {
  RegionalInvoiceFilter,
  regionalInvoiceFilterSchema,
} from '../../schema/regional-invoice-filter.schema';
import { FilterBox } from '../filter-box';

export default function RegionalInvoiceFilterForm() {
  const form = useForm<RegionalInvoiceFilter>({
    resolver: zodResolver(regionalInvoiceFilterSchema),
    defaultValues: {
      sido: '',
      sigungu: '',
      filterPeriod: undefined,
      startDate: undefined,
      endDate: undefined,
      productCountMin: undefined,
      productCountMax: undefined,
    },
  });

  const handleSubmit = (data: RegionalInvoiceFilter) => {
    console.log(data);
  };

  const handleResetFilters = () => {
    form.reset();
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)}>
        <FilterBox />

        <div className="flex gap-2 items-center justify-center py-6 relative ">
          <SearchActions onReset={handleResetFilters} />

          <FormErrorMessage<RegionalInvoiceFilter>
            errors={form.formState.errors}
            errorFields={[
              'filterPeriod',
              'startDate',
              'productCountMin',
              'productCountMax',
            ]}
            className="absolute bottom-0"
          />
        </div>
      </form>
    </Form>
  );
}

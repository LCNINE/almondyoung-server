/** @format */
'use client';

import { Spinner } from '@/components/ui/spinner';
import { Suspense } from 'react';
import RegionalInvoiceFilterForm from '../components/regional-invoice-filter-form';
import OrderHistoryTable from '../components/regional-invoice-table';

export default function RegionalInvoiceTemplate() {
  return (
    <div>
      <RegionalInvoiceFilterForm />

      <Suspense
        fallback={
          <div className="flex items-center justify-center h-screen gap-2">
            <Spinner size="lg" className="w-10 h-10" />
          </div>
        }
      >
        <OrderHistoryTable />
      </Suspense>
    </div>
  );
}

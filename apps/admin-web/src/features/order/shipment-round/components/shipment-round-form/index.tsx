/** @format */

import SearchActions from '@/components/search-actions';
import { Form } from '@/components/ui/form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import {
  ShipmentRoundFilter,
  shipmentRoundFilterSchema,
} from '../../schema/shipment-round.schema';
import ShipmentRoundFilterBox from '../filter-box';
import FormErrorMessage from '@/features/order/error-message';

export default function ShipmentRoundForm() {
  const form = useForm<ShipmentRoundFilter>({
    resolver: zodResolver(shipmentRoundFilterSchema),
    defaultValues: {
      startDate: undefined,
      endDate: undefined,
      shippingBatch: undefined,
      pickingManager: undefined,
      receiverName: undefined,
      searchType: undefined,
      searchValue: undefined,
    },
  });

  const handleSubmit = (data: ShipmentRoundFilter) => {
    console.log(data);
  };

  const handleResetFilters = () => {
    form.reset();
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)}>
        <ShipmentRoundFilterBox />

        <div className="flex gap-2 items-center justify-center py-6 relative">
          <SearchActions onReset={handleResetFilters} />

          <FormErrorMessage<ShipmentRoundFilter>
            errors={form.formState.errors}
            errorFields={['searchValue', 'startDate']}
            className="absolute bottom-0"
          />
        </div>
      </form>
    </Form>
  );
}

import RouteGuard from '@/components/layout/route-guard';
import ReservationsTemplate from '@/features/inventory/reservations/template';

export default function InventoryReservationsPage() {
  return (
    <RouteGuard screen="/inventory/reservations">
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <ReservationsTemplate />
      </div>
    </RouteGuard>
  );
}

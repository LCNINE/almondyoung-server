import { useEffect } from 'react';
import { Outlet, useNavigate, Link } from '@tanstack/react-router';
import { Warehouse as WarehouseIcon } from 'lucide-react';
import { useIsAuthenticated } from '../session-context';
import { useWarehouse } from '../warehouse-context';

export function AuthedLayout() {
  const authed = useIsAuthenticated();
  const navigate = useNavigate();
  const { warehouseName } = useWarehouse();
  // beforeLoad gates entry; this effect handles a live logout / refresh
  // failure while an authenticated screen is already mounted.
  useEffect(() => {
    if (!authed) navigate({ to: '/login' });
  }, [authed, navigate]);
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Link
          to="/settings"
          className="flex items-center gap-1.5 rounded-full border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 active:bg-gray-100"
        >
          <WarehouseIcon className="h-3.5 w-3.5 text-blue-600" aria-hidden />
          {warehouseName ?? '창고 미설정'}
        </Link>
      </div>
      <Outlet />
    </div>
  );
}

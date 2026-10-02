import { useEffect } from 'react';
import { Outlet, useNavigate, Link } from '@tanstack/react-router';
import { Warehouse as WarehouseIcon } from 'lucide-react';
import { useIsAuthenticated } from '../session-context';
import { useWarehouse } from '../warehouse-context';
import { isStationDevice } from '../station';
import { StationShell } from '../../station/StationShell';

export function AuthedLayout() {
  const authed = useIsAuthenticated();
  const navigate = useNavigate();
  const { warehouseName } = useWarehouse();
  // beforeLoad gates entry; this effect handles a live logout / refresh
  // failure while an authenticated screen is already mounted.
  useEffect(() => {
    if (!authed) navigate({ to: '/login' });
  }, [authed, navigate]);
  // 셸 선택은 여기 한 곳(스펙 §4). 스테이션은 탭 셸 안에 화면을 그리고, 핸드헬드는 지금 그대로다.
  if (isStationDevice()) return <StationShell />;
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

import { Outlet } from '@tanstack/react-router';
import { App } from '../App';
import { useIsAuthenticated } from '../session-context';
import { isStationDevice } from '../station';

export function RootLayout() {
  const authed = useIsAuthenticated();
  // 로그인한 스테이션은 셸이 창 전체를 쓴다 — 탭 바가 제목 줄을 대신한다(스펙 §5.1). 로그인 화면·핸드헬드는 그대로.
  if (authed && isStationDevice()) return <Outlet />;
  return (
    <App>
      <Outlet />
    </App>
  );
}

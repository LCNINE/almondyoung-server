import { Outlet } from '@tanstack/react-router';
import { App } from '../App';

export function RootLayout() {
  return (
    <App>
      <Outlet />
    </App>
  );
}

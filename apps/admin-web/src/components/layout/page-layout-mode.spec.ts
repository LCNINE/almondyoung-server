import { usesStandaloneLayout } from './page-layout-mode';

it.each([
  '/attendance',
  '/attendance/calendar',
  '/attendance/records',
  '/login',
  '/unauthorized',
  '/mobile/check-in',
  '/dialog/customer',
  '/customer-window/1',
  '/mall/marketing/time-sale',
])('renders %s without loading the PC shell', (pathname) => {
  expect(usesStandaloneLayout(pathname)).toBe(true);
});

it.each(['/', '/company/worksites', '/archive', '/attendance-settings'])(
  'keeps the admin shell for %s',
  (pathname) => {
    expect(usesStandaloneLayout(pathname)).toBe(false);
  }
);

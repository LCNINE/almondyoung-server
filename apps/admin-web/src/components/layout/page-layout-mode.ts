/** Routes that own their complete page chrome and do not need the PC shell. */
export function usesStandaloneLayout(pathname: string) {
  return (
    pathname === '/login' ||
    pathname === '/unauthorized' ||
    pathname === '/attendance' ||
    pathname.startsWith('/attendance/') ||
    pathname.startsWith('/mobile') ||
    pathname.startsWith('/dialog') ||
    pathname.startsWith('/customer-window') ||
    pathname.startsWith('/mall/marketing/time-sale')
  );
}

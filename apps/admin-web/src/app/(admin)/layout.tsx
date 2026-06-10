// Admin pages require authentication — always render dynamically.
// Without this, BYPASS_AUTH=true builds treat RouteGuard as a no-op and
// Next.js tries to statically prerender pages, causing useSearchParams errors.
export const dynamic = 'force-dynamic';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

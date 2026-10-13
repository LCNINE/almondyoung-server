import RouteGuard from '@/components/layout/route-guard';
import LogoContestEntryListTemplate from '@/features/logo-contest/template';

export default function LogoContestPage() {
  return (
    <RouteGuard screen="/logo-contest">
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <LogoContestEntryListTemplate />
      </div>
    </RouteGuard>
  );
}

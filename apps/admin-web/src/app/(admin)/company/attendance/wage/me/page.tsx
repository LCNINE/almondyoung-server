import RouteGuard from '@/components/layout/route-guard';
import { MyWage } from '@/features/attendance/wage/my-wage';

export default function Page() {
  return (
    <RouteGuard screen="/company/attendance/wage/me">
      <h1 className="mb-6 text-[28px] leading-10 font-bold tracking-tight text-slate-950">
        내 급여
      </h1>
      <MyWage />
    </RouteGuard>
  );
}

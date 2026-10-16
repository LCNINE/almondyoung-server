'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAttendance } from '../hooks/use-attendance';

export function AttendanceNavigation() {
  const pathname = usePathname();
  const { data } = useAttendance();
  const links = [
    ['현황', '/company/attendance'],
    ['공유 캘린더', '/company/attendance/calendar'],
    ['내 기록', '/company/attendance/records'],
    ['정정 / 예외', '/company/attendance/requests'],
    ['내 설정', '/company/attendance/settings'],
    ...(data?.isMaster
      ? [
          ['요청 검토', '/company/attendance/review'],
          ['근무지 설정', '/company/attendance/worksites'],
        ]
      : []),
  ];

  return (
    <nav
      aria-label="출결 메뉴"
      className="mb-6 flex gap-2 overflow-x-auto border-b pb-3"
    >
      {links.map(([label, href]) => (
        <Link
          key={href}
          href={href}
          className={`shrink-0 rounded-lg px-4 py-2 text-sm ${pathname === href ? 'bg-indigo-50 font-semibold text-indigo-600' : 'text-slate-500 hover:bg-slate-50'}`}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}

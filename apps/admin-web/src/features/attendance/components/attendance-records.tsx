'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { attendanceApi } from '@/lib/api/domains/attendance';
import { Skeleton } from '@/components/ui/skeleton';
import { ATTENDANCE_KEY, useAttendance } from '../hooks/use-attendance';
import { useAttendanceAccess } from '../hooks/use-attendance-access';
import { formatAttendanceTime } from '../lib/attendance-model';

export function AttendanceRecords({
  showHeading = true,
}: {
  showHeading?: boolean;
}) {
  const me = useAttendance();
  const { canReadStaff } = useAttendanceAccess();
  const [selectedUserId, setSelectedUserId] = useState('');
  const userId = canReadStaff ? selectedUserId || undefined : undefined;

  const people = useQuery({
    queryKey: [...ATTENDANCE_KEY, 'overview'],
    queryFn: attendanceApi.overview,
    enabled: canReadStaff,
  });
  const query = useQuery({
    queryKey: [...ATTENDANCE_KEY, 'records', userId ?? 'me'],
    queryFn: () => attendanceApi.records(userId),
    enabled: !!me.data,
  });

  if (me.isError) {
    return (
      <p role="alert">
        사용자 정보를 불러오지 못했어요.{' '}
        <button onClick={() => me.refetch()}>다시 시도</button>
      </p>
    );
  }

  return (
    <section className="min-w-0 space-y-6" aria-busy={query.isPending}>
      <div>
        {showHeading && (
          <h1 className="text-2xl font-bold">
            {userId ? '직원 출퇴근 기록' : '내 출퇴근 기록'}
          </h1>
        )}
        <p className="mt-2 text-sm text-slate-400">
          출근일을 기준으로 최근 90개 근무 기록을 보여줘요.
        </p>
      </div>
      {canReadStaff && (
        <div className="space-y-3" aria-busy={people.isPending}>
          <label className="block space-y-2 text-sm">
            기록을 볼 직원
            <select
              className="block min-h-11 w-full min-w-0 max-w-sm rounded-md border bg-white p-2 text-base sm:text-sm"
              value={selectedUserId}
              disabled={people.isPending}
              onChange={(event) => setSelectedUserId(event.target.value)}
            >
              <option value="">내 기록</option>
              {people.data?.people
                .filter((person) => person.userId !== me.data?.userId)
                .map((person) => (
                  <option key={person.userId} value={person.userId}>
                    {person.name}
                  </option>
                ))}
            </select>
          </label>
          {people.isPending && (
            <p role="status" className="sr-only">
              직원 목록을 불러오고 있어요.
            </p>
          )}
          {people.isError && (
            <p role="alert" className="text-sm text-red-600">
              직원 목록을 불러오지 못했어요.{' '}
              <button onClick={() => people.refetch()}>다시 시도</button>
            </p>
          )}
        </div>
      )}
      {query.isError ? (
        <p role="alert" className="text-sm text-red-600">
          기록을 불러오지 못했어요.{' '}
          <button onClick={() => query.refetch()}>다시 시도</button>
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-white">
          {query.isPending && (
            <p role="status" className="sr-only">
              기록을 불러오고 있어요.
            </p>
          )}
          <table className="w-full table-fixed text-left text-xs sm:text-sm">
            <thead className="bg-slate-50 text-xs text-slate-400">
              <tr>
                <th className="px-2 py-4 sm:px-4">근무일</th>
                <th className="px-2 py-4 sm:px-4">출근</th>
                <th className="px-2 py-4 sm:px-4">퇴근</th>
              </tr>
            </thead>
            <tbody>
              {query.isPending &&
                Array.from({ length: 5 }, (_, row) => (
                  <tr key={row} className="border-t" aria-hidden="true">
                    {Array.from({ length: 3 }, (_, column) => (
                      <td key={column} className="px-2 py-4 sm:px-4">
                        <Skeleton
                          className={`h-4 motion-reduce:animate-none sm:h-5 ${column === 0 ? 'w-20 max-w-full' : 'w-12 max-w-full'}`}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              {query.data?.map((session) => (
                <tr key={session.id} className="border-t">
                  <td className="px-2 py-4 sm:px-4">{session.workDate}</td>
                  <td className="px-2 py-4 sm:px-4">
                    {formatAttendanceTime(session.checkIn)}
                  </td>
                  <td className="px-2 py-4 sm:px-4">
                    {formatAttendanceTime(session.checkOut)}
                    {session.checkOut &&
                      new Date(
                        new Date(session.checkOut).getTime() + 9 * 3600000
                      )
                        .toISOString()
                        .slice(0, 10) !== session.workDate && (
                        <span className="mt-1 block text-[10px] text-slate-400 sm:mt-0 sm:ml-2 sm:inline sm:text-xs">
                          다음 날
                        </span>
                      )}
                  </td>
                </tr>
              ))}
              {query.isSuccess && !query.data.length && (
                <tr>
                  <td colSpan={3} className="p-10 text-center text-slate-400">
                    아직 기록이 없어요.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

'use client';

import { useQuery } from '@tanstack/react-query';
import { attendanceApi } from '@/lib/api/domains/attendance';
import { ATTENDANCE_KEY } from '../hooks/use-attendance';
import { formatAttendanceTime } from '../lib/attendance-model';

export function AttendanceRecords() {
  const query = useQuery({
    queryKey: [...ATTENDANCE_KEY, 'records'],
    queryFn: attendanceApi.records,
  });

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">내 출퇴근 기록</h1>
        <p className="mt-2 text-sm text-slate-400">
          출근일을 기준으로 최근 90개 근무 기록을 보여줘요.
        </p>
      </div>
      {query.isError ? (
        <p role="alert" className="text-sm text-red-600">
          기록을 불러오지 못했어요.{' '}
          <button onClick={() => query.refetch()}>다시 시도</button>
        </p>
      ) : query.isPending ? (
        <p>기록을 불러오고 있어요.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-400">
              <tr>
                <th className="p-4">근무일</th>
                <th className="p-4">출근</th>
                <th className="p-4">퇴근</th>
              </tr>
            </thead>
            <tbody>
              {query.data.map((session) => (
                <tr key={session.id} className="border-t">
                  <td className="p-4">{session.workDate}</td>
                  <td className="p-4">
                    {formatAttendanceTime(session.checkIn)}
                  </td>
                  <td className="p-4">
                    {formatAttendanceTime(session.checkOut)}
                    {session.checkOut &&
                      new Date(
                        new Date(session.checkOut).getTime() + 9 * 3600000
                      )
                        .toISOString()
                        .slice(0, 10) !== session.workDate && (
                        <span className="ml-2 text-xs text-slate-400">
                          다음 날
                        </span>
                      )}
                  </td>
                </tr>
              ))}
              {!query.data.length && (
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

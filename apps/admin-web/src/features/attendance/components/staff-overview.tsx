'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { attendanceApi } from '@/lib/api/domains/attendance';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LEAVE_LABELS, STATUS_LABELS } from '@packages/domain-types/attendance';
import { ATTENDANCE_KEY } from '../hooks/use-attendance';

export function StaffOverview() {
  const query = useQuery({
    queryKey: [...ATTENDANCE_KEY, 'overview'],
    queryFn: attendanceApi.overview,
    refetchInterval: 30000,
  });
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const people = query.data?.people ?? [];
  const visible = people.filter(
    (person) =>
      person.name.includes(search.trim()) &&
      (filter === 'all' ||
        (filter === 'leave' ? person.leave : person.status === filter))
  );
  const filters = [
    ['all', '전체'],
    ['working', '근무 중'],
    ['before', '출근 기록 없음'],
    ['done', '퇴근'],
    ['leave', '휴가·반차'],
  ];

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">직원 근무 현황</h1>
          <p className="mt-2 text-sm text-slate-400">
            출퇴근 기록과 오늘의 일정을 함께 확인해요.
          </p>
        </div>
        <Button
          variant="outline"
          className="min-h-11 sm:min-h-9"
          onClick={() => query.refetch()}
          disabled={query.isFetching}
        >
          새로고침
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ['근무 중', people.filter((p) => p.status === 'working').length],
          ['퇴근', people.filter((p) => p.status === 'done').length],
          ['종일 휴가', people.filter((p) => p.leave?.type === 'full').length],
          [
            '반차',
            people.filter((p) => p.leave && p.leave.type !== 'full').length,
          ],
        ].map(([label, count]) => (
          <div key={label} className="rounded-xl border bg-white p-5">
            <p className="text-xs text-slate-400">{label}</p>
            <p className="mt-3 text-3xl font-semibold">
              {query.isPending || query.isError ? '—' : count}
            </p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {filters.map(([value, label]) => (
          <Button
            key={value}
            variant={filter === value ? 'default' : 'outline'}
            size="sm"
            className="min-h-11 sm:min-h-8"
            onClick={() => setFilter(value)}
          >
            {label}
          </Button>
        ))}
      </div>
      <Input
        placeholder="직원 이름 검색"
        aria-label="직원 이름 검색"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        className="max-w-sm"
      />
      {query.isError ? (
        <p role="alert" className="text-sm text-red-600">
          현황을 불러오지 못했어요. 새로고침해 주세요.
        </p>
      ) : query.isPending ? (
        <p className="py-8 text-sm text-slate-400">현황을 불러오고 있어요.</p>
      ) : (
        <div className="divide-y rounded-xl border bg-white">
          {visible.map((person) => (
            <div
              key={person.userId}
              className="flex flex-wrap items-center justify-between gap-3 p-5"
            >
              <span className="min-w-0 break-words font-medium">
                {person.name}
              </span>
              <div className="flex flex-wrap gap-2">
                <Badge
                  variant="secondary"
                  className={
                    person.status === 'working'
                      ? 'bg-emerald-50 text-emerald-700'
                      : ''
                  }
                >
                  {STATUS_LABELS[person.status]}
                </Badge>
                {person.leave && (
                  <Badge variant="outline">
                    {LEAVE_LABELS[person.leave.type]}
                  </Badge>
                )}
              </div>
            </div>
          ))}
          {!visible.length && (
            <p className="p-8 text-center text-sm text-slate-400">
              해당하는 직원이 없어요.
            </p>
          )}
        </div>
      )}
      {query.data && (
        <p className="text-xs text-slate-400">
          마지막 갱신{' '}
          {new Date(query.data.updatedAt).toLocaleTimeString('ko-KR')} ·
          30초마다 갱신돼요.
        </p>
      )}
    </section>
  );
}

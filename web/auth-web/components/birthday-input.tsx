"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

const SELECT_CLASS =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive md:text-sm dark:bg-input/30";

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 100 }, (_, i) => CURRENT_YEAR - i);
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function daysInMonth(year: string, month: string) {
  if (!year || !month) return 31;
  // new Date(y, m, 0) → 해당 월의 마지막 날 (윤년 자동 반영)
  return new Date(Number(year), Number(month), 0).getDate();
}

type BirthdayInputProps = {
  id?: string;
  name: string;
  required?: boolean;
  defaultValue?: string;
};

export function BirthdayInput({
  id,
  name,
  required,
  defaultValue = "",
}: BirthdayInputProps) {
  const [y0, m0, d0] = defaultValue.split("-");
  const [year, setYear] = React.useState(y0 ?? "");
  const [month, setMonth] = React.useState(m0 ? String(Number(m0)) : "");
  const [day, setDay] = React.useState(d0 ? String(Number(d0)) : "");

  const dayCount = daysInMonth(year, month);
  const days = Array.from({ length: dayCount }, (_, i) => i + 1);

  // 월 변경 등으로 일수가 줄면 선택된 일을 보정
  React.useEffect(() => {
    if (day && Number(day) > dayCount) setDay(String(dayCount));
  }, [day, dayCount]);

  const composed =
    year && month && day ? `${year}-${pad(Number(month))}-${pad(Number(day))}` : "";

  return (
    <div className="grid grid-cols-3 gap-2">
      <input type="hidden" name={name} value={composed} required={required} />
      <select
        id={id}
        aria-label="출생 연도"
        className={cn(SELECT_CLASS)}
        value={year}
        required={required}
        onChange={(e) => setYear(e.target.value)}
      >
        <option value="" disabled>
          년
        </option>
        {YEARS.map((y) => (
          <option key={y} value={y}>
            {y}년
          </option>
        ))}
      </select>
      <select
        aria-label="출생 월"
        className={cn(SELECT_CLASS)}
        value={month}
        required={required}
        onChange={(e) => setMonth(e.target.value)}
      >
        <option value="" disabled>
          월
        </option>
        {MONTHS.map((m) => (
          <option key={m} value={m}>
            {m}월
          </option>
        ))}
      </select>
      <select
        aria-label="출생 일"
        className={cn(SELECT_CLASS)}
        value={day}
        required={required}
        onChange={(e) => setDay(e.target.value)}
      >
        <option value="" disabled>
          일
        </option>
        {days.map((d) => (
          <option key={d} value={d}>
            {d}일
          </option>
        ))}
      </select>
    </div>
  );
}

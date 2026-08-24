'use client';

import { useRef } from 'react';

interface Props {
  value: string;
  lengths: number[];
  onChange: (digits: string) => void;
  ariaLabel: string;
}

export function DigitGroupInput({ value, lengths, onChange, ariaLabel }: Props) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const parts: string[] = [];
  let offset = 0;
  for (const length of lengths) {
    parts.push(value.slice(offset, offset + length));
    offset += length;
  }

  function handlePartChange(index: number, raw: string) {
    const digits = raw.replace(/[^0-9]/g, '').slice(0, lengths[index]);
    const next = parts.map((part, i) => (i === index ? digits : part));
    onChange(next.join(''));

    if (digits.length === lengths[index] && index < lengths.length - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  }

  function handleKeyDown(index: number, event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Backspace' || parts[index] || index === 0) return;
    inputRefs.current[index - 1]?.focus();
  }

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="flex h-12 items-center rounded-md border border-gray-300 px-4 focus-within:border-gray-500"
    >
      {parts.map((part, index) => (
        <div key={index} className="flex min-w-0 flex-1 items-center">
          {index > 0 && <span className="shrink-0 px-3 text-gray-400">-</span>}
          <input
            ref={(el) => {
              inputRefs.current[index] = el;
            }}
            inputMode="numeric"
            autoComplete="off"
            value={part}
            maxLength={lengths[index]}
            onChange={(e) => handlePartChange(index, e.target.value)}
            onKeyDown={(e) => handleKeyDown(index, e)}
            aria-label={`${ariaLabel} ${index + 1}번째 자리`}
            className="w-full min-w-0 bg-transparent text-left text-[15px] tabular-nums outline-none placeholder:text-gray-300"
          />
        </div>
      ))}
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';

const TERMS = [
  { title: '서비스 이용약관', url: 'https://pages.tosspayments.com/terms/user' },
  {
    title: '개인(신용)정보 수집 및 이용 동의',
    url: 'https://pages.tosspayments.com/terms/v2/tables/291/records/1174337',
  },
  {
    title: '개인(신용)정보 제3자 제공 동의',
    url: 'https://pages.tosspayments.com/terms/v2/tables/291/records/1174339',
  },
];

export function TossAgreement({ onChange }: { onChange: (agreed: boolean) => void }) {
  useEffect(() => onChange(false), [onChange]);
  const [checked, setChecked] = useState([false, false, false]);
  const [open, setOpen] = useState(false);
  const update = (values: boolean[]) => {
    setChecked(values);
    onChange(values.every(Boolean));
  };
  return (
    <div className="text-sm">
      <div className="flex items-center gap-3">
        <Checkbox
          id="checkout-agree-all"
          checked={checked.every(Boolean)}
          onCheckedChange={(value) => update(checked.map(() => value === true))}
          className="size-5"
        />
        <label htmlFor="checkout-agree-all" className="flex-1 cursor-pointer py-3 font-medium">
          필수 약관 전체동의
        </label>
        <button
          type="button"
          aria-label="필수 약관 상세보기"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="flex size-10 items-center justify-center rounded-lg transition-colors duration-150 active:bg-muted"
        >
          <ChevronDown
            className={`size-5 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
          />
        </button>
      </div>
      <div
        className={`grid transition-[grid-template-rows,opacity] duration-200 motion-reduce:transition-none ${open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
        inert={!open}
        aria-hidden={!open}
      >
        <div className="overflow-hidden">
          {TERMS.map((term, index) => (
            <div key={term.url} className="flex min-h-11 items-center gap-3 pl-1 text-xs text-muted-foreground">
              <Checkbox
                id={`checkout-term-${index}`}
                checked={checked[index]}
                onCheckedChange={(value) =>
                  update(checked.map((current, i) => (i === index ? value === true : current)))
                }
              />
              <label htmlFor={`checkout-term-${index}`} className="flex-1 cursor-pointer">
                {term.title}
              </label>
              <a
                href={term.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${term.title} 원문 보기`}
                className="flex size-10 items-center justify-center"
              >
                <ChevronRight className="size-4" />
              </a>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

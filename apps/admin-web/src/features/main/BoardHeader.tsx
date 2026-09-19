import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { HelpPopover } from '@/features/main/HelpPopover';

export function BoardHeader({
  label,
  help,
  href,
  linkLabel,
}: {
  label: string;
  help: string[];
  href: string;
  linkLabel: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-1 text-[13px] text-[#757575]">
        {label}
        <HelpPopover label={label} items={help} />
      </span>
      <Link href={href} className="flex shrink-0 items-center gap-0.5 text-[13px] text-[#1779BA] hover:underline">
        {linkLabel} <ChevronRight className="h-3 w-3" />
      </Link>
    </div>
  );
}

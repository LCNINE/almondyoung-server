import { Link } from '@tanstack/react-router';
import { cn } from '../../core/design/cn';

const TABS = [
  { to: '/inbound/quick', label: '간편입고', value: 'quick' },
  { to: '/inbound/history', label: '입고내역', value: 'history' },
  { to: '/inbound', label: '발주 입고', value: 'orders' },
] as const;

export function InboundTabs({ active }: { active: (typeof TABS)[number]['value'] }) {
  return (
    <nav
      aria-label="입고 화면"
      className="flex gap-0.5 rounded-lg bg-[#ededee] p-1"
    >
      {TABS.map((tab) => (
        <Link
          key={tab.value}
          to={tab.to}
          aria-current={tab.value === active ? 'page' : undefined}
          className={cn(
            'rounded-[5px] px-3.5 py-[7px] text-[13px] whitespace-nowrap text-[#71717a]',
            tab.value === active &&
              'bg-white font-semibold text-[#27272a] shadow-[0_1px_3px_#0000000c]'
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

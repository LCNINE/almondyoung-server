import Link from 'next/link';
import { ShoppingCart, Coins, Search } from 'lucide-react';

const pages = [
  {
    href: '/dev/store',
    icon: ShoppingCart,
    title: '테스트 상점',
    description: '임의 금액으로 payment intent를 생성해 결제 플로우를 테스트합니다.',
  },
  {
    href: '/dev/points',
    icon: Coins,
    title: '포인트 관리',
    description: '포인트 적립(EARN) · 적립 취소(EARN_CANCEL) · 잔액 및 내역 조회',
  },
  {
    href: '/dev/intents',
    icon: Search,
    title: 'Intent 조회',
    description: 'Intent UUID로 charge, refund, state transition, point 등 연관 데이터를 한눈에 조회합니다.',
  },
];

export default function DevIndexPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">개발자 도구</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Wallet 결제 플로우를 단독으로 테스트할 수 있는 페이지 모음입니다.
        </p>
      </div>

      <ul className="space-y-3">
        {pages.map(({ href, icon: Icon, title, description }) => (
          <li key={href}>
            <Link
              href={href}
              className="flex items-start gap-4 rounded-lg border p-4 hover:bg-muted/50 transition-colors"
            >
              <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
              <div>
                <p className="font-medium text-sm">{title}</p>
                <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

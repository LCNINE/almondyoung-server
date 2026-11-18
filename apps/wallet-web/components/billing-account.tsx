import { UserRound } from 'lucide-react';

export interface BillingAccount {
  name: string | null;
  loginId: string | null;
  reselectHref: string;
}

export function maskLoginId(loginId: string): string {
  const visible = loginId.length > 4 ? 4 : Math.max(1, loginId.length - 2);

  return `${loginId.slice(0, visible)}****`;
}

export function billingAccountLabel({ name, loginId }: Pick<BillingAccount, 'name' | 'loginId'>): string {
  const masked = loginId ? maskLoginId(loginId) : null;
  if (name && masked) return `${name}(${masked})`;

  return name ?? masked ?? '알 수 없는 계정';
}

export function BillingAccountBanner({ account }: { account: BillingAccount }) {
  return (
    <div className="mx-5 mt-4 flex items-center gap-2.5 rounded-xl bg-muted px-3.5 py-3">
      <UserRound aria-hidden className="size-[18px] shrink-0 text-muted-foreground" />
      <p className="min-w-0 flex-1 break-keep text-[13px] leading-snug text-foreground/80">
        <span className="font-bold text-foreground">{billingAccountLabel(account)}</span> 계정으로 등록돼요
      </p>
      <a href={account.reselectHref} className="shrink-0 py-2 text-[12px] font-semibold text-foreground underline">
        내 계정이 아니에요
      </a>
    </div>
  );
}

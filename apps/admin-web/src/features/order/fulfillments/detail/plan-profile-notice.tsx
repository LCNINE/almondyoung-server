import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { splitLineName } from './shipment-split-model';
import { profileGroupName, type ProfileGroup } from './plan-profile';

const skuHref = (code: string) =>
  `/inventory/skus?code=${encodeURIComponent(code)}`;

/**
 * 담긴 상품의 배송 프로필이 하나로 맞지 않는 상자 — 어떤 프로필을 골라도 확정이 거절되므로
 * 고르기 대신 상품별 프로필과 고치는 길을 보인다.
 */
export function PlanProfileNotice({
  groups,
  onSplitByProfile,
}: {
  groups: ProfileGroup[];
  onSplitByProfile: (() => void) | null;
}) {
  const missing = groups.some((group) => !group.profile);
  const mixed = groups.filter((group) => group.profile).length > 1;

  return (
    <div className="space-y-3">
      <Alert className="border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950/20">
        <AlertTriangle />
        <AlertTitle className="line-clamp-none break-keep">
          {mixed
            ? '이 상자는 배송 프로필이 다른 상품이 섞여 있어 확정할 수 없어요'
            : '배송 프로필이 없는 상품이 있어 확정할 수 없어요'}
        </AlertTitle>
        <AlertDescription className="break-keep">
          상자 확정은 담긴 상품이 모두 같은 배송 프로필일 때만 돼요.
        </AlertDescription>
      </Alert>

      <ul role="list" aria-label="상품별 배송 프로필" className="space-y-2">
        {groups.map((group) => (
          <li key={group.key} className="rounded-md border p-2.5 text-sm">
            <p className="font-medium">{profileGroupName(group)}</p>
            <p className="break-keep text-muted-foreground">
              {group.lines.map((line, index) => (
                <span key={line.id}>
                  {index > 0 && ', '}
                  {line.skuCode ? (
                    <Link
                      href={skuHref(line.skuCode)}
                      className="underline underline-offset-2"
                    >
                      {splitLineName(line)}
                    </Link>
                  ) : (
                    splitLineName(line)
                  )}{' '}
                  {line.qty}개
                </span>
              ))}
            </p>
          </li>
        ))}
      </ul>

      <ul className="list-disc space-y-1 pl-5 text-sm break-keep">
        {mixed && (
          <li>
            상품마다 맞는 프로필이면 «배송 프로필별로 나누기»로 프로필마다
            상자를 나눈 뒤 각 상자를 확정해 주세요.
          </li>
        )}
        {mixed && (
          <li>
            한 프로필로 보내야 하는 상품이면 SKU 에서 프로필을 같게 맞춰 주세요.
          </li>
        )}
        {missing && (
          <li>프로필이 없는 상품은 SKU 에서 배송 프로필을 정해 주세요.</li>
        )}
      </ul>

      {mixed && onSplitByProfile && (
        <Button type="button" onClick={onSplitByProfile}>
          배송 프로필별로 나누기
        </Button>
      )}
    </div>
  );
}

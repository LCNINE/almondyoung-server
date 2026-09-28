import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ShopListingModerationDto } from '@/lib/types/dto/products';
import { SHOP_LISTING_MODERATION_LABELS } from '../../lib/admin-listing-rules';

export function ModerationHistory({
  items,
}: {
  items: ShopListingModerationDto[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">판정 이력</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            아직 판정한 적이 없어요.
          </p>
        ) : (
          <ul className="divide-y">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-sm"
              >
                <span className="font-medium">
                  {SHOP_LISTING_MODERATION_LABELS[item.decision]}
                </span>
                <span className="text-muted-foreground text-xs">
                  {item.decidedBy === 'classifier'
                    ? '판정기'
                    : `관리자 ${item.actorUserId ?? ''}`}
                </span>
                <span className="text-muted-foreground text-xs">
                  {new Date(item.createdAt).toLocaleString('ko-KR')}
                </span>
                {item.reason && <p className="w-full text-sm">{item.reason}</p>}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

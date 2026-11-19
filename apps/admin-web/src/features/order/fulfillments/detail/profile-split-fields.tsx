import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { splitLineName } from './shipment-split-model';
import { profileGroupName, type ProfileGroup } from './plan-profile';

function contents(groups: ProfileGroup[]): string {
  return groups
    .flatMap((group) =>
      group.lines.map((line) => `${splitLineName(line)} ${line.qty}개`)
    )
    .join(', ');
}

/** 고른 배송 프로필의 상품을 모두 새 상자로 옮긴다 — 나눈 뒤 남는 것과 옮겨 갈 것을 미리 보인다 */
export function ProfileSplitFields({
  groups,
  groupKey,
  onGroupKeyChange,
}: {
  groups: ProfileGroup[];
  groupKey: string;
  onGroupKeyChange: (key: string) => void;
}) {
  if (groups.length < 2) {
    return (
      <p role="status" className="text-sm break-keep text-muted-foreground">
        {groups.length === 1 && !groups[0].profile
          ? '이제 나눌 배송 프로필이 없어요. SKU 에서 배송 프로필을 정해 주세요.'
          : '이제 이 상자 상품의 배송 프로필이 하나로 맞아요. 나누지 않고 계획 확정을 할 수 있어요.'}
      </p>
    );
  }

  const moving = groups.find((group) => group.key === groupKey);
  const staying = groups.filter((group) => group.key !== groupKey);
  const stillMixed = staying.length > 1;

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="split-profile">새 상자로 보낼 배송 프로필</Label>
        <Select value={groupKey} onValueChange={onGroupKeyChange}>
          <SelectTrigger id="split-profile" className="w-full">
            <SelectValue placeholder="배송 프로필 선택" />
          </SelectTrigger>
          <SelectContent>
            {groups.map((group) => (
              <SelectItem key={group.key} value={group.key}>
                {`${profileGroupName(group)} · 상품 ${group.lines.length}종 ${group.qty}개`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {moving ? (
        <dl
          role="status"
          className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md bg-muted/50 p-3 text-sm break-keep"
        >
          <dt className="text-muted-foreground">이번 상자에 남는 것</dt>
          <dd>{contents(staying)}</dd>
          <dt className="text-muted-foreground">새 상자로 보낼 것</dt>
          <dd>{contents([moving])}</dd>
        </dl>
      ) : (
        <p className="text-sm text-destructive">
          새 상자로 보낼 배송 프로필을 고르세요.
        </p>
      )}

      {moving && !moving.profile && (
        <p className="text-sm break-keep text-amber-700">
          배송 프로필이 없는 상품은 나눠도 확정할 수 없어요. SKU 에서 프로필을
          정해 주세요.
        </p>
      )}
      {moving && stillMixed && (
        <p className="text-sm break-keep text-amber-700">
          나눈 뒤에도 이 상자에 프로필이 {staying.length}개 남아요. 한 번 더
          나눠 주세요.
        </p>
      )}
    </div>
  );
}

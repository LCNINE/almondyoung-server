import { Badge } from '@/components/ui/badge';
import { formatDate } from '@/lib/utils/date';

type AccountStatusCellProps = {
  deletedAt: string | null | undefined;
  dormantAt?: string | null;
};

/**
 * 계정 상태(정상 / 탈퇴 / 휴면).
 *
 * 목록은 탈퇴·휴면 회원까지 함께 내려주는데 화면에 표시가 없어서, 관리자가 탈퇴 사실을 전혀
 * 알 수 없었다. 탈퇴(본인 요청)와 휴면(장기 미접속)은 응대가 다르므로 구분해 보여준다.
 */
export const AccountStatusCell = ({ deletedAt, dormantAt }: AccountStatusCellProps) => {
  if (deletedAt) {
    return (
      <div className="flex flex-col gap-0.5">
        <Badge variant="destructive" className="w-fit">
          탈퇴
        </Badge>
        <span className="text-xs text-muted-foreground">{formatDate(deletedAt)}</span>
      </div>
    );
  }

  if (dormantAt) {
    return (
      <div className="flex flex-col gap-0.5">
        <Badge variant="outline" className="w-fit">
          휴면
        </Badge>
        <span className="text-xs text-muted-foreground">{formatDate(dormantAt)}</span>
      </div>
    );
  }

  return <Badge variant="secondary">정상</Badge>;
};

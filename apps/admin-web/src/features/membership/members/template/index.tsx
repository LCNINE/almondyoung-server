'use client';

import { useState, useEffect } from 'react';
import { Check, ChevronsUpDown, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';
import { MembershipMemberTable } from '../components/table';
import { MembershipMemberFilterBox } from '../components/filter-box';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { useGrantSubscriptionByDays } from '@/lib/services/membership';
import { userApi } from '@/lib/api/domains/users';
import { cn } from '@/lib/utils/ui';

function useDebounced<T>(value: T, delay = 350) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function AdminGrantDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [selectedUser, setSelectedUser] = useState<{ id: string; loginId: string; username: string } | null>(null);
  const [userQuery, setUserQuery] = useState('');
  const [userPopoverOpen, setUserPopoverOpen] = useState(false);
  const [days, setDays] = useState('');
  const [memo, setMemo] = useState('');
  const grantMutation = useGrantSubscriptionByDays();

  const debouncedQuery = useDebounced(userQuery, 350);
  const { data: userResults, isFetching: searching } = useQuery({
    queryKey: ['user-search-grant', debouncedQuery],
    queryFn: () => userApi.getAdminUsers({ q: debouncedQuery, limit: 20 }),
    enabled: debouncedQuery.length >= 1,
    staleTime: 30 * 1000,
  });

  const handleClose = () => {
    setSelectedUser(null);
    setUserQuery('');
    setDays('');
    setMemo('');
    onClose();
  };

  const handleConfirm = async () => {
    if (!selectedUser) {
      toast.error('사용자를 선택해주세요.');
      return;
    }
    const d = Number(days);
    if (!d || d < 1) {
      toast.error('1일 이상의 일수를 입력해주세요.');
      return;
    }
    try {
      await grantMutation.mutateAsync({ userId: selectedUser.id, days: d, memo: memo.trim() || undefined });
      toast.success('구독이 지급되었습니다.');
      handleClose();
    } catch (e: any) {
      const msg: string = e?.response?.data?.message ?? e?.message ?? '';
      if (msg.includes('이미 활성')) {
        toast.error('이미 활성 구독이 있는 사용자입니다. 멤버십 상세에서 기간 조정을 이용하세요.');
      } else {
        toast.error('구독 지급에 실패했습니다.');
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>신규 구독 지급</DialogTitle>
          <DialogDescription>
            사용자를 검색하여 선택한 뒤 지급할 일수를 입력합니다. 결제 없이 즉시 적용되며 메모는 마이페이지에서 확인할 수 있습니다.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>사용자 <span className="text-destructive">*</span></Label>
            <Popover open={userPopoverOpen} onOpenChange={setUserPopoverOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
                  {selectedUser ? (
                    <span className="truncate">
                      {selectedUser.loginId}
                      {selectedUser.username && (
                        <span className="text-muted-foreground ml-1">({selectedUser.username})</span>
                      )}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">아이디 · 이메일 · 이름으로 검색</span>
                  )}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[380px] p-0" align="start">
                <Command shouldFilter={false}>
                  <CommandInput
                    placeholder="아이디 · 이메일 · 이름 검색..."
                    value={userQuery}
                    onValueChange={setUserQuery}
                  />
                  <CommandList>
                    {searching ? (
                      <div className="py-4 text-center text-sm text-muted-foreground">검색 중...</div>
                    ) : !debouncedQuery ? (
                      <CommandEmpty>검색어를 입력하세요.</CommandEmpty>
                    ) : !userResults?.data?.length ? (
                      <CommandEmpty>검색 결과가 없습니다.</CommandEmpty>
                    ) : (
                      <CommandGroup>
                        {userResults.data.map((u) => (
                          <CommandItem
                            key={u.id}
                            value={u.id}
                            onSelect={() => {
                              setSelectedUser({ id: u.id, loginId: u.loginId, username: u.username });
                              setUserPopoverOpen(false);
                              setUserQuery('');
                            }}
                          >
                            <Check className={cn('mr-2 h-4 w-4', selectedUser?.id === u.id ? 'opacity-100' : 'opacity-0')} />
                            <span className="font-medium">{u.loginId}</span>
                            <span className="ml-1.5 text-muted-foreground text-xs">{u.username}</span>
                            {u.email && <span className="ml-1.5 text-muted-foreground text-xs truncate">{u.email}</span>}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    )}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-1.5">
            <Label>지급 일수 <span className="text-destructive">*</span></Label>
            <Input
              type="number"
              placeholder="예: 30"
              min={1}
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>메모 (선택)</Label>
            <Input
              placeholder="예: 계좌이체 확인, 서비스 제공"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            닫기
          </Button>
          <Button onClick={handleConfirm} disabled={grantMutation.isPending}>
            {grantMutation.isPending ? '처리 중...' : '구독 지급'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function MembershipMemberListTemplate() {
  const [subscribeDialogOpen, setSubscribeDialogOpen] = useState(false);

  return (
    <Container className="divide-y-0">
      <Header
        title="멤버십 회원 조회"
        subtitle="멤버십을 한 번이라도 구독했던 회원의 정보를 모두 조회할 수 있습니다."
        right={
          <Button
            size="sm"
            className="gap-1"
            onClick={() => setSubscribeDialogOpen(true)}
          >
            <UserPlus className="h-4 w-4" />
            신규 구독 등록
          </Button>
        }
      />
      <MembershipMemberFilterBox />
      <MembershipMemberTable />
      <AdminGrantDialog
        open={subscribeDialogOpen}
        onClose={() => setSubscribeDialogOpen(false)}
      />
    </Container>
  );
}

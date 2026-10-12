'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type { AlimtalkTemplate } from '@/lib/api/domains/alimtalk';
import {
  useAlimtalkAutoNotices,
  useLinkAlimtalkAutoNotice,
  useToggleAlimtalkAutoNotice,
  useUnlinkAlimtalkAutoNotice,
} from '@/lib/services/alimtalk';
import { autoNoticeFit } from '../lib/alimtalk';

const errorMessage = (error: unknown, fallback: string) =>
  (error instanceof Error && error.message) || fallback;

const vars = (names: string[]) => names.map((v) => `#{${v}}`).join(' ');

/**
 * 템플릿 상세의 «자동 알림» — 이 템플릿을 어느 자동 알림이 쓰는지 보고, 승인된 템플릿이면 잇고·떼고·켜고 끈다.
 * 발송 설정이 아직 없는 알림도 여기서 이으면 꺼진 채로 만들어진다.
 */
export function AutoNoticeLink({ template }: { template: AlimtalkTemplate }) {
  const approved = template.status === 'TSC03';
  const notices = useAlimtalkAutoNotices();
  const link = useLinkAlimtalkAutoNotice();
  const unlink = useUnlinkAlimtalkAutoNotice();
  const toggle = useToggleAlimtalkAutoNotice();
  const [picked, setPicked] = useState<string>('');
  const [confirmReplace, setConfirmReplace] = useState(false);

  const all = notices.data ?? [];
  const mine = all.filter((n) => n.templateCode === template.templateCode);
  const others = all.filter((n) => n.templateCode !== template.templateCode);
  const target = others.find((n) => n.eventKey === picked);
  const fit = target
    ? autoNoticeFit(template.variables, target.variables)
    : null;
  const replacingActive = !!target?.isActive && !!target.templateCode;
  const canLink =
    approved &&
    !!target &&
    fit?.ok === true &&
    (!replacingActive || confirmReplace) &&
    !link.isPending;

  const submitLink = () => {
    if (!target) return;
    link.mutate(
      {
        eventKey: target.eventKey,
        templateCode: template.templateCode,
        replaceActive: replacingActive,
      },
      {
        onSuccess: (view) => {
          toast.success(
            view.isActive
              ? `«${view.name}»이 이제 이 템플릿으로 나갑니다.`
              : `«${view.name}»에 이었습니다. 켜야 발송됩니다.`
          );
          setPicked('');
          setConfirmReplace(false);
        },
        onError: (error) =>
          toast.error(errorMessage(error, '자동 알림에 잇지 못했습니다.')),
      }
    );
  };

  return (
    <section className="flex flex-col gap-2 text-sm">
      <h4 className="font-semibold">자동 알림</h4>
      {notices.isError && (
        <p className="text-destructive text-xs">
          자동 알림 목록을 불러오지 못했습니다.
        </p>
      )}

      {mine.length === 0 && !notices.isLoading && (
        <p className="text-muted-foreground text-xs">
          이 템플릿을 쓰는 자동 알림이 없습니다.
        </p>
      )}
      {mine.map((n) => (
        <div
          key={n.eventKey}
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
        >
          <div className="flex min-w-0 flex-col">
            <span className="font-medium">{n.name}</span>
            <span className="text-muted-foreground text-xs">{n.condition}</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={n.isActive ? 'default' : 'secondary'}>
              {n.isActive ? '발송 중' : '꺼짐'}
            </Badge>
            <Switch
              checked={n.isActive}
              disabled={toggle.isPending || (!approved && !n.isActive)}
              aria-label={`${n.name} ${n.isActive ? '끄기' : '켜기'}`}
              onCheckedChange={(isActive) =>
                toggle.mutate(
                  { eventKey: n.eventKey, isActive },
                  {
                    onSuccess: () =>
                      toast.success(
                        isActive
                          ? `«${n.name}»을 켰습니다.`
                          : `«${n.name}»을 껐습니다.`
                      ),
                    onError: (error) =>
                      toast.error(errorMessage(error, '바꾸지 못했습니다.')),
                  }
                )
              }
            />
            {!n.isActive && (
              <Button
                variant="ghost"
                size="sm"
                disabled={unlink.isPending}
                onClick={() =>
                  unlink.mutate(n.eventKey, {
                    onSuccess: () => toast.success('연결을 뗐습니다.'),
                    onError: (error) =>
                      toast.error(errorMessage(error, '떼지 못했습니다.')),
                  })
                }
              >
                떼기
              </Button>
            )}
          </div>
        </div>
      ))}

      {template.linkedEvents
        .filter((e) => !all.some((n) => n.eventKey === e.eventKey))
        .map((e) => (
          <div
            key={e.eventKey}
            className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
          >
            <span>{e.name}</span>
            <Badge variant={e.isActive ? 'default' : 'secondary'}>
              {e.isActive ? '발송 중' : '꺼짐'}
            </Badge>
          </div>
        ))}

      {approved ? (
        others.length > 0 && (
          <div className="flex flex-col gap-2 rounded-md border border-dashed px-3 py-3">
            <Label className="text-xs font-medium">다른 자동 알림에 잇기</Label>
            <Select
              value={picked}
              onValueChange={(v) => {
                setPicked(v);
                setConfirmReplace(false);
              }}
            >
              <SelectTrigger className="h-9 bg-white">
                <SelectValue placeholder="자동 알림 고르기" />
              </SelectTrigger>
              <SelectContent>
                {others.map((n) => {
                  const ok = autoNoticeFit(template.variables, n.variables).ok;
                  return (
                    <SelectItem key={n.eventKey} value={n.eventKey}>
                      {n.name}
                      {!n.configured
                        ? ' · 발송 설정 없음'
                        : n.templateCode
                          ? ` · 지금 ${n.templateCode}`
                          : ' · 연결 없음'}
                      {!ok && ' · 변수 안 맞음'}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            {target && (
              <div className="flex flex-col gap-1 text-xs">
                <p className="text-muted-foreground">{target.condition}</p>
                <p className="text-muted-foreground">
                  이 알림이 채우는 변수: {vars(target.variables)}
                </p>
                {fit && !fit.ok && (
                  <p className="text-destructive">
                    이 템플릿은 알림이 채우지 않는 {vars(fit.unknown)}을 씁니다
                    — 이으면 카카오가 발송을 거절합니다.
                  </p>
                )}
                {!target.configured && fit?.ok && (
                  <p className="text-muted-foreground">
                    아직 발송 설정이 없어 꺼진 채로 만들어집니다. 이은 뒤 켜
                    주세요.
                  </p>
                )}
                {replacingActive && fit?.ok && (
                  <label className="flex items-start gap-2 text-amber-800">
                    <Checkbox
                      checked={confirmReplace}
                      onCheckedChange={(v) => setConfirmReplace(v === true)}
                    />
                    <span>
                      켜져 있는 알림입니다. 지금 {target.templateCode} 대신 다음
                      발송부터 이 템플릿으로 나갑니다.
                    </span>
                  </label>
                )}
              </div>
            )}
            <Button
              size="sm"
              className="self-start"
              disabled={!canLink}
              onClick={submitLink}
            >
              이 템플릿으로 잇기
            </Button>
          </div>
        )
      ) : (
        <p className="text-muted-foreground text-xs">
          카카오 승인이 끝난 템플릿만 자동 알림에 이을 수 있습니다.
        </p>
      )}
    </section>
  );
}

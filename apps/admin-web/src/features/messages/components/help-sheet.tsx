'use client';

import { CircleHelp } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="text-muted-foreground flex flex-col gap-1 text-sm leading-6">
        {children}
      </div>
    </section>
  );
}

export function HelpSheet() {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          <CircleHelp />
          도움말
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>폰 문자 도움말</SheetTitle>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1 px-4 pb-6">
          <div className="flex flex-col gap-5">
            <Section title="광고와 정보 구분">
              <p>할인·신상품·이벤트처럼 구매를 권하는 문자는 광고입니다.</p>
              <p>
                주문·배송·계정·문의 답변처럼 거래와 서비스를 안내하는 문자는
                정보입니다.
              </p>
              <p>둘이 섞여 있거나 헷갈리면 광고로 보냅니다.</p>
            </Section>
            <Section title="(광고) 표기와 수신거부">
              <p>
                광고는 본문 맨 앞에 <b>(광고)</b>, 맨 끝에{' '}
                <b>수신거부: 이 번호로 &apos;수신거부&apos; 회신</b> 이 자동으로
                붙습니다. 직접 쓰지 않아도 됩니다.
              </p>
              <p>
                마케팅 수신에 동의한 회원에게만 나갑니다. 발송 직전에 한 번 더
                확인해 그사이 철회한 회원은 뺍니다.
              </p>
              <p>
                고객이 &apos;수신거부&apos; 라고 답장하면 동의가 자동으로
                철회되고 처리 안내 문자가 나갑니다.
              </p>
            </Section>
            <Section title="발송 시간대">
              <p>
                광고 개별 발송은 21시~08시에 보내지 않고 기다렸다가 08시 이후에
                나갑니다.
              </p>
              <p>
                대량 발송은 매일 09:00~20:00 사이에만, 폰의 하루 한도를 그
                시간대에 고르게 나눈 간격으로 나갑니다.
              </p>
            </Section>
            <Section title="폰 한도와 대표번호(NHN) 우회">
              <p>
                폰마다 하루 발송 한도가 있고, 문자 1건을 1통으로 셉니다. 남은
                한도는 다음 날로 넘어가지 않습니다.
              </p>
              <p>
                정보성 개별 발송·답장이 폰 한도를 넘으면 확인 창을 거쳐 넘는
                건만 대표번호로 보냅니다.
              </p>
              <p>
                광고는 대표번호로 우회하지 않고 다음 날 폰 한도로 나갑니다.
                수신거부가 폰 답장뿐이기 때문입니다.
              </p>
            </Section>
            <Section title="대량 발송 순서와 예상 완료일">
              <p>
                개별 발송과 답장이 항상 먼저 나가고, 대량 발송은 먼저 만든
                것부터 차례로 나갑니다.
              </p>
              <p>
                대상 명단은 만드는 순간 확정됩니다. 폰 한도만큼 하루하루
                나가다가 전원에게 나가면 끝납니다.
              </p>
              <p>
                예상 완료일은 폰 한도, 지금 켜져 있는 폰, 앞에 쌓인 대기분으로
                계산한 예상치입니다. 폰이 꺼지거나 개별 발송이 끼어들면
                밀립니다. 발송 목록에서 언제든 중지할 수 있습니다.
              </p>
            </Section>
            <Section title="폰이 꺼졌을 때">
              <p>
                30분 넘게 연결이 없으면 오프라인으로 보고 발송 화면 위에
                표시합니다. 그동안 문자는 발송 대기로 쌓입니다.
              </p>
              <p>
                꺼질 때와 다시 켜질 때 한 번씩 Google Chat 으로 알림이 갑니다.
              </p>
            </Section>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

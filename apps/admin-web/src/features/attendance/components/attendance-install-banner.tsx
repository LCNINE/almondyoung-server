'use client';

import { useEffect, useState } from 'react';
import {
  Bookmark,
  ChevronLeft,
  Copy,
  EllipsisVertical,
  FileSearch,
  Menu,
  Plus,
  RotateCw,
  Share,
  Smartphone,
  SquarePlus,
  Star,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from '@/components/ui/drawer';
import {
  INSTALL_BANNER_DISMISSED_KEY,
  installBannerKind,
  type InstallBannerKind,
} from '../lib/install-banner';

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const ICON = '/pwa-attendance/icon-192.png?v=clock-2';
const ATTENDANCE_URL = 'https://admin.almondyoung.com/attendance';

const PREVIEW_KINDS: InstallBannerKind[] = [
  'ios',
  'android',
  'inapp-ios',
  'inapp-android',
];

function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function wasDismissed() {
  try {
    return localStorage.getItem(INSTALL_BANNER_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function AttendanceInstallBanner() {
  const [kind, setKind] = useState<InstallBannerKind | null>(null);
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  useEffect(() => {
    // ?install=ios 처럼 붙이면 PC 에서도 그 기기의 띠·안내를 볼 수 있다(튜토리얼 캡처용)
    const preview = new URLSearchParams(window.location.search).get('install');
    if (PREVIEW_KINDS.includes(preview as InstallBannerKind)) {
      setKind(preview as InstallBannerKind);

      return;
    }

    if (wasDismissed()) return;

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPromptEvent);
    };
    const onInstalled = () => setKind(null);

    setKind(
      installBannerKind({
        userAgent: navigator.userAgent,
        maxTouchPoints: navigator.maxTouchPoints,
        standalone: isStandalone(),
      })
    );
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!kind) return null;

  function dismiss() {
    try {
      localStorage.setItem(INSTALL_BANNER_DISMISSED_KEY, '1');
    } catch {
      // 저장이 막힌 브라우저에선 이번 화면에서만 닫는다
    }
    setKind(null);
  }

  async function install() {
    if (kind === 'android' && prompt) {
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      setPrompt(null);
      if (outcome === 'accepted') setKind(null);

      return;
    }

    setGuideOpen(true);
  }

  return (
    <>
      <div className="mb-3 flex items-center gap-3 rounded-2xl border border-slate-200 bg-white py-3 pr-2 pl-3 [@media(display-mode:standalone)]:hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={ICON} alt="" className="size-11 shrink-0 rounded-[10px]" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">홈 화면에 추가하기</p>
          <p className="mt-0.5 truncate text-xs text-slate-500">
            알림도 받을 수 있어요
          </p>
        </div>
        <Button
          size="sm"
          className="shrink-0 rounded-full bg-indigo-600 px-4 hover:bg-indigo-700"
          onClick={() => void install()}
        >
          설치
        </Button>
        <button
          type="button"
          aria-label="닫기"
          onClick={dismiss}
          className="-ml-1 flex size-8 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100"
        >
          <X className="size-4" />
        </button>
      </div>
      {(kind === 'ios' || kind === 'android') && (
        <InstallGuide
          steps={kind === 'ios' ? IOS_STEPS : ANDROID_STEPS}
          open={guideOpen}
          onOpenChange={setGuideOpen}
        />
      )}
      {(kind === 'inapp-ios' || kind === 'inapp-android') && (
        <InAppNotice
          browser={kind === 'inapp-ios' ? 'Safari' : 'Chrome'}
          open={guideOpen}
          onOpenChange={setGuideOpen}
        />
      )}
    </>
  );
}

function SafariBar({ ring }: { ring?: boolean }) {
  const glass =
    'bg-white/80 shadow-[0_2px_14px_rgb(0_0_0/0.14),0_0_0_0.5px_rgb(0_0_0/0.08)]';

  return (
    <div className="absolute inset-x-3 bottom-4 flex items-center gap-2">
      <span className={`grid size-10 place-items-center rounded-full ${glass}`}>
        <ChevronLeft className="size-5" />
      </span>
      <span
        className={`flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full px-3 text-[13px] ${glass}`}
      >
        <span
          className={`grid size-6 place-items-center rounded-full ${ring ? 'ring-[2.5px] ring-red-500' : ''}`}
        >
          <Menu className="size-4" />
        </span>
        <span className="flex-1 truncate text-center">admin.almondyoung.com</span>
        <RotateCw className="size-4" />
      </span>
      <span className={`grid size-10 place-items-center rounded-full ${glass}`}>
        <Copy className="size-4" />
      </span>
    </div>
  );
}

function Row({
  icon: Icon,
  label,
  highlight,
}: {
  icon: typeof Share;
  label: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm ${highlight ? 'ring-[2.5px] ring-red-500' : ''}`}
    >
      <Icon className="size-4 shrink-0" />
      {label}
    </div>
  );
}

function AppHeader() {
  return (
    <div className="mb-2 flex items-center gap-2.5 px-1">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={ICON} alt="" className="size-9 rounded-lg" />
      <div className="min-w-0">
        <p className="text-[13px] font-semibold">아몬드영 워크</p>
        <p className="truncate text-[11px] text-slate-500">
          admin.almondyoung.com
        </p>
      </div>
    </div>
  );
}

const IOS_STEPS: GuideStep[] = [
  {
    title: '주소창 왼쪽 ≡ 버튼을 눌러요',
    hint: '화면 맨 아래 주소창에 있어요.',
    art: (
      <>
        <div className="absolute inset-0 bg-gradient-to-b from-white to-slate-100" />
        <SafariBar ring />
      </>
    ),
  },
  {
    title: '메뉴에서 「공유」를 눌러요',
    hint: '메뉴 맨 위에 있어요.',
    art: (
      <div className="absolute top-4 left-1/2 w-56 -translate-x-1/2 rounded-3xl bg-white/90 p-1.5 shadow-lg">
        <Row icon={Share} label="공유" highlight />
        <Row icon={Bookmark} label="북마크에 추가" />
        <div className="mx-3 my-1 border-t border-slate-200" />
        <Row icon={FileSearch} label="페이지에서 찾기" />
      </div>
    ),
  },
  {
    title: '「홈 화면에 추가」를 눌러요',
    hint: '안 보이면 목록을 조금 위로 올려 보세요.',
    art: (
      <div className="absolute inset-x-3 top-3 bottom-0 rounded-t-2xl bg-[#f2f2f7] p-3">
        <AppHeader />
        <div className="rounded-2xl bg-[#e9e9ee] p-1">
          <Row icon={Star} label="즐겨찾기에 추가" />
          <Row icon={FileSearch} label="페이지에서 찾기" />
          <Row icon={SquarePlus} label="홈 화면에 추가" highlight />
        </div>
      </div>
    ),
  },
  {
    title: '오른쪽 위 「추가」를 누르면 끝이에요',
    hint: '「웹 앱으로 열기」는 켜진 채로 두세요.',
    art: (
      <div className="absolute inset-x-3 top-3 bottom-0 rounded-t-2xl bg-[#f2f2f7]">
        <div className="flex items-center justify-between px-3.5 py-3 text-sm">
          <span className="text-[#0a84ff]">취소</span>
          <b>홈 화면에 추가</b>
          <span className="rounded-lg px-2 py-0.5 font-semibold text-[#0a84ff] ring-[2.5px] ring-red-500">
            추가
          </span>
        </div>
        <div className="mx-3 rounded-xl bg-white p-3">
          <AppHeader />
        </div>
        <div className="mx-3 mt-2.5 flex items-center justify-between rounded-xl bg-white px-3 py-2.5 text-[13px]">
          웹 앱으로 열기
          <span className="relative h-[22px] w-[38px] rounded-full bg-[#34c759] after:absolute after:top-0.5 after:right-0.5 after:size-[18px] after:rounded-full after:bg-white" />
        </div>
      </div>
    ),
  },
];

const ANDROID_STEPS: GuideStep[] = [
  {
    title: '오른쪽 위 ⋮ 버튼을 눌러요',
    hint: '삼성 인터넷은 아래쪽 ≡ 버튼이에요.',
    art: (
      <>
        <div className="absolute inset-0 bg-gradient-to-b from-white to-slate-100" />
        <div className="absolute inset-x-3 top-4 flex h-10 items-center gap-2 rounded-full bg-slate-200/80 pr-2 pl-4 text-[13px]">
          <span className="flex-1 truncate">admin.almondyoung.com/attendance</span>
          <span className="grid size-7 place-items-center rounded-full ring-[2.5px] ring-red-500">
            <EllipsisVertical className="size-4" />
          </span>
        </div>
      </>
    ),
  },
  {
    title: '「홈 화면에 추가」를 눌러요',
    hint: '「앱 설치」로 보이면 그걸 누르면 돼요.',
    art: (
      <div className="absolute top-3 right-3 w-52 rounded-2xl bg-white p-1.5 shadow-lg">
        <Row icon={Plus} label="새 탭" />
        <Row icon={Bookmark} label="북마크" />
        <Row icon={Share} label="공유" />
        <Row icon={Smartphone} label="홈 화면에 추가" highlight />
      </div>
    ),
  },
  {
    title: '「설치」를 누르면 끝이에요',
    hint: '홈 화면에 아몬드영 워크 아이콘이 생겨요.',
    art: (
      <div className="absolute inset-x-5 top-1/2 -translate-y-1/2 rounded-2xl bg-white p-4 shadow-lg">
        <p className="mb-3 text-[15px] font-semibold">앱 설치</p>
        <AppHeader />
        <div className="mt-3 flex justify-end gap-4 text-sm font-semibold text-[#1a73e8]">
          <span className="px-1 py-0.5">취소</span>
          <span className="rounded-lg px-2 py-0.5 ring-[2.5px] ring-red-500">설치</span>
        </div>
      </div>
    ),
  },
];

type GuideStep = { title: string; hint: string; art: React.ReactNode };

function InstallGuide({
  steps,
  open,
  onOpenChange,
}: {
  steps: GuideStep[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [step, setStep] = useState(0);
  const current = steps[step];
  const last = step === steps.length - 1;

  function changeOpen(next: boolean) {
    onOpenChange(next);
    if (!next) setStep(0);
  }

  return (
    <Drawer open={open} onOpenChange={changeOpen}>
      <DrawerContent className="mx-auto w-full max-w-md rounded-t-3xl px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <DrawerTitle className="sr-only">홈 화면에 추가하기</DrawerTitle>
        <DrawerDescription className="sr-only">
          브라우저 메뉴에서 아몬드영 워크를 홈 화면에 추가하는 방법
        </DrawerDescription>
        <div className="mt-4 mb-3.5 flex gap-1.5" aria-hidden>
          {steps.map((item, index) => (
            <i
              key={item.title}
              className={`h-1 flex-1 rounded-full ${index <= step ? 'bg-indigo-600' : 'bg-slate-200'}`}
            />
          ))}
        </div>
        <div
          className="relative mb-3.5 h-60 overflow-hidden rounded-2xl bg-slate-100 text-slate-900"
          aria-hidden
        >
          {current.art}
        </div>
        <p className="flex items-start gap-2.5 text-[15px] leading-6 font-semibold">
          <span className="mt-px grid size-6 shrink-0 place-items-center rounded-full bg-indigo-50 text-xs font-bold text-indigo-700">
            {step + 1}
          </span>
          {current.title}
        </p>
        <p className="mt-1 mb-4 ml-[34px] text-[13px] text-slate-500">
          {current.hint}
        </p>
        <div className="flex gap-2">
          {step > 0 && (
            <Button
              variant="secondary"
              className="h-12 rounded-xl px-4"
              onClick={() => setStep(step - 1)}
            >
              이전
            </Button>
          )}
          <Button
            className="h-12 flex-1 rounded-xl bg-indigo-600 text-base hover:bg-indigo-700"
            onClick={() => (last ? changeOpen(false) : setStep(step + 1))}
          >
            {last ? '해볼게요' : '다음'}
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function InAppNotice({
  browser,
  open,
  onOpenChange,
}: {
  browser: 'Safari' | 'Chrome';
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(ATTENDANCE_URL);
      toast.success(`주소를 복사했어요. ${browser} 주소창에 붙여 넣어 주세요.`);
      onOpenChange(false);
    } catch {
      toast.error(`복사하지 못했어요. ${ATTENDANCE_URL} 을 직접 입력해 주세요.`);
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="mx-auto w-full max-w-md rounded-t-3xl px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <DrawerTitle className="mt-5 text-lg">{browser}로 열어 주세요</DrawerTitle>
        <DrawerDescription className="mt-1 mb-4 text-[13px] text-slate-500">
          이 브라우저에서는 홈 화면에 추가할 수 없어요.
        </DrawerDescription>
        <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] leading-6 text-amber-800">
          오른쪽 아래 <b>⋯</b> → <b>다른 브라우저로 열기</b>를 누른 뒤, {browser}에서
          「설치」를 다시 눌러 주세요.
        </p>
        <Button
          className="h-12 w-full rounded-xl bg-indigo-600 text-base hover:bg-indigo-700"
          onClick={() => void copy()}
        >
          주소 복사하기
        </Button>
      </DrawerContent>
    </Drawer>
  );
}

import type { AlimtalkButtonInput } from '@/lib/api/domains/alimtalk';

/** 카카오톡 알림톡 말풍선 모양 미리보기. 실제 폰마다 글꼴·줄바꿈이 조금 다를 수 있다. */
export function KakaoBubble({
  body,
  buttons,
}: {
  body: string;
  buttons: Pick<AlimtalkButtonInput, 'name'>[];
}) {
  return (
    <div className="w-full max-w-[300px] rounded-xl bg-[#b2c7da] p-3">
      <div className="overflow-hidden rounded-lg bg-white shadow-sm">
        <div className="bg-[#fee500] px-3 py-2 text-xs font-semibold text-[#3c1e1e]">
          알림톡 도착
        </div>
        <p className="px-3 py-3 text-sm break-words whitespace-pre-wrap">
          {body || '본문을 입력하면 여기에 보입니다.'}
        </p>
        {buttons.length > 0 && (
          <div className="flex flex-col gap-1.5 px-3 pb-3">
            {buttons.map((button, i) => (
              <span
                key={i}
                className="rounded-md border bg-neutral-50 py-1.5 text-center text-xs font-medium text-neutral-800"
              >
                {button.name || '버튼 이름'}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

import { cn } from '../core/design/cn';
import { useRegistryApi, useResolvedActions } from './ActionRegistry';
import { functionBarItems } from './actions';
import { Kbd } from './Kbd';
import type { StationKey } from './keys';

/** 기능키 바 56px(스펙 §5.1). 마우스로 눌러도 같은 액션이 돈다 — 실행은 늘 최신 등록에서 꺼낸다. */
export function FunctionKeyBar({ omit }: { omit: ReadonlySet<StationKey> }) {
  const resolved = useResolvedActions();
  const api = useRegistryApi();
  return (
    <div
      role="toolbar"
      aria-label="기능키"
      className="flex h-14 shrink-0 items-center gap-2 border-t border-[#D5D8DE] bg-white px-3 print:hidden"
    >
      {functionBarItems(resolved, omit).map((action) => (
        <button
          key={action.id}
          type="button"
          onClick={() => {
            const dispatch = api?.resolveKey(action.key);
            if (dispatch?.kind === 'run') dispatch.action.run();
          }}
          className={cn(
            'flex h-10 items-center gap-2 rounded-md border border-[#D5D8DE] bg-white pl-2 pr-3.5 text-sm font-medium text-[#15171C]',
            action.key === 'Escape' && 'ml-auto'
          )}
        >
          <Kbd tone={action.key === 'Escape' ? 'light' : 'dark'}>{action.key === 'Escape' ? 'Esc' : action.key}</Kbd>
          {action.label}
        </button>
      ))}
    </div>
  );
}

import { cn } from '../core/design/cn';
import { useKeyHints, useRegistryApi, useResolvedActions } from './ActionRegistry';
import { functionBarItems } from './actions';
import { Kbd } from './Kbd';

/** 기능키 바(스펙 §5.1). 마우스로 눌러도 같은 액션이 돈다 — 실행은 늘 최신 등록에서 꺼낸다. */
export function FunctionKeyBar() {
  const resolved = useResolvedActions();
  const api = useRegistryApi();
  const hints = useKeyHints();
  const items = functionBarItems(resolved);
  const escape = items.find((action) => action.key === 'Escape');
  const button = (action: (typeof items)[number]) => (
    <button
      key={action.id}
      type="button"
      onClick={() => {
        const dispatch = api?.resolveKey(action.key);
        if (dispatch?.kind === 'run') dispatch.action.run();
      }}
      className={cn(
        'flex items-center gap-2 rounded-lg border border-[#e4e4e7] bg-white px-3 py-[9px] text-xs font-semibold whitespace-nowrap text-[#27272a] hover:bg-[#eff6ff]',
        action.key === 'Escape' && hints.length === 0 && 'ml-auto'
      )}
    >
      <Kbd tone="outline">{action.key === 'Escape' ? 'Esc' : action.key}</Kbd>
      {action.label}
    </button>
  );
  return (
    <div
      role="toolbar"
      aria-label="기능키"
      className="flex shrink-0 items-center gap-2 border-t border-[#e4e4e7] bg-white px-[26px] py-3 print:hidden"
    >
      {items.filter((action) => action !== escape).map(button)}
      {hints.length > 0 && (
        <div aria-label="키 안내" className="ml-auto flex items-center gap-4 text-[11px] text-[#71717a]">
          {hints.map((hint) => (
            <span key={hint.keys} className="flex items-center gap-1.5">
              <Kbd tone="outline">{hint.keys}</Kbd>
              {hint.label}
            </span>
          ))}
        </div>
      )}
      {escape && button(escape)}
    </div>
  );
}

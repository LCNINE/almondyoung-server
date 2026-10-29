import { cn } from '../core/design/cn';
import { useKeyHints, useRegistryApi, useResolvedActions } from './ActionRegistry';
import { functionBarItems } from './actions';
import { Kbd } from './Kbd';

/** 기능키 바 56px(스펙 §5.1). 마우스로 눌러도 같은 액션이 돈다 — 실행은 늘 최신 등록에서 꺼낸다. */
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
        'flex h-10 items-center gap-2 rounded-md border border-[#D5D8DE] bg-white pl-2 pr-3.5 text-sm font-medium text-[#15171C]',
        action.key === 'Escape' && hints.length === 0 && 'ml-auto'
      )}
    >
      <Kbd tone={action.key === 'Escape' ? 'light' : 'dark'}>{action.key === 'Escape' ? 'Esc' : action.key}</Kbd>
      {action.label}
    </button>
  );
  return (
    <div
      role="toolbar"
      aria-label="기능키"
      className="flex h-14 shrink-0 items-center gap-2 border-t border-[#D5D8DE] bg-white px-3 print:hidden"
    >
      {items.filter((action) => action !== escape).map(button)}
      {hints.length > 0 && (
        <div aria-label="키 안내" className="ml-auto flex items-center gap-4 pr-2 text-sm font-medium text-[#3F4450]">
          {hints.map((hint) => (
            <span key={hint.keys} className="flex items-center gap-1.5">
              <Kbd tone="light">{hint.keys}</Kbd>
              {hint.label}
            </span>
          ))}
        </div>
      )}
      {escape && button(escape)}
    </div>
  );
}

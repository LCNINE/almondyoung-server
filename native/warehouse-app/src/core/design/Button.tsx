import { cn } from './cn';

export function Button({
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center rounded-lg bg-[#2563eb] px-4 py-2.5',
        'text-sm font-semibold text-white transition hover:brightness-110',
        'disabled:pointer-events-none disabled:opacity-40',
        className
      )}
      {...props}
    />
  );
}

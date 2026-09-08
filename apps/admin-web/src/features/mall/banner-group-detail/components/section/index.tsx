'use client';

/** 시안(Figma 10:40829) 규격 */
export function BannerSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-[20px] leading-[18px] font-bold text-[#1f2937]">
          {title}
        </h2>
        {action}
      </div>
      <div className="rounded-[10px] border border-[#c6c6c6] bg-[#f5f5f5] p-6">
        {children}
      </div>
    </section>
  );
}

/** 시안 규격 — 16px Bold */
export function FieldLabel({
  htmlFor,
  required,
  children,
}: {
  htmlFor?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="shrink-0 text-[16px] leading-[18px] font-bold whitespace-nowrap text-[#1f2937]"
    >
      {children}
      {required && <span className="text-destructive ml-0.5">*</span>}
    </label>
  );
}

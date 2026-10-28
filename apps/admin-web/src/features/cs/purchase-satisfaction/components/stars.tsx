export function Stars({ rating, withLabel }: { rating: number; withLabel?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span aria-hidden className="tracking-tight">
        {'★'.repeat(rating)}
        <span className="text-muted-foreground/40">{'★'.repeat(5 - rating)}</span>
      </span>
      <span className={withLabel ? 'text-sm font-medium' : 'sr-only'}>{rating}점</span>
    </span>
  );
}

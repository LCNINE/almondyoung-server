export default function CouponLoading() {
  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6 md:py-10">
      <div className="mb-6 h-8 w-24 animate-pulse rounded-lg bg-stone-100" />
      <ul className="flex flex-col gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <li
            key={i}
            className="h-20 animate-pulse rounded-2xl bg-stone-100"
          />
        ))}
      </ul>
    </section>
  )
}

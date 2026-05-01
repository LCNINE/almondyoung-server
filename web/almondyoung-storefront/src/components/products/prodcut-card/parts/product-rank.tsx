export function ProductRank({ rank }: { rank: number }) {
  return (
    <div className="absolute top-0 left-0 bg-black px-2.5 py-1 text-[12px] font-bold text-white">
      {rank}
    </div>
  )
}

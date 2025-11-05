/**
 * @description Q&A 섹션
 * 시맨틱: <section> 사용
 */
export function ProductQnaSection() {
  return (
    <section className="mb-8 rounded-lg bg-white py-6">
      <header>
        <h3 className="mb-4 text-lg font-bold">Q&A</h3>
      </header>
      <div className="py-8 text-center text-gray-500">
        <p>아직 등록된 Q&A가 없습니다.</p>
        <p className="mt-2 text-sm">
          궁금한 점이 있으시면 언제든 문의해주세요!
        </p>
      </div>
    </section>
  )
}

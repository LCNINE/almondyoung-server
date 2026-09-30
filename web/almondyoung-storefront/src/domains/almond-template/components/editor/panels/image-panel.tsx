import type { AlmondEditor } from "../../../hooks/use-almond-editor"

export function ImagePanel({ editor }: { editor: AlmondEditor }) {
  const { add, imageLibrary, imageFile, fillFrames, removeWhiteBackground } =
    editor
  return (
    <>
      <label
        className="block cursor-pointer border py-2 text-center text-sm hover:bg-slate-50"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          const file = e.dataTransfer.files[0]
          if (file) void imageFile(file)
        }}
      >
        + 내 PC 이미지 불러오기
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void imageFile(file)
            event.target.value = ""
          }}
        />
      </label>
      <button
        className="mt-2 w-full bg-[#303030] py-2 text-sm text-white"
        title="선택한 사진의 흰색 배경을 투명하게 만듭니다"
        onClick={() => void removeWhiteBackground()}
      >
        배경이미지 제거 ⓘ
      </button>
      <div className="my-6 border-t pt-5 text-[11px] leading-6 text-[#555]">
        <p>
          사진과 벡터 파일의 해상도·글꼴·색상은 인쇄 전에 확인해 주세요. 화면
          색상과 인쇄 색상은 다를 수 있습니다.
        </p>
        <p className="mt-5">
          이미지 확대 시 해상도가 부족하면 인쇄 품질이 떨어집니다. 고해상도
          원본을 사용해 주세요.
        </p>
      </div>
      <button
        className="ml-auto block rounded-full bg-[#61afd3] px-3 py-1 text-xs text-white hover:bg-[#398eb8]"
        onClick={fillFrames}
      >
        사진자동담기
      </button>
      <div className="mt-3 border-t" />
      {imageLibrary.length ? (
        <>
          <h3 className="mt-5 border-b pb-2 text-sm font-semibold">
            내 라이브러리
          </h3>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {imageLibrary.map((item, index) => (
              <button
                key={`${index}-${item.image.length}`}
                aria-label={`업로드 이미지 ${index + 1} 추가`}
                onClick={() => add("image", { ...item, fill: "#ffffff" })}
                className="flex h-24 items-center justify-center border bg-slate-50"
              >
                <img
                  src={item.image}
                  alt={`업로드 이미지 ${index + 1}`}
                  className="max-h-full max-w-full object-contain"
                />
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="absolute bottom-9 left-0 w-full text-center text-xs text-slate-400">
          이미지 파일을 여기로 끌어 놓으세요
        </p>
      )}
    </>
  )
}

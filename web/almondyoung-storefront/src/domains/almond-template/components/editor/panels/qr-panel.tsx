import type { QrBuilder } from "../../../hooks/use-qr-builder"

export function QrPanel({ qr }: { qr: QrBuilder }) {
  const {
    qrMode,
    setQrMode,
    qrValue,
    setQrValue,
    qrContact,
    setQrContact,
    qrColor,
    setQrColor,
    addQr,
    editingQr,
  } = qr
  return (
    <>
      <div className="mb-3 flex border-b border-[#ccc] text-sm">
        <button
          className={`flex-1 py-2 ${qrMode === "contact" ? "border border-b-0 border-[#ccc] font-semibold" : ""}`}
          onClick={() => setQrMode("contact")}
        >
          명함
        </button>
        <button
          className={`flex-1 py-2 ${qrMode === "url" ? "border border-b-0 border-[#ccc] font-semibold" : ""}`}
          onClick={() => setQrMode("url")}
        >
          웹주소
        </button>
      </div>
      {qrMode === "url" ? (
        <textarea
          aria-label="QR 웹주소"
          className="w-full border p-2 text-sm"
          placeholder="https://example.com"
          value={qrValue}
          onChange={(e) => setQrValue(e.target.value)}
        />
      ) : (
        <div className="space-y-2">
          {(
            [
              ["name", "이름"],
              ["company", "회사"],
              ["phone", "전화번호"],
              ["email", "이메일"],
              ["address", "주소"],
              ["url", "홈페이지"],
            ] as const
          ).map(([key, label]) => (
            <input
              key={key}
              aria-label={label}
              placeholder={label}
              className="w-full border p-2 text-sm"
              value={qrContact[key]}
              onChange={(e) =>
                setQrContact({ ...qrContact, [key]: e.target.value })
              }
            />
          ))}
        </div>
      )}
      <p className="mt-4 mb-2 text-sm font-semibold">색상선택</p>
      <div className="mb-4 flex flex-wrap gap-2">
        {[
          "#000000",
          "#0000ff",
          "#a9a9a9",
          "#808080",
          "#ff00ff",
          "#ff0000",
          "#008000",
        ].map((color) => (
          <button
            key={color}
            aria-label={`QR 색상 ${color}`}
            className={`h-8 w-8 rounded-full border ${qrColor === color ? "ring-2 ring-[#333] ring-offset-2" : ""}`}
            style={{ background: color }}
            onClick={() => setQrColor(color)}
          />
        ))}
      </div>
      <button
        className="w-full border border-[#ddd] bg-white py-2 text-sm font-semibold text-[#333]"
        onClick={addQr}
      >
        {editingQr ? "선택한 QR 수정하기" : "만들기"}
      </button>
      <p className="mt-3 text-xs text-[#e04a4a]">
        사용하실 QR어플로 주문전에 꼭 확인해 보세요.
      </p>
    </>
  )
}

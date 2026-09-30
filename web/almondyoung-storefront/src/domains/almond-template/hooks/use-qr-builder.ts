import { useEffect, useState } from "react"
import QRCode from "qrcode"
import type { Design, Layer } from "../lib/document"

type Params = {
  design: Design
  add: (type: Layer["type"], extra?: Partial<Layer>) => void
  patch: (id: string, value: Partial<Layer>) => void
  selected: Layer | undefined
  editable: boolean
  setMessage: (message: string) => void
}

const EMPTY_CONTACT = {
  name: "",
  company: "",
  phone: "",
  email: "",
  address: "",
  url: "",
}
const VCARD_FIELDS = {
  FN: "name",
  ORG: "company",
  TEL: "phone",
  EMAIL: "email",
  ADR: "address",
  URL: "url",
} as const

export function parseQrData(data: string) {
  if (!data.startsWith("BEGIN:VCARD"))
    return { mode: "url" as const, value: data, contact: EMPTY_CONTACT }
  const contact = { ...EMPTY_CONTACT }
  for (const line of data.split("\n")) {
    const [key, ...rest] = line.split(":")
    const field = VCARD_FIELDS[key as keyof typeof VCARD_FIELDS]
    if (field) contact[field] = rest.join(":")
  }
  return { mode: "contact" as const, value: "", contact }
}

export function useQrBuilder({
  design,
  add,
  patch,
  selected,
  editable,
  setMessage,
}: Params) {
  const [qrMode, setQrMode] = useState<"url" | "contact">("contact")
  const [qrValue, setQrValue] = useState("")
  const [qrContact, setQrContact] = useState(EMPTY_CONTACT)
  const [qrColor, setQrColor] = useState("#000000")
  const editingQr = selected?.type === "qr" && editable ? selected : undefined

  useEffect(() => {
    if (selected?.type !== "qr") return
    setQrColor(selected.fill)
    if (!selected.qrData) return
    const parsed = parseQrData(selected.qrData)
    setQrMode(parsed.mode)
    setQrValue(parsed.value)
    setQrContact(parsed.contact)
  }, [selected?.id])
  const addQr = () => {
    const value =
      qrMode === "url"
        ? qrValue.trim()
        : `BEGIN:VCARD\nVERSION:3.0\nFN:${qrContact.name}\nORG:${qrContact.company}\nTEL:${qrContact.phone}\nEMAIL:${qrContact.email}\nADR:${qrContact.address}\nURL:${qrContact.url}\nEND:VCARD`
    if (qrMode === "url" && !/^https?:\/\//i.test(value))
      return setMessage("웹주소는 https://로 시작해야 합니다.")
    if (qrMode === "contact" && !qrContact.name.trim())
      return setMessage("명함 QR에는 이름을 입력하세요.")
    try {
      const matrix = QRCode.create(value, { errorCorrectionLevel: "M" }).modules
      const qr = {
        qrBits: Array.from(matrix.data)
          .map((v) => (v ? "1" : "0"))
          .join(""),
        qrSize: matrix.size,
        qrData: value,
        fill: qrColor,
      }
      if (editingQr) return patch(editingQr.id, qr)
      const width = Math.min(design.widthMm, design.heightMm) * 0.25
      add("qr", { ...qr, width, height: width, name: "QR코드" })
    } catch {
      setMessage("QR코드를 만들 수 없습니다. 내용을 줄여 주세요.")
    }
  }

  return {
    qrMode,
    setQrMode,
    qrValue,
    setQrValue,
    qrContact,
    setQrContact,
    qrColor,
    setQrColor,
    addQr,
    editingQr: !!editingQr,
  }
}

export type QrBuilder = ReturnType<typeof useQrBuilder>

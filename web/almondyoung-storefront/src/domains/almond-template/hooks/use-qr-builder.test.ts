import { expect, it } from "vitest"
import { parseQrData } from "./use-qr-builder"

it("저장된 QR 내용을 입력 칸으로 되돌린다", () => {
  expect(parseQrData("https://almondyoung.com")).toMatchObject({
    mode: "url",
    value: "https://almondyoung.com",
  })
  const vcard =
    "BEGIN:VCARD\nVERSION:3.0\nFN:홍길동\nORG:아몬드영\nTEL:010-1234-5678\nEMAIL:a@b.c\nADR:서울\nURL:https://a.b\nEND:VCARD"
  expect(parseQrData(vcard)).toEqual({
    mode: "contact",
    value: "",
    contact: {
      name: "홍길동",
      company: "아몬드영",
      phone: "010-1234-5678",
      email: "a@b.c",
      address: "서울",
      url: "https://a.b",
    },
  })
})

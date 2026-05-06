"use server"

import { api } from "@/lib/api/api"

interface RegisterFcmTokenDto {
  token: string
  platform: "web"
  deviceId?: string
  deviceModel?: string
  deviceName?: string
}

export async function registerFcmToken(dto: RegisterFcmTokenDto): Promise<void> {
  await api("notification", "/devices/fcm-token", {
    method: "POST",
    body: dto,
  })
}

export async function deactivateFcmToken(token: string): Promise<void> {
  await api("notification", "/devices/fcm-token", {
    method: "DELETE",
    body: { token },
  })
}

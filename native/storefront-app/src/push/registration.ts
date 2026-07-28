export type RegisterFcmTokenBody = {
  token: string
  platform: "android" | "ios"
  deviceId?: string
  deviceModel?: string
  deviceName?: string
}

export type DeviceInfo = {
  token: string
  deviceId?: string
  deviceModel?: string
  deviceName?: string
}

export type PushDeps = { fetch: typeof fetch; baseUrl: string }

/** notification 서비스의 RegisterFcmTokenDto 에 맞춘 payload. */
export function buildRegistrationPayload(input: DeviceInfo): RegisterFcmTokenBody {
  return {
    token: input.token,
    platform: "android",
    ...(input.deviceId ? { deviceId: input.deviceId } : {}),
    ...(input.deviceModel ? { deviceModel: input.deviceModel } : {}),
    ...(input.deviceName ? { deviceName: input.deviceName } : {}),
  }
}

async function call(
  deps: PushDeps,
  method: "POST" | "DELETE",
  accessToken: string,
  body: unknown,
): Promise<void> {
  const res = await deps.fetch(`${deps.baseUrl}/devices/fcm-token`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new Error(`fcm-token ${method} 실패: ${res.status} ${await res.text()}`)
  }
}

export function registerFcmToken(
  deps: PushDeps,
  input: { accessToken: string; payload: RegisterFcmTokenBody },
): Promise<void> {
  return call(deps, "POST", input.accessToken, input.payload)
}

export function deactivateFcmToken(
  deps: PushDeps,
  input: { accessToken: string; token: string },
): Promise<void> {
  return call(deps, "DELETE", input.accessToken, { token: input.token })
}

export const shouldRejectCallbackStatus = (
  status: string | null,
  mode: string | null
) => mode !== "membership" && status !== "succeeded"

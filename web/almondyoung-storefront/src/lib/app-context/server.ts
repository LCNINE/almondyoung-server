import "server-only"

import { headers } from "next/headers"

import { APP_CONTEXT_HEADER, AppContext, deserializeAppContext } from "./parse"

/** 서버 컴포넌트에서 앱 컨텍스트를 읽는다. 웹 브라우저면 null. */
export async function getAppContext(): Promise<AppContext | null> {
  const h = await headers()
  return deserializeAppContext(h.get(APP_CONTEXT_HEADER))
}

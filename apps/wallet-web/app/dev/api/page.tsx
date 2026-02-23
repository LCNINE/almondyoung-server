"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

interface ApiPreset {
  id: string;
  name: string;
  method: HttpMethod;
  pathTemplate: string;
  bodyText?: string;
}

interface ApiConsoleState {
  baseUrl: string;
  authToken: string;
  method: HttpMethod;
  pathTemplate: string;
  intentId: string;
  legId: string;
  refundId: string;
  headersText: string;
  bodyText: string;
  includeCorrelationId: boolean;
  correlationId: string;
  actorId: string;
  idempotencyKey: string;
}

interface ProxyResponsePayload {
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: unknown;
  };
  response: {
    ok: boolean;
    status: number;
    statusText: string;
    elapsedMs: number;
    headers: Record<string, string>;
    bodyText: string;
    bodyJson: unknown | null;
  };
}

const CONSOLE_STORAGE_KEY = "wallet-web:dev-api-console:v2";
const PRESET_STORAGE_KEY = "wallet-web:dev-api-presets:v2";
const SELECTED_PRESET_STORAGE_KEY = "wallet-web:dev-api-selected-preset:v2";

const BUILTIN_PRESETS: ApiPreset[] = [
  {
    id: "builtin-create-intent",
    name: "Create Intent",
    method: "POST",
    pathTemplate: "/v1/intents",
    bodyText: JSON.stringify(
      {
        referenceType: "STORE_ORDER",
        referenceId: "dev-order-001",
        userId: "dev-user-001",
        currency: "KRW",
        payableAmount: 10000,
        snapshotPayload: {
          schemaVersion: "INTENT_SNAPSHOT_V1",
          items: [
            {
              lineId: "line-1",
              name: "Product A",
              type: "PRODUCT",
              id: "product-001",
              unitPrice: 12000,
              quantity: 1,
              discounts: [
                {
                  discountId: "item-per-unit-1",
                  kind: "ITEM_PER_UNIT",
                  amount: 1000,
                },
                {
                  discountId: "item-flat-1",
                  kind: "ITEM_FLAT",
                  amount: 1000,
                },
              ],
            },
            {
              lineId: "line-2",
              name: "Shipping Fee",
              type: "SHIPPING_FEE",
              unitPrice: 2000,
              quantity: 1,
              discounts: [],
            },
          ],
          orderDiscounts: [
            {
              discountId: "order-discount-1",
              kind: "ORDER",
              amount: 2000,
            },
          ],
        },
        signature: "dev-signature",
        signatureVersion: "v1",
        signedAt: "2026-02-21T00:00:00.000Z",
        metadata: {
          source: "wallet-web-dev-console",
        },
      },
      null,
      2
    ),
  },
  {
    id: "builtin-get-intent",
    name: "Get Intent",
    method: "GET",
    pathTemplate: "/v1/intents/:intentId",
  },
  {
    id: "builtin-configure-legs",
    name: "Configure Legs",
    method: "PUT",
    pathTemplate: "/v1/intents/:intentId/legs",
    bodyText: JSON.stringify(
      {
        legs: [
          {
            providerType: "POINTS",
            amount: 10000,
            sequenceNo: 1,
            isRequired: true,
            metadata: {},
          },
        ],
      },
      null,
      2
    ),
  },
  {
    id: "builtin-authorize-leg",
    name: "Authorize Leg",
    method: "POST",
    pathTemplate: "/v1/intents/:intentId/legs/:legId/authorize",
  },
  {
    id: "builtin-capture-leg",
    name: "Capture Leg",
    method: "POST",
    pathTemplate: "/v1/intents/:intentId/legs/:legId/capture",
  },
  {
    id: "builtin-cancel-intent",
    name: "Cancel Intent",
    method: "POST",
    pathTemplate: "/v1/intents/:intentId/cancel",
  },
  {
    id: "builtin-supersede-intent",
    name: "Supersede Intent",
    method: "POST",
    pathTemplate: "/v1/intents/:intentId/supersede",
  },
  {
    id: "builtin-create-refund-request",
    name: "Create Refund Request",
    method: "POST",
    pathTemplate: "/v1/intents/:intentId/refund-requests",
    bodyText: JSON.stringify(
      {
        refundAmount: 5000,
        allocation: [
          {
            legId: "{{legId}}",
            amount: 5000,
          },
        ],
        reasonCode: "CUSTOMER_REQUEST",
        reasonMessage: "dev refund request",
      },
      null,
      2
    ),
  },
  {
    id: "builtin-get-refund-request",
    name: "Get Refund Request",
    method: "GET",
    pathTemplate: "/v1/refund-requests/:refundId",
  },
  {
    id: "builtin-retry-intent-reconcile",
    name: "Retry Intent Reconcile",
    method: "POST",
    pathTemplate: "/v1/admin/intents/:intentId/reconcile/retry",
    bodyText: JSON.stringify(
      {
        reasonCode: "DEV_RETRY",
        reasonMessage: "retry by dev api console",
        force: true,
      },
      null,
      2
    ),
  },
  {
    id: "builtin-retry-leg-reconcile",
    name: "Retry Leg Reconcile",
    method: "POST",
    pathTemplate: "/v1/admin/legs/:legId/reconcile/retry",
    bodyText: JSON.stringify(
      {
        reasonCode: "DEV_RETRY",
        reasonMessage: "retry by dev api console",
        force: true,
      },
      null,
      2
    ),
  },
];

const DEFAULT_PRESET = BUILTIN_PRESETS[1] ?? BUILTIN_PRESETS[0];
const DEFAULT_SELECTED_PRESET_ID = DEFAULT_PRESET?.id ?? "";

const DEFAULT_STATE: ApiConsoleState = {
  baseUrl: "http://localhost:3000",
  authToken: "",
  method: DEFAULT_PRESET?.method ?? "GET",
  pathTemplate: DEFAULT_PRESET?.pathTemplate ?? "/v1/intents/:intentId",
  intentId: "",
  legId: "",
  refundId: "",
  headersText: JSON.stringify({}, null, 2),
  bodyText: "",
  includeCorrelationId: true,
  correlationId: "",
  actorId: "",
  idempotencyKey: "",
};

function isHttpMethod(value: unknown): value is HttpMethod {
  return (
    value === "GET" ||
    value === "POST" ||
    value === "PUT" ||
    value === "PATCH" ||
    value === "DELETE"
  );
}

function createPresetId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `custom-${Date.now()}-${random}`;
}

function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `idem-${crypto.randomUUID()}`;
  }
  const random = Math.random().toString(36).slice(2, 10);
  return `idem-${Date.now()}-${random}`;
}

function normalizePresets(input: unknown): ApiPreset[] {
  if (!Array.isArray(input)) {
    return BUILTIN_PRESETS;
  }

  const normalized: ApiPreset[] = [];

  for (const item of input) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      continue;
    }

    const raw = item as Partial<ApiPreset>;
    const name = String(raw.name ?? "").trim();
    const pathTemplate = String(raw.pathTemplate ?? "").trim();
    const method = raw.method;

    if (!name || !pathTemplate || !isHttpMethod(method)) {
      continue;
    }

    normalized.push({
      id: String(raw.id ?? createPresetId()),
      name,
      method,
      pathTemplate,
      bodyText: typeof raw.bodyText === "string" ? raw.bodyText : "",
    });
  }

  return normalized.length > 0 ? normalized : BUILTIN_PRESETS;
}

function cloneBuiltinPresets(): ApiPreset[] {
  return BUILTIN_PRESETS.map((preset) => ({ ...preset }));
}

function statusBadgeVariant(status: number): "default" | "secondary" | "outline" | "destructive" {
  if (status >= 200 && status < 300) {
    return "default";
  }
  if (status >= 400) {
    return "destructive";
  }
  if (status >= 300) {
    return "secondary";
  }
  return "outline";
}

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString("ko-KR");
}

function safeParseJsonObject(
  input: string,
  fieldName: string
): { ok: true; value: Record<string, string> } | { ok: false; message: string } {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: true, value: {} };
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {
        ok: false,
        message: `${fieldName} must be a JSON object`,
      };
    }

    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      normalized[key] = String(value);
    }

    return { ok: true, value: normalized };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? `${fieldName} JSON parse error: ${error.message}`
          : `${fieldName} JSON parse error`,
    };
  }
}

function interpolateText(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? "");
}

function resolvePathTemplate(pathTemplate: string, vars: Record<string, string>): string {
  return pathTemplate.replace(/:(intentId|legId|refundId)/g, (_, key: string) => {
    const value = vars[key];
    return value ? encodeURIComponent(value) : `:${key}`;
  });
}

function tryParseBody(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalizeJsonValue(value: unknown): string {
  if (value === null) {
    return "null";
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("snapshotPayload contains non-finite number");
    }

    const serialized = JSON.stringify(value);
    if (!serialized) {
      throw new Error("snapshotPayload number serialization failed");
    }

    if (serialized.includes("e") || serialized.includes("E")) {
      throw new Error("snapshotPayload number cannot use exponential notation");
    }

    return serialized;
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeJsonValue(item)).join(",")}]`;
  }

  if (isPlainObject(value)) {
    const sortedKeys = Object.keys(value).sort();
    const serializedPairs: string[] = [];

    for (const key of sortedKeys) {
      const propertyValue = value[key];
      if (propertyValue === undefined) {
        continue;
      }
      serializedPairs.push(
        `${JSON.stringify(key)}:${canonicalizeJsonValue(propertyValue)}`,
      );
    }

    return `{${serializedPairs.join(",")}}`;
  }

  throw new Error(
    `snapshotPayload includes unsupported type: ${Object.prototype.toString.call(value)}`,
  );
}

function canonicalizeSnapshotPayload(snapshotPayload: unknown): string {
  return canonicalizeJsonValue(snapshotPayload);
}

async function computePayloadHash(canonicalPayload: string): Promise<string> {
  if (!crypto?.subtle) {
    throw new Error("Web Crypto API is not available in this browser");
  }

  const bytes = new TextEncoder().encode(canonicalPayload);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function buildSigningString(
  signatureVersion: string,
  signedAt: string,
  payloadHash: string,
): string {
  return `${signatureVersion}\n${signedAt}\n${payloadHash}`;
}

function toBase64Url(input: Uint8Array): string {
  let binary = "";
  for (const byte of input) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function computeHmacSignature(
  sharedSecret: string,
  signingString: string,
): Promise<string> {
  if (!crypto?.subtle) {
    throw new Error("Web Crypto API is not available in this browser");
  }

  const keyBytes = new TextEncoder().encode(sharedSecret);
  const messageBytes = new TextEncoder().encode(signingString);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const rawSignature = await crypto.subtle.sign("HMAC", cryptoKey, messageBytes);
  return toBase64Url(new Uint8Array(rawSignature));
}

function buildCurlCommand(payload: {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}): string {
  const lines: string[] = [`curl -X ${payload.method} '${payload.url}'`];

  for (const [key, value] of Object.entries(payload.headers)) {
    lines.push(`  -H '${key}: ${String(value).replace(/'/g, "'\\''")}'`);
  }

  if (payload.body !== undefined && payload.body !== null && payload.method !== "GET") {
    const bodyString =
      typeof payload.body === "string"
        ? payload.body
        : JSON.stringify(payload.body, null, 2);
    lines.push(`  --data-raw '${bodyString.replace(/'/g, "'\\''")}'`);
  }

  return lines.join(" \\\n");
}

export default function DevApiConsolePage() {
  const [state, setState] = useState<ApiConsoleState>(DEFAULT_STATE);
  const [presets, setPresets] = useState<ApiPreset[]>(cloneBuiltinPresets());
  const [selectedPresetId, setSelectedPresetId] = useState(
    DEFAULT_SELECTED_PRESET_ID
  );
  const [isPresetSheetOpen, setIsPresetSheetOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastExecutedAt, setLastExecutedAt] = useState<string | null>(null);
  const [result, setResult] = useState<ProxyResponsePayload | null>(null);
  const [lastCurl, setLastCurl] = useState("");
  const [hmacSharedSecret, setHmacSharedSecret] = useState("");
  const [lastSignedAt, setLastSignedAt] = useState<string | null>(null);

  useEffect(() => {
    const rawState = localStorage.getItem(CONSOLE_STORAGE_KEY);
    const rawPresets = localStorage.getItem(PRESET_STORAGE_KEY);
    const rawSelectedPresetId = localStorage.getItem(SELECTED_PRESET_STORAGE_KEY);

    try {
      if (rawState) {
        const parsed = JSON.parse(rawState) as Partial<ApiConsoleState>;
        setState((prev) => ({
          ...prev,
          ...parsed,
        }));
      }

      if (rawPresets) {
        const parsedPresets = JSON.parse(rawPresets) as unknown;
        const nextPresets = normalizePresets(parsedPresets);
        setPresets(nextPresets);
      }

      if (rawSelectedPresetId) {
        setSelectedPresetId(rawSelectedPresetId);
      }
    } catch {
      // ignore broken local cache
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(CONSOLE_STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  useEffect(() => {
    localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(presets));
  }, [presets]);

  useEffect(() => {
    if (!selectedPresetId) {
      localStorage.removeItem(SELECTED_PRESET_STORAGE_KEY);
      return;
    }
    localStorage.setItem(SELECTED_PRESET_STORAGE_KEY, selectedPresetId);
  }, [selectedPresetId]);

  useEffect(() => {
    if (presets.some((preset) => preset.id === selectedPresetId)) {
      return;
    }
    setSelectedPresetId(presets[0]?.id ?? "");
  }, [presets, selectedPresetId]);

  const resolvedPath = useMemo(() => {
    return resolvePathTemplate(state.pathTemplate, {
      intentId: state.intentId.trim(),
      legId: state.legId.trim(),
      refundId: state.refundId.trim(),
    });
  }, [state.pathTemplate, state.intentId, state.legId, state.refundId]);

  const canSend = Boolean(state.baseUrl.trim() && resolvedPath.trim());

  const onPresetChange = (presetId: string): void => {
    setSelectedPresetId(presetId);
    if (!presetId) {
      return;
    }

    const preset = presets.find((item) => item.id === presetId);
    if (!preset) {
      return;
    }

    setState((prev) => ({
      ...prev,
      method: preset.method,
      pathTemplate: preset.pathTemplate,
      bodyText: preset.bodyText ?? "",
    }));
  };

  const updatePreset = (presetId: string, patch: Partial<ApiPreset>): void => {
    setPresets((prev) =>
      prev.map((preset) => {
        if (preset.id !== presetId) {
          return preset;
        }

        return {
          ...preset,
          ...patch,
        };
      })
    );
  };

  const addPresetFromCurrent = (): void => {
    const nextPreset: ApiPreset = {
      id: createPresetId(),
      name: `Custom ${presets.length + 1}`,
      method: state.method,
      pathTemplate: state.pathTemplate,
      bodyText: state.bodyText,
    };

    setPresets((prev) => [nextPreset, ...prev]);
    setSelectedPresetId(nextPreset.id);
  };

  const overwritePresetFromCurrent = (presetId: string): void => {
    updatePreset(presetId, {
      method: state.method,
      pathTemplate: state.pathTemplate,
      bodyText: state.bodyText,
    });
  };

  const removePreset = (presetId: string): void => {
    setPresets((prev) => {
      const next = prev.filter((preset) => preset.id !== presetId);

      if (next.length === 0) {
        const fallback = {
          ...BUILTIN_PRESETS[0],
          id: createPresetId(),
          name: "Custom 1",
        };
        setSelectedPresetId(fallback.id);
        return [fallback];
      }

      if (selectedPresetId === presetId) {
        setSelectedPresetId(next[0].id);
      }

      return next;
    });
  };

  const resetPresetsToDefault = (): void => {
    const cloned = cloneBuiltinPresets();
    setPresets(cloned);
    setSelectedPresetId(cloned[0]?.id ?? "");
  };

  const onReset = (): void => {
    setState(DEFAULT_STATE);
    setError(null);
    setResult(null);
    setLastCurl("");
  };

  const onGenerateCorrelation = (): void => {
    const nextValue =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}`;
    setState((prev) => ({ ...prev, correlationId: nextValue }));
  };

  const onGenerateIdempotencyKey = (): void => {
    setState((prev) => ({ ...prev, idempotencyKey: createIdempotencyKey() }));
  };

  const onGenerateIntentSignature = async (): Promise<void> => {
    setError(null);

    try {
      const sharedSecret = hmacSharedSecret.trim();
      if (!sharedSecret) {
        throw new Error("HMAC shared secret is required");
      }

      const vars = {
        intentId: state.intentId.trim(),
        legId: state.legId.trim(),
        refundId: state.refundId.trim(),
      };
      const bodySource = interpolateText(state.bodyText, vars);
      const parsedBody = tryParseBody(bodySource);

      if (
        typeof parsedBody !== "object" ||
        parsedBody === null ||
        Array.isArray(parsedBody)
      ) {
        throw new Error("Body must be a JSON object to generate signature");
      }

      const bodyObject = parsedBody as Record<string, unknown>;
      if (!("snapshotPayload" in bodyObject)) {
        throw new Error("Body must include snapshotPayload");
      }

      const signedAt = new Date().toISOString();
      const signatureVersion = "v1";
      const canonicalPayload = canonicalizeSnapshotPayload(
        bodyObject.snapshotPayload,
      );
      const payloadHash = await computePayloadHash(canonicalPayload);
      const signingString = buildSigningString(
        signatureVersion,
        signedAt,
        payloadHash,
      );
      const signature = await computeHmacSignature(sharedSecret, signingString);

      const nextBody = {
        ...bodyObject,
        signatureVersion,
        signedAt,
        signature,
      };

      setState((prev) => ({
        ...prev,
        bodyText: JSON.stringify(nextBody, null, 2),
      }));
      setLastSignedAt(signedAt);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unknown signature generation error",
      );
    }
  };

  const onSendRequest = async (): Promise<void> => {
    setError(null);
    setLoading(true);

    try {
      const vars = {
        intentId: state.intentId.trim(),
        legId: state.legId.trim(),
        refundId: state.refundId.trim(),
      };

      const interpolatedPath = interpolateText(
        resolvePathTemplate(state.pathTemplate, vars),
        vars
      );

      const headersParsed = safeParseJsonObject(
        interpolateText(state.headersText, vars),
        "headers"
      );
      if (!headersParsed.ok) {
        throw new Error(headersParsed.message);
      }

      const headers: Record<string, string> = { ...headersParsed.value };
      if (state.authToken.trim()) {
        headers.authorization = `Bearer ${state.authToken.trim()}`;
      }
      if (state.includeCorrelationId) {
        let correlation = state.correlationId.trim();
        if (!correlation) {
          correlation =
            typeof crypto !== "undefined" && crypto.randomUUID
              ? crypto.randomUUID()
              : `${Date.now()}`;
          setState((prev) => ({ ...prev, correlationId: correlation }));
        }
        headers["x-correlation-id"] = correlation;
      }
      if (state.actorId.trim()) {
        headers["x-actor-id"] = state.actorId.trim();
      }
      if (state.method !== "GET") {
        let idempotencyKey = state.idempotencyKey.trim();
        if (!idempotencyKey) {
          idempotencyKey = createIdempotencyKey();
          setState((prev) => ({ ...prev, idempotencyKey }));
        }
        for (const key of Object.keys(headers)) {
          if (key.toLowerCase() === "idempotency-key") {
            delete headers[key];
          }
        }
        headers["Idempotency-Key"] = idempotencyKey;
      }

      const bodySource = interpolateText(state.bodyText, vars);
      const body = tryParseBody(bodySource);

      const payload = {
        baseUrl: state.baseUrl.trim(),
        path: interpolatedPath,
        method: state.method,
        headers,
        body,
      };

      const endpoint = new URL(interpolatedPath, state.baseUrl.trim()).toString();
      setLastCurl(
        buildCurlCommand({
          method: state.method,
          url: endpoint,
          headers,
          body,
        })
      );

      const response = await fetch("/api/dev/http-proxy", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const responseBody = (await response.json()) as ProxyResponsePayload | {
        message?: string;
      };

      if (!response.ok) {
        throw new Error(
          "message" in responseBody && responseBody.message
            ? responseBody.message
            : `HTTP ${response.status}`
        );
      }

      setResult(responseBody as ProxyResponsePayload);
      setLastExecutedAt(new Date().toISOString());
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unknown request error"
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-7xl space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="outline">
          <Link href="/dev/intents">Intent Explorer</Link>
        </Button>
        <Button asChild variant="default">
          <Link href="/dev/api">API Console</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/dev/signature">Signature Utility</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/dev/points">Points Manager</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Wallet Dev: API Console</CardTitle>
          <CardDescription>
            원하는 파라미터로 Wallet API를 호출하고 응답을 바로 확인합니다. 설정은 localStorage에 저장됩니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <Input
              placeholder="Backend Base URL (e.g. http://localhost:3000)"
              value={state.baseUrl}
              onChange={(event) =>
                setState((prev) => ({ ...prev, baseUrl: event.target.value }))
              }
            />
            <Input
              placeholder="Bearer Token (optional)"
              value={state.authToken}
              onChange={(event) =>
                setState((prev) => ({ ...prev, authToken: event.target.value }))
              }
            />
            <div className="flex gap-2">
              <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg border px-2.5 text-sm">
                <span className="text-muted-foreground text-xs">preset</span>
                <select
                  className="w-full bg-transparent outline-none"
                  value={selectedPresetId}
                  onChange={(event) => onPresetChange(event.target.value)}
                >
                  {presets.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.name}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsPresetSheetOpen(true)}
              >
                Presets
              </Button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="flex h-8 items-center gap-2 rounded-lg border px-2.5 text-sm">
              <span className="text-muted-foreground text-xs">method</span>
              <select
                className="w-full bg-transparent outline-none"
                value={state.method}
                onChange={(event) =>
                  setState((prev) => ({
                    ...prev,
                    method: event.target.value as HttpMethod,
                  }))
                }
              >
                <option value="GET">GET</option>
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
                <option value="PATCH">PATCH</option>
                <option value="DELETE">DELETE</option>
              </select>
            </label>
            <Button type="button" variant="outline" onClick={addPresetFromCurrent}>
              Save As New Preset
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => overwritePresetFromCurrent(selectedPresetId)}
              disabled={!selectedPresetId}
            >
              Overwrite Selected Preset
            </Button>
            <Button type="button" variant="outline" onClick={resetPresetsToDefault}>
              Reset Presets
            </Button>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <Input
              placeholder="intentId"
              value={state.intentId}
              onChange={(event) =>
                setState((prev) => ({ ...prev, intentId: event.target.value }))
              }
            />
            <Input
              placeholder="legId"
              value={state.legId}
              onChange={(event) =>
                setState((prev) => ({ ...prev, legId: event.target.value }))
              }
            />
            <Input
              placeholder="refundId"
              value={state.refundId}
              onChange={(event) =>
                setState((prev) => ({ ...prev, refundId: event.target.value }))
              }
            />
          </div>

          <Input
            placeholder="/v1/intents/:intentId"
            value={state.pathTemplate}
            onChange={(event) =>
              setState((prev) => ({ ...prev, pathTemplate: event.target.value }))
            }
          />

          <div className="rounded-md border p-2 text-xs">
            <p className="text-muted-foreground">resolved path</p>
            <p className="font-mono">{resolvedPath}</p>
          </div>

          <div className="grid gap-3 xl:grid-cols-2">
            <div className="space-y-2">
              <p className="text-sm font-medium">headers JSON</p>
              <Textarea
                className="min-h-36 font-mono text-xs"
                value={state.headersText}
                onChange={(event) =>
                  setState((prev) => ({ ...prev, headersText: event.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">body (JSON or raw text)</p>
              <Textarea
                className="min-h-36 font-mono text-xs"
                value={state.bodyText}
                onChange={(event) =>
                  setState((prev) => ({ ...prev, bodyText: event.target.value }))
                }
              />
            </div>
          </div>

          <div className="space-y-2 rounded-md border p-3">
            <p className="text-sm font-medium">intent signature helper</p>
            <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
              <Input
                type="password"
                placeholder="WALLET_HMAC_SHARED_SECRET (not saved)"
                value={hmacSharedSecret}
                onChange={(event) => setHmacSharedSecret(event.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  void onGenerateIntentSignature();
                }}
              >
                Sign Intent Body (Now)
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              Uses current time + body.snapshotPayload and updates
              signatureVersion/signedAt/signature in body JSON.
            </p>
            {lastSignedAt ? (
              <p className="text-muted-foreground text-xs">
                last signed: {formatDateTime(lastSignedAt)}
              </p>
            ) : null}
          </div>

          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <label className="flex h-8 items-center gap-2 rounded-lg border px-2.5 text-sm">
              <input
                type="checkbox"
                checked={state.includeCorrelationId}
                onChange={(event) =>
                  setState((prev) => ({
                    ...prev,
                    includeCorrelationId: event.target.checked,
                  }))
                }
              />
              include x-correlation-id
            </label>
            <Input
              placeholder="x-correlation-id (empty => auto)"
              value={state.correlationId}
              onChange={(event) =>
                setState((prev) => ({ ...prev, correlationId: event.target.value }))
              }
            />
            <Input
              placeholder="x-actor-id (optional)"
              value={state.actorId}
              onChange={(event) =>
                setState((prev) => ({ ...prev, actorId: event.target.value }))
              }
            />
            <Input
              placeholder="Idempotency-Key (write required; empty => auto)"
              value={state.idempotencyKey}
              onChange={(event) =>
                setState((prev) => ({ ...prev, idempotencyKey: event.target.value }))
              }
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={onSendRequest} disabled={!canSend || loading}>
              {loading ? "Sending..." : "Send Request"}
            </Button>
            <Button type="button" variant="outline" onClick={onGenerateCorrelation}>
              Generate Correlation ID
            </Button>
            <Button type="button" variant="outline" onClick={onGenerateIdempotencyKey}>
              Generate Idempotency Key
            </Button>
            <Button type="button" variant="outline" onClick={onReset}>
              Reset
            </Button>
            {lastExecutedAt ? (
              <span className="text-muted-foreground text-xs">
                last executed: {formatDateTime(lastExecutedAt)}
              </span>
            ) : null}
          </div>

          {error ? <p className="text-destructive text-sm font-medium">{error}</p> : null}
        </CardContent>
      </Card>

      {lastCurl ? (
        <Card>
          <CardHeader>
            <CardTitle>cURL Preview</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="bg-muted/40 overflow-x-auto rounded-md border p-3 text-xs">
              {lastCurl}
            </pre>
          </CardContent>
        </Card>
      ) : null}

      {result ? (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>Response</CardTitle>
              <Badge variant={statusBadgeVariant(result.response.status)}>
                {result.response.status} {result.response.statusText}
              </Badge>
              <Badge variant="outline">{result.response.elapsedMs} ms</Badge>
            </div>
            <CardDescription className="font-mono text-xs">
              {result.request.method} {result.request.url}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <details open className="rounded-md border p-2">
              <summary className="cursor-pointer text-sm font-medium">Response Body</summary>
              <pre className="bg-muted/40 mt-2 overflow-x-auto rounded-md border p-3 text-xs">
                {result.response.bodyJson !== null
                  ? JSON.stringify(result.response.bodyJson, null, 2)
                  : result.response.bodyText || "(empty)"}
              </pre>
            </details>

            <details className="rounded-md border p-2">
              <summary className="cursor-pointer text-sm font-medium">Request Headers</summary>
              <pre className="bg-muted/40 mt-2 overflow-x-auto rounded-md border p-3 text-xs">
                {JSON.stringify(result.request.headers, null, 2)}
              </pre>
            </details>

            <details className="rounded-md border p-2">
              <summary className="cursor-pointer text-sm font-medium">Response Headers</summary>
              <pre className="bg-muted/40 mt-2 overflow-x-auto rounded-md border p-3 text-xs">
                {JSON.stringify(result.response.headers, null, 2)}
              </pre>
            </details>
          </CardContent>
        </Card>
      ) : null}

      <Sheet open={isPresetSheetOpen} onOpenChange={setIsPresetSheetOpen}>
        <SheetContent side="right" className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Preset Sheet</SheetTitle>
            <SheetDescription>
              프리셋 생성/수정/삭제를 관리합니다. localStorage에 저장됩니다.
            </SheetDescription>
          </SheetHeader>
          <SheetFooter className="mt-3">
            <Button type="button" variant="outline" onClick={addPresetFromCurrent}>
              New From Form
            </Button>
            <SheetClose asChild>
              <Button type="button">Close</Button>
            </SheetClose>
          </SheetFooter>

          <div className="mt-4 space-y-3">
            {presets.map((preset) => (
              <Card key={preset.id} className="gap-2">
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="text-sm">{preset.name || "(unnamed)"}</CardTitle>
                    <div className="flex gap-2">
                      {selectedPresetId === preset.id ? (
                        <Badge variant="default">Selected</Badge>
                      ) : (
                        <Badge variant="outline">Preset</Badge>
                      )}
                      <Badge variant="secondary">{preset.method}</Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="grid gap-2 md:grid-cols-2">
                    <Input
                      placeholder="Preset Name"
                      value={preset.name}
                      onChange={(event) =>
                        updatePreset(preset.id, { name: event.target.value })
                      }
                    />
                    <label className="flex h-8 items-center gap-2 rounded-lg border px-2.5 text-sm">
                      <span className="text-muted-foreground text-xs">method</span>
                      <select
                        className="w-full bg-transparent outline-none"
                        value={preset.method}
                        onChange={(event) =>
                          updatePreset(preset.id, {
                            method: event.target.value as HttpMethod,
                          })
                        }
                      >
                        <option value="GET">GET</option>
                        <option value="POST">POST</option>
                        <option value="PUT">PUT</option>
                        <option value="PATCH">PATCH</option>
                        <option value="DELETE">DELETE</option>
                      </select>
                    </label>
                  </div>

                  <Input
                    placeholder="/v1/intents/:intentId"
                    value={preset.pathTemplate}
                    onChange={(event) =>
                      updatePreset(preset.id, {
                        pathTemplate: event.target.value,
                      })
                    }
                  />

                  <Textarea
                    className="min-h-28 font-mono text-xs"
                    placeholder="Body template"
                    value={preset.bodyText ?? ""}
                    onChange={(event) =>
                      updatePreset(preset.id, {
                        bodyText: event.target.value,
                      })
                    }
                  />

                  <div className="flex flex-wrap gap-2">
                    <Button type="button" onClick={() => onPresetChange(preset.id)}>
                      Apply
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => overwritePresetFromCurrent(preset.id)}
                    >
                      Use Current Form Values
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={() => removePreset(preset.id)}
                    >
                      Delete
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </main>
  );
}

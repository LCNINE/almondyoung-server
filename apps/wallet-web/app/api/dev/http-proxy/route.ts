import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

interface ProxyRequestBody {
  baseUrl: string;
  path: string;
  method: string;
  headers?: Record<string, string>;
  body?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildTargetUrl(baseUrl: string, path: string): URL {
  const normalizedBase = baseUrl.trim().replace(/\/+$/, "");
  const normalizedPath = path.trim().startsWith("/")
    ? path.trim()
    : `/${path.trim()}`;
  return new URL(`${normalizedBase}${normalizedPath}`);
}

function sanitizeRequestHeaders(
  input: Record<string, string> | undefined
): Headers {
  const output = new Headers();
  if (!input) {
    return output;
  }

  const blocked = new Set([
    "host",
    "content-length",
    "connection",
    "transfer-encoding",
  ]);

  for (const [rawKey, rawValue] of Object.entries(input)) {
    const key = rawKey.trim();
    const value = String(rawValue ?? "").trim();
    if (!key || !value) {
      continue;
    }
    if (blocked.has(key.toLowerCase())) {
      continue;
    }
    output.set(key, value);
  }

  return output;
}

function parseResponseBody(rawBody: string): {
  bodyText: string;
  bodyJson: unknown | null;
} {
  if (!rawBody) {
    return { bodyText: "", bodyJson: null };
  }

  try {
    return {
      bodyText: rawBody,
      bodyJson: JSON.parse(rawBody),
    };
  } catch {
    return {
      bodyText: rawBody,
      bodyJson: null,
    };
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const json = (await req.json()) as ProxyRequestBody;
    const baseUrl = String(json.baseUrl ?? "").trim();
    const path = String(json.path ?? "").trim();
    const method = String(json.method ?? "GET").toUpperCase();

    if (!baseUrl) {
      return NextResponse.json(
        { message: "baseUrl is required" },
        { status: 400 }
      );
    }

    if (!path) {
      return NextResponse.json(
        { message: "path is required" },
        { status: 400 }
      );
    }

    if (!ALLOWED_METHODS.has(method)) {
      return NextResponse.json(
        { message: `method must be one of: ${Array.from(ALLOWED_METHODS).join(", ")}` },
        { status: 400 }
      );
    }

    const targetUrl = buildTargetUrl(baseUrl, path);
    if (!["http:", "https:"].includes(targetUrl.protocol)) {
      return NextResponse.json(
        { message: "Only http/https protocols are supported" },
        { status: 400 }
      );
    }

    const headers = sanitizeRequestHeaders(json.headers);

    let upstreamBody: string | undefined;
    if (method !== "GET" && method !== "HEAD" && json.body !== undefined) {
      if (typeof json.body === "string") {
        upstreamBody = json.body;
      } else if (json.body === null) {
        upstreamBody = "null";
        if (!headers.has("content-type")) {
          headers.set("content-type", "application/json");
        }
      } else if (isRecord(json.body) || Array.isArray(json.body)) {
        upstreamBody = JSON.stringify(json.body);
        if (!headers.has("content-type")) {
          headers.set("content-type", "application/json");
        }
      } else {
        upstreamBody = String(json.body);
      }
    }

    const startedAt = Date.now();
    const upstreamResponse = await fetch(targetUrl.toString(), {
      method,
      headers,
      body: upstreamBody,
      cache: "no-store",
      redirect: "manual",
    });
    const elapsedMs = Date.now() - startedAt;

    const responseHeaders = Object.fromEntries(upstreamResponse.headers.entries());
    const rawBody = await upstreamResponse.text();
    const parsed = parseResponseBody(rawBody);

    return NextResponse.json({
      request: {
        method,
        url: targetUrl.toString(),
        headers: Object.fromEntries(headers.entries()),
        body: json.body ?? null,
      },
      response: {
        ok: upstreamResponse.ok,
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        elapsedMs,
        headers: responseHeaders,
        bodyText: parsed.bodyText,
        bodyJson: parsed.bodyJson,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown proxy error";
    return NextResponse.json({ message }, { status: 500 });
  }
}

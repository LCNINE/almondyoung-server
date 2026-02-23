"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

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
import { Textarea } from "@/components/ui/textarea";

interface SignatureResult {
  canonicalPayload: string;
  payloadHash: string;
  signingString: string;
  signature: string;
}

const DEFAULT_SNAPSHOT_PAYLOAD = {
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
};

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
      throw new Error("Snapshot payload contains non-finite number");
    }

    const serialized = JSON.stringify(value);
    if (!serialized) {
      throw new Error("Snapshot payload number serialization failed");
    }

    if (serialized.includes("e") || serialized.includes("E")) {
      throw new Error("Snapshot payload number cannot use exponential notation");
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
    `Snapshot payload includes unsupported type: ${Object.prototype.toString.call(value)}`,
  );
}

function canonicalizeSnapshotPayload(snapshotPayload: unknown): string {
  return canonicalizeJsonValue(snapshotPayload);
}

async function computePayloadHash(canonicalPayload: string): Promise<string> {
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

function isValidSignedAt(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

export default function DevSignaturePage() {
  const [sharedSecret, setSharedSecret] = useState("");
  const [signatureVersion, setSignatureVersion] = useState("v1");
  const [signedAt, setSignedAt] = useState(() => new Date().toISOString());
  const [snapshotPayloadText, setSnapshotPayloadText] = useState(
    JSON.stringify(DEFAULT_SNAPSHOT_PAYLOAD, null, 2),
  );
  const [result, setResult] = useState<SignatureResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [copiedField, setCopiedField] = useState("");

  const signedAtIsValid = useMemo(() => isValidSignedAt(signedAt), [signedAt]);

  const onSetNow = (): void => {
    setSignedAt(new Date().toISOString());
  };

  const onUseExample = (): void => {
    setSnapshotPayloadText(JSON.stringify(DEFAULT_SNAPSHOT_PAYLOAD, null, 2));
  };

  const onGenerate = async (): Promise<void> => {
    setLoading(true);
    setError("");
    setCopiedField("");

    try {
      if (!sharedSecret.trim()) {
        throw new Error("shared secret is required");
      }
      if (!signatureVersion.trim()) {
        throw new Error("signatureVersion is required");
      }
      if (!signedAt.trim()) {
        throw new Error("signedAt is required");
      }
      if (!signedAtIsValid) {
        throw new Error("signedAt must be a valid ISO-8601 timestamp");
      }

      const parsedSnapshot = JSON.parse(snapshotPayloadText) as unknown;
      const canonicalPayload = canonicalizeSnapshotPayload(parsedSnapshot);
      const payloadHash = await computePayloadHash(canonicalPayload);
      const signingString = buildSigningString(
        signatureVersion.trim(),
        signedAt.trim(),
        payloadHash,
      );
      const signature = await computeHmacSignature(
        sharedSecret.trim(),
        signingString,
      );

      setResult({
        canonicalPayload,
        payloadHash,
        signingString,
        signature,
      });
    } catch (caughtError) {
      setResult(null);
      setError(
        caughtError instanceof Error ? caughtError.message : "Unknown error",
      );
    } finally {
      setLoading(false);
    }
  };

  const onCopy = async (label: string, value: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(label);
      setTimeout(() => {
        setCopiedField((current) => (current === label ? "" : current));
      }, 1500);
    } catch {
      setError("Failed to copy. Please copy manually.");
    }
  };

  return (
    <main className="mx-auto w-full max-w-7xl space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="outline">
          <Link href="/dev/intents">Intent Explorer</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/dev/api">API Console</Link>
        </Button>
        <Button asChild variant="default">
          <Link href="/dev/signature">Signature Utility</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/dev/points">Points Manager</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Wallet Dev: Intent Signature Utility</CardTitle>
          <CardDescription>
            Generate the `signature` for create-intent requests using the same
            canonicalization and HMAC rules as wallet server.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Input
              type="password"
              placeholder="WALLET_HMAC_SHARED_SECRET"
              value={sharedSecret}
              onChange={(event) => setSharedSecret(event.target.value)}
            />
            <Input
              placeholder="signatureVersion (v1)"
              value={signatureVersion}
              onChange={(event) => setSignatureVersion(event.target.value)}
            />
            <Input
              placeholder="signedAt (ISO-8601)"
              value={signedAt}
              onChange={(event) => setSignedAt(event.target.value)}
            />
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onSetNow}>
                Set signedAt Now
              </Button>
              <Button type="button" variant="outline" onClick={onUseExample}>
                Use Example
              </Button>
            </div>
          </div>

          <div className="rounded-md border p-3">
            <p className="mb-2 text-sm font-semibold">snapshotPayload JSON</p>
            <Textarea
              className="min-h-[260px] font-mono text-xs"
              value={snapshotPayloadText}
              onChange={(event) => setSnapshotPayloadText(event.target.value)}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={onGenerate} disabled={loading}>
              {loading ? "Generating..." : "Generate Signature"}
            </Button>
            {signedAtIsValid ? (
              <Badge variant="outline">signedAt valid</Badge>
            ) : (
              <Badge variant="destructive">signedAt invalid</Badge>
            )}
            {copiedField ? (
              <Badge variant="secondary">{copiedField} copied</Badge>
            ) : null}
          </div>

          {error ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Output</CardTitle>
          <CardDescription>
            Copy `signature` into the create-intent request body.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <OutputField
            label="signature"
            value={result?.signature ?? ""}
            onCopy={onCopy}
            placeholder="Generate to see signature"
          />
          <OutputField
            label="payloadHash (sha256 hex)"
            value={result?.payloadHash ?? ""}
            onCopy={onCopy}
            placeholder="Generate to see payload hash"
          />
          <OutputField
            label="signingString"
            value={result?.signingString ?? ""}
            onCopy={onCopy}
            placeholder="Generate to see signing string"
            multiline
          />
          <OutputField
            label="canonicalPayload"
            value={result?.canonicalPayload ?? ""}
            onCopy={onCopy}
            placeholder="Generate to see canonical payload"
            multiline
          />
        </CardContent>
      </Card>
    </main>
  );
}

function OutputField({
  label,
  value,
  onCopy,
  placeholder,
  multiline = false,
}: {
  label: string;
  value: string;
  onCopy: (label: string, value: string) => Promise<void>;
  placeholder: string;
  multiline?: boolean;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{label}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!value}
          onClick={() => {
            void onCopy(label, value);
          }}
        >
          Copy
        </Button>
      </div>
      {multiline ? (
        <Textarea
          className="min-h-[120px] font-mono text-xs"
          readOnly
          value={value}
          placeholder={placeholder}
        />
      ) : (
        <Input
          className="font-mono text-xs"
          readOnly
          value={value}
          placeholder={placeholder}
        />
      )}
    </div>
  );
}

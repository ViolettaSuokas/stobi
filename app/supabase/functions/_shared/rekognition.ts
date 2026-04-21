// AWS Rekognition DetectModerationLabels wrapper for Supabase Edge Functions.
//
// Использует AWS Signature V4 напрямую (без aws-sdk), чтобы минимизировать
// размер bundle Deno-функции и холодный старт. SigV4 подписывает POST-запрос
// на endpoint rekognition.<region>.amazonaws.com.
//
// Требует secrets в Supabase Functions:
//   AWS_ACCESS_KEY_ID
//   AWS_SECRET_ACCESS_KEY
//   AWS_REGION (default 'eu-central-1' — Frankfurt, EU data residency)
//
// Возвращаемые labels — массив объектов { Name, Confidence, ParentName }.
// "Safe" = нет label с Confidence >= MIN_CONFIDENCE (default 80).

import { hmac, sha256Hex } from "./crypto.ts";

export type RekognitionLabel = {
  Name: string;
  Confidence: number;
  ParentName?: string;
};

export type ModerationResult = {
  safe: boolean;
  labels: RekognitionLabel[];
};

const MIN_CONFIDENCE = Number(Deno.env.get("NSFW_MIN_CONFIDENCE") ?? "80");

function getEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

/** Fetches the image at `photoUrl` as bytes, then sends base64 to Rekognition. */
export async function detectModeration(photoUrl: string): Promise<ModerationResult> {
  const accessKey = getEnv("AWS_ACCESS_KEY_ID");
  const secretKey = getEnv("AWS_SECRET_ACCESS_KEY");
  const region = Deno.env.get("AWS_REGION") ?? "eu-central-1";

  // 1. Скачиваем фото
  const imgRes = await fetch(photoUrl);
  if (!imgRes.ok) {
    throw new Error(`Failed to fetch image: ${imgRes.status}`);
  }
  const imgBytes = new Uint8Array(await imgRes.arrayBuffer());

  // 2. Rekognition ожидает либо S3 reference, либо base64 в теле запроса.
  // Для независимости от S3 — base64.
  const b64 = base64Encode(imgBytes);

  const body = JSON.stringify({
    Image: { Bytes: b64 },
    MinConfidence: MIN_CONFIDENCE,
  });

  // 3. Sig V4
  const host = `rekognition.${region}.amazonaws.com`;
  const amzTarget = "RekognitionService.DetectModerationLabels";
  const contentType = "application/x-amz-json-1.1";
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);

  const headers: Record<string, string> = {
    host,
    "x-amz-date": amzDate,
    "x-amz-target": amzTarget,
    "content-type": contentType,
  };

  const payloadHash = await sha256Hex(body);
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((k) => `${k}:${headers[k]}\n`)
    .join("");
  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalRequest = [
    "POST",
    "/",
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const algorithm = "AWS4-HMAC-SHA256";
  const credentialScope = `${dateStamp}/${region}/rekognition/aws4_request`;
  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  // Derive signing key
  const kDate = await hmac(`AWS4${secretKey}`, dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, "rekognition");
  const kSigning = await hmac(kService, "aws4_request");
  const signature = toHex(await hmac(kSigning, stringToSign));

  const authorization = `${algorithm} Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(`https://${host}/`, {
    method: "POST",
    headers: {
      ...headers,
      authorization,
    },
    body,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Rekognition error ${res.status}: ${errText}`);
  }

  const json = await res.json();
  const labels: RekognitionLabel[] = json.ModerationLabels ?? [];
  const safe = labels.length === 0;
  return { safe, labels };
}

// ─────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────

function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function toHex(bytes: Uint8Array | ArrayBuffer): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

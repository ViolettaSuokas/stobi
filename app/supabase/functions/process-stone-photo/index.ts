// Edge Function: process-stone-photo
//
// Входит в hide flow (регистрация нового камня). Клиент присылает URL
// уже загруженной в storage фотографии → функция:
//   1. AWS Rekognition DetectModerationLabels → если NSFW, возвращаем { safe: false }
//   2. Replicate CLIP → 512-dim embedding
//   3. Возвращаем { safe: true, embedding }
//
// Клиент собирает 3 embedding'а (3 ракурса), передаёт в RPC `create_stone`,
// который усредняет и сохраняет в stones.embedding.
//
// Auth: требует Supabase JWT (authenticated юзер). Service role не позволен.

// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { detectModeration } from "../_shared/rekognition.ts";
import { embedImage } from "../_shared/replicate.ts";

type ProcessResult =
  | { safe: true; embedding: number[] }
  | { safe: false; labels: unknown[] };

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return json({ error: "POST required" }, 405);
  }

  // Basic JWT presence check — Supabase Edge Functions auto-inject if configured.
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: { photo_url?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const photoUrl = body.photo_url;
  if (!photoUrl || typeof photoUrl !== "string") {
    return json({ error: "photo_url required" }, 400);
  }

  try {
    // 1. NSFW first — fail fast, не тратим Replicate-credit на нецензурные фото
    const moderation = await detectModeration(photoUrl);
    if (!moderation.safe) {
      const result: ProcessResult = { safe: false, labels: moderation.labels };
      return json(result, 200);
    }

    // 2. Embedding
    const embedding = await embedImage(photoUrl);
    if (!Array.isArray(embedding) || embedding.length !== 768) {
      return json({ error: "Unexpected embedding shape" }, 502);
    }

    const result: ProcessResult = { safe: true, embedding };
    return json(result, 200);
  } catch (e: any) {
    console.error("process-stone-photo error", e);
    return json({ error: e?.message ?? String(e) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

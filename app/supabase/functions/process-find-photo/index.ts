// Edge Function: process-find-photo
//
// Входит в find flow (юзер сканирует найденный камень). Почти идентична
// process-stone-photo, но отдельный endpoint для ясности и чтобы иметь
// возможность накладывать разные rate limits в будущем.
//
// Auth: требует Supabase JWT.

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
    const moderation = await detectModeration(photoUrl);
    if (!moderation.safe) {
      const result: ProcessResult = { safe: false, labels: moderation.labels };
      return json(result, 200);
    }

    const embedding = await embedImage(photoUrl);
    if (!Array.isArray(embedding) || embedding.length !== 768) {
      return json({ error: "Unexpected embedding shape" }, 502);
    }

    const result: ProcessResult = { safe: true, embedding };
    return json(result, 200);
  } catch (e: any) {
    console.error("process-find-photo error", e);
    return json({ error: e?.message ?? String(e) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

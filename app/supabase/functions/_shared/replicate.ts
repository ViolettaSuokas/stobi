// Replicate CLIP embedding wrapper.
//
// Модель: openai/clip-vit-base-patch32 (или совместимая CLIP ViT-B/32).
// Возвращает 512-dim float32 embedding из URL картинки.
//
// Требует secrets в Supabase Functions:
//   REPLICATE_API_TOKEN
//   REPLICATE_CLIP_MODEL_VERSION (sha256 version id от нужной модели)
//
// Replicate API — async: POST /predictions → получить id → GET /predictions/{id}
// пока status != 'succeeded'/'failed'. Дефолтный timeout — 30 сек.

const REPLICATE_API = "https://api.replicate.com/v1";
const POLL_INTERVAL_MS = 500;
const MAX_WAIT_MS = 30000;

export async function embedImage(photoUrl: string): Promise<number[]> {
  const token = Deno.env.get("REPLICATE_API_TOKEN");
  const modelVersion = Deno.env.get("REPLICATE_CLIP_MODEL_VERSION");

  if (!token) throw new Error("Missing REPLICATE_API_TOKEN");
  if (!modelVersion) throw new Error("Missing REPLICATE_CLIP_MODEL_VERSION");

  // Start prediction.
  // Для andreasjansson/clip-features input = { inputs: "<url>" }
  // (newline-separated strings: либо тексты, либо image URLs).
  const startRes = await fetch(`${REPLICATE_API}/predictions`, {
    method: "POST",
    headers: {
      "Authorization": `Token ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      version: modelVersion,
      input: { inputs: photoUrl },
    }),
  });

  if (!startRes.ok) {
    const err = await startRes.text();
    throw new Error(`Replicate create failed ${startRes.status}: ${err}`);
  }

  const prediction = await startRes.json();
  const predictionId = prediction.id;
  if (!predictionId) throw new Error("No prediction id returned");

  // Poll
  const start = Date.now();
  while (Date.now() - start < MAX_WAIT_MS) {
    await sleep(POLL_INTERVAL_MS);
    const pollRes = await fetch(`${REPLICATE_API}/predictions/${predictionId}`, {
      headers: { "Authorization": `Token ${token}` },
    });
    if (!pollRes.ok) {
      throw new Error(`Replicate poll failed ${pollRes.status}`);
    }
    const poll = await pollRes.json();
    if (poll.status === "succeeded") {
      // andreasjansson/clip-features возвращает:
      //   [{ input: "url", embedding: [768 floats] }, ...]
      // Модель использует ViT-L/14 → 768-мерный embedding.
      // Схема БД приведена к vector(768).
      const out = poll.output;
      let raw: number[] | null = null;
      if (Array.isArray(out) && out.length > 0) {
        const first = out[0];
        if (Array.isArray(first?.embedding) && first.embedding.length === 768) {
          raw = first.embedding as number[];
        } else if (out.length === 768 && typeof out[0] === "number") {
          raw = out as number[];
        }
      }
      if (!raw && Array.isArray(out?.embedding) && out.embedding.length === 768) {
        raw = out.embedding as number[];
      }
      if (!raw) {
        throw new Error(`Unexpected Replicate output shape: ${JSON.stringify(out).slice(0, 300)}`);
      }
      // L2-normalize — Replicate модель отдаёт raw CLIP features без нормализации.
      // pgvector cosine distance (`<=>`) математически корректна только на unit-векторах,
      // иначе яркое фото с большей magnitude доминирует над тусклым при усреднении.
      return l2Normalize(raw);
    }
    if (poll.status === "failed" || poll.status === "canceled") {
      throw new Error(`Replicate prediction ${poll.status}: ${poll.error ?? ""}`);
    }
  }

  throw new Error(`Replicate timeout after ${MAX_WAIT_MS}ms`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function l2Normalize(v: number[]): number[] {
  let sq = 0;
  for (let i = 0; i < v.length; i++) sq += v[i] * v[i];
  const norm = Math.sqrt(sq);
  if (norm === 0 || !isFinite(norm)) return v;
  const out = new Array<number>(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
  return out;
}

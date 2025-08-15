// api/preview.js
import OpenAI from "openai";
import { toFile } from "openai/uploads";

export const config = { api: { bodyParser: { sizeLimit: "10mb" } } };

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const STYLE_PROMPTS = {
  urban:
    "Turn the input photo into a bold urban-street cartoon illustration with clean inking, saturated colors, subtle halftones, soft shading, and a flat background. Keep identity and face intact, keep clothing silhouette similar. No text.",
  retro:
    "Turn the input photo into a retro comic-book illustration with vintage halftones, inked outlines and muted palette. Preserve identity and expressions. No text.",
  vibrant:
    "Turn the input photo into a vibrant cartoon poster, high contrast, neon accents, crisp outlines. Preserve identity. No text.",
  anime:
    "Turn the input photo into an anime-style character with big expressive eyes, soft cel shading, and clean lineart. Preserve identity. No text.",
};

// Convierte data URL -> Blob
function dataURLToBlob(dataUrl) {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || "");
  if (!m) throw new Error("Invalid base64 (expected data:image/*;base64,...)");
  const mime = m[1];
  const buf = Buffer.from(m[2], "base64");
  return new Blob([buf], { type: mime || "image/png" });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const started = Date.now();
  try {
    const { imageBase64, imageUrl, style = "urban" } = req.body || {};

    // 1) Normalizamos a File
    let file;
    if (imageBase64) {
      const blob = dataURLToBlob(imageBase64);
      file = await toFile(blob, "source.png");
    } else if (imageUrl) {
      const resp = await fetch(imageUrl);
      if (!resp.ok) throw new Error(`Could not fetch imageUrl (${resp.status})`);
      const ab = await resp.arrayBuffer();
      // Intentamos inferir mime; si no se puede, usa image/png
      const ct = resp.headers.get("content-type") || "image/png";
      file = await toFile(new Blob([ab], { type: ct }), "source.png");
    } else {
      return res
        .status(400)
        .json({ ok: false, error: "Provide imageBase64 (data URL) or imageUrl" });
    }

    // 2) Prompt de estilo
    const prompt = STYLE_PROMPTS[style] || STYLE_PROMPTS.urban;

    // 3) Llamada a OpenAI — OJO: método correcto es images.edit (singular)
    const result = await openai.images.edit({
      model: "gpt-image-1",
      image: file,
      prompt,
      // algunos tenants solo aceptan estos tamaños: 1024x1024 | 1024x1536 | 1536x1024 | auto
      size: "1024x1024",
      n: 1,
    });

    const b64 = result?.data?.[0]?.b64_json;
    if (!b64) throw new Error("No image returned from OpenAI");

    return res.status(200).json({
      ok: true,
      previewBase64: `data:image/png;base64,${b64}`,
      debug: {
        from: imageBase64 ? "base64" : "url",
        tookMs: Date.now() - started,
      },
    });
  } catch (e) {
    console.error("Error /api/preview:", e);
    // Intenta tomar mensaje útil si viene desde la API
    const msg =
      e?.response?.data?.error?.message ||
      e?.error?.message ||
      e?.message ||
      String(e);
    return res.status(400).json({ ok: false, error: msg });
  }
}

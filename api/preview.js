// api/preview.js
// Genera la PREVIEW (baja) con OpenAI y devuelve SIEMPRE headers CORS.

import OpenAI from "openai";

// ===== CORS (una sola definición) =====
const ALLOWED_ORIGINS = new Set([
  "https://mora2.com",
  "https://www.mora2.com",
]);

function getCorsHeaders(origin) {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : "";
  const base = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  return allow ? { ...base, "Access-Control-Allow-Origin": allow } : base;
}

export const config = { api: { bodyParser: { sizeLimit: "7mb" } } };

// === helpers imagen (validación simple del data URL) ===
function parseDataUrl(dataUrl) {
  const m = /^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/i.exec(dataUrl || "");
  if (!m) return null;
  const mime = m[1].toLowerCase();
  const b64 = m[2];
  return { mime, b64 };
}

// Estilos (prompts)
const STYLE_PROMPTS = {
  urban:
    "Turn the input photo into a bold urban-street cartoon illustration with clean inking, saturated colors, subtle halftones, soft shading, and a flat background. Keep identity and face intact, keep clothing silhouette similar. No text.",
  comic:
    "Turn the input photo into a retro comic-book illustration with vintage halftones, inked outlines and a muted palette. Preserve identity and expressions. No text.",
  cartoon:
    "Turn the input photo into a vibrant cartoon poster with crisp outlines and saturated colors. Preserve identity. No text.",
  anime:
    "Turn the input photo into an anime-style cel-shaded character with clean lineart. Preserve identity. No text.",
};

function stylePrompt(style) {
  return STYLE_PROMPTS[style] || STYLE_PROMPTS.urban;
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req, res) {
  const origin = req.headers.origin;

  // --- CORS preflight y método no permitido (una sola vez) ---
  if (req.method === "OPTIONS") {
    return res.status(200).set(getCorsHeaders(origin)).end();
  }
  if (req.method !== "POST") {
    return res
      .status(405)
      .set(getCorsHeaders(origin))
      .json({ ok: false, error: "Method not allowed" });
  }

  try {
    const { imageBase64, style = "urban" } = req.body || {};
    if (!imageBase64) {
      return res
        .status(400)
        .set(getCorsHeaders(origin))
        .json({ ok: false, error: "Missing imageBase64" });
    }

    const parsed = parseDataUrl(imageBase64);
    if (!parsed) {
      return res
        .status(400)
        .set(getCorsHeaders(origin))
        .json({ ok: false, error: "Invalid data URL" });
    }

    // Prompt por estilo
    const prompt = stylePrompt(style);

    // Edición rápida para preview (usa el data URL directo)
    const result = await openai.images.edits({
      model: "gpt-image-1",
      image: imageBase64, // data URL
      prompt,
      size: "1024x1024", // puedes bajar a 512x512 si quieres acelerar
      n: 1,
    });

    const b64 = result?.data?.[0]?.b64_json;
    if (!b64) {
      return res
        .status(500)
        .set(getCorsHeaders(origin))
        .json({ ok: false, error: "No preview from OpenAI" });
    }

    // Data URL para pintar en el canvas del frontend
    const previewBase64 = `data:image/png;base64,${b64}`;

    return res
      .status(200)
      .set(getCorsHeaders(origin))
      .json({ ok: true, previewBase64 });
  } catch (err) {
    console.error("Error /api/preview:", err);
    return res
      .status(500)
      .set(getCorsHeaders(origin))
      .json({ ok: false, error: err?.message || String(err) });
  }
}

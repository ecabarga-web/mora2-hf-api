// api/preview.js
import OpenAI from "openai";

// === HOTFIX CORS (abierto) ===
// Cuando confirmes que funciona, lo cerramos a tus dominios.
function getCorsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export const config = { api: { bodyParser: { sizeLimit: "7mb" } } };

const STYLE_PROMPTS = {
  urban:   "Turn the input photo into a bold urban-street cartoon illustration with clean inking, saturated colors, subtle halftones, soft shading, and a flat background. Keep identity and face intact, keep clothing silhouette similar. No text.",
  comic:   "Turn the input photo into a retro comic-book illustration with vintage halftones, inked outlines and a muted palette. Preserve identity and expressions. No text.",
  cartoon: "Turn the input photo into a vibrant cartoon poster with crisp outlines and saturated colors. Preserve identity. No text.",
  anime:   "Turn the input photo into an anime-style cel-shaded character with clean lineart. Preserve identity. No text.",
};

function stylePrompt(style) {
  return STYLE_PROMPTS[style] || STYLE_PROMPTS.urban;
}

function parseDataUrl(dataUrl) {
  const m = /^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/i.exec(dataUrl || "");
  if (!m) return null;
  return { mime: m[1].toLowerCase(), b64: m[2] };
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req, res) {
  const headers = getCorsHeaders();

  // Preflight
  if (req.method === "OPTIONS") {
    return res.status(200).set(headers).end();
  }

  // GET de diagnóstico (para ver headers CORS en el navegador)
  if (req.method === "GET") {
    return res.status(200).set(headers).json({
      ok: true,
      route: "preview",
      time: new Date().toISOString(),
    });
  }

  if (req.method !== "POST") {
    return res.status(405).set(headers).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const { imageBase64, style = "urban" } = req.body || {};
    if (!imageBase64) {
      return res.status(400).set(headers).json({ ok: false, error: "Missing imageBase64" });
    }

    const parsed = parseDataUrl(imageBase64);
    if (!parsed) {
      return res.status(400).set(headers).json({ ok: false, error: "Invalid data URL" });
    }

    // OpenAI: usar gpt-image-1 con data URL directa
    const prompt = stylePrompt(style);
    const result = await openai.images.edits({
      model: "gpt-image-1",
      image: imageBase64,        // data URL
      prompt,
      size: "1024x1024",         // valores permitidos: 1024x1024 | 1024x1536 | 1536x1024 | auto
      n: 1
    });

    const b64 = result?.data?.[0]?.b64_json;
    if (!b64) {
      return res.status(500).set(headers).json({ ok: false, error: "No preview from OpenAI" });
    }

    const previewBase64 = `data:image/png;base64,${b64}`;
    return res.status(200).set(headers).json({ ok: true, previewBase64 });
  } catch (err) {
    console.error("Error /api/preview:", err);
    return res.status(500).set(headers).json({ ok: false, error: err?.message || String(err) });
  }
}

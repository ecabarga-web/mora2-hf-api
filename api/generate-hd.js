// api/generate-hd.js
import OpenAI from "openai";
import { toFile } from "openai/uploads";
import { put } from "@vercel/blob";

// ====== CONFIG ======
export const config = { api: { bodyParser: { sizeLimit: "12mb" } } };

// ====== CORS (una sola vez) ======
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

// ====== OpenAI ======
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ====== Estilos ======
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

// ====== Helpers imagen ======
function parseDataUrl(dataUrl) {
  const m = /^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/i.exec(dataUrl || "");
  if (!m) return null;
  const mime = m[1].toLowerCase();
  const b64 = m[2];
  const buf = Buffer.from(b64, "base64");
  return { mime, buf };
}

async function fetchAsTypedBlob(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch sourceUrl failed (${r.status})`);
  const ct = (r.headers.get("content-type") || "").toLowerCase();
  const mime =
    ct.includes("image/png") ? "image/png" :
    ct.includes("image/jpeg") || ct.includes("image/jpg") ? "image/jpeg" :
    ct.includes("image/webp") ? "image/webp" :
    null;
  if (!mime) throw new Error(`Unsupported mime from sourceUrl (${ct || "unknown"})`);
  const ab = await r.arrayBuffer();
  return new Blob([ab], { type: mime });
}

function stylePrompt(style) {
  return STYLE_PROMPTS[style] || STYLE_PROMPTS.urban;
}

// ====== Handler ======
export default async function handler(req, res) {
  // --- CORS preflight y método no permitido ---
  if (req.method === "OPTIONS") {
    return res.status(200).set(getCorsHeaders(req.headers.origin)).end();
  }
  if (req.method !== "POST") {
    return res
      .status(405)
      .set(getCorsHeaders(req.headers.origin))
      .json({ ok: false, error: "Method not allowed" });
  }

  const started = Date.now();
  try {
    const { sourceUrl, imageBase64, style = "urban" } = req.body || {};
    if (!sourceUrl && !imageBase64) {
      return res
        .status(400)
        .set(getCorsHeaders(req.headers.origin))
        .json({ ok: false, error: "Provide sourceUrl or imageBase64 (data URL)" });
    }

    // 1) Normaliza imagen de entrada
    let fileForOpenAI;
    if (sourceUrl) {
      const blob = await fetchAsTypedBlob(sourceUrl);
      fileForOpenAI = await toFile(blob, "source");
    } else {
      const parsed = parseDataUrl(imageBase64);
      if (!parsed) {
        return res
          .status(400)
          .set(getCorsHeaders(req.headers.origin))
          .json({ ok: false, error: "Invalid data URL in imageBase64" });
      }
      const { mime, buf } = parsed;
      const blob = new Blob([buf], { type: mime });
      fileForOpenAI = await toFile(blob, "source");
    }

    // 2) Genera HD con OpenAI
    const prompt = stylePrompt(style);
    const result = await openai.images.edits({
      model: "gpt-image-1",
      image: fileForOpenAI,
      prompt,
      size: "1024x1024",
      n: 1,
    });

    const b64 = result?.data?.[0]?.b64_json;
    if (!b64) throw new Error("No HD image from OpenAI");

    // 3) Sube a Vercel Blob (público)
    const bytes = Buffer.from(b64, "base64");
    const key = `mora2/hd_${Date.now()}_${Math.random().toString(36).slice(2)}.png`;

    const putRes = await put(key, bytes, {
      contentType: "image/png",
      access: "public",
    });

    // 4) Respuesta OK
    return res
      .status(200)
      .set(getCorsHeaders(req.headers.origin))
      .json({
        ok: true,
        hdUrl: putRes.url,
        hdKey: putRes.pathname || key,
        tookMs: Date.now() - started,
      });

  } catch (e) {
    console.error("Error /api/generate-hd:", e);
    const message = e?.message || String(e);
    return res
      .status(500)
      .set(getCorsHeaders(req.headers.origin))
      .json({ ok: false, error: message });
  }
}

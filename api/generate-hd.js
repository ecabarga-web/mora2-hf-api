// api/generate-hd.js
// Genera la versión HD usando el endpoint HTTP de OpenAI (sin SDK)
// y sube el PNG resultante a Vercel Blob.

import { put } from "@vercel/blob";

// ===== CORS (igual patrón que preview.js) =====
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "https://mora2.com";
function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
}

// ====== CONFIG ======
export const config = { api: { bodyParser: { sizeLimit: "12mb" } } };

// ====== Estilos (sin cambios) ======
const STYLE_PROMPTS = {
  urban:
    "Turn the input photo into a bold urban-street cartoon illustration with clean inking, saturated colors, subtle halftones, soft shading, and a flat/plain background. Keep identity and face intact, keep clothing silhouette similar. No text.",
  retro:
    "Turn the input photo into a retro comic-book illustration with vintage halftones, inked outlines and muted palette. Preserve identity and expressions. No text.",
  vibrant:
    "Turn the input photo into a vibrant cartoon poster, high contrast, neon accents, crisp outlines. Preserve identity. No text.",
  anime:
    "Turn the input photo into an anime-style character with big expressive eyes, soft cel shading, and clean lineart. Preserve identity. No text.",
};
const stylePrompt = (s) => STYLE_PROMPTS[s] || STYLE_PROMPTS.urban;

// ===== Helpers imagen =====
function parseDataUrl(dataUrl) {
  // Acepta png/jpeg/jpg/webp
  const m = /^data:(image\/(?:png|jpeg|jpg|webp));base64,([a-z0-9+/=]+)$/i.exec(
    dataUrl || ""
  );
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
    ct.includes("image/png")
      ? "image/png"
      : ct.includes("image/jpeg") || ct.includes("image/jpg")
      ? "image/jpeg"
      : ct.includes("image/webp")
      ? "image/webp"
      : null;
  if (!mime) throw new Error(`Unsupported mime from sourceUrl (${ct || "unknown"})`);
  const ab = await r.arrayBuffer();
  return new Blob([ab], { type: mime });
}

// ===== Handler =====
export default async function handler(req, res) {
  setCORS(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")
    return res.status(405).json({ ok: false, error: "Method not allowed" });

  const started = Date.now();

  try {
    const { sourceUrl, imageBase64, style = "urban" } = req.body || {};

    // 1) Normalizamos la imagen de entrada
    let imageBlob = null;
    if (sourceUrl && typeof sourceUrl === "string" && sourceUrl.startsWith("http")) {
      // Caso A: viene URL
      imageBlob = await fetchAsTypedBlob(sourceUrl);
    } else if (
      imageBase64 &&
      typeof imageBase64 === "string" &&
      imageBase64.startsWith("data:image/")
    ) {
      // Caso B: viene data URL
      const parsed = parseDataUrl(imageBase64);
      if (!parsed) {
        return res
          .status(400)
          .json({ ok: false, error: "imageBase64 must be a valid data URL (png/jpg/webp)" });
      }
      imageBlob = new Blob([parsed.buf], { type: parsed.mime });
    } else {
      // Nada válido
      return res
        .status(400)
        .json({ ok: false, error: "No valid image provided (use sourceUrl or imageBase64 data URL)" });
    }

    // 2) Llamamos a OpenAI /v1/images/edits
    const form = new FormData();
    form.append("model", "gpt-image-1");
    form.append("prompt", stylePrompt(style));
    form.append("size", "1024x1024");
    const ext = (imageBlob.type.split("/")[1] || "png").replace("jpeg", "jpg");
    form.append("image", imageBlob, `source.${ext}`);

    const r = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
    });

    const j = await r.json();
    if (!r.ok) {
      return res
        .status(r.status)
        .json({ ok: false, error: j?.error?.message || "OpenAI error" });
    }

    const b64 = j?.data?.[0]?.b64_json;
    if (!b64) throw new Error("No HD image returned from OpenAI");

    // 3) Subimos a Vercel Blob (público)
    const bytes = Buffer.from(b64, "base64");
    const key = `mora2/hd_${Date.now()}_${Math.random().toString(36).slice(2)}.png`;
    const putRes = await put(key, bytes, {
      contentType: "image/png",
      access: "public",
    });

    // 4) Respuesta (no abrimos la URL al cliente)
    return res.status(200).json({
      ok: true,
      // si no quieres exponer la URL, coméntala:
      // hdUrl: putRes.url,
      hdKey: putRes.pathname || key,
      tookMs: Date.now() - started,
      used: sourceUrl ? "sourceUrl" : "imageBase64",
    });
  } catch (e) {
    console.error("Error /api/generate-hd:", e);
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}

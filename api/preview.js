// api/preview.js
// Genera la PREVIEW (baja) usando el endpoint HTTP de OpenAI (sin SDK)

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "https://mora2.com";
function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
}

export const config = { api: { bodyParser: { sizeLimit: "7mb" } } };

const STYLE_PROMPTS = {
  urban:  "Turn the input photo into a bold urban-street cartoon illustration with clean inking, saturated colors, subtle halftones, soft shading, flat/plain background. Keep identity intact. No text.",
  comic:  "Turn the input photo into a retro comic-book illustration with vintage halftones, inked outlines, muted palette. Preserve identity. No text.",
  cartoon:"Turn the input photo into a vibrant cartoon poster with crisp outlines and saturated colors. Preserve identity. No text.",
  anime:  "Turn the input photo into an anime-style cel-shaded character with clean lineart. Preserve identity. No text."
};
// ====== imports que ya tienes ======
import OpenAI from 'openai';
// import { v2 as cloudinary } from 'cloudinary';   // si lo usas aquí
// …tus otros imports…

// ====== CORS helper — PEGAR AQUÍ, debajo de los imports ======
const ALLOWED_ORIGINS = [
  'https://mora2.com',
  'https://www.mora2.com',
  // agrega si usas otra URL de pruebas (por ej. tu página en GHL si tiene otro dominio)
  // 'https://<tu-subdominio-de-ghl>.com'
];

function getCorsHeaders(origin) {
  const allow =
    ALLOWED_ORIGINS.includes(origin) || process.env.NODE_ENV !== 'production'
      ? origin
      : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

// (si ya tienes esto, déjalo como está)
export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

// ====== handler ======
export default async function handler(req, res) {
  // ====== CORS — PEGAR ESTO AL INICIO DEL HANDLER ======
  const origin = req.headers.origin || '';
  const corsHeaders = getCorsHeaders(origin);

  // Preflight
  if (req.method === 'OPTIONS') {
    Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
    res.status(204).end(); // No Content
    return;
  }
  // Para la request real
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
  // ====== FIN CORS ======

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    // …tu lógica actual de PREVIEW…
    // - leer body: const { imageBase64, style } = req.body;
    // - llamar a OpenAI para boceto/preview o lo que tengas
    // - devolver: res.status(200).json({ ok:true, previewBase64, sourceUrl })

    // EJEMPLO de final feliz (deja el tuyo):
    // res.status(200).json({ ok: true, previewBase64, sourceUrl });
  } catch (err) {
    console.error('Error /api/preview', err);
    res.status(500).json({ ok: false, error: err.message || 'Server error' });
  }
}
export default async function handler(req, res) {
  setCORS(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok:false, error:"Method not allowed" });

  try {
    const { imageBase64, style = "urban" } = req.body || {};
    if (!imageBase64) return res.status(400).json({ ok:false, error:"imageBase64 required (data URL)" });

    // dataURL -> Blob
    const [meta, b64] = imageBase64.split(",");
    const mime = (meta.match(/data:(.*?);base64/) || [])[1] || "image/png";
    const buf = Buffer.from(b64, "base64");
    const fileBlob = new Blob([buf], { type: mime });

   const form = new FormData();
form.append("model", "gpt-image-1");
form.append("prompt", STYLE_PROMPTS[style] || STYLE_PROMPTS.urban);
form.append("size", "1024x1024");
form.append("image", fileBlob, "source." + (mime.split("/")[1] || "png"));

    const r = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form
    });

    const j = await r.json();
    if (!r.ok) {
      return res.status(r.status).json({ ok:false, error: j.error?.message || "OpenAI error" });
    }

    const b64json = j.data?.[0]?.b64_json;
    if (!b64json) throw new Error("No preview image returned");

    return res.status(200).json({
      ok: true,
      previewBase64: `data:image/png;base64,${b64json}`
    });
  } catch (e) {
    console.error("preview error:", e);
    return res.status(500).json({ ok:false, error: e.message });
  }
}

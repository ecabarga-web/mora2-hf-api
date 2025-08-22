// api/generate-hd.js
// Genera la versión HD usando el endpoint HTTP de OpenAI (sin SDK)
// y sube el PNG resultante a Vercel Blob.

import { put } from "@vercel/blob";

// ===== CORS (mismo patrón que preview.js) =====
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

function stylePrompt(style) {
  return STYLE_PROMPTS[style] || STYLE_PROMPTS.urban;
}

// ===== Helpers imagen =====
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

// ===== Handler =====
export default async function handler(req, res) {
  // CORS
  setCORS(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok:false, error:"Method not allowed" });

  const started = Date.now();

  try {
    const { sourceUrl, imageBase64, style = "urban" } = req.body || {};
    if (!sourceUrl && !imageBase64) {
      return res.status(400).json({ ok:false, error:"Provide sourceUrl or imageBase64 (data URL)" });
    }

    // 1) Preparamos el archivo para OpenAI (Blob tipado)
    let imageBlob;
    if (sourceUrl) {
      imageBlob = await fetchAsTypedBlob(sourceUrl);
    } else {
      const parsed = parseDataUrl(imageBase64);
      if (!parsed) return res.status(400).json({ ok:false, error:"Invalid data URL in imageBase64" });
      const { mime, buf } = parsed;
      imageBlob = new Blob([buf], { type: mime });
    }

    // 2) Llamamos al endpoint HTTP /v1/images/edits
    const form = new FormData();
    form.append("model", "gpt-image-1");
    form.append("prompt", stylePrompt(style));
    form.append("size", "1024x1024");
    // nombre de archivo cualquiera con extensión acorde al mime
    const ext = (imageBlob.type.split("/")[1] || "png").replace("jpeg","jpg");
    form.append("image", imageBlob, `source.${ext}`);

    const r = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form
    });

    const j = await r.json();
if (!r.ok) {
  return res.status(r.status)
    setCORS(res);
return res.status(XXX).json({ ... });
    .json({ ok:false, error: j.error?.message || "OpenAI error" });
}

const b64 = j?.data?.[0]?.b64_json;
if (!b64) {
  return res.status(500)
    setCORS(res);
return res.status(XXX).json({ ... });
    .json({ ok:false, error: "No HD image returned" });
}

// Subimos a Vercel Blob (público) PERO no devolvemos la URL al cliente
const bytes = Buffer.from(b64, "base64");
const key = `mora2/hd_${Date.now()}_${Math.random().toString(36).slice(2)}.png`;

const putRes = await put(key, bytes, {
  contentType: "image/png",
  access: "public"
});

// ⚠️ No devolvemos hdUrl al navegador
return res.status(200)
  setCORS(res);
return res.status(XXX).json({ ... });
  .json({
    ok: true,
    stored: true,
    // opcional: referencia interna por si la quieres loguear o asociar al pedido
    hdKey: putRes.pathname || key
  });

    // 4) Respuesta OK
    return res.status(200).json({
      ok: true,
      hdUrl: putRes.url,
      hdKey: putRes.pathname || key,
      tookMs: Date.now() - started,
    });

  } catch (e) {
    console.error("Error /api/generate-hd:", e);
    return res.status(500).json({ ok:false, error: e?.message || String(e) });
  }
}

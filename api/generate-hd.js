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

// ===== Estilos (nueva lista) =====
const STYLE_PROMPTS = {
  urban:
    "Turn the input photo into a bold urban-street cartoon portrait. Clean thick inking, saturated yet balanced colors, subtle halftones, soft shading, flat/plain background. Keep identity, face features, glasses and hair/beard intact. Shoulders-up framing. No text, no typography.",

  pixar:
    "Transform the input photo into a Pixar-style character render. Big expressive eyes, soft 3D-like shading, smooth gradients, gentle subsurface scattering, glossy eye highlights, soft rim light, simple studio background. Preserve identity and likeness. Shoulders-up. No text, no captions.",

  realista:
    "Turn the input photo into a realistic cartoon with strong graphic lines and flat shadows, similar to a graphic-novel poster. Thick outlines, warm neutral palette, defined beard and hair strands, subtle rim light, light vignette/plain background. Maintain exact identity, glasses reflections allowed. Shoulders-up framing. No text.",

  anime:
    "Turn the input photo into an anime-style cel-shaded character with clean lineart, clear color blocks, subtle gradients, and simple background. Preserve identity and expression. Shoulders-up. No text."
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
    // 👇 agregamos draftKey, lo demás se queda igual
    const { sourceUrl, imageBase64, style = "urban", draftKey } = req.body || {};
    if (!sourceUrl && !imageBase64) {
      return res.status(400).json({ ok:false, error:"Provide sourceUrl or imageBase64 (data URL)" });
    }
    // === FAST PATH: si viene la preview y piden congelarla, no regeneramos ===
if (
  req.body?.freezePreview &&
  imageBase64 &&
  typeof imageBase64 === "string" &&
  imageBase64.startsWith("data:image/")
) {
  const parsed = parseDataUrl(imageBase64);
  if (!parsed) {
    return res.status(400).json({ ok:false, error:"Invalid preview data URL" });
  }

  const { mime, buf } = parsed;

  // Si vino draftKey válido lo usamos para el nombre, si no generamos uno
  const safeDraft =
    draftKey && /^[a-zA-Z0-9._-]{3,80}$/.test(draftKey)
      ? `mora2/${draftKey}`
      : `mora2/hd_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  const key = `${safeDraft}.png`;

  const putRes = await put(key, buf, {
    contentType: mime || "image/png",
    access: "public",
  });

  return res.status(200).json({
    ok: true,
    hdUrl: putRes.url,
    hdKey: putRes.pathname || key,
    tookMs: Date.now() - started,
  });
}

    // --- Normalizar imagen de entrada ---
    let imageBlob = null;

    // PRIORIDAD: dataURL (preview) -> sourceUrl
    if (
      imageBase64 &&
      typeof imageBase64 === "string" &&
      imageBase64.startsWith("data:image/")
    ) {
      // Caso B: viene data URL (ideal: la preview que ya viste)
      const parsed = parseDataUrl(imageBase64);
      if (!parsed) {
        return res
          .status(400)
          .json({ ok: false, error: "imageBase64 must be a valid data URL (png/jpg/webp)" });
      }
      const { mime, buf } = parsed;
      imageBlob = new Blob([buf], { type: mime });
    } else if (
      sourceUrl &&
      typeof sourceUrl === "string" &&
      /^https?:\/\//i.test(sourceUrl)
    ) {
      // Caso A: viene URL
      imageBlob = await fetchAsTypedBlob(sourceUrl);
    } else {
      // Nada válido
      return res
        .status(400)
        .json({ ok: false, error: "No valid image provided (use sourceUrl or imageBase64 data URL)" });
    }

    // extensión para nombre de archivo que enviamos a OpenAI
    const ext = (imageBlob.type.split("/")[1] || "png").replace("jpeg","jpg");

    // 2) Llamamos al endpoint HTTP /v1/images/edits
    const form = new FormData();
    form.append("model", "gpt-image-1");
    form.append("prompt", stylePrompt(style));
    form.append("size", "1024x1024");
    // nombre de archivo cualquiera con extensión acorde al mime
    form.append("image", imageBlob, `source.${ext}`);

    const r = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form
    });

    const j = await r.json();
    if (!r.ok) {
      return res.status(r.status).json({ ok:false, error: j.error?.message || "OpenAI error" });
    }

    const b64 = j?.data?.[0]?.b64_json;
    if (!b64) throw new Error("No HD image returned");

    // 3) Subimos a Vercel Blob (público) — usa draftKey si viene
    const bytes = Buffer.from(b64, "base64");
    const safeDraft =
      draftKey && /^[a-zA-Z0-9._-]{3,80}$/.test(draftKey)
        ? `mora2/${draftKey}`
        : `mora2/hd_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const key = `${safeDraft}.png`;

    const putRes = await put(key, bytes, {
      contentType: "image/png",
      access: "public",
    });

    // 4) Respuesta OK (sin abrir la imagen en el cliente)
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

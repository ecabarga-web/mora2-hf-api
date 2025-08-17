// ---- CORS SHIM (pegar al inicio del archivo) ----
const ALLOWED_ORIGINS = [
  'https://mora2.com',
  'http://localhost:3000',
  'http://localhost:5173'
];

function pickOrigin(req) {
  const o = req.headers?.origin || '';
  return ALLOWED_ORIGINS.includes(o) ? o : ALLOWED_ORIGINS[0];
}

function setCors(res, origin) {
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
}

import OpenAI from "openai";
import { toFile } from "openai/uploads";
import { v2 as cloudinary } from "cloudinary";

export const config = { api: { bodyParser: { sizeLimit: "10mb" } } };

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Estilos
const STYLE_PROMPTS = {
  urban:   "Turn the input photo into a bold urban-street cartoon illustration with clean inking, saturated colors, subtle halftones, soft shading, and a flat background. Keep identity and face intact, keep clothing silhouette similar. No text.",
  comic:   "Turn the input photo into a retro comic-book illustration with vintage halftones, inked outlines and muted palette. Preserve identity and expressions. No text.",
  cartoon: "Turn the input photo into a vibrant cartoon poster, high contrast, neon accents, crisp outlines. Preserve identity. No text.",
  anime:   "Turn the input photo into an anime-style character with big expressive eyes, soft cel shading, and clean lineart. Preserve identity. No text."
};

// Helpers
function parseDataUrl(dataUrl) {
  const m = /^data:(image\/(png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || "");
  if (!m) throw new Error("Invalid base64 (expected data:image/*;base64,...)");
  const mime = m[1];
  const ext  = m[2] === 'jpg' ? 'jpeg' : m[2];
  const buf  = Buffer.from(m[3], "base64");
  return { mime, ext, buf };
}

function uploadToCloudinaryBuffer(buf, folder, mime = "image/png") {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: "image", overwrite: true },
      (err, result) => err ? reject(err) : resolve(result)
    );
    stream.end(buf);
  });
}

export default async function handler(req, res) {
  const origin = pickOrigin(req);
  setCors(res, origin);

  // Preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const { imageBase64, style = "urban" } = req.body || {};
    if (!imageBase64) {
      return res.status(400).json({ ok: false, error: "imageBase64 required (data URL)" });
    }

    // 1) Parsear data URL y subir ORIGINAL a Cloudinary (sirve para HD)
    const { mime, ext, buf } = parseDataUrl(imageBase64);
    const up = await uploadToCloudinaryBuffer(buf, "mora2/previews_src", mime);
    const sourceUrl = up.secure_url;

    // 2) Preparar archivo para OpenAI (con mimetype correcto)
    const file = new File([buf], source.${ext}, { type: mime });

    // 3) Generar PREVIEW con gpt-image-1 (usa tamaños válidos: 1024/1536 o auto)
    const prompt = STYLE_PROMPTS[style] || STYLE_PROMPTS.urban;

    // Nota: en el SDK v4 el método es `images.edit` (singular)
    const result = await openai.images.edit({
      model: "gpt-image-1",
      image: file,
      prompt,
      size: "1024x1024", // evita 512, no está soportado
      n: 1
    });

    const b64 = result?.data?.[0]?.b64_json;
    if (!b64) throw new Error("No image returned from OpenAI");

    return res.status(200).json({
      ok: true,
      previewBase64: `data:image/png;base64,${b64}`,
      sourceUrl
    });
  } catch (e) {
    console.error("Error /api/preview:", e);
    // Si viene de OpenAI, suele tener e.status y e.error
    const msg = e?.message || (e?.error?.message) || String(e);
    return res.status(500).json({ ok: false, error: msg });
  }
}

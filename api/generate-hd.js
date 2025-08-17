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

export const config = { api: { bodyParser: { sizeLimit: "15mb" } } };

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

async function fetchAsBuffer(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Fetch sourceUrl failed: HTTP ${r.status}`);
  const mime = r.headers.get("content-type") || "image/jpeg";
  const ab   = await r.arrayBuffer();
  return { mime, buf: Buffer.from(ab) };
}

export default async function handler(req, res) {
  const origin = pickOrigin(req);
  setCors(res, origin);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const { sourceUrl, imageBase64, style = "urban" } = req.body || {};
    let buf, mime, ext = "png";

    if (sourceUrl) {
      const fetched = await fetchAsBuffer(sourceUrl);
      buf  = fetched.buf;
      mime = fetched.mime.startsWith("image/") ? fetched.mime : "image/jpeg";
      ext  = mime.split("/")[1] || "jpeg";
    } else if (imageBase64) {
      const parsed = parseDataUrl(imageBase64);
      buf  = parsed.buf;
      mime = parsed.mime;
      ext  = parsed.ext;
    } else {
      return res.status(400).json({ ok: false, error: "Provide sourceUrl or imageBase64" });
    }

    // Archivo para OpenAI
    const blob = new Blob([buf], { type: mime });
    const file = await toFile(blob, `source.${ext}`);

    const prompt = STYLE_PROMPTS[style] || STYLE_PROMPTS.urban;

    // HD (usa tamaños válidos: 1024/1536/auto). Puedes subir a 1536 si quieres.
    const result = await openai.images.edit({
      model: "gpt-image-1",
      image: file,
      prompt,
      size: "1024x1024",
      n: 1
    });

    const hdB64 = result?.data?.[0]?.b64_json;
    if (!hdB64) throw new Error("No HD image from OpenAI");

    // Subir a Cloudinary (PNG)
    const up = await cloudinary.uploader.upload(
      `data:image/png;base64,${hdB64}`,
      { folder: "mora2/generated_hd", resource_type: "image", overwrite: true }
    );

    return res.status(200).json({ ok: true, hdUrl: up.secure_url });
  } catch (e) {
    console.error("Error /api/generate-hd:", e);
    const msg = e?.message || (e?.error?.message) || String(e);
    return res.status(500).json({ ok: false, error: msg });
  }
}

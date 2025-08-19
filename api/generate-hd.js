// api/generate-hd.js
// Genera la HD y la sube a Cloudinary (sin SDK de OpenAI, usando fetch HTTP)

import { v2 as cloudinary } from "cloudinary";

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "https://mora2.com";
function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
}

export const config = { api: { bodyParser: { sizeLimit: "7mb" } } };

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const STYLE_PROMPTS = {
  urban:  "Turn the input photo into a bold urban-street cartoon illustration with clean inking, saturated colors, subtle halftones, soft shading, flat/plain background. Keep identity intact. No text.",
  comic:  "Turn the input photo into a retro comic-book illustration with vintage halftones, inked outlines, muted palette. Preserve identity. No text.",
  cartoon:"Turn the input photo into a vibrant cartoon poster with crisp outlines and saturated colors. Preserve identity. No text.",
  anime:  "Turn the input photo into an anime-style cel-shaded character with clean lineart. Preserve identity. No text."
};

export default async function handler(req, res) {
  setCORS(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok:false, error:"Method not allowed" });

  try {
    const { imageBase64, sourceUrl, style = "urban" } = req.body || {};
    if (!imageBase64 && !sourceUrl) {
      return res.status(400).json({ ok:false, error:"imageBase64 or sourceUrl required" });
    }

    // 1) Obtener Blob de la imagen fuente
    let fileBlob;
    if (sourceUrl) {
      const ab = await fetch(sourceUrl).then(r => r.arrayBuffer());
      fileBlob = new Blob([ab], { type: "image/png" });
    } else {
      const [meta, b64] = imageBase64.split(",");
      const mime = (meta.match(/data:(.*?);base64/) || [])[1] || "image/png";
      const buf = Buffer.from(b64, "base64");
      fileBlob = new Blob([buf], { type: mime });
    }

    // 2) Llamar a OpenAI (HD 1024x1024 para cumplir con tamaños permitidos)
    const form = new FormData();
    form.append("model", "gpt-image-1");
    form.append("prompt", STYLE_PROMPTS[style] || STYLE_PROMPTS.urban);
    form.append("size", "1024x1024");
    form.append("response_format", "b64_json");
    form.append("image", fileBlob, "source.png");

    const r = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form
    });
    const j = await r.json();
    if (!r.ok) {
      return res.status(r.status).json({ ok:false, error: j.error?.message || "OpenAI error" });
    }

    const hdB64 = j.data?.[0]?.b64_json;
    if (!hdB64) throw new Error("No HD image returned");

    // 3) Subir a Cloudinary
    const up = await cloudinary.uploader.upload(
      `data:image/png;base64,${hdB64}`,
      { folder: "mora2/generated_hd", resource_type: "image", overwrite: true }
    );

    return res.status(200).json({ ok: true, hdUrl: up.secure_url });
  } catch (e) {
    console.error("generate-hd error:", e);
    return res.status(500).json({ ok:false, error: e.message });
  }
}

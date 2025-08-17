import OpenAI from "openai";
import { toFile } from "openai/uploads";
import { v2 as cloudinary } from "cloudinary";

// --- CONFIG ---
export const config = { api: { bodyParser: { sizeLimit: "10mb" } } };

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const STYLE_PROMPTS = {
  urban:   "Turn the input photo into a bold urban-street cartoon illustration with clean inking, saturated colors, subtle halftones, soft shading, and a flat background. Keep identity and face intact, keep clothing silhouette similar. No text.",
  retro:   "Turn the input photo into a retro comic-book illustration with vintage halftones, inked outlines and muted palette. Preserve identity and expressions. No text.",
  vibrant: "Turn the input photo into a vibrant cartoon poster, high contrast, neon accents, crisp outlines. Preserve identity. No text.",
  anime:   "Turn the input photo into an anime-style character with big expressive eyes, soft cel shading, and clean lineart. Preserve identity. No text.",
};

// dataURL -> Blob (con MIME correcto)
function dataURLToBlob(dataUrl) {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || "");
  if (!m) throw new Error("Invalid base64 (expected data:image/*;base64,...)");
  const mime = m[1];
  const b64  = m[2];
  const buf  = Buffer.from(b64, "base64");
  return new Blob([buf], { type: mime || "image/png" });
}

export default async function handler(req, res) {
  // --- CORS ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const start = Date.now();
  try {
    const { imageBase64, style = "urban" } = req.body || {};
    if (!imageBase64) {
      return res.status(400).json({ ok: false, error: "imageBase64 required (data URL)" });
    }

    // Subimos la original a Cloudinary (opcional, útil para trazabilidad)
    // No es obligatorio; si no la quieres, comenta este bloque.
    let sourceUrl = null;
    try {
      const up = await cloudinary.uploader.upload(imageBase64, {
        folder: "mora2/previews_src",
        overwrite: true,
        resource_type: "image",
      });
      sourceUrl = up.secure_url;
    } catch (e) {
      // Continuar aunque falle la subida de la original.
      console.warn("Cloudinary source upload skipped:", e?.message || e);
    }

    // Convertimos dataURL a File (manteniendo el MIME real)
    const blob = dataURLToBlob(imageBase64);
    const file = await toFile(blob, "source.png"); // nombre no importa, el MIME viene del blob

    const prompt = STYLE_PROMPTS[style] || STYLE_PROMPTS.urban;

    // Preview con tamaño válido (gpt-image-1 no acepta 512)
    const result = await openai.images.edits({
      model: "gpt-image-1",
      image: file,
      prompt,
      size: "1024x1024",
      n: 1,
      // por defecto devuelve b64 en "b64_json"
    });

    const b64 = result?.data?.[0]?.b64_json;
    if (!b64) throw new Error("No image returned from OpenAI");

    return res.status(200).json({
      ok: true,
      previewBase64: data:image/png;base64,${b64},
      sourceUrl,
      tookMs: Date.now() - start,
    });
  } catch (e) {
    console.error("Error /api/preview:", e);
    let msg = e?.message || String(e);
    if (e?.response?.data?.error?.message) msg = e.response.data.error.message;
    return res.status(400).json({
      ok: false,
      error: msg,
    });
  }
}

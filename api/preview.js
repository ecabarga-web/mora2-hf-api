import OpenAI from "openai";
import { toFile } from "openai/uploads";
import { v2 as cloudinary } from "cloudinary";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export const config = { api: { bodyParser: { sizeLimit: "7mb" } } };

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

// Si viene base64 pelado, le ponemos prefijo para Cloudinary
function ensureDataUrl(b64) {
  if (!b64) return "";
  if (b64.startsWith("data:")) return b64;
  // por defecto tratamos como jpeg
  return `data:image/jpeg;base64,${b64}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const { imageBase64, style = "urban" } = req.body || {};
    if (!imageBase64) {
      return res.status(400).json({ ok: false, error: "imageBase64 required" });
    }

    const dataUrl = ensureDataUrl(imageBase64);

    // 1) Subir ORIGINAL a Cloudinary (acepta data URLs)
    const up = await cloudinary.uploader.upload(dataUrl, {
      folder: "mora2/previews_src",
      overwrite: true,
    });
    const sourceUrl = up.secure_url;

    // 2) Descargar el original como archivo para OpenAI
    const file = await toFile(sourceUrl);

    // 3) Hacer EDIT con gpt-image-1 (SDK nuevo, sin response_format)
    const prompt = STYLE_PROMPTS[style] || STYLE_PROMPTS.urban;

    const result = await openai.images.edits({
      model: "gpt-image-1",
      image: file,          // archivo, no ruta ni data URL
      prompt,
      size: "512x512",
      n: 1,
    });

    // En el SDK nuevo, el base64 está en data[0].b64_json
    const b64 = result.data?.[0]?.b64_json;
    if (!b64) throw new Error("No image returned from OpenAI");

    return res.status(200).json({
      ok: true,
      previewBase64: `data:image/png;base64,${b64}`,
      sourceUrl,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
}

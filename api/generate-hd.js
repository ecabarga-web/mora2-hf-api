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

const STYLE_PROMPTS = {
  urban:   "Turn the input photo into a bold urban-street cartoon illustration with clean inking, saturated colors, subtle halftones, soft shading, and a flat background. Keep identity and face intact, keep clothing silhouette similar. No text.",
  retro:   "Turn the input photo into a retro comic-book illustration with vintage halftones, inked outlines and muted palette. Preserve identity and expressions. No text.",
  vibrant: "Turn the input photo into a vibrant cartoon poster, high contrast, neon accents, crisp outlines. Preserve identity. No text.",
  anime:   "Turn the input photo into an anime-style character with big expressive eyes, soft cel shading, and clean lineart. Preserve identity. No text.",
};

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

    const blob = dataURLToBlob(imageBase64);
    const file = await toFile(blob, "source.png");

    const prompt = STYLE_PROMPTS[style] || STYLE_PROMPTS.urban;

    // “HD” dentro de límites del modelo (usa 1024x1024 por compatibilidad)
    const result = await openai.images.edits({
      model: "gpt-image-1",
      image: file,
      prompt,
      size: "1024x1024",
      n: 1,
    });

    const hdB64 = result?.data?.[0]?.b64_json;
    if (!hdB64) throw new Error("No HD image from OpenAI");

    // Subir a Cloudinary
    const uploadRes = await cloudinary.uploader.upload(
      data:image/png;base64,${hdB64},
      { folder: "mora2/generated_hd", overwrite: true, resource_type: "image" }
    );

    return res.status(200).json({
      ok: true,
      hdUrl: uploadRes.secure_url,
      tookMs: Date.now() - start,
    });
  } catch (e) {
    console.error("Error /api/generate-hd:", e);
    let msg = e?.message || String(e);
    if (e?.response?.data?.error?.message) msg = e.response.data.error.message;
    return res.status(400).json({ ok: false, error: msg });
  }
}

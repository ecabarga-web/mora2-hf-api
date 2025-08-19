// api/generate-hd.js
import OpenAI from "openai";
import { toFile } from "openai/uploads";
import { v2 as cloudinary } from "cloudinary";

export const config = { api: { bodyParser: { sizeLimit: "7mb" } } };

// --- OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Estilos
const STYLE_PROMPTS = {
  urban:   "Turn the input photo into a bold urban-street cartoon illustration with clean inking, saturated colors, subtle halftones and soft shading. Preserve face and identity. No text.",
  retro:   "Turn the input photo into a retro comic-book illustration with vintage halftones, inked outlines and a muted palette. Preserve identity. No text.",
  vibrant: "Turn the input photo into a vibrant cartoon poster with crisp outlines and high contrast. Preserve identity. No text.",
  anime:   "Turn the input photo into an anime-style character with clean lineart and soft cel shading. Preserve identity. No text."
};

// Tamaños permitidos por la API actual
const ALLOWED_SIZES = new Set(["1024x1024", "1024x1536", "1536x1024", "auto"]);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    let { imageBase64, sourceUrl, style = "urban", size = "1024x1024" } = req.body || {};
    if (!ALLOWED_SIZES.has(size)) size = "1024x1024";

    if (!imageBase64 && !sourceUrl) {
      return res.status(400).json({ ok: false, error: "Provide imageBase64 or sourceUrl" });
    }

    // ----- prepara archivo para OpenAI
    let file;
    if (sourceUrl) {
      const ab = await fetch(sourceUrl).then(r => r.arrayBuffer());
      file = await toFile(new Blob([ab], { type: "image/png" }), "source.png");
    } else {
      const ab = await fetch(imageBase64).then(r => r.arrayBuffer());
      const mime = (imageBase64.match(/^data:(image\/[a-zA-Z+.\-]+);base64,/) || [])[1] || "image/png";
      file = await toFile(new Blob([ab], { type: mime }), "source");
    }

    const prompt = STYLE_PROMPTS[style] || STYLE_PROMPTS.urban;

    // ----- genera HD
    const ai = await openai.images.edits({
      model: "gpt-image-1",
      image: file,
      prompt,
      size,               // <= validado arriba
      n: 1,
      response_format: "b64_json"
    });

    const hdB64 = ai?.data?.[0]?.b64_json;
    if (!hdB64) throw new Error("No HD image returned from OpenAI");

    const hdDataUrl = `data:image/png;base64,${hdB64}`;

    // ----- intenta subir a Cloudinary
    let hdUrl = null;
    try {
      const up = await cloudinary.uploader.upload(hdDataUrl, {
        folder: "mora2/generated_hd",
        overwrite: true,
        resource_type: "image"
      });
      hdUrl = up?.secure_url || null;
      console.log("[generate-hd] Cloudinary upload ok:", { public_id: up?.public_id, secure_url: up?.secure_url });
    } catch (e) {
      console.error("[generate-hd] Cloudinary upload failed:", e?.message || e);
    }

    // Devolvemos ambos: si hdUrl existe, el front usará URL; si no, usa hdDataUrl como fallback
    return res.status(200).json({
      ok: true,
      size_used: size,
      hdUrl,
      hdDataUrl
    });
  } catch (e) {
    console.error("[generate-hd] Fatal:", e?.message || e);
    return res.status(500).json({ ok: false, error: e?.message || "Internal error" });
  }
}

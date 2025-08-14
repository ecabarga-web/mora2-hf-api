// api/preview.js
import OpenAI from "openai";
import { toFile } from "openai/uploads";
import { v2 as cloudinary } from "cloudinary";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// acepta hasta ~7 MB en el body (ajústalo si lo necesitas)
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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const { imageBase64, style = "urban" } = req.body || {};
    if (!imageBase64 || typeof imageBase64 !== "string") {
      return res.status(400).json({ ok: false, error: "imageBase64 required" });
    }

    // Asegura data URL para Cloudinary (si te mandan puro base64 sin prefijo)
    const dataUrl = imageBase64.startsWith("data:")
      ? imageBase64
      : `data:image/jpeg;base64,${imageBase64}`;

    // 1) Sube ORIGINAL a Cloudinary
    const up = await cloudinary.uploader.upload(dataUrl, {
      folder: "mora2/previews_src",
      overwrite: true,
      resource_type: "image",
    });
    const sourceUrl = up.secure_url;

    // 2) Descarga original y conviértelo a File para el SDK
    const ab = await fetch(sourceUrl).then((r) => r.arrayBuffer());
    const file = await toFile(new Blob([ab], { type: "image/jpeg" }), "source.jpg");

    // 3) Genera PREVIEW 512x512 con gpt-image-1 (image-to-image)
    const prompt = STYLE_PROMPTS[style] || STYLE_PROMPTS.urban;

    const result = await openai.images.generate({
      model: "gpt-image-1",
      prompt,
      size: "512x512",
      // NO uses response_format en el SDK nuevo
      image: [file], // imagen de referencia (edición)
    });

    const b64 = result?.data?.[0]?.b64_json;
    if (!b64) {
      throw new Error("No image returned from OpenAI");
    }

    return res.status(200).json({
      ok: true,
      previewBase64: `data:image/png;base64,${b64}`,
      sourceUrl,
    });
  } catch (e) {
    console.error("Preview error:", e);
    // Si OpenAI devolvió error con payload, muéstralo como string
    const msg =
      e?.error?.message ||
      e?.message ||
      (typeof e === "string" ? e : "Unknown error");
    return res.status(500).json({ ok: false, error: msg });
  }
}

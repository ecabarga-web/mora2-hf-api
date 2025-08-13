import OpenAI from "openai";
import { toFile } from "openai/uploads";
import { v2 as cloudinary } from "cloudinary";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Aumenta el límite por si las bases64 vienen “pesadas”
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

// helper: sube un Buffer a Cloudinary usando stream
function uploadBufferToCloudinary(buf, folder = "mora2/previews_src", mime = "image/jpeg") {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, overwrite: true, resource_type: "image" },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    // importante: indicar el mimetype en el stream si el cliente lo manda
    stream.end(buf);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const { imageBase64, style = "urban" } = req.body || {};
    if (!imageBase64 || typeof imageBase64 !== "string") {
      return res.status(400).json({ ok: false, error: "imageBase64 required" });
    }

    // Aceptamos tanto data URL como base64 “pelado”
    // Intentamos extraer mime y el payload
    let mime = "image/jpeg";
    let b64 = imageBase64;

    const dataUrlMatch = imageBase64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/);
    if (dataUrlMatch) {
      mime = dataUrlMatch[1];
      b64 = dataUrlMatch[2];
    }

    // Validación básica
    if (!b64 || /[^A-Za-z0-9+/=]/.test(b64.replace(/\s/g, ""))) {
      return res.status(400).json({ ok: false, error: "Invalid base64" });
    }

    const buffer = Buffer.from(b64, "base64");

    // 1) Subimos el ORIGINAL a Cloudinary vía stream (evita ENOENT)
    const up = await uploadBufferToCloudinary(buffer, "mora2/previews_src", mime);
    const sourceUrl = up.secure_url;
    if (!sourceUrl) throw new Error("Upload to Cloudinary failed");

    // 2) Descargamos el original (URL) para pasarlo como archivo a OpenAI
    const ab = await fetch(sourceUrl).then((r) => r.arrayBuffer());
    const file = await toFile(new Blob([ab], { type: mime }), "source" + (mime.endsWith("png") ? ".png" : ".jpg"));

    // 3) Generamos PREVIEW 512x512 con gpt-image-1
    const prompt = STYLE_PROMPTS[style] || STYLE_PROMPTS.urban;

    const result = await openai.images.edits({
      model: "gpt-image-1",
      image: file,
      prompt,
      size: "512x512",
      n: 1,
      response_format: "b64_json",
    });

    const outB64 = result.data?.[0]?.b64_json;
    if (!outB64) throw new Error("No image returned from OpenAI");

    return res.status(200).json({
      ok: true,
      previewBase64: `data:image/png;base64,${outB64}`,
      sourceUrl,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: e.message || "Server error" });
  }
}

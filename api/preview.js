import OpenAI from "openai";
import { toFile } from "openai/uploads";
import { v2 as cloudinary } from "cloudinary";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// límite para el body (por si pruebas con base64)
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

function normalizeBase64(input) {
  // Si viene vacío
  if (!input || typeof input !== "string") return null;

  // Si ya es data URI
  if (input.startsWith("data:image/")) return input;

  // Si parece base64 "pura", le ponemos prefijo jpg por defecto
  const b64re = /^[A-Za-z0-9+/=\s]+$/;
  if (b64re.test(input)) {
    return `data:image/jpeg;base64,${input.replace(/\s/g, "")}`;
  }

  return null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const { imageBase64, imageUrl, style = "urban" } = req.body || {};

    // 1) Subir ORIGINAL a Cloudinary (acepta base64 data-uri o URL remota)
    let uploadSource;

    if (imageUrl && /^https?:\/\//i.test(imageUrl)) {
      uploadSource = imageUrl; // Cloudinary puede “fetch” por URL directamente
    } else {
      const dataUri = normalizeBase64(imageBase64);
      if (!dataUri) {
        return res
          .status(400)
          .json({ ok: false, error: "Invalid base64 or missing image" });
      }
      uploadSource = dataUri;
    }

    const up = await cloudinary.uploader.upload(uploadSource, {
      folder: "mora2/previews_src",
      overwrite: true,
    });
    const sourceUrl = up.secure_url;

    // 2) Descargar original para pasarlo a OpenAI como archivo
    const ab = await fetch(sourceUrl).then((r) => r.arrayBuffer());
    const file = await toFile(new Blob([ab], { type: "image/jpeg" }), "source.jpg");

    // 3) Llamar a OpenAI para el preview 512x512
    const prompt = STYLE_PROMPTS[style] || STYLE_PROMPTS.urban;

    const result = await openai.images.edits({
      model: "gpt-image-1",
      image: file,
      prompt,
      size: "512x512",
      n: 1,
      response_format: "b64_json",
    });

    const b64 = result.data?.[0]?.b64_json;
    if (!b64) throw new Error("No image returned from OpenAI");

    return res.status(200).json({
      ok: true,
      previewBase64: `data:image/png;base64,${b64}`,
      sourceUrl,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}

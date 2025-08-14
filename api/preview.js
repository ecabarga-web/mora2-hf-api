// api/preview.js
import OpenAI from "openai";
import { toFile } from "openai/uploads";
import { v2 as cloudinary } from "cloudinary";

export const config = { api: { bodyParser: { sizeLimit: "10mb" } } };

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

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

// Acepta:
//  A) imageBase64="data:image/png;base64,AAAA..."
//  B) imageBase64="AAAA..." + mime="image/png"
function normalize(imageBase64, mimeFromBody) {
  if (!imageBase64 || typeof imageBase64 !== "string") {
    throw new Error("imageBase64 required");
  }

  let mime = mimeFromBody || "";
  let raw = imageBase64;

  const m = /^data:([^;]+);base64,(.+)$/i.exec(imageBase64);
  if (m) {
    mime = m[1];
    raw = m[2];
  }
  if (!m && !mime) {
    throw new Error(
      "Invalid base64 (expected data:image/*;base64,* OR provide 'mime' with image/jpeg|image/png|image/webp)"
    );
  }

  const allowed = new Set(["image/png", "image/jpeg", "image/webp"]);
  if (!allowed.has(mime)) {
    throw new Error("Invalid image mime. Allowed: image/jpeg, image/png, image/webp");
  }

  // Valida base64
  Buffer.from(raw, "base64"); // si es inválido lanzará

  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  return { rawBase64: raw, mime, ext };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const { imageBase64, mime: mimeFromBody, style = "urban" } = req.body || {};

    // 1) Normaliza y fuerza MIME
    const { rawBase64, mime, ext } = normalize(imageBase64, mimeFromBody);
    const bytes = Uint8Array.from(Buffer.from(rawBase64, "base64"));
    const blob = new Blob([bytes], { type: mime });     // <- AQUÍ fijamos el tipo
    const fileForOpenAI = await toFile(blob, `source.${ext}`); // <- y le damos extensión

    // 2) (Opcional) sube el original a Cloudinary, por si quieres guardarlo
    let sourceUrl = "";
    try {
      const uploadRes = await new Promise((resolve, reject) => {
        cloudinary.uploader
          .upload_stream(
            { folder: "mora2/previews_src", overwrite: true, resource_type: "image" },
            (err, result) => (err ? reject(err) : resolve(result))
          )
          .end(Buffer.from(rawBase64, "base64"));
      });
      sourceUrl = uploadRes?.secure_url || "";
    } catch {}

    // 3) Genera preview con tamaño válido
    const prompt = STYLE_PROMPTS[style] || STYLE_PROMPTS.urban;
    const result = await openai.images.edit({
      model: "gpt-image-1",
      image: fileForOpenAI,
      prompt,
      size: "1024x1024", // '512x512' ya no es válido
      n: 1,
    });

    const b64 = result?.data?.[0]?.b64_json;
    if (!b64) throw new Error("No image returned from OpenAI");

    return res.status(200).json({
      ok: true,
      previewBase64: `data:image/png;base64,${b64}`,
      sourceUrl,
    });
  } catch (e) {
    const msg = e?.response?.data?.error?.message || e?.message || "Unexpected error";
    console.error("Error /api/preview:", msg);
    return res.status(400).json({ ok: false, error: msg });
  }
}

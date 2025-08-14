// api/preview.js
import OpenAI from "openai";
import { toFile } from "openai/uploads";
import { v2 as cloudinary } from "cloudinary";

// --- Vercel body size (ajústalo si necesitas más) ---
export const config = { api: { bodyParser: { sizeLimit: "10mb" } } };

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Estilos
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

// Utilidad: soporta data URL o base64 crudo con mime
function normalizeIncomingImage({ imageBase64, mime }) {
  if (!imageBase64) throw new Error("imageBase64 required");

  let _mime = mime;
  let b64 = imageBase64;

  // Caso A: data URL: data:image/png;base64,XXXX
  const m = /^data:([^;]+);base64,(.+)$/.exec(imageBase64);
  if (m) {
    _mime = m[1];
    b64 = m[2];
  }

  if (!_mime) {
    throw new Error(
      "Invalid base64 (expected data:image/*;base64,* or provide 'mime' with image/jpeg|image/png|image/webp)"
    );
  }

  const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
  if (!allowed.has(_mime)) {
    throw new Error("Invalid image file");
  }

  const buffer = Buffer.from(b64, "base64");
  if (!buffer.length) throw new Error("Invalid base64 payload");

  // extensión para el filename (OpenAI la usa para inferir mimetype si hace falta)
  const ext = _mime === "image/png" ? "png" : _mime === "image/webp" ? "webp" : "jpg";
  const filename = `upload.${ext}`;
  return { buffer, mime: _mime, filename };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const { imageBase64, mime, style = "urban" } = req.body || {};
    const { buffer, mime: resolvedMime, filename } = normalizeIncomingImage({
      imageBase64,
      mime,
    });

    // 1) Sube ORIGINAL a Cloudinary (útil para trazabilidad)
    const sourceUrl = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: "mora2/previews_src", overwrite: true, resource_type: "image" },
        (err, result) => (err ? reject(err) : resolve(result.secure_url))
      );
      stream.end(buffer);
    });

    // 2) Prepara archivo para OpenAI con nombre + extensión correcta
    // Nota: toFile(Buffer, "nombre.ext") asegura que no termine en application/octet-stream
    const file = await toFile(buffer, filename);

    const prompt = STYLE_PROMPTS[style] || STYLE_PROMPTS.urban;

    // 3) Edit con gpt-image-1 (size válido)
    const result = await openai.images.edit({
      model: "gpt-image-1",
      image: file,
      prompt,
      size: "1024x1024", // valores válidos: 1024x1024 | 1024x1536 | 1536x1024 | auto
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
    console.error("Error /api/preview:", e);
    // Mensaje claro hacia afuera
    const msg =
      e?.error?.message ||
      e?.response?.data?.error?.message ||
      e?.message ||
      "Unexpected error";
    return res.status(400).json({ ok: false, error: msg });
  }
}


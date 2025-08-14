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

// ===== Estilos =====
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

// ===== Utilidades =====
const DATAURL_RE = /^data:([^;]+);base64,([A-Za-z0-9+/=]+)$/;

function parseIncomingBase64({ imageBase64, mime }) {
  if (!imageBase64) throw new Error("imageBase64 required");

  let detectedMime = mime;
  let b64 = imageBase64;

  // Caso A: data URL completo
  const m = DATAURL_RE.exec(imageBase64);
  if (m) {
    detectedMime = m[1];
    b64 = m[2];
  } else {
    // Caso B: base64 crudo -> mime obligatorio
    if (!detectedMime) {
      throw new Error(
        "Invalid base64 (expected data:image/*;base64,* or provide 'mime' with image/jpeg|image/png|image/webp)"
      );
    }
  }

  // Validación básica
  if (!/^image\/(png|jpeg|webp)$/.test(detectedMime)) {
    throw new Error("Unsupported mime. Use image/png, image/jpeg or image/webp");
  }

  try {
    const buf = Buffer.from(b64, "base64");
    if (!buf.length) throw new Error("Empty buffer");
    return { buffer: buf, mime: detectedMime };
  } catch {
    throw new Error("Invalid base64 payload");
  }
}

function extFromMime(mime) {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg"; // por defecto
}

// ===== Handler =====
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const { style = "urban" } = req.body || {};
    const { buffer, mime } = parseIncomingBase64(req.body);

    // Sube la original a Cloudinary (opcional pero útil para trazabilidad)
    const sourceUrl = await new Promise((resolve, reject) => {
      cloudinary.uploader
        .upload_stream(
          { folder: "mora2/previews_src", overwrite: true, resource_type: "image" },
          (err, result) => (err ? reject(err) : resolve(result.secure_url))
        )
        .end(buffer);
    });

    // Prepara el archivo para OpenAI con contentType explícito
    const filename = `source.${extFromMime(mime)}`;
    const file = await toFile(buffer, filename, { contentType: mime });

    const prompt = STYLE_PROMPTS[style] || STYLE_PROMPTS.urban;

    // gpt-image-1 acepta: 1024x1024 | 1024x1536 | 1536x1024 | auto
    const result = await openai.images.edit({
      model: "gpt-image-1",
      image: file,
      prompt,
      size: "1024x1024",
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
    // Mensaje claro
    const msg =
      e?.response?.data?.error?.message ||
      e?.message ||
      "Unexpected error";
    return res.status(msg.includes("Invalid") ? 400 : 500).json({ ok: false, error: msg });
  }
}

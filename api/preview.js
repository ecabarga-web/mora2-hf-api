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

// --- Utilidades ---
function parseIncomingBase64(payload, fallbackMime = "image/jpeg") {
  if (!payload || typeof payload !== "string") {
    throw new Error("imageBase64 required");
  }

  const trimmed = payload.trim().replace(/\s+/g, ""); // elimina espacios/saltos

  // 1) data URL -> extrae mime y base64
  const m = /^data:([^;]+);base64,(.+)$/.exec(trimmed);
  if (m) {
    const mime = m[1];
    const b64 = m[2];
    return { mime, b64 };
  }

  // 2) base64 “puro” -> usa mime proporcionado por el cliente o fallback
  // Nota: aquí NO validamos caracteres del base64 para ser flexibles.
  return { mime: fallbackMime, b64: trimmed };
}

function b64ToBlob(b64, mime) {
  const buf = Buffer.from(b64, "base64");
  return new Blob([buf], { type: mime });
}

function extFromMime(mime) {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg"; // por defecto
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const { imageBase64, style = "urban", mime } = req.body || {};

    // Normaliza (acepta data URL o base64 puro + mime opcional)
    const { mime: realMime, b64 } = parseIncomingBase64(imageBase64, mime || "image/jpeg");

    // Sube original a Cloudinary (útil para trazabilidad)
    await new Promise((resolve, reject) => {
      cloudinary.uploader
        .upload_stream(
          { folder: "mora2/previews_src", overwrite: true, resource_type: "image" },
          (err, result) => (err ? reject(err) : resolve(result))
        )
        .end(Buffer.from(b64, "base64"));
    });

    // Prepara archivo para OpenAI
    const blob = b64ToBlob(b64, realMime);
    const filename = `source.${extFromMime(realMime)}`;
    const file = await toFile(blob, filename);

    // Prompt
    const prompt = STYLE_PROMPTS[style] || STYLE_PROMPTS.urban;

    // EDIT con tamaño válido (¡no 512!)
    const result = await openai.images.edit({
      model: "gpt-image-1",
      image: file,
      prompt,
      size: "1024x1024", // válidos: '1024x1024' | '1024x1536' | '1536x1024' | 'auto'
      n: 1,
    });

    const b64Out = result?.data?.[0]?.b64_json;
    if (!b64Out) throw new Error("No image returned from OpenAI");

    return res.status(200).json({
      ok: true,
      previewBase64: `data:image/png;base64,${b64Out}`,
    });
  } catch (e) {
    // Intenta mensaje legible
    const friendly =
      e?.response?.data?.error?.message ||
      e?.error?.message ||
      e?.message ||
      String(e);
    console.error("Error /api/preview:", e);
    return res.status(400).json({ ok: false, error: friendly });
  }
}

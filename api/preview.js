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

// prompts
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

/**
 * Normaliza la imagen entrante:
 * - Acepta data URL: "data:image/png;base64,AAAA..."
 * - Acepta base64 "puro": "AAAA..." + mime provisto en "mime" (o default image/jpeg)
 * - Elimina saltos/espacios.
 */
function normalizeIncomingImage({ imageBase64, mime }) {
  if (!imageBase64 || typeof imageBase64 !== "string") {
    throw new Error("imageBase64 required");
  }

  const s = imageBase64.trim().replace(/\s+/g, ""); // sin espacios/saltos
  let outMime, b64, ext;

  // data URL?
  const m = /^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=]+)$/i.exec(s);
  if (m) {
    outMime = m[1].toLowerCase();            // p.ej. image/jpeg
    b64 = m[2];
  } else {
    // base64 "puro" sin prefijo; exige mime o asume image/jpeg
    outMime = (mime || "image/jpeg").toLowerCase();
    // validar mime soportado
    if (!/^image\/(?:jpeg|jpg|png|webp)$/.test(outMime)) {
      throw new Error(`Unsupported mime: ${outMime}`);
    }
    // si por error vino con "data:image..." lo limpiamos
    const idx = s.indexOf("base64,");
    b64 = idx >= 0 ? s.slice(idx + 7) : s;
    // debe ser base64
    if (!/^[A-Za-z0-9+/=]+$/.test(b64)) {
      throw new Error("Invalid base64 payload");
    }
  }

  ext = outMime.split("/")[1];
  const buf = Buffer.from(b64, "base64");
  return { buf, mime: outMime, ext };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const { imageBase64, style = "urban", mime } = req.body || {};
    const { buf, mime: effectiveMime, ext } = normalizeIncomingImage({
      imageBase64,
      mime,
    });

    // 1) Subir original a Cloudinary (opcional, nos da URL)
    const sourceUrl = await new Promise((resolve, reject) => {
      cloudinary.uploader
        .upload_stream(
          {
            folder: "mora2/previews_src",
            overwrite: true,
            resource_type: "image",
          },
          (error, result) => {
            if (error) return reject(error);
            resolve(result.secure_url);
          }
        )
        .end(buf);
    });

    // 2) Crear archivo para OpenAI con mime correcto
    const sourceFile = await toFile(buf, `source.${ext}`, { type: effectiveMime });

    // 3) Generar preview 512x512 con OpenAI
    const prompt = STYLE_PROMPTS[style] || STYLE_PROMPTS.urban;
    const result = await openai.images.edit({
      model: "gpt-image-1",
      image: sourceFile,
      prompt,
      size: "512x512",
      n: 1,
    });

    const b64Out = result?.data?.[0]?.b64_json;
    if (!b64Out) throw new Error("No image returned from OpenAI");

    return res.status(200).json({
      ok: true,
      previewBase64: `data:image/png;base64,${b64Out}`,
      sourceUrl,
    });
  } catch (e) {
    console.error("Error /api/preview:", e);
    const msg = e?.message || String(e);
    return res.status(400).json({ ok: false, error: msg });
  }
}

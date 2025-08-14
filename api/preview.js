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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const { imageBase64, style = "urban" } = req.body || {};
    if (!imageBase64) {
      return res.status(400).json({ ok: false, error: "imageBase64 required" });
    }

    // --- 1) Parsear el data URL y construir Buffer + mime + extensión ---
    const m = /^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(
      imageBase64.trim()
    );
    if (!m) {
      return res
        .status(400)
        .json({ ok: false, error: "Invalid base64 (expected data:image/*;base64,*)" });
    }

    const mime = m[1];                         // p.ej. image/jpeg
    const b64 = m[2];                          // solo la parte base64
    const buf = Buffer.from(b64, "base64");
    const ext = mime.split("/")[1] || "jpg";   // jpeg | png | webp

    // Crear archivo para OpenAI con el mime correcto (¡clave para evitar octet-stream!)
    const sourceFile = await toFile(buf, `source.${ext}`, { type: mime });

    // --- 2) (Opcional) Subir original a Cloudinary para tener un URL de referencia ---
    const sourceUrl = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: "mora2/previews_src",
          overwrite: true,
          resource_type: "image",
        },
        (error, result) => {
          if (error) return reject(error);
          resolve(result.secure_url);
        }
      );
      stream.end(buf); // subimos el buffer directamente
    });

    // --- 3) Generar preview 512x512 con OpenAI ---
    const prompt = STYLE_PROMPTS[style] || STYLE_PROMPTS.urban;

    const result = await openai.images.edit({
      model: "gpt-image-1",
      image: sourceFile,
      prompt,
      size: "512x512",
      n: 1,
      // NO poner response_format: el SDK ya devuelve b64_json
    });

    const b64Out = result?.data?.[0]?.b64_json;
    if (!b64Out) throw new Error("No image returned from OpenAI");

    return res.status(200).json({
      ok: true,
      previewBase64: `data:image/png;base64,${b64Out}`,
      sourceUrl,
    });
  } catch (e) {
    console.error("Error en /api/preview:", e);
    let msg = e?.message || String(e);
    if (e?.response?.data?.error?.message) msg = e.response.data.error.message;
    return res.status(500).json({ ok: false, error: msg });
  }
}

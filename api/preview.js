// api/preview.js
import OpenAI from "openai";
import { toFile } from "openai/uploads";
import { v2 as cloudinary } from "cloudinary";

// -------- Config --------
export const config = { api: { bodyParser: { sizeLimit: "15mb" } } };

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

// Utilidad: dataURL -> Blob
function dataURLToBlob(dataUrl) {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || "");
  if (!m) throw new Error("Invalid base64 (expected data:image/*;base64,...)");
  const mime = m[1];
  const b64 = m[2];
  const buf = Buffer.from(b64, "base64");
  return { blob: new Blob([buf], { type: mime }), mime };
}

// Utilidad: URL remota -> Blob + mime
async function urlToBlob(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Fetch failed (${resp.status})`);
  const mime = resp.headers.get("content-type") || "";
  if (!/^image\/(png|jpeg|jpg|webp)$/i.test(mime)) {
    throw new Error(
      `Unsupported image mime from URL (${mime}). Use image/jpeg, image/png or image/webp.`
    );
  }
  const ab = await resp.arrayBuffer();
  return { blob: new Blob([ab], { type: mime }), mime };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const t0 = Date.now();
  try {
    const { imageBase64, imageUrl, style = "urban" } = req.body || {};
    const prompt = STYLE_PROMPTS[style] || STYLE_PROMPTS.urban;

    let file;          // File para OpenAI
    let sourceUrl;     // URL a devolver (Cloudinary o la misma remota)
    let debug = {};    // Para ayudarte a ver qué se envió

    if (imageBase64) {
      // A) Data URL base64
      const { blob, mime } = dataURLToBlob(imageBase64);
      const ext =
        mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
      file = await toFile(blob, `source.${ext}`);
      // (Opcional) subimos original a Cloudinary
      const up = await cloudinary.uploader.upload(imageBase64, {
        folder: "mora2/previews_src",
        overwrite: true,
      });
      sourceUrl = up.secure_url;
      debug = { mode: "base64", mimeSent: mime, filename: `source.${ext}` };
    } else if (imageUrl) {
      // B) URL remota
      const { blob, mime } = await urlToBlob(imageUrl);
      const ext =
        mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
      file = await toFile(blob, `source.${ext}`);
      sourceUrl = imageUrl; // o súbela a Cloudinary si quieres
      debug = { mode: "url", mimeSent: mime, filename: `source.${ext}` };
    } else {
      return res
        .status(400)
        .json({ ok: false, error: "Provide either imageBase64 or imageUrl" });
    }

    // OpenAI (gpt-image-1) — tamaños válidos: 1024x1024 / 1024x1536 / 1536x1024 / auto
    const result = await openai.images.edits({
      model: "gpt-image-1",
      image: file,
      prompt,
      size: "1024x1024",
      n: 1,
      // No pongas response_format; SDK devuelve b64_json por defecto
    });

    const b64 = result?.data?.[0]?.b64_json;
    if (!b64) throw new Error("No image returned from OpenAI");

    return res.status(200).json({
      ok: true,
      previewBase64: `data:image/png;base64,${b64}`,
      sourceUrl,
      debug: { ...debug, tookMs: Date.now() - t0 },
    });
  } catch (e) {
    // Limpio y útil
    const msg =
      e?.response?.data?.error?.message ||
      e?.message ||
      "Unexpected error processing image";
    return res.status(400).json({ ok: false, error: msg });
  }
}

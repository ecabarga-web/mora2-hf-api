// api/preview.js
import OpenAI from "openai";
import { toFile } from "openai/uploads";

export const config = { api: { bodyParser: { sizeLimit: "10mb" } } };

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- Estilos (igual que antes) ---
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

// Util: adivinar mime por extensión (cuando GHL manda octet-stream)
function guessMimeFromUrl(url) {
  const u = (url || "").split("?")[0].toLowerCase();
  if (u.endsWith(".png")) return "image/png";
  if (u.endsWith(".jpg") || u.endsWith(".jpeg")) return "image/jpeg";
  if (u.endsWith(".webp")) return "image/webp";
  return "image/png";
}

// Util: dataURL -> Blob
function dataURLToBlob(dataUrl) {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || "");
  if (!m) throw new Error("Invalid base64 (expected data:image/*;base64,...)");
  const mime = m[1];
  const b64 = m[2];
  const buf = Buffer.from(b64, "base64");
  return new Blob([buf], { type: mime || "image/png" });
}

// Normaliza: devuelve un File listo para OpenAI desde imageBase64 o imageUrl
async function normalizeToFile({ imageBase64, imageUrl }) {
  if (imageBase64) {
    const blob = dataURLToBlob(imageBase64);
    return await toFile(blob, "source.png");
  }
  if (imageUrl) {
    const resp = await fetch(imageUrl);
    if (!resp.ok) throw new Error(`Download failed (${resp.status})`);
    const ab = await resp.arrayBuffer();

    // intenta obtener mime real; si viene octet-stream, usa la extensión
    let mime = resp.headers.get("content-type");
    if (!mime || mime === "application/octet-stream") {
      mime = guessMimeFromUrl(imageUrl);
    }
    // seguridad básica de tamaño (10MB)
    if (ab.byteLength > 10 * 1024 * 1024) {
      throw new Error("Image too large (max 10MB)");
    }
    const blob = new Blob([ab], { type: mime });
    return await toFile(blob, mime.includes("jpeg") ? "source.jpg" : "source.png");
  }
  throw new Error("Send either imageBase64 (data URL) or imageUrl");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  try {
    const { imageBase64, imageUrl, style = "urban" } = req.body || {};
    if (!imageBase64 && !imageUrl) {
      return res
        .status(400)
        .json({ ok: false, error: "Provide imageBase64 (data URL) or imageUrl" });
    }

    const file = await normalizeToFile({ imageBase64, imageUrl });
    const prompt = STYLE_PROMPTS[style] || STYLE_PROMPTS.urban;

    // Nota: tamaños válidos hoy: 1024x1024, 1024x1536, 1536x1024, auto
    const result = await openai.images.edits({
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
      debug: {
        from: imageBase64 ? "base64" : "url",
      },
    });
  } catch (e) {
    console.error("Error /api/preview:", e);
    const msg =
      e?.response?.data?.error?.message ||
      e?.message ||
      "Unexpected error";
    return res.status(400).json({ ok: false, error: msg });
  }
}

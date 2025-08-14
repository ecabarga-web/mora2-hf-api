// api/preview.js
import OpenAI from "openai";
import { toFile } from "openai/uploads";

// Aumenta el límite por si mandas imágenes base64 grandes
export const config = { api: { bodyParser: { sizeLimit: "10mb" } } };

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Mapeo de MIME a extensión
const EXT = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

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

// Normaliza la entrada: acepta dataURL o base64 “puro” + mime
function normalizeIncomingImage(imageBase64, mimeFromBody) {
  if (!imageBase64 || typeof imageBase64 !== "string") {
    throw new Error("imageBase64 required");
  }

  let mime;
  let rawB64;

  // Caso A: dataURL
  const m = /^data:([^;]+);base64,(.+)$/i.exec(imageBase64);
  if (m) {
    mime = m[1].toLowerCase();
    rawB64 = m[2];
  } else {
    // Caso B: base64 puro + mime
    if (!mimeFromBody) {
      throw new Error(
        "Invalid base64 (expected data:image/*;base64,* or provide 'mime' with image/jpeg|image/png|image/webp)"
      );
    }
    mime = String(mimeFromBody).toLowerCase();
    rawB64 = imageBase64;
  }

  if (!EXT[mime]) {
    throw new Error(
      "Unsupported mime. Use one of: image/jpeg, image/png, image/webp"
    );
  }

  // Validación rápida de base64
  if (!/^[a-z0-9+/=]+$/i.test(rawB64)) {
    throw new Error("Invalid base64 payload");
  }

  const buf = Buffer.from(rawB64, "base64");
  const blob = new Blob([buf], { type: mime });
  const filename = `upload.${EXT[mime]}`;

  return { blob, filename };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const { imageBase64, mime, style = "urban" } = req.body || {};
    const prompt = STYLE_PROMPTS[style] || STYLE_PROMPTS.urban;

    // 1) Normaliza entrada -> Blob + filename con extensión correcta
    const { blob, filename } = normalizeIncomingImage(imageBase64, mime);
    const file = await toFile(blob, filename); // el MIME viaja en el blob

    // 2) Llama a OpenAI (nota: tamaños válidos ya no incluyen 512x512)
    const result = await openai.images.edit({
      model: "gpt-image-1",
      image: file,
      prompt,
      size: "1024x1024", // '1024x1024' | '1024x1536' | '1536x1024' | 'auto'
      n: 1,
    });

    const b64 = result?.data?.[0]?.b64_json;
    if (!b64) throw new Error("No image returned from OpenAI");

    return res
      .status(200)
      .json({ ok: true, previewBase64: `data:image/png;base64,${b64}` });
  } catch (e) {
    // Intenta un mensaje más claro si viene de OpenAI
    let msg = e?.message || String(e);
    if (e?.error?.message) msg = e.error.message;
    if (e?.response?.data?.error?.message) msg = e.response.data.error.message;

    // Regresa 400 si es de validación; 500 si parece otra cosa
    const isBadReq =
      /invalid|unsupported|required|mime|base64|method/i.test(msg) ||
      e?.status === 400 ||
      e?.code === "invalid_request_error";

    return res.status(isBadReq ? 400 : 500).json({ ok: false, error: msg });
  }
}


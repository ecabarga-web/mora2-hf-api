// api/preview.js
import OpenAI from "openai";
import { toFile } from "openai/uploads";
import { v2 as cloudinary } from "cloudinary";

// --- Vercel body size ---
export const config = { api: { bodyParser: { sizeLimit: "10mb" } } };

// --- SDKs ---
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// --- Estilos ---
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

// --- Util: normalizar base64 ---
// Admite:
//  A) dataURL -> "data:image/png;base64,AAAA..."
//  B) raw + mime -> { imageBase64: "AAAA...", mime: "image/png" }
function normalizeIncomingImage(imageBase64, mimeFromBody) {
  if (!imageBase64 || typeof imageBase64 !== "string") {
    throw new Error("imageBase64 required");
  }

  let mime = mimeFromBody || "";
  let raw = imageBase64;

  const dataUrlMatch = /^data:([^;]+);base64,(.+)$/i.exec(imageBase64);
  if (dataUrlMatch) {
    mime = dataUrlMatch[1];
    raw = dataUrlMatch[2];
  }

  if (!dataUrlMatch && !mime) {
    throw new Error(
      "Invalid base64 (expected data:image/*;base64,* OR provide 'mime' with image/jpeg|image/png|image/webp)"
    );
  }

  // validar mime soportado
  const allowed = new Set(["image/png", "image/jpeg", "image/webp"]);
  if (!allowed.has(mime)) {
    throw new Error(
      "Invalid image mime. Allowed: image/jpeg, image/png, image/webp"
    );
  }

  // validar que sea base64
  try {
    // si no es base64 válido, Buffer lanzará
    Buffer.from(raw, "base64");
  } catch {
    throw new Error("Invalid base64 payload");
  }

  // extensión por mime (para que el SDK NO lo lea como octet-stream)
  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";

  return { rawBase64: raw, mime, ext };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const { imageBase64, mime: mimeFromBody, style = "urban" } = req.body || {};
    // 1) Normalizar entrada
    const { rawBase64, mime, ext } = normalizeIncomingImage(imageBase64, mimeFromBody);
    const imgBuffer = Buffer.from(rawBase64, "base64");

    // 2) Subir ORIGINAL a Cloudinary (opcional pero útil)
    const uploadResult = await new Promise((resolve, reject) => {
      cloudinary.uploader
        .upload_stream(
          {
            folder: "mora2/previews_src",
            overwrite: true,
            resource_type: "image",
          },
          (error, result) => {
            if (error) return reject(error);
            resolve(result);
          }
        )
        .end(imgBuffer);
    });
    const sourceUrl = uploadResult?.secure_url;

    // 3) Preparar archivo para OpenAI con extensión correcta
    const fileForOpenAI = await toFile(imgBuffer, `source.${ext}`);

    // 4) Generar preview (TAMAÑO VÁLIDO: 1024x1024 / 1024x1536 / 1536x1024 / "auto")
    const prompt = STYLE_PROMPTS[style] || STYLE_PROMPTS.urban;

    const result = await openai.images.edit({
      model: "gpt-image-1",
      image: fileForOpenAI,
      prompt,
      size: "1024x1024", // ⬅️ evita el error de 512x512
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
    // Mensaje claro al cliente
    const msg =
      e?.response?.data?.error?.message ||
      e?.message ||
      "Unexpected error";
    // Log útil en Vercel
    console.error("Error /api/preview:", e);
    return res.status(400).json({ ok: false, error: msg });
  }
}

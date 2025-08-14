// api/preview.js
import OpenAI from "openai";
import { toFile } from "openai/uploads";
import { v2 as cloudinary } from "cloudinary";

// --- CONFIG ---
export const config = { api: { bodyParser: { sizeLimit: "10mb" } } };

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Estilos
const STYLE_PROMPTS = { ... };  // (igual que antes, sin cambios)

function dataURLToBlob(dataUrl) {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || "");
  if (!m) throw new Error("Invalid base64");
  const mime = m[1];
  const b64 = m[2];
  const buf = Buffer.from(b64, "base64");
  return new Blob([buf], { type: mime || "image/jpeg" });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const { imageBase64, style = "urban" } = req.body || {};
    if (!imageBase64) {
      return res.status(400).json({ ok: false, error: "imageBase64 required" });
    }

    // 1) Subimos la imagen original a Cloudinary usando upload_stream
    const base64Data = imageBase64.split(",")[1]; // separa el prefijo data:
    const imgBuffer = Buffer.from(base64Data, "base64");
    const uploadResult = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        { folder: "mora2/previews_src", overwrite: true },
        (error, result) => {
          if (error) return reject(error);
          resolve(result);
        }
      ).end(imgBuffer);
    });
    const sourceUrl = uploadResult.secure_url;  // URL de la imagen original subida

    // 2) Preparamos el archivo para OpenAI (como Blob a File) 
    const sourceBlob = dataURLToBlob(imageBase64);
    const sourceFile = await toFile(sourceBlob, "source.jpg");

    // 3) Generamos la imagen de vista previa 512x512 con OpenAI
    const prompt = STYLE_PROMPTS[style] || STYLE_PROMPTS.urban;
    const result = await openai.images.edit({
      model: "gpt-image-1",
      image: sourceFile,
      prompt,
      size: "512x512",
      n: 1,
      // No especifiques response_format (por defecto devuelve base64 en data.b64_json)
    });

    const b64 = result.data[0]?.b64_json;
    if (!b64) throw new Error("No image returned from OpenAI");

    return res.status(200).json({
      ok: true,
      previewBase64: `data:image/png;base64,${b64}`,
      sourceUrl,
    });
  } catch (e) {
    console.error("Error en /api/preview:", e);
    // Intenta extraer mensaje detallado si viene de OpenAI o Cloudinary
    let errorMessage = e.message || String(e);
    if (e.response?.data?.error?.message) {
      errorMessage = e.response.data.error.message;
    }
    return res.status(500).json({ ok: false, error: errorMessage });
  }
}

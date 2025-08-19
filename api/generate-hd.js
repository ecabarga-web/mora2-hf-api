// api/generate-hd.js
// Genera la versión "HD" (1024x1024) con OpenAI y la sube a Cloudinary.
// Incluye CORS y acepta dos modos de entrada: {sourceUrl} o {imageBase64 (data URL)}.

export const config = { api: { bodyParser: { sizeLimit: "15mb" } } };

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY;
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "https://mora2.com";

// === Cloudinary SDK (solo uploader) ===
import { v2 as cloudinary } from "cloudinary";
cloudinary.config({
  cloud_name: CLOUDINARY_CLOUD_NAME,
  api_key: CLOUDINARY_API_KEY,
  api_secret: CLOUDINARY_API_SECRET,
});

// === Utiles ===
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function bad(res, code, msg) {
  return res.status(code).json({ ok: false, error: msg });
}

const STYLE_PROMPTS = {
  urban:
    "Create a clean, stylized urban-street cartoon of the subject. Keep facial identity and proportions consistent. Crisp lines, bold but harmonious colors, subtle shading. No text.",
  comic:
    "Create a clean retro comic illustration of the subject with neat inking, controlled halftones and balanced color palette. Preserve identity. No text.",
  cartoon:
    "Create a vibrant cartoon poster of the subject. Clean outlines, saturated colors, soft shading. Preserve identity. No text.",
  anime:
    "Create an anime-style illustration of the subject with clean cel shading and precise linework. Preserve identity. No text."
};

// Convierte una data URL a Blob + mime
function dataUrlToBlob(dataUrl) {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || "");
  if (!m) throw new Error("Invalid data URL");
  const mime = m[1];
  const b64 = m[2];
  const buf = Buffer.from(b64, "base64");
  return { blob: new Blob([buf], { type: mime }), mime };
}

// Deriva extensión simple desde mime
function extFromMime(mime) {
  if (!mime || typeof mime !== "string") return "png";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  return "png";
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return bad(res, 405, "Method not allowed");

  try {
    if (!OPENAI_API_KEY) return bad(res, 500, "Missing OPENAI_API_KEY");
    if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
      return bad(res, 500, "Cloudinary not configured");
    }

    const { imageBase64, sourceUrl, style = "urban" } = req.body || {};
    if (!imageBase64 && !sourceUrl) {
      return bad(res, 400, "Provide sourceUrl or imageBase64 (data URL)");
    }

    // --- Normalizamos a Blob + mime + filename ---
    let fileBlob, mime, filename;

    if (imageBase64) {
      // Viene como data URL
      const r = dataUrlToBlob(imageBase64);
      fileBlob = r.blob;
      mime = r.mime;
      filename = "source." + extFromMime(mime);
    } else {
      // Viene como URL (ej. Cloudinary / GHL storage)
      const resp = await fetch(sourceUrl);
      if (!resp.ok) throw new Error(`Cannot fetch sourceUrl (${resp.status})`);
      const ct = resp.headers.get("content-type") || "image/png";
      const ab = await resp.arrayBuffer();
      fileBlob = new Blob([ab], { type: ct });
      mime = ct; // ⬅️ ahora SÍ tenemos mime definido
      filename = "source." + extFromMime(mime);
    }

    // --- Llamada a OpenAI Images (edits) ---
    // Usamos fetch con FormData nativo; NO incluir response_format (da 400).
    const prompt = STYLE_PROMPTS[style] || STYLE_PROMPTS.urban;

    const form = new FormData();
    form.append("model", "gpt-image-1");
    form.append("prompt", prompt);
    form.append("size", "1024x1024"); // valores soportados
    form.append("image", fileBlob, filename);

    const oa = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`
      },
      body: form
    });

    if (!oa.ok) {
      const text = await oa.text().catch(() => "");
      return bad(res, oa.status, text || "OpenAI error");
    }

    const j = await oa.json();
    const b64 = j?.data?.[0]?.b64_json;
    if (!b64) return bad(res, 500, "No image returned from OpenAI");

    // --- Subimos a Cloudinary (y devolvemos hdUrl) ---
    const upload = await cloudinary.uploader.upload(
      `data:image/png;base64,${b64}`,
      {
        folder: "mora2/generated_hd",
        overwrite: true,
        resource_type: "image",
        public_id: `hd_${Date.now()}`
      }
    );

    const hdUrl = upload?.secure_url;
    if (!hdUrl) return bad(res, 500, "HD generated but no URL");

    return res.status(200).json({ ok: true, hdUrl });
  } catch (err) {
    console.error("Error /api/generate-hd:", err);
    return bad(res, 500, err.message || "Internal error");
  }
}

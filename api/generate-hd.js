// /api/generate-hd.js
export const config = { api: { bodyParser: { sizeLimit: "12mb" } } };

const ORIGIN = process.env.ALLOWED_ORIGIN || "*";
const OPENAI_KEY = process.env.OPENAI_API_KEY;

// Cloudinary opcional
const C_CLOUD = process.env.CLOUDINARY_CLOUD_NAME;
const C_KEY = process.env.CLOUDINARY_API_KEY;
const C_SEC = process.env.CLOUDINARY_API_SECRET;

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function dataUrlToBlob(dataUrl) {
  const m = /^data:(image\/(png|jpeg|webp));base64,(.+)$/i.exec(dataUrl || "");
  if (!m) return null;
  const [, mime, , b64] = m;
  const buf = Buffer.from(b64, "base64");
  return new Blob([buf], { type: mime });
}

async function urlToBlob(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch sourceUrl ${r.status}`);
  const ct = r.headers.get("content-type") || "";
  if (!/^image\/(png|jpe?g|webp)$/i.test(ct)) {
    throw new Error(`unsupported content-type: ${ct}`);
  }
  const ab = await r.arrayBuffer();
  return new Blob([ab], { type: ct });
}

async function openaiImageEdit({ blob, prompt, size }) {
  const fd = new FormData();
  fd.append("model", "gpt-image-1");
  fd.append("prompt", prompt);
  fd.append("size", size); // "1024x1024"
  const ext =
    blob.type === "image/png"
      ? "png"
      : blob.type === "image/webp"
      ? "webp"
      : "jpg";
  fd.append("image", blob, `source.${ext}`);

  const resp = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_KEY}` },
    body: fd,
  });

  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg =
      json?.error?.message ||
      `OpenAI error ${resp.status} ${resp.statusText}`;
    const err = new Error(msg);
    err.status = resp.status;
    throw err;
  }

  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) throw new Error("No image returned by OpenAI");
  return `data:image/png;base64,${b64}`;
}

const STYLE_PROMPTS = {
  urban:
    "Turn the input photo into a bold urban-street cartoon illustration with clean inking, saturated colors, subtle halftones, soft shading, and transparent background. Keep identity and face intact, keep clothing silhouette similar. No text.",
  comic:
    "Turn the input photo into a retro comic-book illustration with vintage halftones, inked outlines and muted palette. Preserve identity and expressions. Transparent Background. No text.",
  cartoon:
    "Turn the input photo into a vibrant cartoon poster, high contrast, neon accents, crisp outlines. Transparent Background.Preserve identity. No text.",
  anime:
    "Turn the input photo into an anime-style character with big expressive eyes, soft cel shading, and clean lineart. Transparent Background.Preserve identity. No text.",
};

async function uploadCloudinary(dataUrl) {
  if (!C_CLOUD || !C_KEY || !C_SEC) return null;
  const url = `https://api.cloudinary.com/v1_1/${C_CLOUD}/image/upload`;

  // Debes tener un preset firmado o firmar server-side. Como ya estás en server,
  // subimos con firma básica (timestamp + api_key + secret).
  const timestamp = Math.floor(Date.now() / 1000);
  const paramsToSign = `timestamp=${timestamp}${C_SEC}`;
  const sha1 = await crypto.subtle.digest(
    "SHA-1",
    new TextEncoder().encode(paramsToSign)
  );
  const signature = Array.from(new Uint8Array(sha1))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const fd = new FormData();
  fd.append("file", dataUrl);
  fd.append("api_key", C_KEY);
  fd.append("timestamp", String(timestamp));
  fd.append("signature", signature);
  fd.append("folder", "mora2/generated_hd");

  const r = await fetch(url, { method: "POST", body: fd });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || "Cloudinary upload failed");
  return j.secure_url;
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    if (!OPENAI_KEY) throw new Error("Missing OPENAI_API_KEY");
    const { imageBase64, sourceUrl, style = "urban" } = req.body || {};

    let blob = null;
    if (imageBase64) {
      blob = dataUrlToBlob(imageBase64);
      if (!blob) throw new Error("Invalid data URL (imageBase64)");
    } else if (sourceUrl) {
      blob = await urlToBlob(sourceUrl);
    } else {
      return res
        .status(400)
        .json({ ok: false, error: "imageBase64 or sourceUrl required" });
    }

    const prompt = STYLE_PROMPTS[style] || STYLE_PROMPTS.urban;
    const hdDataUrl = await openaiImageEdit({
      blob,
      prompt,
      size: "1024x1024",
    });

    // Si hay Cloudinary, subimos y devolvemos URL
    let hdUrl = null;
    try {
      hdUrl = await uploadCloudinary(hdDataUrl);
    } catch (_) {
      // si falla Cloudinary, devolvemos base64 igualmente
    }

    return res
      .status(200)
      .json({ ok: true, hdUrl, hdBase64: hdUrl ? undefined : hdDataUrl });
  } catch (e) {
    const status = e.status || 500;
    return res
      .status(status)
      .json({ ok: false, error: String(e.message || e) });
  }
}

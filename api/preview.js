// /api/preview.js
export const config = { api: { bodyParser: { sizeLimit: "10mb" } } };

const ORIGIN = process.env.ALLOWED_ORIGIN || "*";
const OPENAI_KEY = process.env.OPENAI_API_KEY;

// prompts por estilo
const STYLE_PROMPTS = {
  urban:
    "Turn the input photo into a bold urban-street cartoon illustration with clean inking, saturated colors, subtle halftones, soft shading, and a flat background. Keep identity and face intact, keep clothing silhouette similar. No text.",
  comic:
    "Turn the input photo into a retro comic-book illustration with vintage halftones, inked outlines and muted palette. Preserve identity and expressions. No text.",
  cartoon:
    "Turn the input photo into a vibrant cartoon poster, high contrast, neon accents, crisp outlines. Preserve identity. No text.",
  anime:
    "Turn the input photo into an anime-style character with big expressive eyes, soft cel shading, and clean lineart. Preserve identity. No text.",
};

// ---------- util CORS ----------
function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// ---------- util: validar y convertir entrada a Blob ----------
function dataUrlToBlob(dataUrl) {
  // data:image/png;base64,AAAA...
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

// ---------- llamada REST directa a /v1/images/edits ----------
async function openaiImageEdit({ blob, prompt, size }) {
  const fd = new FormData();
  fd.append("model", "gpt-image-1");
  fd.append("prompt", prompt);
  fd.append("size", size); // "1024x1024"
  // nombre de archivo acorde al mime
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

// ---------- handler ----------
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
    const previewBase64 = await openaiImageEdit({
      blob,
      prompt,
      size: "1024x1024",
    });

    return res.status(200).json({ ok: true, previewBase64 });
  } catch (e) {
    const status = e.status || 500;
    return res
      .status(status)
      .json({ ok: false, error: String(e.message || e) });
  }
}

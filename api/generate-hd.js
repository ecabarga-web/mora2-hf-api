import OpenAI from "openai";
import { toFile } from "openai/uploads";
import { v2 as cloudinary } from "cloudinary";

export const config = { api: { bodyParser: { sizeLimit: "7mb" } } };

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// --- CORS ---
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

const STYLE_PROMPTS = {
  urban:  "Turn the input photo into a bold urban-street cartoon illustration with clean inking, saturated colors, subtle halftones, soft shading, and a flat background. Keep identity and face intact. No text.",
  comic:  "Turn the input photo into a retro comic-book illustration with vintage halftones, inked outlines and muted palette. Keep identity intact. No text.",
  cartoon:"Turn the input photo into a vibrant cartoon poster with high contrast and crisp outlines. Keep identity intact. No text.",
  anime:  "Turn the input photo into an anime-style character with big expressive eyes, soft cel shading, and clean lineart. Keep identity intact. No text."
};

function inferExt(mime) {
  if (mime.includes("png"))  return "png";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  return "png";
}

function parseDataUrl(dataUrl) {
  const m = /^data:(.+?);base64,(.+)$/.exec(dataUrl || "");
  if (!m) return null;
  const mime = m[1];
  const b64  = m[2];
  const buf  = Buffer.from(b64, "base64");
  const blob = new Blob([buf], { type: mime });
  const ext  = inferExt(mime);
  const fileName = `source.${ext}`;
  return { blob, fileName, mime };
}

async function fetchUrlAsBlob(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch imageUrl failed: ${r.status}`);
  const ab  = await r.arrayBuffer();
  let mime  = r.headers.get("content-type") || "";
  if (!/image\/(png|jpeg|webp)/.test(mime)) {
    if (url.endsWith(".png")) mime = "image/png";
    else if (/\.(jpe?g)$/i.test(url)) mime = "image/jpeg";
    else if (url.endsWith(".webp")) mime = "image/webp";
    else mime = "image/png";
  }
  const blob = new Blob([ab], { type: mime });
  const ext  = inferExt(mime);
  return { blob, fileName: `source.${ext}`, mime };
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS).end();
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405, CORS_HEADERS).end();
    return;
  }

  try {
    const { imageBase64, sourceUrl, imageUrl, style = "urban" } = req.body || {};

    let blobInfo = null;
    if (sourceUrl) {
      blobInfo = await fetchUrlAsBlob(sourceUrl);
    } else if (imageUrl) {
      blobInfo = await fetchUrlAsBlob(imageUrl);
    } else if (imageBase64) {
      blobInfo = parseDataUrl(imageBase64);
      if (!blobInfo) {
        res.writeHead(400, CORS_HEADERS);
        return res.end(JSON.stringify({ ok: false, error: "Invalid base64 (expected data:image/*;base64,...)" }));
      }
    } else {
      res.writeHead(400, CORS_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: "Provide one of: sourceUrl | imageUrl | imageBase64" }));
    }

    const { blob, fileName } = blobInfo;
    const file = await toFile(blob, fileName);

    const prompt = STYLE_PROMPTS[style] || STYLE_PROMPTS.urban;

    // HD 2048
    const result = await openai.images.edits({
      model: "gpt-image-1",
      image: file,
      prompt,
      size: "2048x2048",
      n: 1,
      response_format: "b64_json"
    });

    const b64 = result.data?.[0]?.b64_json;
    if (!b64) throw new Error("No HD from OpenAI");

    // Subimos a Cloudinary
    const up = await cloudinary.uploader.upload(
      `data:image/png;base64,${b64}`,
      { folder: "mora2/generated_hd", resource_type: "image", overwrite: true }
    );

    res.writeHead(200, { "Content-Type": "application/json", ...CORS_HEADERS });
    res.end(JSON.stringify({ ok: true, hdUrl: up.secure_url }));
  } catch (e) {
    console.error("Error /api/generate-hd:", e);
    res.writeHead(500, { "Content-Type": "application/json", ...CORS_HEADERS });
    res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
  }
}

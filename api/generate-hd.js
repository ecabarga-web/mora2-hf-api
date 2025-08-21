// api/generate-hd.js
import OpenAI from "openai";
import { toFile } from "openai/uploads";
import { put } from "@vercel/blob";

// === HOTFIX CORS (abierto) ===
function getCorsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export const config = { api: { bodyParser: { sizeLimit: "12mb" } } };

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

function stylePrompt(style) {
  return STYLE_PROMPTS[style] || STYLE_PROMPTS.urban;
}

function parseDataUrl(dataUrl) {
  const m = /^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/i.exec(dataUrl || "");
  if (!m) return null;
  const mime = m[1].toLowerCase();
  const b64 = m[2];
  return { mime, buf: Buffer.from(b64, "base64") };
}

async function fetchAsTypedBlob(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch sourceUrl failed (${r.status})`);
  const ct = (r.headers.get("content-type") || "").toLowerCase();
  const mime =
    ct.includes("image/png") ? "image/png" :
    (ct.includes("image/jpeg") || ct.includes("image/jpg")) ? "image/jpeg" :
    ct.includes("image/webp") ? "image/webp" :
    null;
  if (!mime) throw new Error(`Unsupported mime from sourceUrl (${ct || "unknown"})`);
  const ab = await r.arrayBuffer();
  return new Blob([ab], { type: mime });
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req, res) {
  const headers = getCorsHeaders();

  // Preflight
  if (req.method === "OPTIONS") {
    return res.status(200).set(headers).end();
  }

  // GET de diagnóstico
  if (req.method === "GET") {
    return res.status(200).set(headers).json({
      ok: true,
      route: "generate-hd",
      time: new Date().toISOString(),
    });
  }

  if (req.method !== "POST") {
    return res.status(405).set(headers).json({ ok: false, error: "Method not allowed" });
  }

  const started = Date.now();

  try {
    const { sourceUrl, imageBase64, style = "urban" } = req.body || {};
    if (!sourceUrl && !imageBase64) {
      return res.status(400).set(headers).json({ ok: false, error: "Provide sourceUrl or imageBase64 (data URL)" });
    }

    // Normaliza a File
    let fileForOpenAI;
    if (sourceUrl) {
      const blob = await fetchAsTypedBlob(sourceUrl);
      fileForOpenAI = await toFile(blob, "source");
    } else {
      const parsed = parseDataUrl(imageBase64);
      if (!parsed) {
        return res.status(400).set(headers).json({ ok: false, error: "Invalid data URL in imageBase64" });
      }
      const blob = new Blob([parsed.buf], { type: "image/png" }); // tipamos a png
      fileForOpenAI = await toFile(blob, "source");
    }

    // OpenAI HD (1024)
    const prompt = stylePrompt(style);
    const result = await openai.images.edits({
      model: "gpt-image-1",
      image: fileForOpenAI,
      prompt,
      size: "1024x1024",
      n: 1,
    });

    const b64 = result?.data?.[0]?.b64_json;
    if (!b64) throw new Error("No HD image from OpenAI");

    // Sube a Vercel Blob
    const bytes = Buffer.from(b64, "base64");
    const key = `mora2/hd_${Date.now()}_${Math.random().toString(36).slice(2)}.png`;

    const putRes = await put(key, bytes, {
      contentType: "image/png",
      access: "public",
    });

    return res.status(200).set(headers).json({
      ok: true,
      hdUrl: putRes.url,
      hdKey: putRes.pathname || key,
      tookMs: Date.now() - started,
    });

  } catch (e) {
    console.error("Error /api/generate-hd:", e);
    return res.status(500).set(headers).json({ ok: false, error: e?.message || String(e) });
  }
}

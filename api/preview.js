// api/preview.js
import OpenAI from "openai";
import { toFile } from "openai/uploads";

// === CORS ===
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "https://mora2.com";
function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
}

export const config = { api: { bodyParser: { sizeLimit: "7mb" } } };

const STYLE_PROMPTS = {
  urban:  "Turn the input photo into a bold urban-street cartoon illustration with clean inking, saturated colors, subtle halftones, soft shading, and a flat background. Keep identity and face intact, keep clothing silhouette similar. No text.",
  comic:  "Turn the input photo into a retro comic-book illustration with vintage halftones, inked outlines and muted palette. Preserve identity and expressions. No text.",
  cartoon:"Turn the input photo into a vibrant cartoon poster, high contrast, neon accents, crisp outlines. Preserve identity. No text.",
  anime:  "Turn the input photo into an anime-style character with big expressive eyes, soft cel shading, and clean lineart. Preserve identity. No text."
};

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req, res) {
  // CORS preflight + headers
  setCORS(res);
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    return res.status(405).json({ ok:false, error:"Method not allowed" });
  }

  try {
    const { imageBase64, style = "urban" } = req.body || {};
    if (!imageBase64) return res.status(400).json({ ok:false, error:"imageBase64 required (data URL)" });

    // dataURL -> file
    const [meta, b64] = imageBase64.split(",");
    const mime = (meta.match(/data:(.*?);base64/) || [])[1] || "image/png";
    const buf = Buffer.from(b64, "base64");
    const file = await toFile(new Blob([buf], { type: mime }), "source." + (mime.split("/")[1] || "png"));

    const prompt = STYLE_PROMPTS[style] || STYLE_PROMPTS.urban;

    // Preview (baja): 1024
    const img = await openai.images.edits({
      model: "gpt-image-1",
      image: file,
      size: "1024x1024",
      prompt,
      n: 1,
      response_format: "b64_json"
    });

    const b64json = img.data?.[0]?.b64_json;
    if (!b64json) throw new Error("No preview from OpenAI");

    return res.status(200).json({
      ok: true,
      previewBase64: `data:image/png;base64,${b64json}`
    });

  } catch (e) {
    console.error("preview error:", e);
    return res.status(500).json({ ok:false, error: e.message });
  }
}

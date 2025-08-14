// api/preview.js
import OpenAI from "openai";
import { toFile } from "openai/uploads";

export const config = { api: { bodyParser: { sizeLimit: "10mb" } } };

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

    const prompt = STYLE_PROMPTS[style] || STYLE_PROMPTS.urban;

    // dataURL -> Blob -> File (NUNCA intentamos “abrir” un path)
    const blob = dataURLToBlob(imageBase64);
    const file = await toFile(blob, "source.jpg");

    // En SDK reciente es images.edit (singular)
    const out = await openai.images.edit({
      model: "gpt-image-1",
      image: file,
      prompt,
      size: "512x512",
      n: 1,
    });

    const b64 = out?.data?.[0]?.b64_json;
    if (!b64) throw new Error("No image returned from OpenAI");

    return res.status(200).json({
      ok: true,
      previewBase64: `data:image/png;base64,${b64}`,
    });
  } catch (e) {
    console.error("Error /api/preview:", e);
    const msg = e?.response?.data?.error?.message || e?.message || String(e);
    return res.status(500).json({ ok: false, error: msg });
  }
}

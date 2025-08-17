// /api/preview.js
import OpenAI from "openai";
import { toFile } from "openai/uploads";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ——— CORS ———
const CORS = {
  "Access-Control-Allow-Origin": "*", // si quieres, cámbialo a "https://mora2.com"
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const config = { api: { bodyParser: { sizeLimit: "7mb" } } };

// estilos
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

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(200, CORS);
    return res.end();
  }
  if (req.method !== "POST") {
    res.writeHead(405, CORS);
    return res.end(JSON.stringify({ ok: false, error: "Method not allowed" }));
  }

  try {
    const { imageBase64, style = "urban" } = req.body || {};
    if (!imageBase64) {
      res.writeHead(400, CORS);
      return res.end(JSON.stringify({ ok: false, error: "imageBase64 required (data URL)" }));
    }

    // dataURL -> { mime, b64 }
    const match = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/i.exec(imageBase64);
    if (!match) {
      res.writeHead(400, CORS);
      return res.end(JSON.stringify({ ok: false, error: "Invalid base64 (expected data:image/*;base64,...)" }));
    }
    const mime = match[1];               // image/png | image/jpeg | image/webp
    const b64  = match[2];
    const ext  = mime.split("/")[1];

    const blob = new Blob([Buffer.from(b64, "base64")], { type: mime });
    const file = await toFile(blob, source.${ext});

    const prompt = STYLE_PROMPTS[style] || STYLE_PROMPTS.urban;

    // Preview 1024
    const result = await openai.images.edits({
      model: "gpt-image-1",
      image: file,
      prompt,
      size: "1024x1024",
      n: 1,
      response_format: "b64_json",
    });

    const outB64 = result?.data?.[0]?.b64_json;
    if (!outB64) throw new Error("No preview from OpenAI");

    res.writeHead(200, CORS);
    return res.end(
      JSON.stringify({
        ok: true,
        previewBase64: data:image/png;base64,${outB64},
      })
    );
  } catch (e) {
    console.error("Error /api/preview:", e);
    const msg = e?.message || "Unknown";
    res.writeHead(400, CORS);
    return res.end(JSON.stringify({ ok: false, error: msg }));
  }
}


// api/generate-hd.js
import OpenAI from "openai";
import { toFile } from "openai/uploads";
import { v2 as cloudinary } from "cloudinary";

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

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const STYLE_PROMPTS = {
  urban:  "Turn the input photo into a bold urban-street cartoon illustration with clean inking, saturated colors, subtle halftones, soft shading. Keep identity and face intact, keep clothing silhouette similar. No text.",
  comic:  "Turn the input photo into a retro comic-book illustration with vintage halftones, inked outlines and muted palette. Preserve identity and expressions. No text.",
  cartoon:"Turn the input photo into a vibrant cartoon poster, high contrast, neon accents, crisp outlines. Preserve identity. No text.",
  anime:  "Turn the input photo into an anime-style character with big expressive eyes, soft cel shading, and clean lineart. Preserve identity. No text."
};

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
    const { imageBase64, sourceUrl, style = "urban" } = req.body || {};
    if (!imageBase64 && !sourceUrl) {
      return res.status(400).json({ ok:false, error:"imageBase64 or sourceUrl required" });
    }

    // 1) Preparar archivo para OpenAI
    let file;
    if (sourceUrl) {
      const ab = await fetch(sourceUrl).then(r => r.arrayBuffer());
      file = await toFile(new Blob([ab], { type: "image/png" }), "source.png");
    } else {
      const [meta, b64] = imageBase64.split(",");
      const mime = (meta.match(/data:(.*?);base64/) || [])[1] || "image/png";
      const buf = Buffer.from(b64, "base64");
      file = await toFile(new Blob([buf], { type: mime }), "source." + (mime.split("/")[1] || "png"));
    }

    // 2) Generar HD (1024x1024 — valores admitidos por la API)
    const prompt = STYLE_PROMPTS[style] || STYLE_PROMPTS.urban;
    const result = await openai.images.edits({
      model: "gpt-image-1",
      image: file,
      prompt,
      size: "1024x1024",
      n: 1,
      response_format: "b64_json"
    });

    const hdB64 = result.data?.[0]?.b64_json;
    if (!hdB64) throw new Error("No HD from OpenAI");

    // 3) Subir a Cloudinary y devolver URL
    const uploadRes = await cloudinary.uploader.upload(
      `data:image/png;base64,${hdB64}`,
      { folder: "mora2/generated_hd", overwrite: true, resource_type: "image" }
    );

    return res.status(200).json({ ok:true, hdUrl: uploadRes.secure_url });

  } catch (e) {
    console.error("generate-hd error:", e);
    return res.status(500).json({ ok:false, error: e.message });
  }
}

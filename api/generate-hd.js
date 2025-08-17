// /api/generate-hd.js
import OpenAI from "openai";
import { toFile } from "openai/uploads";
import { v2 as cloudinary } from "cloudinary";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const config = { api: { bodyParser: { sizeLimit: "10mb" } } };

const STYLE_PROMPTS = {
  urban:
    "Turn the input photo into a bold urban-street cartoon illustration with clean inking, saturated colors, subtle halftones, soft shading. Keep identity and face intact. No text.",
  comic:
    "Retro comic-book illustration with vintage halftones and inked outlines. Preserve identity. No text.",
  cartoon:
    "Vibrant cartoon poster, high contrast, neon accents, crisp outlines. Preserve identity. No text.",
  anime:
    "Anime-style character, big expressive eyes, soft cel shading, clean lineart. Preserve identity. No text.",
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
    const { imageBase64, sourceUrl, style = "urban" } = req.body || {};
    const prompt = STYLE_PROMPTS[style] || STYLE_PROMPTS.urban;

    let file;

    if (sourceUrl) {
      // Descarga de URL (ej. Cloudinary) y pasa como file
      const ab = await fetch(sourceUrl).then(r => r.arrayBuffer());
      file = await toFile(new Blob([ab], { type: "image/jpeg" }), "source.jpg");
    } else if (imageBase64) {
      const match = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/i.exec(imageBase64);
      if (!match) {
        res.writeHead(400, CORS);
        return res.end(JSON.stringify({ ok: false, error: "Invalid base64 (expected data:image/*;base64,...)" }));
      }
      const mime = match[1];
      const b64  = match[2];
      const ext  = mime.split("/")[1];
      const blob = new Blob([Buffer.from(b64, "base64")], { type: mime });
      file = await toFile(blob, source.${ext});
    } else {
      res.writeHead(400, CORS);
      return res.end(JSON.stringify({ ok: false, error: "imageBase64 or sourceUrl required" }));
    }

    // HD 2048
    const result = await openai.images.edits({
      model: "gpt-image-1",
      image: file,
      prompt,
      size: "2048x2048",
      n: 1,
      response_format: "b64_json",
    });

    const hdB64 = result?.data?.[0]?.b64_json;
    if (!hdB64) throw new Error("No HD from OpenAI");

    // Sube a Cloudinary
    const up = await cloudinary.uploader.upload(data:image/png;base64,${hdB64}, {
      folder: "mora2/generated_hd",
      overwrite: true,
      resource_type: "image",
    });

    res.writeHead(200, CORS);
    return res.end(JSON.stringify({ ok: true, hdUrl: up.secure_url }));
  } catch (e) {
    console.error("Error /api/generate-hd:", e);
    res.writeHead(400, CORS);
    return res.end(JSON.stringify({ ok: false, error: e?.message || "Unknown" }));
  }
}

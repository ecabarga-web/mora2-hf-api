import OpenAI from "openai";
import { toFile } from "openai/uploads";
import { v2 as cloudinary } from "cloudinary";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const { imageBase64, sourceUrl, style = "urban" } = req.body || {};
    if (!imageBase64 && !sourceUrl) {
      return res.status(400).json({ ok: false, error: "imageBase64 (data URL) o sourceUrl requeridos" });
    }

    let file;

    if (imageBase64) {
      const match = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/i.exec(imageBase64);
      if (!match) return res.status(400).json({ ok: false, error: "Invalid data URL" });
      const mime = match[1];
      const buf = Buffer.from(match[2], "base64");
      file = await toFile(new Blob([buf], { type: mime }), `source.${mime.split("/")[1]}`);
    } else {
      const r = await fetch(sourceUrl);
      if (!r.ok) throw new Error(`No se pudo descargar sourceUrl (${r.status})`);
      const mime = r.headers.get("content-type") || "image/png";
      if (!/image\/(png|jpeg|webp)/i.test(mime)) {
        return res.status(400).json({ ok: false, error: `Mimetype no soportado en sourceUrl (${mime})` });
      }
      const ab = await r.arrayBuffer();
      file = await toFile(new Blob([ab], { type: mime }), `source.${mime.split("/")[1]}`);
    }

    const STYLE_PROMPTS = {
      urban:  "Bold urban-street cartoon illustration, clean inking, saturated colors, flat background. Keep identity. No text.",
      comic:  "Retro comic-book illustration, vintage halftones, inked outlines, muted palette. Keep identity. No text.",
      cartoon:"Vibrant cartoon poster, high contrast, neon accents, crisp outlines. Keep identity. No text.",
      anime:  "Anime character, big expressive eyes, soft cel shading, clean lineart. Keep identity. No text."
    };
    const prompt = STYLE_PROMPTS[style] || STYLE_PROMPTS.urban;

    const result = await openai.images.edits({
      model: "gpt-image-1",
      image: file,
      prompt,
      size: "2048x2048",
      n: 1,
      response_format: "b64_json"
    });

    const hdB64 = result.data?.[0]?.b64_json;
    if (!hdB64) throw new Error("OpenAI no devolvió imagen HD");

    // Subir a Cloudinary para servir un URL
    const upload = await cloudinary.uploader.upload(
      `data:image/png;base64,${hdB64}`,
      { folder: "mora2/generated_hd", overwrite: true, resource_type: "image" }
    );

    return res.status(200).json({ ok: true, hdUrl: upload.secure_url });
  } catch (err) {
    console.error("Error /api/generate-hd:", err);
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
}

import OpenAI from "openai";
import { toFile } from "openai/uploads";
import { v2 as cloudinary } from "cloudinary";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export const config = { api: { bodyParser: { sizeLimit: "15mb" } } };

const STYLE_PROMPTS = {
  urban: "Turn the input photo into a bold urban-street cartoon illustration with clean inking, saturated colors, subtle halftones, soft shading, and a flat background. Keep identity and face intact, keep clothing silhouette similar. No text.",
  retro: "Turn the input photo into a retro comic-book illustration with vintage halftones, inked outlines and muted palette. Preserve identity and expressions. No text.",
  vibrant: "Turn the input photo into a vibrant cartoon poster, high contrast, neon accents, crisp outlines. Preserve identity. No text.",
  anime: "Turn the input photo into an anime-style character with big expressive eyes, soft cel shading, and clean lineart. Preserve identity. No text."
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const { imageBase64, style = "urban" } = req.body || {};
    if (!imageBase64) {
      return res.status(400).json({ ok: false, error: "imageBase64 required" });
    }

    // Quitar prefijo data:image/...;base64, si existe
    const cleanB64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");
    const imgBuffer = Buffer.from(cleanB64, "base64");

    // Convertir a archivo para OpenAI
    const file = await toFile(new Blob([imgBuffer], { type: "image/png" }), "source.png");

    const prompt = STYLE_PROMPTS[style] || STYLE_PROMPTS.urban;

    // Generar imagen HD
    const result = await openai.images.edits({
      model: "gpt-image-1",
      image: file,
      prompt,
      size: "1536x1024",
      n: 1,
      response_format: "b64_json"
    });

    const hdB64 = result.data?.[0]?.b64_json;
    if (!hdB64) throw new Error("No HD from OpenAI");

    // Subir a Cloudinary
    const uploadRes = await cloudinary.uploader.upload(
      `data:image/png;base64,${hdB64}`,
      {
        folder: "mora2/generated_hd",
        overwrite: true,
        resource_type: "image"
      }
    );

    return res.status(200).json({ ok: true, hdUrl: uploadRes.secure_url });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}

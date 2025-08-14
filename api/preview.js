import OpenAI from "openai";
import { toFile } from "openai/uploads";
import { v2 as cloudinary } from "cloudinary";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export const config = { api: { bodyParser: { sizeLimit: "7mb" } } };

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

function normalizeBase64(input) {
  if (!input || typeof input !== "string") return null;
  if (input.startsWith("data:image/")) return input;
  const b64re = /^[A-Za-z0-9+/=\s]+$/;
  if (b64re.test(input)) {
    return `data:image/jpeg;base64,${input.replace(/\s/g, "")}`;
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const { imageBase64, imageUrl, style = "urban" } = req.body || {};

    // 1) Subida del original a Cloudinary
    let uploadSource;
    if (imageUrl && /^https?:\/\//i.test(imageUrl)) {
      uploadSource = imageUrl;
    } else {
      const dataUri = normalizeBase64(imageBase64);
      if (!dataUri) {
        return res
          .status(400)
          .json({ ok: false, error: "Invalid base64 or missing image" });
      }
      uploadSource = dataUri;
    }

    const up = await cloudinary.uploader.upload(uploadSource, {
      folder: "mora2/previews_src",
      overwrite: true,
    });
    const sourceUrl = up.secure_url;

    // 2) Descargar original y convertir a File para multipart/form-data
    const ab = await fetch(sourceUrl).then((r) => r.arrayBuffer());
    const file = await toFile(new Blob([ab], { type: "image/jpeg" }), "source.jpg");

    // 3) Llamada REST a OpenAI: /v1/images/edits (sin usar el método del SDK)
    const prompt = STYLE_PROMPTS[style] || STYLE_PROMPTS.urban;

    const form = new FormData();
    form.append("model", "gpt-image-1");
    form.append("prompt", prompt);
    form.append("size", "512x512");
    form.append("n", "1");
    form.append("response_format", "b64_json");
    form.append("image", file); // <— archivo fuente

    const resp = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        // NO pongas Content-Type aquí; la pone el browser con boundary
      },
      body: form,
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`OpenAI error ${resp.status}: ${errText}`);
    }

    const data = await resp.json();
    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) throw new Error("No image returned from OpenAI");

    return res.status(200).json({
      ok: true,
      previewBase64: `data:image/png;base64,${b64}`,
      sourceUrl,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}


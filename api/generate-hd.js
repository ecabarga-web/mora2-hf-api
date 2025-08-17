import OpenAI from "openai";
import { toFile } from "openai/uploads";
import { v2 as cloudinary } from "cloudinary";

export const config = { api: { bodyParser: { sizeLimit: "7mb" } } };

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const STYLE_PROMPTS = {
  urban:
    "Turn the input photo into a bold urban-street cartoon illustration with clean inking, saturated colors, subtle halftones, soft shading, and a flat background. Keep identity and face intact, keep clothing silhouette similar. No text.",
  comic:
    "Turn the input photo into a retro comic-book illustration with vintage halftones, inked outlines and muted palette. Preserve identity and expressions. No text.",
  cartoon:
    "Turn the input photo into a vibrant cartoon poster with high contrast, crisp outlines, and neon accents. Preserve identity. No text.",
  anime:
    "Turn the input photo into an anime-style character with big expressive eyes, soft cel shading, and clean lineart. Preserve identity. No text.",
};

const EXT_FROM_MIME = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "https://mora2.com");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Credentials", "true");
}

function parseDataUrl(dataUrl) {
  const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(
    dataUrl || ""
  );
  if (!m) throw new Error("Invalid base64 (expected data:image/*;base64,...)");
  return { mime: m[1], base64: m[2] };
}

async function buildImageFile({ imageBase64, sourceUrl }) {
  if (imageBase64) {
    const { mime, base64 } = parseDataUrl(imageBase64);
    if (!EXT_FROM_MIME[mime]) {
      throw new Error(
        `Unsupported image mime '${mime}'. Use PNG/JPEG/WEBP data URL.`
      );
    }
    const buf = Buffer.from(base64, "base64");
    const filename = `source.${EXT_FROM_MIME[mime]}`;
    return {
      file: await toFile(buf, filename, { contentType: mime }),
      mime,
      filename,
      bytes: buf.length,
    };
  }

  if (sourceUrl) {
    const r = await fetch(sourceUrl);
    if (!r.ok) throw new Error(`Cannot fetch sourceUrl (HTTP ${r.status})`);
    const mime = r.headers.get("content-type") || "image/png";
    if (!EXT_FROM_MIME[mime]) {
      throw new Error(`Unsupported remote mimetype '${mime}'.`);
    }
    const buf = Buffer.from(await r.arrayBuffer());
    const filename = `source.${EXT_FROM_MIME[mime]}`;
    return {
      file: await toFile(buf, filename, { contentType: mime }),
      mime,
      filename,
      bytes: buf.length,
    };
  }

  throw new Error("imageBase64 (data URL) or sourceUrl required");
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const t0 = Date.now();
    const { imageBase64, sourceUrl, style = "urban" } = req.body || {};
    const prompt = STYLE_PROMPTS[style] || STYLE_PROMPTS.urban;

    const { file, mime, filename, bytes } = await buildImageFile({
      imageBase64,
      sourceUrl,
    });

    // 1) Generar HD 2048
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

    // 2) Subir a Cloudinary
    const uploadRes = await cloudinary.uploader.upload(
      `data:image/png;base64,${hdB64}`,
      {
        folder: "mora2/generated_hd",
        overwrite: true,
        resource_type: "image",
      }
    );

    return res.status(200).json({
      ok: true,
      hdUrl: uploadRes.secure_url,
      debug: {
        mimeSent: mime,
        filename,
        bytes,
        tookMs: Date.now() - t0,
      },
    });
  } catch (e) {
    console.error("Error /api/generate-hd:", e);
    return res
      .status(400)
      .json({ ok: false, error: e?.message || "Generate HD failed" });
  }
}

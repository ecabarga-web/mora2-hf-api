import OpenAI from "openai";
import { toFile } from "openai/uploads";

export const config = { api: { bodyParser: { sizeLimit: "7mb" } } };

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
  // data:image/png;base64,AAAA...
  const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(
    dataUrl || ""
  );
  if (!m) throw new Error("Invalid base64 (expected data:image/*;base64,...)");
  return { mime: m[1], base64: m[2] };
}

async function buildImageFile({ imageBase64, imageUrl }) {
  // 1) Data URL
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

  // 2) HTTP(S) URL
  if (imageUrl) {
    const r = await fetch(imageUrl);
    if (!r.ok) throw new Error(`Cannot fetch imageUrl (HTTP ${r.status})`);
    const mime = r.headers.get("content-type") || "image/png";
    if (!EXT_FROM_MIME[mime]) {
      throw new Error(
        `Unsupported remote mimetype '${mime}'. Use PNG/JPEG/WEBP.`
      );
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

  throw new Error("imageBase64 (data URL) or imageUrl required");
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
    const { imageBase64, imageUrl, style = "urban" } = req.body || {};

    const prompt = STYLE_PROMPTS[style] || STYLE_PROMPTS.urban;
    const { file, mime, filename, bytes } = await buildImageFile({
      imageBase64,
      imageUrl,
    });

    // Preview: 512x512
    const result = await openai.images.edits({
      model: "gpt-image-1",
      image: file,
      prompt,
      size: "512x512",
      n: 1,
      response_format: "b64_json",
    });

    const b64 = result?.data?.[0]?.b64_json;
    if (!b64) throw new Error("No preview image returned by OpenAI");

    const previewBase64 = `data:image/png;base64,${b64}`;

    return res.status(200).json({
      ok: true,
      previewBase64,
      // puedes devolver también algún dato útil de debug:
      debug: {
        mimeSent: mime,
        filename,
        bytes,
        tookMs: Date.now() - t0,
      },
    });
  } catch (e) {
    console.error("Error /api/preview:", e);
    // Intenta devolver texto crudo si es error OpenAI
    return res
      .status(400)
      .json({ ok: false, error: e?.message || "Preview failed" });
  }
}

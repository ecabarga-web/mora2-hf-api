import OpenAI from "openai";
import { toFile } from "openai/uploads";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// CORS helper
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

    // 1) Construir el File a partir de dataURL o URL remota
    let file;

    if (imageBase64) {
      // data:image/png;base64,AAAA...
      const match = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/i.exec(imageBase64);
      if (!match) return res.status(400).json({ ok: false, error: "Invalid data URL" });

      const mime = match[1];
      const buf = Buffer.from(match[2], "base64");
      file = await toFile(new Blob([buf], { type: mime }), `source.${mime.split("/")[1]}`);
    } else {
      // Descargar la imagen por URL y respetar su mimetype
      const r = await fetch(sourceUrl);
      if (!r.ok) throw new Error(`No se pudo descargar sourceUrl (${r.status})`);
      const mime = r.headers.get("content-type") || "image/png";
      if (!/image\/(png|jpeg|webp)/i.test(mime)) {
        return res.status(400).json({ ok: false, error: `Mimetype no soportado en sourceUrl (${mime})` });
      }
      const ab = await r.arrayBuffer();
      file = await toFile(new Blob([ab], { type: mime }), `source.${mime.split("/")[1]}`);
    }

    // 2) Prompt simple por estilo
    const STYLE_PROMPTS = {
      urban:  "Bold urban-street cartoon illustration, clean inking, saturated colors, flat background. Keep identity. No text.",
      comic:  "Retro comic-book illustration, vintage halftones, inked outlines, muted palette. Keep identity. No text.",
      cartoon:"Vibrant cartoon poster, high contrast, neon accents, crisp outlines. Keep identity. No text.",
      anime:  "Anime character, big expressive eyes, soft cel shading, clean lineart. Keep identity. No text."
    };
    const prompt = STYLE_PROMPTS[style] || STYLE_PROMPTS.urban;

    // 3) Llamada a OpenAI
    const result = await openai.images.edits({
      model: "gpt-image-1",
      image: file,
      prompt,
      size: "1024x1024",
      n: 1,
      response_format: "b64_json"
    });

    const b64 = result.data?.[0]?.b64_json;
    if (!b64) throw new Error("OpenAI no devolvió imagen");

    // Devolvemos como data URL para que tu front lo pinte directo
    return res.status(200).json({
      ok: true,
      previewBase64: `data:image/png;base64,${b64}`
    });
  } catch (err) {
    console.error("Error /api/preview:", err);
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
}

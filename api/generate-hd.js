// api/generate-hd.js
import OpenAI from "openai";
import { put } from "@vercel/blob";

// Permite CORS desde tu dominio
const ORIGIN = process.env.ALLOWED_ORIGIN || "https://mora2.com";

// Helpers
function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function dataURLtoBuffer(dataUrl) {
  // data:image/png;base64,AAAA....
  const m = /^data:(.+);base64,(.*)$/.exec(dataUrl || "");
  if (!m) return null;
  return Buffer.from(m[2], "base64");
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const { imageBase64, sourceUrl, style, size } = req.body || {};
    // Por políticas actuales del Image API, los tamaños válidos:
    const finalSize = size && ["1024x1024","1024x1536","1536x1024","auto"].includes(size)
      ? size
      : "1024x1024";

    // 1) Obtenemos la imagen fuente (buffer) desde dataURL o desde URL
    let srcBuffer = null;
    if (imageBase64) {
      srcBuffer = dataURLtoBuffer(imageBase64);
    } else if (sourceUrl) {
      const r = await fetch(sourceUrl);
      const ab = await r.arrayBuffer();
      srcBuffer = Buffer.from(ab);
    }
    if (!srcBuffer) {
      return res.status(400).json({ ok: false, error: "Missing source image" });
    }

    // 2) Llamada a OpenAI (usa tu prompt actual para HD)
    //    Mantengo la misma lógica que ya te funcionaba: "edits" con una única imagen.
    const prompt =
      `Clean vector-style cartoon portrait, no background (transparent), face likeness preserved, ` +
      `smooth outlines, soft cell shading, no artifacts, print-ready for t-shirt. Style: ${style || "urban"}`;

    // La API v1 de images (Node SDK) usa formData con file. Aquí cargamos el buffer como file.
    const result = await openai.images.edits({
      image: srcBuffer,                // <-- tu foto
      prompt,
      size: finalSize,                 // "1024x1024" etc
      response_format: "b64_json",     // devolvemos base64 para guardar luego
      background: "transparent"        // intenta transparencia cuando sea posible
    });

    const b64 = result?.data?.[0]?.b64_json;
    if (!b64) {
      return res.status(500).json({ ok: false, error: "OpenAI no devolvió imagen HD" });
    }

    // 3) Guardamos en Vercel Blob como PNG público
    const fileBuf = Buffer.from(b64, "base64");
    const fileName = `mora2/generated_hd/hd_${Date.now()}.png`;

    const { url } = await put(fileName, fileBuf, {
      access: "public",
      contentType: "image/png",
      addRandomSuffix: false, // clave estable (ya usamos timestamp)
    });

    // 4) (Opcional) Notificar a GHL con el URL de la HD: descomenta si ya tienes el webhook
    /*
    const ghlWebhook = process.env.GHL_WEBHOOK_URL;
    if (ghlWebhook) {
      // Manda lo que necesites: contactoId, nombre, email, estilo, hdUrl...
      await fetch(ghlWebhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "mora2",
          style,
          hdUrl: url,
          // contactId, name, email... lo que envíes desde el front
        })
      });
    }
    */

    return res.status(200).json({ ok: true, hdUrl: url });
  } catch (err) {
    console.error("generate-hd error:", err);
    const msg = err?.message || "Server error";
    return res.status(500).json({ ok: false, error: msg });
  }
}

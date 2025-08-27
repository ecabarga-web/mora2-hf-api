// api/preview.js
// Genera la PREVIEW (baja) usando el endpoint HTTP de OpenAI (sin SDK)
// y DEVUELVE SOLO base64 inline (no persiste en Blob).

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

// === Estilos ===
const STYLE_PROMPTS = {
  urban:  "Turn the input photo into a bold urban-street cartoon portrait. Clean thick inking, saturated yet balanced colors, subtle halftones, soft shading, flat/plain background. Keep identity, face features, glasses and hair/beard intact. Shoulders-up framing. No text, no typography.",
  pixar:  "Transform the input photo into a Pixar-style character render. Big expressive eyes, soft 3D-like shading, smooth gradients, gentle subsurface scattering, glossy eye highlights, soft rim light, simple studio background. Preserve identity and likeness. Shoulders-up. No text, no captions.",
  realista: "Turn the input photo into a realistic cartoon with strong graphic lines and flat shadows, similar to a graphic-novel poster. Thick outlines, warm neutral palette, defined beard and hair strands, subtle rim light, light vignette/plain background. Maintain exact identity, glasses reflections allowed. Shoulders-up framing. No text.",
  anime:  "Turn the input photo into an anime-style cel-shaded character with clean lineart. Preserve identity. No text."
};


export default async function handler(req, res) {
  // CORS siempre
  setCORS(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")
    return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const { imageBase64, style = "urban" } = req.body || {};
    if (!imageBase64)
      return res
        .status(400)
        .json({ ok: false, error: "imageBase64 required (data URL)" });

    // dataURL -> Blob
    const [meta, b64] = String(imageBase64).split(",");
    const mime =
      (meta && (meta.match(/data:(.*?);base64/) || [])[1]) || "image/png";
    const buf = Buffer.from(b64 || "", "base64");
    const fileBlob = new Blob([buf], { type: mime });

    // Llamada HTTP directa a OpenAI images/edits
    const form = new FormData();
    form.append("model", "gpt-image-1");
    form.append(
      "prompt",
      STYLE_PROMPTS[style] || STYLE_PROMPTS.urban
    );
    form.append("size", "1024x1024");
    form.append("image", fileBlob, "source." + (mime.split("/")[1] || "png"));

    const r = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
    });

    const j = await r.json();
    if (!r.ok) {
      return res
        .status(r.status)
        .json({ ok: false, error: j.error?.message || "OpenAI error" });
    }

    const b64json = j.data?.[0]?.b64_json;
    if (!b64json) throw new Error("No preview image returned");

    // ⚠️ NO persistimos el preview. Devolvemos inline.
    res.setHeader("Cache-Control", "no-store");

    return res.status(200).json({
      ok: true,
      previewBase64: `data:image/png;base64,${b64json}`,
      // (opcional) draftKey si más adelante quieres “congelar” la semilla
      // draftKey: j.data?.[0]?.revised_prompt_id || null
    });
  } catch (e) {
    console.error("preview error:", e);
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
    // CORS headers ya están puestos por setCORS al inicio
  }
}

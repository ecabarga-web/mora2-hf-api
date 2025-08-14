// api/preview.js
export const config = { api: { bodyParser: { sizeLimit: "10mb" } } };

// Aceptamos SOLO data URL: "data:image/png;base64,AAAA..."
function parseDataURL(dataUrl) {
  const m = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl || "");
  if (!m) throw new Error("Invalid base64 (expected data:image/*;base64,...)");
  const mime = m[1].toLowerCase();
  const raw = m[2];
  const allowed = new Set(["image/png", "image/jpeg", "image/webp"]);
  if (!allowed.has(mime)) {
    throw new Error(`Invalid image mime '${mime}'. Allowed: image/png, image/jpeg, image/webp`);
  }
  // Valida base64
  const buf = Buffer.from(raw, "base64");
  return { mime, raw, buf };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const started = Date.now();
  try {
    const { imageBase64, style = "urban" } = req.body || {};
    if (!imageBase64) return res.status(400).json({ ok: false, error: "imageBase64 required (data URL)" });

    const { mime, raw, buf } = parseDataURL(imageBase64);
    const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";

    // Construimos un Blob con el tipo correcto y lo añadimos a FormData.
    const blob = new Blob([buf], { type: mime });
    const fd = new FormData();
    fd.append("model", "gpt-image-1");
    fd.append(
      "prompt",
      style === "urban"
        ? "Turn the input photo into a bold urban-street cartoon illustration. Keep identity. No text."
        : "Make a clean cartoon. Keep identity. No text."
    );
    fd.append("size", "1024x1024");
    // OJO: poner filename explícito; el Content-Type del part saldrá del blob.type
    fd.append("image", blob, `source.${ext}`);

    const resp = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: fd,
    });

    if (!resp.ok) {
      // Devuelve detalle de lo que mandamos para depurar
      const body = await resp.text().catch(() => "");
      return res.status(400).json({
        ok: false,
        error: body || `OpenAI ${resp.status} ${resp.statusText}`,
        debug: {
          mimeSent: mime,
          bytes: buf.length,
          filename: `source.${ext}`,
          tookMs: Date.now() - started,
        },
      });
    }

    const data = await resp.json();
    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) throw new Error("No image returned from OpenAI");

    return res.status(200).json({
      ok: true,
      previewBase64: `data:image/png;base64,${b64}`,
      tookMs: Date.now() - started,
    });
  } catch (e) {
    return res.status(400).json({
      ok: false,
      error: e?.message || String(e),
    });
  }
}

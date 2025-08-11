import fetch from "node-fetch";
import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

export const config = { api: { bodyParser: { sizeLimit: "7mb" } } };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
  try {
    const { imageBase64, style = "urban" } = req.body || {};
    if (!imageBase64) return res.status(400).json({ ok: false, error: "imageBase64 required" });

    // 1) Sube el original (luego sirve para la HD)
    const up = await cloudinary.uploader.upload(imageBase64, {
      folder: "mora2/previews_src", overwrite: true
    });
    const sourceUrl = up.secure_url;

    // 2) Llama el Space de HF (si usas otro, ajusta el payload)
    const resp = await fetch(process.env.HF_SPACE_CARTOON_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.HF_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ data: [sourceUrl] })
    });
    if (!resp.ok) throw new Error("HF cartoon request failed");
    const gradio = await resp.json();
    const out = gradio?.data?.[0];
    if (!out) throw new Error("No image from HF");

    // 3) Baja a 512px y envíala como base64 (fácil para el canvas)
    const reduced = cloudinary.url(out, {
      type: "fetch",
      transformation: [{ width: 512, height: 512, crop: "limit", fetch_format: "jpg", quality: "auto" }]
    });
    const buf = await (await fetch(reduced)).arrayBuffer();
    const b64 = `data:image/jpeg;base64,${Buffer.from(buf).toString("base64")}`;

    return res.status(200).json({ ok: true, previewBase64: b64, sourceUrl });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}

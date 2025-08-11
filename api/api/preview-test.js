// api/preview-test.js
import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export const config = { api: { bodyParser: { sizeLimit: "7mb" } } };

export default async function handler(req, res) {
  // CORS básico (por si pruebas desde browser)
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(200).end();
  }
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method !== "POST")
    return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const { imageBase64 } = req.body || {};
    if (!imageBase64) return res.status(400).json({ ok: false, error: "imageBase64 required" });

    // 1) Sube la imagen original a Cloudinary
    const up = await cloudinary.uploader.upload(imageBase64, {
      folder: "mora2/previews_src",
      overwrite: true,
    });

    // 2) Devuelve una versión reducida a 512px como base64
    const url512 = cloudinary.url(up.secure_url, {
      type: "fetch",
      transformation: [{ width: 512, height: 512, crop: "limit", fetch_format: "jpg", quality: "auto" }],
    });

    const bin = await fetch(url512).then(r => r.arrayBuffer());
    const b64 = `data:image/jpeg;base64,${Buffer.from(bin).toString("base64")}`;

    return res.status(200).json({ ok: true, previewBase64: b64, sourceUrl: up.secure_url });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}

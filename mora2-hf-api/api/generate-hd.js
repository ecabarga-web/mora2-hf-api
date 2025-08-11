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
    const { imageUrl, style = "urban" } = req.body || {};
    if (!imageUrl) return res.status(400).json({ ok: false, error: "imageUrl required" });

    // 1) Cartoon HD (same Space, no size limit)
    const r1 = await fetch(process.env.HF_SPACE_CARTOON_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.HF_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ data: [imageUrl] })
    });
    if (!r1.ok) throw new Error("HF HD failed");
    const out1 = (await r1.json())?.data?.[0];
    if (!out1) throw new Error("No image from HF");

    // 2) Optional upscale 2x (Real-ESRGAN Space)
    let finalUrl = out1;
    if (process.env.HF_SPACE_UPSCALE_URL) {
      const r2 = await fetch(process.env.HF_SPACE_UPSCALE_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.HF_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ data: [out1] })
      });
      if (r2.ok) finalUrl = (await r2.json())?.data?.[0] || out1;
    }

    // 3) Save final result in Cloudinary
    const bin = await (await fetch(finalUrl)).arrayBuffer();
    const up = await cloudinary.uploader.upload(`data:image/png;base64,${Buffer.from(bin).toString("base64")}`, {
      folder: "mora2/hd", overwrite: true
    });

    return res.status(200).json({ ok: true, hdUrl: up.secure_url });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}

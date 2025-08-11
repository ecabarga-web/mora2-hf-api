import fetch from "node-fetch";
import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export default async function handler(req, res) {
  try {
    const { imageUrl, style } = req.body;
    if (!imageUrl || !style) {
      return res.status(400).json({ error: "Missing params" });
    }

    // 1) Llamar al Space de Hugging Face para generar HD
    const resp = await fetch(process.env.HF_SPACE_CARTOON_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.HF_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ data: [imageUrl, style, "hd"] }),
    });

    if (!resp.ok) throw new Error("HF HD request failed");

    const gradio = await resp.json();
    const hdUrl = gradio.data[0];
    if (!hdUrl) throw new Error("No HD image from HF");

    // 2) Guardar en Cloudinary
    const uploaded = await cloudinary.uploader.upload(hdUrl, {
      folder: "mora2_hd",
      resource_type: "image",
    });

    return res.status(200).json({ ok: true, hdUrl: uploaded.secure_url });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}

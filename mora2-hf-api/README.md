# Mora2 HF API

Dos endpoints serverless para Vercel que llaman Spaces de Hugging Face y guardan imágenes en Cloudinary.

- `POST /api/preview` → genera preview 512px (base64) + `sourceUrl` (Cloudinary)
- `POST /api/generate-hd` → genera HD + upscale opcional y guarda URL final en Cloudinary

## Variables de entorno (Vercel → Project → Settings → Environment Variables)

```
CLOUDINARY_CLOUD_NAME=xxxx
CLOUDINARY_API_KEY=xxxx
CLOUDINARY_API_SECRET=xxxx
HF_TOKEN=hf_xxx
HF_SPACE_CARTOON_URL=https://hf.space/embed/akhaliq/AnimeGANv2/+/api/predict
HF_SPACE_UPSCALE_URL=https://hf.space/embed/nateraw/real-esrgan/+/api/predict
```

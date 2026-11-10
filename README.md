# Pixel Wrangler

Turn photos into palette-limited pixel art. Pick an image, choose the framing, and get a
gallery of the same image rendered in each of your palettes, each one ready to download.

Everything happens in your browser. Images are never uploaded. The only network request
the page makes is fetching a palette from [Lospec](https://lospec.com/palette-list) when
you add one by name.

[![CI](https://github.com/firworksyt/PixelWrangler/actions/workflows/ci.yml/badge.svg)](https://github.com/firworksyt/PixelWrangler/actions/workflows/ci.yml)
[![Security Scan](https://github.com/firworksyt/PixelWrangler/actions/workflows/security.yml/badge.svg)](https://github.com/firworksyt/PixelWrangler/actions/workflows/security.yml)
[![Docker Image](https://github.com/firworksyt/PixelWrangler/actions/workflows/docker.yml/badge.svg)](https://github.com/firworksyt/PixelWrangler/actions/workflows/docker.yml)

## Features

- 🖼️ Open an image by browsing, drag and drop, the Paste button, or Ctrl/⌘+V
- ✂️ Aspect ratios 2:1, 16:9, 3:2, 4:3 and 1:1, landscape or portrait, with a draggable crop
- 🎨 One card per palette, processed with Floyd–Steinberg dithering
- ➕ Add any Lospec palette by name (e.g. `nostalgic-dreams`); your list is saved in the browser
- ⬇️ Download a crisp PNG at 8× (2048×1024 for 2:1), with no metadata from the original photo
- 🌙 Light and dark mode (follows your system, with a toggle that remembers your choice)
- 🔖 Footer shows the deployed commit and its date, linked to GitHub
- 🔒 No uploads, no accounts, no tracking

## How it works

1. Crop to the chosen aspect ratio and downscale with Lanczos to about 32,768 pixels
   (256×128 at 2:1). Every ratio keeps the same pixel budget so the pixels look the same size.
2. Map every pixel to the palette with Floyd–Steinberg error diffusion.
3. Upscale ×8 with nearest-neighbour for the download.

## Development

```bash
npm install
npm run dev     # http://localhost:8080
npm test
npm run lint
```

There is no build step: `public/` is served as-is.

## Docker Deployment

A multi-arch image (amd64 and arm64) is published to `ghcr.io/firworksyt/pixelwrangler`.

```bash
docker run -d -p 8080:8080 --name pixelwrangler --restart unless-stopped \
  ghcr.io/firworksyt/pixelwrangler:latest
```

Or with Docker Compose:

```bash
docker compose up -d
```

The container is plain nginx (unprivileged, port 8080) serving static files, with a strict
Content Security Policy that only allows the page to talk to itself and `lospec.com`. Put
it behind your reverse proxy for TLS.

## License

WTFPL

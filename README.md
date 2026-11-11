# Pixel Wrangler

Turn photos into palette-limited pixel art. Pick an image, choose the framing, and get a
gallery of the same image rendered in each of your palettes, each one ready to download.

Videos work too: drop one in, pick a frame rate, and each palette card plays it back as
pixel art, ready to download as a looping GIF.

Everything happens in your browser. Your files are never uploaded. The only network request
the page makes is fetching a palette from [Lospec](https://lospec.com/palette-list) when
you add one by name.

[![CI](https://github.com/firworksyt/PixelWrangler/actions/workflows/ci.yml/badge.svg)](https://github.com/firworksyt/PixelWrangler/actions/workflows/ci.yml)
[![Security Scan](https://github.com/firworksyt/PixelWrangler/actions/workflows/security.yml/badge.svg)](https://github.com/firworksyt/PixelWrangler/actions/workflows/security.yml)
[![Docker Image](https://github.com/firworksyt/PixelWrangler/actions/workflows/docker.yml/badge.svg)](https://github.com/firworksyt/PixelWrangler/actions/workflows/docker.yml)

## Features

- 🖼️ Open an image or video by browsing, drag and drop, or Ctrl/⌘+V (the Paste button works for images)
- 🎞️ Videos become animated GIFs: pick the frame rate (default 4 fps) and every palette card plays it
- ✂️ Aspect ratios 2:1, 16:9, 3:2, 4:3 and 1:1, landscape or portrait, with a draggable crop
- 🎨 One card per palette, processed with Floyd–Steinberg dithering
- ➕ Add any Lospec palette by name (e.g. `nostalgic-dreams`); your list is saved in the browser
- ⬇️ Download a crisp PNG (or GIF for videos) at 8× (2048×1024 for 2:1), with no metadata from the original
- 🌙 Light and dark mode (follows your system, with a toggle that remembers your choice)
- 🔖 Footer shows the deployed commit and its date, linked to GitHub
- 🔒 No uploads, no accounts, no tracking

## How it works

1. Crop to the chosen aspect ratio and downscale with Lanczos to about 32,768 pixels
   (256×128 at 2:1). Every ratio keeps the same pixel budget so the pixels look the same size.
2. Map every pixel to the palette with Floyd–Steinberg error diffusion.
3. Upscale ×8 with nearest-neighbour for the download.

Videos are sampled at the chosen frame rate and every frame goes through the same steps,
then they're saved as a looping GIF that uses the palette's exact colours.

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

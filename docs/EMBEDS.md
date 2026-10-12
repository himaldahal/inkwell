# Embeds (editor) - required CSP hosts

Embed items (`type:'embed'`) only accept links matched by the allow-list in `src/editor/embeds.js`.
They render as a click-to-load placeholder (nothing is requested until the user taps *Load*), then as a sandboxed
`<iframe sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer">`.

## `frame-src` hosts to allow
- `https://www.youtube-nocookie.com`
- `https://player.vimeo.com`
- `https://www.loom.com`
- `https://docs.google.com` (Docs, Slides, Sheets previews)
- `https://www.figma.com`
- `https://maps.google.com`
- `https://www.openstreetmap.org`

## `media-src`
Direct audio/video links (`.mp3 .wav .ogg .m4a .mp4 .webm ...`) are played with `<audio>/<video preload="none">`, so `media-src https:` is needed.

Other links (including PDF URLs) become link cards and are never framed. No images or thumbnails are fetched from providers.
Item shape: `{type:'embed', url, embedUrl, provider, kind:'iframe|audio|video|link', title, x,y,w,h}`.

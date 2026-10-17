# AI Creative Studio — Integrated AI Video MVP

This branch integrates the executable video-editing core into the Creative Studio UI and adopts the shared contracts designed for AI Video Studio.

## What works now

- React/TypeScript Vireon editor workspace
- Reference-inspired dark Arabic-first editing UI
- Real project persistence with SQLite through `apps/api`
- Real local video upload and FFprobe metadata discovery
- Multi-clip video timeline with persistent clip state
- Split, delete, move and trim commands
- Undo/redo history (bounded)
- Arabic/English deterministic editing commands without an API key
- Optional OpenAI Responses API tool provider (`apps/api/src/aiProvider.ts`)
- Real FFmpeg MP4/H.264/AAC export
- Contextual tool panels for media, audio, text, effects, transitions, color and AI
- Floating AI assistant and Arabic/English UI switch
- Shared Timeline and `edit_timeline` contracts
- Automated regression suite that creates a real test video, uploads it, edits it, undoes/redoes it and renders a real MP4
- GitHub Actions integration CI for API and web builds

## Local requirements

Node.js 22+ and FFmpeg/FFprobe.

```bash
npm install
npm run dev
```

The web app runs through Vite and the API on port `8787`.

## Optional AI provider

Set `OPENAI_API_KEY` to enable the Responses API tool provider. Without it, local deterministic command parsing remains available for offline development and testing.

## Rayan Studio — browser-side script video editor

A separate Arabic-first page is available at `/rayan-studio.html` when the web app is served or deployed. It lets the user choose a local video, upload/edit a JavaScript processing script, run FFmpeg WebAssembly in the browser, preview the result, and download the output. The page links to the [Rayan X World privacy policy](https://mhommdkuyr.github.io/rayan-x-world/privacy.html).

### Script contract

The uploaded `.js` file should define `async function processVideo({ videoBytes, runFFmpeg, log, progress })` and return the `Uint8Array` result from `runFFmpeg({ args, inputName, outputName, videoBytes })`. The `args` array must end with `outputName`. The included example compresses the source to H.264/AAC MP4. Only run scripts you trust; scripts execute as code in a Web Worker and this is not a complete security sandbox. FFmpeg is downloaded from a CDN on first use; video files are processed in-browser and are not sent to the app server by the page itself.

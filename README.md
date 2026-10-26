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


## GitHub Actions-only Google Colab automation

The repository includes an on-demand workflow that executes Python on an ephemeral remote Google Colab runtime without Render or another application server.

- Workflow: [Colab On Demand (headless)](.github/workflows/colab_on_demand.yml)
- Runner: [scripts/colab_bridge.py](scripts/colab_bridge.py)
- Smoke test: [tasks/current_task.py](tasks/current_task.py)
- Upstream runtime CLI: [googlecolab/google-colab-cli](https://github.com/googlecolab/google-colab-cli)

### Run a task

1. Open the repository's **Actions** tab.
2. Select **Colab On Demand (headless)** and choose **Run workflow**.
3. Supply Python in `task_code`, or set `script_path` to a Python file inside the repository. If both are supplied, `script_path` takes priority.
4. Leave the accelerator as `none` for CPU, or choose a GPU type only when needed. GPU availability and consumption depend on the Google Colab account and its compute allowance.
5. Open the completed run and download its `colab-output-<run-id>` artifact. The workflow retains artifacts for 14 days.

Pushes to `tasks/**`, `scripts/colab_bridge.py`, or this workflow file on `main` also trigger a run. With no dispatch inputs, the runner executes `tasks/current_task.py`.

### Credentials and runtime behavior

Add a GitHub Actions repository secret named `COLAB_CREDENTIALS` containing a Google Application Default Credentials JSON object with a supported type (such as `authorized_user` or `service_account`). The workflow writes it to the runner's standard ADC path with restrictive file permissions, validates its type without printing the secret, and exports `GOOGLE_APPLICATION_CREDENTIALS`.

Each `colab run` creates a remote Colab runtime, runs the selected Python file, returns its output to the workflow log, and terminates that runtime. A run is successful only when the CLI exits with code 0; inspect the actual execution output before relying on task-level results.

This automation intentionally uses Google's headless Colab CLI rather than the browser-connected Colab MCP server. The official [Colab MCP](https://github.com/googlecolab/colab-mcp) bridges a local agent to a notebook open in a browser on the same device; GitHub Actions runners do not have that interactive browser session. No Render service is needed for the workflow above.

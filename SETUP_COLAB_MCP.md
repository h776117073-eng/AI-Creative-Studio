# Google Colab MCP on GitHub Actions

Repository: [h776117073-eng/AI-Creative-Studio](https://github.com/h776117073-eng/AI-Creative-Studio)

This workflow starts `@google/colab-mcp-server` over stdio, discovers its MCP tools, and attempts to call a code-execution tool with the Python code supplied to the workflow. It writes a diagnostic/result record to `output/execution_log.json` and uploads the `output/` directory as an Actions artifact.

## 1. Prepare credentials locally (one time)

First install and authenticate the Colab MCP server locally using the instructions published with the version of `@google/colab-mcp-server` you use. Complete any browser-based sign-in step. The workflow expects the resulting credentials file at:

```text
~/.config/colab-mcp/credentials.json
```

To check that the file exists and copy its complete contents into the GitHub secret editor, run:

```bash
test -s "$HOME/.config/colab-mcp/credentials.json" && cat "$HOME/.config/colab-mcp/credentials.json"
```

Treat the output as a password: do not commit it, paste it into issues, or send it in chat. If your local server stores credentials elsewhere or uses a different JSON schema, follow the server's current official setup instructions and place/export the valid credentials in the expected location. This repository does not generate or refresh expired Google credentials automatically.

## 2. Add repository secrets

Open **Settings → Secrets and variables → Actions → New repository secret** at:

https://github.com/h776117073-eng/AI-Creative-Studio/settings/secrets/actions

Add these exact names:

- `COLAB_CREDENTIALS` — the complete JSON contents of `credentials.json`, not a file path.
- `API_KEY` — the API key required by your MCP server configuration, if applicable. The workflow exposes it as both `API_KEY` and `GOOGLE_API_KEY`. Do not use a Google account password here.

Secrets are injected only at run time and are not written to the repository. The workflow creates `~/.config/colab-mcp/credentials.json` with owner-only permissions.

## 3. Run the workflow manually

1. Open [Actions](https://github.com/h776117073-eng/AI-Creative-Studio/actions).
2. Select **Google Colab MCP Automation**.
3. Press **Run workflow**.
4. Optionally provide Python code in **python_code**. The default is a short connectivity test.
5. Leave **tool_name** blank for automatic discovery, unless the log shows that the server uses a differently named execution tool. In that case, rerun with the exact tool name listed in the log.
6. Set **timeout_seconds** (default 900) and press **Run workflow**.

The workflow also runs weekly on Monday at 03:17 UTC. Scheduled execution uses a short connectivity-test code snippet.

## 4. Inspect results and troubleshoot

Open the completed workflow run and download the artifact named `colab-mcp-output-<run-id>`. The key file is `output/execution_log.json`, which records the discovered tool names/schemas, selected tool, result, and diagnostic errors.

- **Missing credentials / token / 401 / 403:** refresh local authentication and update `COLAB_CREDENTIALS`.
- **No code-execution tool found:** inspect `discovered_tools` in the JSON log, then set `tool_name` to the exact server tool name. If its input schema differs from common code parameters, update `scripts/run_colab_agent.py` to match that schema.
- **Timeout:** increase `timeout_seconds` and inspect the remote Colab session before retrying; a client timeout does not guarantee that remote execution stopped.
- **API key:** the server may not require `API_KEY`; if it does, ensure it is the key expected by that server version.

**Important:** this automation can only execute code if the MCP server exposes a compatible execution tool and its credentials remain valid. A successful GitHub Actions job is not, by itself, proof that a long-running notebook workload completed or that output files were saved to Google Drive.

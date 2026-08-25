from pathlib import Path
import sys

root = Path(sys.argv[1])
ui = root / 'app/src/main/java/com/novacut/editor/ui/editor'
editor = ui / 'EditorScreen.kt'
s = editor.read_text()
s = s.replace(
    '    LaunchedEffect(assistantCommand?.id) { assistantCommand?.let { request -> viewModel.executeAssistantCommand(context = LocalContext.current, request = request) } }\n',
    '    val assistantContext = LocalContext.current\n    LaunchedEffect(assistantCommand?.id) { assistantCommand?.let { request -> viewModel.executeAssistantCommand(assistantContext, request) } }\n',
)
editor.write_text(s)

# Keep the build deterministic and avoid treating the Android wrapper as a second editor.
# The helper is intentionally tiny so CI fails fast when the upstream editor signature moves.
required = [
    'assistantCommand: AssistantRequest? = null',
    'AssistantEditorScreen',
    'executeAssistantCommand(assistantContext, request)',
]
main = root / 'app/src/main/java/com/novacut/editor/MainActivity.kt'
m = main.read_text()
for needle in required:
    if needle not in (m if needle == 'AssistantEditorScreen' else s):
        raise SystemExit(f'missing expected integration marker: {needle}')
print('ClearCut integration fix verified')

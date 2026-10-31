# Arabic episode CPU lip-sync pipeline — preflight

This automation deliberately does **not** start Colab, CUDA, or a GPU service.

## Verified Drive assets

- Source: \`13AL8R54GE-S41TsIbXGX1rhIa-Y0HZm-\`
- Current Arabic dub: \`15MkBM0m9YduRz4pim2Stp_9ruW5XbqKw\`
- Timing/QA archive: \`1mVJpaVrR0Y9ikfeX_lynBCVwDBoUemxV\`
- Voice masters 06–10 archive: \`1kW388RgJNpoVCFEE8HRU18x4sX250bBf\`
- Output folder: \`189EzPY0ZgR2fa6hHL2jw2gmHwW_OLLGH\` (\`مخرجات المزامنة\`)

The five individual voice masters 01–05 remain in the episode folder. This pipeline must use the existing voice masters only; it must not synthesize replacement dialogue.

## Required secret

The runner must authenticate to the user's private Drive files through OAuth. Supply either:

- \`GOOGLE_DRIVE_CREDENTIALS_JSON\` (preferred), or
- the pre-existing \`COLAB_CREDENTIALS\` secret if it is a valid Google ADC JSON with the full Drive scope.

The secret is only read by the Actions runner; the JSON and access tokens are never printed or committed. Despite the legacy secret name, this workflow does not call Colab.

## Preflight behavior

The first workflow only verifies:

- actual runner CPU/RAM/disk and FFmpeg availability;
- OAuth refresh and Drive API read/write access;
- source and dub metadata and download capability;
- integrity of the timing/QA ZIP and voice-master ZIP;
- ability to write a JSON report into the Drive output folder.

It does not download the two large videos, split them, alter any audio, or run Lip-Sync.

## Processing gates still required

The media-processing workflow must not start until an ONNX lip-sync model and face detector are both available with an appropriate usage license, and the per-utterance timeline has been converted into validated active speech windows. The commonly circulated Wav2Lip checkpoints state research/personal/non-commercial terms; ONNX conversion does not automatically grant commercial rights. No checkpoint is silently downloaded or assumed here.

For the measured episode duration (about 6,154 seconds), five-minute chunking yields 21 actual chunks, not 24. The next stage should create the chunk count dynamically from the probed media duration, checkpoint each chunk in Drive, upload each finished chunk directly to Drive, then concatenate and verify the final MKV. No large media artifacts should be retained in GitHub Actions storage.

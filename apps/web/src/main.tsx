const showRuntimeCrashOverlay = (title: string, errorLike: unknown): void => {
  const error = errorLike instanceof Error ? errorLike : undefined;
  const errorMessage = error?.message ?? (typeof errorLike === 'string' ? errorLike : 'Unknown runtime error');
  const errorStack = error?.stack ?? (errorLike && typeof errorLike === 'object' && 'stack' in errorLike ? String((errorLike as { stack?: unknown }).stack) : '');
  const errorDiv = document.createElement('div');
  errorDiv.style.cssText = ['position:fixed','top:0','left:0','width:100vw','height:100vh','background:#7f0000','color:#fff','padding:20px','z-index:999999','overflow:scroll','font-family:monospace','font-size:14px','line-height:1.45','white-space:pre-wrap','box-sizing:border-box'].join(';');
  errorDiv.innerText = `${title}\n\nmessage:\n${errorMessage}\n\nstack:\n${errorStack || 'No stack available'}`;
  (document.body || document.documentElement).appendChild(errorDiv);
};

window.addEventListener('error', event => showRuntimeCrashOverlay('🚨 RUNTIME CRASH DETECTED', event.error ?? event.message));
window.addEventListener('unhandledrejection', event => showRuntimeCrashOverlay('🚨 UNHANDLED PROMISE REJECTION DETECTED', event.reason));

document.body.style.backgroundColor = '#111';

// Functional project import bridge. It converts a Vireon JSON export into a real server project,
// then re-uploads any server-backed media and remaps their asset IDs so the timeline remains usable.
(() => {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (!url.includes('/api/projects/import')) return originalFetch(input, init);
    try {
      const payload = JSON.parse(String(init?.body || '{}')) as any;
      const base = url.split('/api/projects/import')[0];
      const create = await originalFetch(`${base}/api/projects`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({name:payload.name || 'مشروع مستورد'}) });
      if (!create.ok) return new Response(JSON.stringify({error:'تعذر إنشاء المشروع المستورد'}), {status:create.status, headers:{'content-type':'application/json'}});
      let project = await create.json();
      const idMap = new Map<string,string>();
      const assets = Array.isArray(payload.assets) ? payload.assets : [];
      for (const oldAsset of assets) {
        if (!oldAsset?.url || oldAsset.url.startsWith('blob:')) continue;
        try {
          const media = await originalFetch(oldAsset.url.startsWith('http') ? oldAsset.url : `${base}${oldAsset.url}`);
          if (!media.ok) continue;
          const blob = await media.blob();
          const file = new File([blob], oldAsset.name || `asset-${Date.now()}`, {type: oldAsset.mime || blob.type || 'application/octet-stream'});
          const form = new FormData(); form.append('file', file);
          const uploaded = await originalFetch(`${base}/api/projects/${project.id}/upload`, {method:'POST', body:form});
          if (!uploaded.ok) continue;
          const remote = await uploaded.json();
          const same = remote.assets.filter((a:any)=>a.name === file.name).slice(-1)[0];
          if (same) idMap.set(String(oldAsset.id), String(same.id));
          project = remote;
        } catch { /* a missing optional asset must not cancel the whole import */ }
      }
      const timeline = structuredClone(payload.timeline || project.timeline);
      for (const track of (timeline.tracks || [])) for (const clip of (track.clips || [])) if (clip.assetId && idMap.has(String(clip.assetId))) clip.assetId = idMap.get(String(clip.assetId));
      const saved = await originalFetch(`${base}/api/projects/${project.id}/timeline`, {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({timeline})});
      if (saved.ok) project = await saved.json();
      return new Response(JSON.stringify(project), {status:200, headers:{'content-type':'application/json'}});
    } catch (error) {
      return new Response(JSON.stringify({error: error instanceof Error ? error.message : 'تعذر استيراد المشروع'}), {status:400, headers:{'content-type':'application/json'}});
    }
  };
})();

console.log('App Bootstrapped Successfully');
const debugHeader = document.createElement('div');
debugHeader.innerText = 'AI Creative Studio bootstrapped';
debugHeader.style.cssText = ['position:fixed','top:0','left:0','right:0','z-index:999998','background:#111827','color:#fff','font:12px monospace','padding:4px 8px','text-align:center','pointer-events:none'].join(';');
document.body.appendChild(debugHeader);

void import('./bootstrap').catch(error => showRuntimeCrashOverlay('🚨 APPLICATION BOOTSTRAP FAILED', error));

/* ============================================================
   VerseCraft DEBUG BOOT (Full file replacement)
   Purpose: show WHY you’re getting a blank blue screen on iOS.
   - Renders immediately
   - Captures JS errors + unhandled promise rejections
   - Tests fetch of: stories.json and first story file
   ============================================================ */

(function(){
  const rootId = "app";

  function esc(s){
    return String(s)
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;");
  }

  function ensureRoot(){
    let el = document.getElementById(rootId);
    if(!el){
      el = document.createElement("div");
      el.id = rootId;
      document.body.appendChild(el);
    }
    return el;
  }

  function renderBox(title, bodyHtml){
    const el = ensureRoot();
    el.innerHTML = `
      <div style="min-height:100vh; padding:16px; font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif; color:#eaf1ff; background:#061320;">
        <div style="max-width:680px; margin:0 auto;">
          <div style="font-weight:900; letter-spacing:.10em; text-transform:uppercase; opacity:.95;">VerseCraft Debug Boot</div>
          <div style="margin-top:10px; padding:14px; border-radius:14px; background:rgba(234,241,255,.06); border:1px solid rgba(234,241,255,.10);">
            <div style="font-weight:900; font-size:16px;">${esc(title)}</div>
            <div style="margin-top:10px; color:rgba(234,241,255,.85); line-height:1.45;">${bodyHtml}</div>
          </div>
          <div style="margin-top:12px; font-size:12px; color:rgba(234,241,255,.55);">Tip: Open <b>/app.js</b> and <b>/stories.json</b> directly in Safari to confirm they load.</div>
        </div>
      </div>
    `;
  }

  function appendLog(html){
    const box = document.getElementById("vcdbg-log");
    if(box) box.innerHTML += html;
  }

  function startUI(){
    renderBox("Starting…", `
      <div id="vcdbg-log">
        <div>✅ JS executed. If you can read this, GitHub Pages is serving <b>app.js</b>.</div>
        <div style="margin-top:8px;">Now running checks…</div>
      </div>
    `);
  }

  function showError(title, err){
    const msg = (err && (err.stack || err.message)) ? (err.stack || err.message) : String(err);
    renderBox(title, `<pre style="white-space:pre-wrap; margin:0; color:#ffd1d1;">${esc(msg)}</pre>`);
  }

  window.addEventListener("error", (e) => {
    try{
      showError("JavaScript Error", e?.error || e?.message || e);
    }catch{}
  });

  window.addEventListener("unhandledrejection", (e) => {
    try{
      showError("Unhandled Promise Rejection", e?.reason || e);
    }catch{}
  });

  async function fetchText(url){
    const res = await fetch(url, { cache: "no-store" });
    const txt = await res.text();
    return { ok: res.ok, status: res.status, statusText: res.statusText, txt };
  }

  async function runChecks(){
    startUI();

    // 1) stories.json
    appendLog(`<div style="margin-top:10px;">1) Fetching <b>stories.json</b>…</div>`);
    const s1 = await fetchText("stories.json");
    appendLog(`<div>stories.json → <b>${s1.status} ${esc(s1.statusText)}</b></div>`);

    if(!s1.ok){
      appendLog(`<div style="margin-top:6px; color:#ffd1d1;">Cannot load stories.json from repo root. This alone will cause a “blank app” in the real build.</div>`);
      return;
    }

    let idx;
    try{
      idx = JSON.parse(s1.txt);
      appendLog(`<div style="margin-top:6px;">✅ stories.json parsed. stories: <b>${(idx.stories||[]).length}</b></div>`);
    }catch(err){
      appendLog(`<div style="margin-top:6px; color:#ffd1d1;">stories.json is not valid JSON.</div>`);
      appendLog(`<pre style="white-space:pre-wrap; color:#ffd1d1;">${esc(String(err))}</pre>`);
      return;
    }

    const first = (idx.stories||[])[0];
    if(!first || !first.file){
      appendLog(`<div style="margin-top:6px; color:#ffd1d1;">stories.json has no stories[0].file.</div>`);
      return;
    }

    // 2) First story file
    appendLog(`<div style="margin-top:12px;">2) Fetching first story file: <b>${esc(first.file)}</b>…</div>`);
    const s2 = await fetchText(first.file);
    appendLog(`<div>${esc(first.file)} → <b>${s2.status} ${esc(s2.statusText)}</b></div>`);
    if(!s2.ok){
      appendLog(`<div style="margin-top:6px; color:#ffd1d1;">Story file not found. Check path/case in stories.json.</div>`);
      return;
    }

    // 3) Validate that it looks like JSON
    try{
      JSON.parse(s2.txt);
      appendLog(`<div style="margin-top:6px;">✅ Story JSON parsed.</div>`);
    }catch(err){
      appendLog(`<div style="margin-top:6px; color:#ffd1d1;">Story file is not valid JSON.</div>`);
      appendLog(`<pre style="white-space:pre-wrap; color:#ffd1d1;">${esc(String(err))}</pre>`);
      return;
    }

    // 4) Confirm app.js cache bust
    appendLog(`<div style="margin-top:12px;">3) Cache-bust reminder:</div>`);
    appendLog(`<div style="color:rgba(234,241,255,.75);">If you replaced files but iOS still shows old behavior, bump the version in <b>index.html</b>: <code>?v=1206</code> (and commit).</div>`);

    renderBox("Checks Completed ✅", document.getElementById("vcdbg-log").innerHTML);
  }

  // Start
  runChecks().catch(err => showError("Debug Boot Failed", err));
})();

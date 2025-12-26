/* ============================================================
   VerseCraft Stable MVP Shell (Full file replacement)
   - Home splash OK (no library preview)
   - Story picker works reliably on iOS (event delegation + pointer/touch)
   - HUD minimize is state-driven + persists across rerenders
   - Better story load errors (missing file / invalid JSON)
   ============================================================ */

const LS = {
  SAVE: "versecraft_save_v1",
  LAST_STORY: "versecraft_last_story_id",
};

const DEFAULT_PLAYER = () => ({
  hp: { cur: 10, max: 10 },
  xp: { cur: 0, max: 100 },
  lvl: 1,
  wealth: { W: 1, E: 1, A: 1, L: 1, T: 1, H: 1 },
  flags: {},
  inv: {
    consumables: [
      { id: "bandage", name: "Bandage", qty: 1, value: 15, use: { type: "heal", amount: 3 } },
    ],
    items: [
      { id: "candle", name: "Candle", qty: 1, value: 10, use: { type: "story", tag: "CandleMoment" } },
    ],
    weapons: [
      { id: "rusty_dagger", name: "Rusty Dagger", qty: 1, value: 25, equipSlot: "weapon" },
    ],
    armor: [
      { id: "leather_jerkin", name: "Leather Jerkin", qty: 1, value: 30, equipSlot: "armor" },
    ],
    special: [
      { id: "candle_token", name: "Candle", qty: 1, value: 10, equipSlot: "special" },
    ],
  },
  equip: {
    weapon: "rusty_dagger",
    armor: "leather_jerkin",
    special: "candle_token",
  },
});

const state = {
  mode: "boot", // boot | home | game
  storiesIndex: null,
  storyMetaById: new Map(),
  story: null,
  storyId: null,
  sectionId: null,

  player: DEFAULT_PLAYER(),

  ui: {
    modal: null,         // dialog | picker | character | inventory
    invTab: "consumables",
    hudMin: false,
  },
};

function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }
function safeTitleCaseName(name){
  if(!name) return "";
  return String(name).replaceAll("_", " ");
}
function escapeHtml(str){
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function setHudMin(isMin){
  state.ui.hudMin = !!isMin;
  document.body.classList.toggle("hud-min", state.ui.hudMin);
}

function toastDialog(title, message){
  state.ui.modal = { type: "dialog", title, message };
  render();
}

/* ===== Robust JSON fetch (better errors on GH Pages / iOS) ===== */
async function fetchJson(url){
  const res = await fetch(url, { cache: "no-store" });
  const text = await res.text();

  if(!res.ok){
    throw new Error(`Fetch failed (${res.status}). URL: ${url}`);
  }

  try{
    return JSON.parse(text);
  }catch{
    const preview = text.slice(0, 220).replace(/\s+/g, " ").trim();
    throw new Error(`Invalid JSON in ${url}. First bytes: "${preview}"`);
  }
}

async function loadStoriesIndex(){
  const idx = await fetchJson("stories.json");
  state.storiesIndex = idx;
  state.storyMetaById.clear();
  (idx.stories || []).forEach(s => state.storyMetaById.set(s.id, s));
}

async function loadStoryById(storyId, { resetPlayer = true } = {}){
  const meta = state.storyMetaById.get(storyId);
  if(!meta) throw new Error("Story not found in stories.json");

  const story = await fetchJson(meta.file);

  state.story = story;
  state.storyId = storyId;
  state.sectionId = story.start || story.startSectionId || "START";

  if(resetPlayer){
    state.player = DEFAULT_PLAYER();
    // If a module declares primaryResource max, align HP max for THIS module
    const max = story?.module?.primaryResource?.max;
    if(typeof max === "number" && max > 0){
      state.player.hp.max = max;
      state.player.hp.cur = clamp(state.player.hp.cur, 0, max);
    }
  }

  localStorage.setItem(LS.LAST_STORY, storyId);
}

/* ===== Save / Load ===== */
function saveGame(){
  const payload = {
    storyId: state.storyId,
    sectionId: state.sectionId,
    player: state.player,
    savedAt: Date.now(),
  };
  localStorage.setItem(LS.SAVE, JSON.stringify(payload));
  toastDialog("Saved", "Your progress was saved locally on this device.");
}

function loadGame(){
  const raw = localStorage.getItem(LS.SAVE);
  if(!raw){
    toastDialog("No Save Found", "There is no local save on this device yet.");
    return;
  }

  let data;
  try{ data = JSON.parse(raw); }
  catch{
    toastDialog("Save Corrupted", "The local save could not be read.");
    return;
  }

  if(!data.storyId){
    toastDialog("Save Invalid", "Saved story data is missing.");
    return;
  }
  if(!state.storyMetaById.get(data.storyId)){
    toastDialog("Saved Story Not Found", "Saved story not found in stories.json");
    return;
  }

  (async () => {
    try{
      await loadStoryById(data.storyId, { resetPlayer: false });
      state.player = data.player || DEFAULT_PLAYER();
      state.sectionId = data.sectionId || (state.story.start || "START");
      state.mode = "game";
      state.ui.modal = null;
      render();
    }catch(err){
      toastDialog("Load Failed", String(err?.message || err));
    }
  })();
}

/* ===== Story section access ===== */
function getSection(){
  const s = state.story;
  if(!s) return null;

  if(Array.isArray(s.sections)){
    return s.sections.find(x => x.id === state.sectionId) || null;
  }
  if(s.sections && typeof s.sections === "object"){
    return s.sections[state.sectionId] ? { id: state.sectionId, ...s.sections[state.sectionId] } : null;
  }
  return null;
}

/* ===== Effects ===== */
function applyEffect(effect){
  if(!effect) return;

  if(typeof effect.hp === "number"){
    state.player.hp.cur = clamp(state.player.hp.cur + effect.hp, 0, state.player.hp.max);
  }
  if(typeof effect.xp === "number"){
    state.player.xp.cur = clamp(state.player.xp.cur + effect.xp, 0, state.player.xp.max);
  }
  if(effect.setFlag){
    state.player.flags[effect.setFlag] = true;
  }
  if(effect.clearFlag){
    delete state.player.flags[effect.clearFlag];
  }
  if(effect.addItem){
    addItem(effect.addItem);
  }
  if(effect.removeItem){
    removeItem(effect.removeItem);
  }
}

function addItem(spec){
  const cat = spec.category;
  if(!cat || !state.player.inv[cat]) return;

  const list = state.player.inv[cat];
  const id = spec.id;
  const existing = list.find(x => x.id === id);

  if(existing){
    existing.qty = clamp((existing.qty || 0) + (spec.qty || 1), 0, 9999);
  }else{
    list.push({
      id,
      name: safeTitleCaseName(spec.name || id),
      qty: clamp(spec.qty || 1, 0, 9999),
      value: spec.value ?? 0,
      use: spec.use,
      equipSlot: spec.equipSlot,
    });
  }
}

function removeItem(spec){
  const cat = spec.category;
  if(!cat || !state.player.inv[cat]) return;

  const list = state.player.inv[cat];
  const it = list.find(x => x.id === spec.id);
  if(!it) return;

  const q = spec.qty ?? 1;
  it.qty = clamp((it.qty || 0) - q, 0, 9999);
  if(it.qty === 0) list.splice(list.indexOf(it), 1);
}

function canShowChoice(choice){
  if(!choice) return true;
  const req = choice.requires;
  if(!req) return true;

  if(req.flag && !state.player.flags[req.flag]) return false;
  if(req.notFlag && state.player.flags[req.notFlag]) return false;

  if(req.hasItem){
    const { category, id } = req.hasItem;
    const list = state.player.inv[category] || [];
    const it = list.find(x => x.id === id);
    if(!it || (it.qty || 0) <= 0) return false;
  }
  return true;
}

function onChoose(choice){
  if(choice.effects){
    const arr = Array.isArray(choice.effects) ? choice.effects : [choice.effects];
    arr.forEach(applyEffect);
  }

  // failure routing if resource hits 0
  if(state.player.hp.cur <= 0){
    const fail = state.story?.module?.primaryResource?.failureSectionId || "DEATH";
    state.sectionId = fail;
    render();
    return;
  }

  if(choice.to){
    state.sectionId = choice.to;
    render();
    return;
  }

  render();
}

/* ===== Inventory actions ===== */
function getInvList(cat){ return state.player.inv[cat] || []; }

function useItem(cat, id){
  const list = getInvList(cat);
  const it = list.find(x => x.id === id);
  if(!it) return;
  if((it.qty || 0) <= 0) return;

  const use = it.use;
  if(use?.type === "heal"){
    const amt = use.amount || 0;
    state.player.hp.cur = clamp(state.player.hp.cur + amt, 0, state.player.hp.max);
  }else if(use?.type === "story"){
    if(use.tag) state.player.flags[use.tag] = true;
  }

  it.qty = clamp((it.qty || 0) - 1, 0, 9999);
  if(it.qty === 0) list.splice(list.indexOf(it), 1);

  render();
}

function equipItem(cat, id){
  const list = getInvList(cat);
  const it = list.find(x => x.id === id);
  if(!it) return;
  const slot = it.equipSlot;
  if(!slot) return;
  state.player.equip[slot] = id;
  render();
}

function getEquippedName(slot){
  const id = state.player.equip[slot];
  if(!id) return "None";

  const allCats = ["weapons","armor","special","items","consumables"];
  for(const cat of allCats){
    const list = state.player.inv[cat] || [];
    const it = list.find(x => x.id === id);
    if(it) return it.name;
  }
  return safeTitleCaseName(id);
}

/* ============================================================
   RENDER
   ============================================================ */
function render(){
  const root = document.getElementById("app");
  if(!root) return;

  // ensure hud-min class matches state every render
  document.body.classList.toggle("hud-min", !!state.ui.hudMin);

  if(state.mode === "home"){
    root.innerHTML = renderHome();
  }else if(state.mode === "game"){
    root.innerHTML = renderGame();
  }else{
    root.innerHTML = renderBoot();
  }
}

function renderBoot(){
  return `
    <div class="vc-wrap">
      <div class="vc-panel vc-panelPad">
        <div style="text-align:center; padding: 22px 10px;">
          <div style="font-weight:900; letter-spacing:.12em; text-transform:uppercase;">VerseCraft</div>
          <div style="margin-top:10px; color: rgba(234,241,255,.7);">Loading…</div>
        </div>
      </div>
    </div>
  `;
}

function renderHome(){
  const hasSave = !!localStorage.getItem(LS.SAVE);
  const continueClass = hasSave ? "" : "vc-btn--disabled";

  return `
    <div class="vc-wrap">
      <div class="vc-panel vc-scroll">
        <div class="vc-panelPad">
          <div class="vc-homeTop">
            <img src="assets/versecraft-logo.png" alt="VerseCraft Logo" />
          </div>

          <div class="vc-tagline">Choose Your Paths. Live Your Story.</div>

          <button class="vc-btn" id="btnTapStart" type="button">Tap To Start</button>
          <button class="vc-btn" id="btnStoryPicker" type="button">Load New Story</button>
          <button class="vc-btn ${continueClass}" id="btnContinue" type="button">Continue Story</button>
        </div>

        ${renderModalIfAny()}
      </div>
    </div>
  `;
}

function renderGame(){
  const meta = state.storyMetaById.get(state.storyId);
  const title = safeTitleCaseName(meta?.title || state.story?.title || "Story");
  const subtitle = safeTitleCaseName(meta?.subtitle || "");

  const sec = getSection();
  const text = sec?.text || "Missing section content.";
  const system = sec?.system ? String(sec.system) : "";
  const choices = (sec?.choices || []).filter(canShowChoice);

  const hpPct = state.player.hp.max > 0 ? (state.player.hp.cur / state.player.hp.max) * 100 : 0;
  const xpPct = state.player.xp.max > 0 ? (state.player.xp.cur / state.player.xp.max) * 100 : 0;

  return `
    <div class="vc-wrap">
      <div class="vc-panel vc-scroll">
        <div class="vc-hud">
          <div class="vc-hudInner">
            <div class="vc-hudTop">
              <div>
                <h1 class="vc-hudTitle">${escapeHtml(title)}</h1>
                ${subtitle ? `<div style="color: rgba(234,241,255,.68); font-weight:800; margin-top:2px;">${escapeHtml(subtitle)}</div>` : ""}
              </div>
              <button class="vc-minBtn" id="hudMinBtn" type="button">${state.ui.hudMin ? "Expand" : "Minimize"}</button>
            </div>

            <div class="vc-bars">
              <div class="vc-barRow">
                <div class="vc-barLabel">HP</div>
                <div class="vc-bar"><div class="vc-barFill" style="width:${hpPct}%;"></div></div>
                <div class="vc-barVal">${state.player.hp.cur} / ${state.player.hp.max}</div>
              </div>

              <div class="vc-barRow">
                <div class="vc-barLabel">XP</div>
                <div class="vc-bar"><div class="vc-barFill vc-barFill--xp" style="width:${xpPct}%;"></div></div>
                <div class="vc-barVal">${state.player.xp.cur} / ${state.player.xp.max}</div>
              </div>

              <div style="margin-top:2px; font-weight:900; color: rgba(234,241,255,.85);">LVL ${state.player.lvl}</div>
            </div>

            <div class="vc-hudBtns">
              <button class="vc-btn" id="btnCharacter" type="button">Character</button>
              <button class="vc-btn" id="btnInventory" type="button">Inventory</button>
              <button class="vc-btn" id="btnSave" type="button">Save</button>
            </div>

            <div class="vc-hudBtns2">
              <button class="vc-btn" id="btnLoad" type="button">Load</button>
              <button class="vc-btn" id="btnMainMenu" type="button">Main Menu</button>
            </div>
          </div>
        </div>

        <div class="vc-content">
          <div class="vc-scene">
            <div class="vc-sceneTitle">Image Placeholder</div>
            <div class="vc-sceneSub">Future: scene image or video</div>
          </div>

          <div class="vc-storyText">
            ${escapeHtml(text).replace(/\n/g, "<br/>")}
            ${system ? `<div class="vc-systemLine">${escapeHtml(system)}</div>` : ""}

            <div class="vc-choices">
              ${choices.map((c, i) =>
                `<button class="vc-choiceBtn" type="button" data-choice="${i}">${escapeHtml(c.label || "Continue")}</button>`
              ).join("")}
            </div>
          </div>
        </div>

        ${renderModalIfAny()}
      </div>
    </div>
  `;
}

function renderModalIfAny(){
  const m = state.ui.modal;
  if(!m) return "";

  if(m.type === "dialog"){
    return `
      <div class="vc-modalMask" data-mask="1">
        <div class="vc-modal" role="dialog" aria-modal="true">
          <div class="vc-modalHeader">
            <h2 class="vc-modalTitle">${escapeHtml(m.title || "Notice")}</h2>
            <button class="vc-closeBtn" type="button" data-close="1">Close</button>
          </div>
          <div class="vc-modalBody">
            <div style="color: rgba(234,241,255,.78); line-height:1.5;">
              ${escapeHtml(m.message || "").replace(/\n/g, "<br/>")}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  if(m.type === "picker"){
    const stories = state.storiesIndex?.stories || [];
    return `
      <div class="vc-modalMask" data-mask="1">
        <div class="vc-modal" role="dialog" aria-modal="true">
          <div class="vc-modalHeader">
            <h2 class="vc-modalTitle">Load Story</h2>
            <button class="vc-closeBtn" type="button" data-close="1">Close</button>
          </div>
          <div class="vc-modalBody">
            ${stories.map(s => `
              <button type="button" class="vc-storyCard" data-pick-story="${escapeHtml(s.id)}">
                <div class="vc-storyTitle">${escapeHtml(safeTitleCaseName(s.title))}</div>
                <p class="vc-storySub">${escapeHtml(safeTitleCaseName(s.subtitle || ""))}</p>
                <div class="vc-storyMeta">${escapeHtml(s.estimate || "")}</div>
              </button>
            `).join("")}
          </div>
        </div>
      </div>
    `;
  }

  if(m.type === "character"){
    const w = state.player.wealth;
    return `
      <div class="vc-modalMask" data-mask="1">
        <div class="vc-modal" role="dialog" aria-modal="true">
          <div class="vc-modalHeader">
            <h2 class="vc-modalTitle">Character</h2>
            <button class="vc-closeBtn" type="button" data-close="1">Close</button>
          </div>

          <div class="vc-modalBody">
            <div class="vc-grid2">
              ${statTile("W", w.W)}
              ${statTile("E", w.E)}
              ${statTile("A", w.A)}
              ${statTile("L", w.L)}
              ${statTile("T", w.T)}
              ${statTile("H", w.H)}
            </div>

            <div class="vc-avatarBox">
              <div style="font-weight:900; margin-bottom:10px;">Avatar</div>
              <div class="vc-silhouette"></div>
            </div>

            <div class="vc-loadout">
              <h3>Loadout</h3>
              ${loadoutRow("Weapon", getEquippedName("weapon"))}
              ${loadoutRow("Armor", getEquippedName("armor"))}
              ${loadoutRow("Special Item", getEquippedName("special"))}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  if(m.type === "inventory"){
    const tab = state.ui.invTab;
    return `
      <div class="vc-modalMask" data-mask="1">
        <div class="vc-modal" role="dialog" aria-modal="true">
          <div class="vc-modalHeader">
            <h2 class="vc-modalTitle">Inventory</h2>
            <button class="vc-closeBtn" type="button" data-close="1">Close</button>
          </div>

          <div class="vc-modalBody">
            <div class="vc-tabs">
              ${tabBtn("consumables","Consumables",tab)}
              ${tabBtn("items","Items",tab)}
              ${tabBtn("weapons","Weapons",tab)}
              ${tabBtn("armor","Armor",tab)}
              ${tabBtn("special","Special",tab)}
            </div>

            ${renderInvTab(tab)}
          </div>
        </div>
      </div>
    `;
  }

  return "";
}

function statTile(k, v){
  return `
    <div class="vc-statTile">
      <span class="k">${escapeHtml(k)}</span>
      <span class="v">${escapeHtml(String(v))}</span>
    </div>
  `;
}

function loadoutRow(key, val){
  return `
    <div class="vc-loadoutRow">
      <div class="vc-loadoutKey">${escapeHtml(key)}</div>
      <div class="vc-loadoutVal">${escapeHtml(val)}</div>
    </div>
  `;
}

function tabBtn(id, label, active){
  const cls = id === active ? "vc-tab vc-tab--active" : "vc-tab";
  return `<button type="button" class="${cls}" data-inv-tab="${id}">${escapeHtml(label)}</button>`;
}

function renderInvTab(cat){
  const list = getInvList(cat);

  if(!list || list.length === 0){
    return `<div style="color: rgba(234,241,255,.70); padding: 8px 2px;">Nothing here yet.</div>`;
  }

  const canUse = (cat === "consumables" || cat === "items");
  const canEquip = (cat === "weapons" || cat === "armor" || cat === "special");

  return list.map(it => {
    const name = safeTitleCaseName(it.name);
    const qty = it.qty ?? 0;
    const value = it.value ?? 0;

    return `
      <div class="vc-itemRow">
        <div>
          <div class="vc-itemName">${escapeHtml(name)}${qty > 1 ? ` x${qty}` : ""}</div>
          <div class="vc-itemMeta">Value: ${escapeHtml(String(value))}</div>
        </div>

        <div class="vc-itemActions">
          ${canUse ? `<button type="button" class="vc-miniBtn" data-use-item="1" data-cat="${cat}" data-id="${escapeHtml(it.id)}">Use</button>` : ""}
          ${canEquip && it.equipSlot ? `<button type="button" class="vc-miniBtn" data-equip-item="1" data-cat="${cat}" data-id="${escapeHtml(it.id)}">Equip</button>` : ""}
        </div>
      </div>
    `;
  }).join("");
}

/* ============================================================
   INPUT HANDLING (Event Delegation)
   Fixes: “picker isn’t clickable” / iOS touch weirdness
   ============================================================ */
function closeModal(){ state.ui.modal = null; render(); }
function openModal(type){ state.ui.modal = { type }; render(); }

function findActionEl(target){
  if(!target) return null;
  return target.closest?.(
    "[data-pick-story],[data-choice],[data-inv-tab],[data-use-item],[data-equip-item],[data-close],[data-mask]"
  ) || null;
}

async function handleAction(el){
  if(!el) return;

  // close on mask click ONLY if the mask itself was tapped
  if(el.hasAttribute("data-mask")) return;

  if(el.hasAttribute("data-close")){
    closeModal();
    return;
  }

  // Home controls
  if(el.id === "btnTapStart"){
    const last = localStorage.getItem(LS.LAST_STORY) || state.storiesIndex?.defaultStoryId;
    if(!last){ toastDialog("No Story", "No default story is set in stories.json"); return; }
    try{
      await loadStoryById(last, { resetPlayer: true });
      state.mode = "game";
      setHudMin(false);
      render();
    }catch(err){
      toastDialog("Start Failed", String(err?.message || err));
    }
    return;
  }

  if(el.id === "btnStoryPicker"){
    openModal("picker");
    return;
  }

  if(el.id === "btnContinue"){
    const raw = localStorage.getItem(LS.SAVE);
    if(raw){
      loadGame();
      return;
    }
    const last = localStorage.getItem(LS.LAST_STORY) || state.storiesIndex?.defaultStoryId;
    if(!last){ toastDialog("No Story", "No default story is set in stories.json"); return; }
    try{
      await loadStoryById(last, { resetPlayer: true });
      state.mode = "game";
      setHudMin(false);
      render();
    }catch(err){
      toastDialog("Continue Failed", String(err?.message || err));
    }
    return;
  }

  // Picker: load story
  if(el.hasAttribute("data-pick-story")){
    const id = el.getAttribute("data-pick-story");
    try{
      await loadStoryById(id, { resetPlayer: true });
      state.mode = "game";
      state.ui.modal = null;
      setHudMin(false);
      render();
    }catch(err){
      toastDialog("Story Load Failed", String(err?.message || err));
    }
    return;
  }

  // HUD minimize
  if(el.id === "hudMinBtn"){
    setHudMin(!state.ui.hudMin);
    render();
    return;
  }

  // In-game controls
  if(el.id === "btnCharacter"){ openModal("character"); return; }
  if(el.id === "btnInventory"){ openModal("inventory"); return; }
  if(el.id === "btnSave"){ saveGame(); return; }
  if(el.id === "btnLoad"){ loadGame(); return; }
  if(el.id === "btnMainMenu"){
    state.mode = "home";
    state.ui.modal = null;
    setHudMin(false);
    render();
    return;
  }

  // Choice selection
  if(el.hasAttribute("data-choice")){
    const idx = Number(el.getAttribute("data-choice"));
    const sec = getSection();
    if(!sec) return;

    const choices = (sec.choices || []).filter(canShowChoice);
    const choice = choices[idx];
    if(!choice) return;

    if(choice.toMenu){
      state.mode = "home";
      state.ui.modal = null;
      setHudMin(false);
      render();
      return;
    }
    onChoose(choice);
    return;
  }

  // Inventory tabs
  if(el.hasAttribute("data-inv-tab")){
    state.ui.invTab = el.getAttribute("data-inv-tab");
    render();
    return;
  }

  // Inventory use/equip
  if(el.hasAttribute("data-use-item")){
    const cat = el.getAttribute("data-cat");
    const id = el.getAttribute("data-id");
    useItem(cat, id);
    return;
  }

  if(el.hasAttribute("data-equip-item")){
    const cat = el.getAttribute("data-cat");
    const id = el.getAttribute("data-id");
    equipItem(cat, id);
    return;
  }
}

/* Attach BOTH click + touchend + pointerup (iOS-safe) */
function attachGlobalHandlers(){
  const root = document.getElementById("app");
  if(!root) return;

  const onAny = async (evt) => {
    const el = findActionEl(evt.target);
    if(!el) return;

    // mask close: only if you tapped the mask itself
    if(el.hasAttribute("data-mask")){
      if(evt.target === el) closeModal();
      return;
    }

    // prevent double fire on iOS (touchend + click)
    if(evt.type !== "click") evt.preventDefault?.();

    await handleAction(el);
  };

  document.addEventListener("click", onAny, { passive: true });
  document.addEventListener("touchend", onAny, { passive: false });
  document.addEventListener("pointerup", onAny, { passive: true });
}

/* ===== Boot ===== */
(async function init(){
  try{
    attachGlobalHandlers();
    await loadStoriesIndex();

    state.mode = "home";

    // align last story with save, if present
    const raw = localStorage.getItem(LS.SAVE);
    if(raw){
      try{
        const saved = JSON.parse(raw);
        if(saved?.storyId) localStorage.setItem(LS.LAST_STORY, saved.storyId);
      }catch{}
    }

    render();
  }catch(err){
    state.mode = "home";
    render();
    toastDialog("Boot Failed", "Could not load stories.json. Make sure it exists in the repo root.");
  }
})();
/* ============================================================
   VerseCraft Stable UI Shell (Full file replacement)
   + Add: Web background media wiring (GitHub raw) with Node/Act fallback
   - Space-canon supported: "Act 01", "Node 0101" => URL-encoded automatically
   ============================================================ */

const LS = {
  SAVE_PREFIX: "versecraft_save_v1",       // per-story, per-slot keys
  LAST_STORY: "versecraft_last_story_id",  // last story opened
  LAST_SAVE: "versecraft_last_save_v1",    // { storyId, slot } for Continue Story
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

/* ============================================================
   ✅ MEDIA WIRING (BACKGROUND)
   - This sets #vc-bg background-image based on current story position
   - Tries: Node override → Act default
   - Tries extensions in order: webp → png → jpg → jpeg
   ============================================================ */
const MEDIA_BASE =
  "https://raw.githubusercontent.com/soundlogicstudios/VerseCraft-Media/main/Media/";

function encPath(s){
  // Space-canon needs URL encoding
  return s.replaceAll(" ", "%20");
}

function nodeFolderFromId(nodeId){
  const n = String(nodeId).padStart(4, "0");
  return `Node ${n}`; // space canon
}

// Act name can be stored in module later; for now default to Act 01
function getActIdForStory(story){
  const act = story?.module?.actId;
  return safeTitleCaseName(act || "Act 01");
}

// Best-effort: treat numeric section ids as node ids (101 => Node 0101).
// If section ids are not numeric (e.g., START), returns null.
function nodeIdFromSectionId(sectionId){
  const s = String(sectionId || "").trim();
  if(!s) return null;
  // grab digits anywhere (e.g., "0101", "101", "S101" -> 101)
  const digits = s.match(/\d+/)?.[0] || "";
  if(!digits) return null;
  const n = parseInt(digits, 10);
  if(!Number.isFinite(n)) return null;
  return n;
}

function buildNodeBgUrls({ storyId, actId, nodeId }){
  const nodeFolder = nodeFolderFromId(nodeId);
  const exts = ["webp","png","jpg","jpeg"];
  return exts.map(ext => encPath(
    MEDIA_BASE +
      `Stories/${storyId}/Acts/${actId}/Nodes/${nodeFolder}/Scenes/Background.${ext}`
  ));
}

function buildActDefaultBgUrls({ storyId, actId }){
  const exts = ["webp","png","jpg","jpeg"];
  return exts.map(ext => encPath(
    MEDIA_BASE +
      `Stories/${storyId}/Acts/${actId}/Defaults/Scenes/Background.${ext}`
  ));
}

// Preload-first success wins (avoids needing HEAD requests)
function pickFirstLoadableUrl(urls){
  return new Promise((resolve) => {
    let i = 0;
    const img = new Image();

    const tryNext = () => {
      if(i >= urls.length) return resolve(null);
      const url = urls[i++];
      img.onload = () => resolve(url);
      img.onerror = () => tryNext();
      img.src = url;
    };

    tryNext();
  });
}

let LAST_BG_KEY = "";

async function updateBackgroundForState(){
  try{
    const el = document.getElementById("vc-bg");
    if(!el) return;

    if(state.mode !== "game" || !state.storyId || !state.story){
      // optional: clear background when not in game
      el.style.backgroundImage = "";
      LAST_BG_KEY = "";
      return;
    }

    const storyId = state.storyId;
    const actId = getActIdForStory(state.story);
    const nodeId = nodeIdFromSectionId(state.sectionId);

    // If we can't infer node, use Act defaults only
    const key = `${storyId}::${actId}::${nodeId ?? "NO_NODE"}`;
    if(key === LAST_BG_KEY) return;

    let urls = [];
    if(nodeId !== null){
      urls = urls.concat(buildNodeBgUrls({ storyId, actId, nodeId }));
    }
    urls = urls.concat(buildActDefaultBgUrls({ storyId, actId }));

    const picked = await pickFirstLoadableUrl(urls);
    if(picked){
      el.style.backgroundImage = `url("${picked}")`;
      LAST_BG_KEY = key;
    }else{
      // Nothing found; keep a dark fallback
      el.style.backgroundImage = "";
      LAST_BG_KEY = key;
    }
  }catch{
    // fail silent (never crash UI)
  }
}

/* ============================================================
   ✅ Save-slot helpers (3 slots per story)
   ============================================================ */
function saveKey(storyId, slot){
  const sid = String(storyId || "");
  const s = clamp(Number(slot || 1), 1, 3);
  return `${LS.SAVE_PREFIX}::${sid}::slot${s}`;
}

function setLastSave(storyId, slot){
  try{
    localStorage.setItem(LS.LAST_SAVE, JSON.stringify({ storyId, slot: clamp(Number(slot||1),1,3) }));
  }catch{}
}

function getLastSave(){
  const raw = localStorage.getItem(LS.LAST_SAVE);
  if(!raw) return null;
  try{
    const d = JSON.parse(raw);
    if(!d?.storyId) return null;
    return { storyId: String(d.storyId), slot: clamp(Number(d.slot||1),1,3) };
  }catch{ return null; }
}

function getSavedPayload(storyId, slot = 1){
  const raw = localStorage.getItem(saveKey(storyId, slot));
  if(!raw) return null;
  try{ return JSON.parse(raw); }catch{ return null; }
}

function slotSummary(storyId, slot){
  const d = getSavedPayload(storyId, slot);
  return (d && d.savedAt) ? d : null;
}

/* ============================================================
   ✅ Module-agnostic default player
   ============================================================ */
const DEFAULT_PLAYER = () => ({
  hp: { cur: 15, min: 0, max: 15 }, // legacy key "hp" but module may label it Reputation, etc.
  xp: { cur: 0, max: 100 },         // in-story xp (UI bar)
  lvl: 1,
  money: 0,                         // module currency (Dollars, Gold, Credits, etc.)
  wealth: { W: 5, E: 5, A: 5, L: 5, T: 5, H: 5 },
  flags: {},
  inv: {
    consumables: [],
    items: [],
    weapons: [],
    armor: [],
    special: [],
  },
  equip: {
    weapon: null,
    armor: null,
    special: null,
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
    modal: null,
    invTab: "consumables",
  },
};

function toastDialog(title, message){
  state.ui.modal = { type: "dialog", title, message };
  render();
}

async function fetchJson(url){
  const res = await fetch(url, { cache: "no-store" });
  if(!res.ok) throw new Error(`${res.status} ${res.statusText} (${url})`);
  return await res.json();
}

async function loadStoriesIndex(){
  const idx = await fetchJson("stories.json");
  state.storiesIndex = idx;
  state.storyMetaById.clear();
  (idx.stories || []).forEach(s => state.storyMetaById.set(s.id, s));
}

async function loadStoryById(storyId){
  const meta = state.storyMetaById.get(storyId);
  if(!meta) throw new Error("Story not found in stories.json");
  const story = await fetchJson(meta.file);
  state.story = story;
  state.storyId = storyId;
  state.sectionId = story.start || story.startSectionId || "START";
  localStorage.setItem(LS.LAST_STORY, storyId);
}

/* ============================================================
   ✅ Module config helpers
   ============================================================ */
function getPrimaryResource(story){
  const pr = story?.module?.primaryResource || {};
  const name = safeTitleCaseName(pr.name || "HP");
  const min = (typeof pr.min === "number") ? pr.min : 0;
  const max = (typeof pr.max === "number") ? pr.max : 15;
  const failureSectionId = String(pr.failureSectionId || "DEATH");
  return { name, min, max, failureSectionId };
}

function getCurrency(story){
  const c = story?.module?.currency || {};
  const name = safeTitleCaseName(c.name || "Money");
  const symbol = (typeof c.symbol === "string") ? c.symbol : "";
  const startingMoney = (typeof story?.module?.startingMoney === "number")
    ? story.module.startingMoney
    : 0;
  return { name, symbol, startingMoney };
}

/* ============================================================
   ✅ NEW RUN seeding from module.loadout
   ============================================================ */
function seedPlayerForStory(story){
  const p = DEFAULT_PLAYER();

  // Primary resource (legacy key "hp")
  const pr = getPrimaryResource(story);
  p.hp.min = pr.min;
  p.hp.max = pr.max;

  const startVal = (pr.min < 0) ? 0 : pr.max;
  p.hp.cur = clamp(startVal, pr.min, pr.max);

  // Money
  const cur = getCurrency(story);
  p.money = cur.startingMoney || 0;

  const loadout = story?.module?.loadout;
  if(loadout && typeof loadout === "object"){
    const slotToDefaultCategory = {
      weapon: "weapons",
      armor: "armor",
      special: "special",
    };

    for(const slot of ["weapon","armor","special"]){
      const spec = loadout[slot];
      if(!spec || !spec.id) continue;

      const cat = spec.category || slotToDefaultCategory[slot];
      if(!p.inv[cat]) continue;

      const itemId = String(spec.id);
      const itemName = safeTitleCaseName(spec.name || spec.id);

      p.inv[cat].push({
        id: itemId,
        name: itemName,
        qty: 1,
        value: 0,
        equipSlot: slot,
      });

      p.equip[slot] = itemId;
    }
  }

  return p;
}

/* ============================================================
   Start story as a NEW RUN
   ============================================================ */
async function startNewRun(storyId){
  await loadStoryById(storyId);
  ensureFailureSection();
  state.player = seedPlayerForStory(state.story);
  state.mode = "game";
  state.ui.modal = null;
  render();
}

/* ============================================================
   Save / Load
   ============================================================ */
function saveGame(slot = 1){
  if(!state.storyId){
    toastDialog("No Story", "Load a story before saving.");
    return;
  }
  const s = clamp(Number(slot || 1), 1, 3);
  const payload = {
    storyId: state.storyId,
    sectionId: state.sectionId,
    player: state.player,
    savedAt: Date.now(),
    slot: s,
  };
  localStorage.setItem(saveKey(state.storyId, s), JSON.stringify(payload));
  setLastSave(state.storyId, s);
  toastDialog("Saved", `Saved to Slot ${s} for this story.`);
}

async function loadGameAsync({ strictStoryMatch, storyId, slot } = { strictStoryMatch: false }){
  const last = getLastSave();
  const sid = storyId || last?.storyId;
  const s = clamp(Number(slot || last?.slot || 1), 1, 3);

  if(!sid){
    toastDialog("No Save Found", "There is no saved slot to continue yet.");
    return;
  }

  const data = getSavedPayload(sid, s);
  if(!data){
    toastDialog("Empty Slot", `No save found in Slot ${s} for this story.`);
    return;
  }

  if(!data?.storyId){
    toastDialog("Save Invalid", "Saved story data is missing.");
    return;
  }
  if(!state.storyMetaById.get(data.storyId)){
    toastDialog("Saved Story Not Found", "Saved story not found in stories.json");
    return;
  }

  if(strictStoryMatch){
    if(!state.storyId){
      toastDialog("No Story Loaded", "Load a story first, then load a save for that story.");
      return;
    }
    if(data.storyId !== state.storyId){
      const meta = state.storyMetaById.get(data.storyId);
      const savedTitle = safeTitleCaseName(meta?.title || data.storyId);
      const curMeta = state.storyMetaById.get(state.storyId);
      const curTitle = safeTitleCaseName(curMeta?.title || state.storyId);

      toastDialog(
        "Save Belongs To Another Story",
        `Slot ${s} is for "${savedTitle}", but you currently have "${curTitle}" loaded.\n\nGo to Main Menu → Continue Story to load the saved module, or load the correct story first.`
      );
      return;
    }
  }

  await loadStoryById(data.storyId);
  ensureFailureSection();

  state.player = data.player || seedPlayerForStory(state.story);

  const pr = getPrimaryResource(state.story);
  if(state.player?.hp){
    if(typeof state.player.hp.min !== "number") state.player.hp.min = pr.min;
    if(typeof state.player.hp.max !== "number") state.player.hp.max = pr.max;
    state.player.hp.cur = clamp(state.player.hp.cur ?? 0, state.player.hp.min, state.player.hp.max);
  }
  if(typeof state.player.money !== "number"){
    state.player.money = getCurrency(state.story).startingMoney || 0;
  }

  state.sectionId = data.sectionId || (state.story.start || "START");
  state.mode = "game";
  state.ui.modal = null;
  setLastSave(data.storyId, s);
  render();
}

/* ============================================================
   Story navigation + effects
   ============================================================ */
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

function applyEffect(effect){
  if(!effect) return;

  if(typeof effect.hp === "number"){
    const p = state.player;
    const min = (typeof p.hp.min === "number") ? p.hp.min : 0;
    const max = (typeof p.hp.max === "number") ? p.hp.max : 15;
    p.hp.cur = clamp(p.hp.cur + effect.hp, min, max);
  }

  if(typeof effect.money === "number"){
    state.player.money = (state.player.money || 0) + effect.money;
    if(state.player.money < 0) state.player.money = 0;
  }

  if(effect.setFlag) state.player.flags[effect.setFlag] = true;
  if(effect.clearFlag) delete state.player.flags[effect.clearFlag];
  if(effect.addItem) addItem(effect.addItem);
  if(effect.removeItem) removeItem(effect.removeItem);

  if(typeof effect.xp === "number"){
    const p = state.player;
    p.xp.cur = clamp(p.xp.cur + effect.xp, 0, p.xp.max);
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

  if(state.player.equip.weapon === spec.id) state.player.equip.weapon = null;
  if(state.player.equip.armor === spec.id) state.player.equip.armor = null;
  if(state.player.equip.special === spec.id) state.player.equip.special = null;
}

function canShowChoice(choice){
  if(!choice) return true;
  const req = choice.requires;
  if(!req) return true;

  if(req.flag && !state.player.flags[req.flag]) return false;
  if(req.notFlag && state.player.flags[req.notFlag]) return false;

  if(typeof req.moneyAtLeast === "number"){
    if((state.player.money || 0) < req.moneyAtLeast) return false;
  }

  if(req.hasItem){
    const { category, id } = req.hasItem;
    const list = state.player.inv[category] || [];
    const it = list.find(x => x.id === id);
    if(!it || (it.qty || 0) <= 0) return false;
  }
  return true;
}

function shouldFailRun(){
  const pr = getPrimaryResource(state.story);
  const cur = state.player?.hp?.cur ?? 0;
  const min = state.player?.hp?.min ?? pr.min;
  return cur <= min;
}

function getFailureSectionId(){
  return getPrimaryResource(state.story).failureSectionId || "DEATH";
}

function onChoose(choice){
  if(choice.effects){
    const arr = Array.isArray(choice.effects) ? choice.effects : [choice.effects];
    arr.forEach(applyEffect);
  }

  if(shouldFailRun()){
    state.sectionId = getFailureSectionId();
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

/* ============================================================
   Ensure module failure section exists
   ============================================================ */
function ensureFailureSection(){
  const s = state.story;
  if(!s) return;

  const pr = getPrimaryResource(s);
  const failId = pr.failureSectionId || "DEATH";

  const failText =
`You falter as the pressure finally wins.

This run ends when your primary resource bottoms out.

Try again—watch for danger, and use your items when it matters.`;

  const failObj = {
    text: failText,
    system: "First failure is expected. You’re learning the rules through play.",
    choices: [{ label: "Return To Main Menu", toMenu: true }]
  };

  if(Array.isArray(s.sections)){
    const existing = s.sections.find(x => x.id === failId);
    if(!existing) s.sections.push({ id: failId, ...failObj });
  }else if(s.sections && typeof s.sections === "object"){
    if(!s.sections[failId]) s.sections[failId] = failObj;
  }
}

function openModal(type, extra){
  state.ui.modal = { type, ...(extra||{}) };
  render();
}
function closeModal(){ state.ui.modal = null; render(); }

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
    const min = (typeof state.player.hp.min === "number") ? state.player.hp.min : 0;
    const max = (typeof state.player.hp.max === "number") ? state.player.hp.max : 15;
    state.player.hp.cur = clamp(state.player.hp.cur + amt, min, max);
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

function unequipSlot(slot){
  if(!slot) return;
  if(!state.player?.equip) return;
  if(slot !== "weapon" && slot !== "armor" && slot !== "special") return;
  state.player.equip[slot] = null;
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

/* ===== Render ===== */
function render(){
  const root = document.getElementById("app");
  if(!root) return;

  if(state.mode === "home") root.innerHTML = renderHome();
  else if(state.mode === "game") root.innerHTML = renderGame();
  else root.innerHTML = renderBoot();

  // Update background after UI renders (safe even if it fails)
  updateBackgroundForState();
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
  const lastSave = getLastSave();
  const hasSave = !!(lastSave && localStorage.getItem(saveKey(lastSave.storyId, lastSave.slot)));
  const continueClass = hasSave ? "" : "vc-btn--disabled";

  return `
    <div class="vc-wrap">
      <div class="vc-panel vc-scroll">
        <div class="vc-panelPad">
          <div class="vc-homeTop">
            <img src="assets/versecraft-logo.png" alt="VerseCraft Logo" />
          </div>

          <div class="vc-tagline">Your Choices, Your RPG, Your Story.</div>

          <button class="vc-btn" id="btnTapStart">Tap To Start</button>
          <button class="vc-btn" id="btnStoryPicker">Load New Story</button>
          <button class="vc-btn ${continueClass}" id="btnContinue">Continue Story</button>
        </div>

        ${renderModalIfAny()}
      </div>
    </div>
  `;
}

function getSlotLabel(slot){
  const labels = state.story?.module?.slotLabels;
  if(labels && typeof labels === "object"){
    if(slot === "weapon") return safeTitleCaseName(labels.weapon || "Weapon");
    if(slot === "armor") return safeTitleCaseName(labels.armor || "Armor");
    if(slot === "special") return safeTitleCaseName(labels.special || "Special Item");
  }
  if(slot === "weapon") return "Weapon";
  if(slot === "armor") return "Armor";
  return "Special Item";
}

function renderGame(){
  const meta = state.storyMetaById.get(state.storyId);
  const title = safeTitleCaseName(meta?.title || state.story?.title || "Story");
  const subtitle = safeTitleCaseName(meta?.subtitle || "");

  const sec = getSection();
  const text = sec?.text || "Missing section content.";
  const system = sec?.system ? String(sec.system) : "";
  const choices = (sec?.choices || []).filter(canShowChoice);

  const pr = getPrimaryResource(state.story);
  const cur = state.player?.hp?.cur ?? 0;
  const min = state.player?.hp?.min ?? pr.min;
  const max = state.player?.hp?.max ?? pr.max;
  const range = Math.max(1, (max - min));
  const hpPct = ((cur - min) / range) * 100;

  const xpPct = state.player.xp.max > 0 ? (state.player.xp.cur / state.player.xp.max) * 100 : 0;

  const resourceVal = (min < 0)
    ? `${cur}`
    : `${cur} / ${max}`;

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
              <button class="vc-minBtn" id="hudMinBtn">${document.body.classList.contains("hud-min") ? "Expand" : "Minimize"}</button>
            </div>

            <div class="vc-bars">
              <div class="vc-barRow">
                <div class="vc-barLabel">${escapeHtml(pr.name)}</div>
                <div class="vc-bar"><div class="vc-barFill" style="width:${clamp(hpPct, 0, 100)}%;"></div></div>
                <div class="vc-barVal">${escapeHtml(resourceVal)}</div>
              </div>
              <div class="vc-barRow">
                <div class="vc-barLabel">XP</div>
                <div class="vc-bar"><div class="vc-barFill vc-barFill--xp" style="width:${xpPct}%;"></div></div>
                <div class="vc-barVal">${state.player.xp.cur} / ${state.player.xp.max}</div>
              </div>
              <div style="margin-top:2px; font-weight:900; color: rgba(234,241,255,.85);">LVL ${state.player.lvl}</div>
            </div>

            <div class="vc-hudBtns">
              <button class="vc-btn" id="btnCharacter">Character</button>
              <button class="vc-btn" id="btnInventory">Inventory</button>
              <button class="vc-btn" id="btnSave">Save</button>
            </div>
            <div class="vc-hudBtns2">
              <button class="vc-btn" id="btnLoad">Load</button>
              <button class="vc-btn" id="btnMainMenu">Main Menu</button>
            </div>
          </div>
        </div>

        <div class="vc-content">
          <div class="vc-scene">
            <div class="vc-sceneTitle">Background</div>
            <div class="vc-sceneSub">Now auto-loads from VerseCraft-Media (Node → Act fallback)</div>
          </div>

          <div class="vc-storyText">
            ${escapeHtml(text).replace(/\n/g, "<br/>")}
            ${system ? `<div class="vc-systemLine">${escapeHtml(system)}</div>` : ""}

            <div class="vc-choices">
              ${choices.map((c, i) => `<button class="vc-choiceBtn" data-choice="${i}">${escapeHtml(c.label || "Continue")}</button>`).join("")}
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
      <div class="vc-modalMask">
        <div class="vc-modal">
          <div class="vc-modalHeader">
            <h2 class="vc-modalTitle">${escapeHtml(m.title || "Notice")}</h2>
            <button class="vc-closeBtn" data-close="1">Close</button>
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
      <div class="vc-modalMask">
        <div class="vc-modal">
          <div class="vc-modalHeader">
            <h2 class="vc-modalTitle">Load Story</h2>
            <button class="vc-closeBtn" data-close="1">Close</button>
          </div>
          <div class="vc-modalBody">
            ${stories.map(s => {
              const thumb = (s.thumb || "").trim();
              const thumbHtml = thumb
                ? `<img src="${escapeHtml(thumb)}" alt="${escapeHtml(safeTitleCaseName(s.title))}" style="width:100%; height:100%; object-fit:cover; border-radius:12px; opacity:.95;" />`
                : `<div style="width:100%; height:100%; border-radius:12px; background: rgba(234,241,255,.08); display:flex; align-items:center; justify-content:center; color: rgba(234,241,255,.55); font-weight:800;">Thumb</div>`;

              return `
                <button class="vc-storyCard" data-pick-story="${escapeHtml(s.id)}" style="display:flex; gap:12px; align-items:stretch;">
                  <div style="flex:1; min-width:0;">
                    <div class="vc-storyTitle">${escapeHtml(safeTitleCaseName(s.title))}</div>
                    <p class="vc-storySub">${escapeHtml(safeTitleCaseName(s.subtitle || ""))}</p>
                    <div class="vc-storyMeta">${escapeHtml(s.estimate || "")}</div>
                  </div>
                  <div style="width:86px; flex:0 0 86px; height:86px;">
                    ${thumbHtml}
                  </div>
                </button>
              `;
            }).join("")}
          </div>
        </div>
      </div>
    `;
  }

  if(m.type === "slots"){
    const mode = m.mode || "save"; // save | load
    const sid = m.storyId || state.storyId;
    if(!sid){
      return `
        <div class="vc-modalMask">
          <div class="vc-modal">
            <div class="vc-modalHeader">
              <h2 class="vc-modalTitle">${mode === "save" ? "Save Slots" : "Load Slots"}</h2>
              <button class="vc-closeBtn" data-close="1">Close</button>
            </div>
            <div class="vc-modalBody">
              <div style="color: rgba(234,241,255,.78); line-height:1.5;">No story loaded.</div>
            </div>
          </div>
        </div>
      `;
    }

    const meta = state.storyMetaById.get(sid);
    const stTitle = safeTitleCaseName(meta?.title || sid);

    const rows = [1,2,3].map(slot => {
      const info = slotSummary(sid, slot);
      const label = info?.savedAt
        ? `Slot ${slot} · ${new Date(info.savedAt).toLocaleString()}`
        : `Slot ${slot} · Empty`;

      return `
        <button class="vc-storyCard" data-slot-action="${escapeHtml(mode)}" data-slot="${slot}">
          <div class="vc-storyTitle">${escapeHtml(label)}</div>
          <p class="vc-storySub">${escapeHtml(stTitle)}</p>
        </button>
      `;
    }).join("");

    return `
      <div class="vc-modalMask">
        <div class="vc-modal">
          <div class="vc-modalHeader">
            <h2 class="vc-modalTitle">${mode === "save" ? "Save Slots" : "Load Slots"}</h2>
            <button class="vc-closeBtn" data-close="1">Close</button>
          </div>
          <div class="vc-modalBody">
            ${rows}
          </div>
        </div>
      </div>
    `;
  }

  if(m.type === "character"){
    const w = state.player.wealth;
    const cur = getCurrency(state.story);
    const moneyStr = `${cur.symbol || ""}${state.player.money || 0}`;
    return `
      <div class="vc-modalMask">
        <div class="vc-modal">
          <div class="vc-modalHeader">
            <h2 class="vc-modalTitle">Character</h2>
            <button class="vc-closeBtn" data-close="1">Close</button>
          </div>

          <div class="vc-modalBody">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
              <div style="font-weight:900; color: rgba(234,241,255,.85);">${escapeHtml(cur.name)}</div>
              <div style="font-weight:900; color: rgba(234,241,255,.95);">${escapeHtml(moneyStr)}</div>
            </div>

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
              ${loadoutRow(getSlotLabel("weapon"), getEquippedName("weapon"), "weapon")}
              ${loadoutRow(getSlotLabel("armor"), getEquippedName("armor"), "armor")}
              ${loadoutRow(getSlotLabel("special"), getEquippedName("special"), "special")}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  if(m.type === "inventory"){
    const tab = state.ui.invTab;
    return `
      <div class="vc-modalMask">
        <div class="vc-modal">
          <div class="vc-modalHeader">
            <h2 class="vc-modalTitle">Inventory</h2>
            <button class="vc-closeBtn" data-close="1">Close</button>
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

function loadoutRow(key, val, slot){
  const equippedId = slot ? state.player?.equip?.[slot] : null;
  const showUnequip = !!equippedId;

  return `
    <div class="vc-loadoutRow" style="grid-template-columns: 120px 1fr auto;">
      <div class="vc-loadoutKey">${escapeHtml(key)}</div>
      <div class="vc-loadoutVal">${escapeHtml(val)}</div>
      ${showUnequip ? `<button class="vc-miniBtn" data-unequip-slot="${escapeHtml(slot)}">Unequip</button>` : ``}
    </div>
  `;
}

function tabBtn(id, label, active){
  const cls = id === active ? "vc-tab vc-tab--active" : "vc-tab";
  return `<button class="${cls}" data-inv-tab="${escapeHtml(id)}">${escapeHtml(label)}</button>`;
}

function isEquippedId(id){
  return id && (id === state.player.equip.weapon || id === state.player.equip.armor || id === state.player.equip.special);
}

function renderInvTab(cat){
  let list = getInvList(cat);

  if(cat === "weapons" || cat === "armor" || cat === "special"){
    list = list.filter(it => !isEquippedId(it.id));
  }

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
          ${canUse ? `<button class="vc-miniBtn" data-use-item="1" data-cat="${escapeHtml(cat)}" data-id="${escapeHtml(it.id)}">Use</button>` : ""}
          ${canEquip && it.equipSlot ? `<button class="vc-miniBtn" data-equip-item="1" data-cat="${escapeHtml(cat)}" data-id="${escapeHtml(it.id)}">Equip</button>` : ""}
        </div>
      </div>
    `;
  }).join("");
}

/* ============================================================
   ✅ Swipe/Tap Guard
   ============================================================ */
const TAP = {
  startX: 0,
  startY: 0,
  moved: false,
  active: false,
  thresholdPx: 10,
};

document.addEventListener("pointerdown", (e) => {
  TAP.active = true;
  TAP.moved = false;
  TAP.startX = e.clientX;
  TAP.startY = e.clientY;
}, { passive: true });

document.addEventListener("pointermove", (e) => {
  if(!TAP.active) return;
  const dx = Math.abs(e.clientX - TAP.startX);
  const dy = Math.abs(e.clientY - TAP.startY);
  if(dx > TAP.thresholdPx || dy > TAP.thresholdPx){
    TAP.moved = true;
  }
}, { passive: true });

document.addEventListener("pointerup", () => { TAP.active = false; }, { passive: true });
document.addEventListener("pointercancel", () => { TAP.active = false; }, { passive: true });

/* ============================================================
   Global click handler
   ============================================================ */
document.addEventListener("click", async (e) => {
  if(TAP.moved) return;

  const t = e.target;

  if(t.classList && t.classList.contains("vc-modalMask")){
    closeModal();
    return;
  }

  if(t.matches && t.matches("[data-close]")){
    closeModal();
    return;
  }

  if(t.id === "hudMinBtn"){
    document.body.classList.toggle("hud-min");
    render();
    return;
  }

  if(t.id === "btnTapStart"){
    const last = localStorage.getItem(LS.LAST_STORY) || state.storiesIndex?.defaultStoryId;
    if(!last){ toastDialog("No Story", "No default story is set in stories.json"); return; }
    try{
      await startNewRun(last);
    }catch(err){
      toastDialog("Start Failed", String(err?.message || err));
    }
    return;
  }

  if(t.id === "btnStoryPicker"){
    openModal("picker");
    return;
  }

  if(t.id === "btnContinue"){
    try{
      const lastSave = getLastSave();
      if(lastSave && localStorage.getItem(saveKey(lastSave.storyId, lastSave.slot))){
        await loadGameAsync({ strictStoryMatch: false });
      }else{
        const last = localStorage.getItem(LS.LAST_STORY) || state.storiesIndex?.defaultStoryId;
        if(!last){ toastDialog("No Story", "No default story is set in stories.json"); return; }
        await startNewRun(last);
      }
    }catch(err){
      toastDialog("Continue Failed", String(err?.message || err));
    }
    return;
  }

  const pickBtn = t.closest && t.closest("[data-pick-story]");
  if(pickBtn){
    const id = pickBtn.getAttribute("data-pick-story");
    try{
      await startNewRun(id);
    }catch(err){
      toastDialog("Story Switch Failed", String(err?.message || err));
    }
    return;
  }

  if(t.id === "btnCharacter"){ openModal("character"); return; }
  if(t.id === "btnInventory"){ openModal("inventory"); return; }

  if(t.id === "btnSave"){
    openModal("slots", { mode: "save", storyId: state.storyId });
    return;
  }

  if(t.id === "btnLoad"){
    openModal("slots", { mode: "load", storyId: state.storyId });
    return;
  }

  if(t.id === "btnMainMenu"){
    document.body.classList.remove("hud-min");
    state.mode = "home";
    state.ui.modal = null;
    render();
    return;
  }

  const slotActionBtn = t.closest && t.closest("[data-slot-action]");
  if(slotActionBtn){
    const mode = slotActionBtn.getAttribute("data-slot-action");
    const slot = Number(slotActionBtn.getAttribute("data-slot"));
    if(mode === "save"){
      saveGame(slot);
      return;
    }
    if(mode === "load"){
      try{
        await loadGameAsync({ strictStoryMatch: true, storyId: state.storyId, slot });
      }catch(err){
        toastDialog("Load Failed", String(err?.message || err));
      }
      return;
    }
  }

  const unequipBtn = t.closest && t.closest("[data-unequip-slot]");
  if(unequipBtn){
    unequipSlot(unequipBtn.getAttribute("data-unequip-slot"));
    return;
  }

  const choiceBtn = t.closest && t.closest("[data-choice]");
  if(choiceBtn){
    const idx = Number(choiceBtn.getAttribute("data-choice"));
    const sec = getSection();
    if(!sec) return;
    const choices = (sec.choices || []).filter(canShowChoice);
    const choice = choices[idx];
    if(!choice) return;

    if(choice.toMenu){
      document.body.classList.remove("hud-min");
      state.mode = "home";
      state.ui.modal = null;
      render();
      return;
    }

    onChoose(choice);
    return;
  }

  const tabBtnEl = t.closest && t.closest("[data-inv-tab]");
  if(tabBtnEl){
    state.ui.invTab = tabBtnEl.getAttribute("data-inv-tab");
    render();
    return;
  }

  const useBtn = t.closest && t.closest("[data-use-item]");
  if(useBtn){
    useItem(useBtn.getAttribute("data-cat"), useBtn.getAttribute("data-id"));
    return;
  }

  const equipBtn = t.closest && t.closest("[data-equip-item]");
  if(equipBtn){
    equipItem(equipBtn.getAttribute("data-cat"), equipBtn.getAttribute("data-id"));
    return;
  }
});

/* ===== Boot ===== */
(async function init(){
  try{
    await loadStoriesIndex();

    const lastSave = getLastSave();
    if(lastSave){
      localStorage.setItem(LS.LAST_STORY, lastSave.storyId);
    }

    state.mode = "home";
    render();
  }catch(err){
    state.mode = "home";
    render();
    toastDialog("Boot Failed", "Could not load stories.json from repo root. Make sure it exists and is valid JSON.");
  }
})();
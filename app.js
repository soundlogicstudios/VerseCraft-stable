/* ============================================================
   VerseCraft Stable UI Shell (Full file replacement)
   - Home: logo + Tap To Start / Load New Story / Continue Story
   - NO Library preview on splash
   - Story Picker modal (Option C)
   - In-game: HUD + minimize (iOS-safe) + content scroll
   - Character + Inventory modals (populated)
   - Item use clamps at 0, equips supported
   - Save/Load (single slot) localStorage
   - NO Rep / NO Timing
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
    modal: null, // picker | character | inventory | dialog
    invTab: "consumables",
  },
};

function $(sel){ return document.querySelector(sel); }
function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

function safeTitleCaseName(name){
  if(!name) return "";
  return String(name).replaceAll("_", " ");
}

function toastDialog(title, message){
  state.ui.modal = { type: "dialog", title, message };
  render();
}

async function fetchJson(url){
  const res = await fetch(url, { cache: "no-store" });
  if(!res.ok) throw new Error(`${res.status} ${res.statusText}`);
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

  const start = story.start || story.startSectionId || "START";
  state.sectionId = start;

  if(!state.player) state.player = DEFAULT_PLAYER();
  localStorage.setItem(LS.LAST_STORY, storyId);
}

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
      await loadStoryById(data.storyId);
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

function getSection(){
  const s = state.story;
  if(!s) return null;

  if(Array.isArray(s.sections)){
    return s.sections.find(x => x.id === state.sectionId) || null;
  }
  if(s.sections && typeof s.sections === "object"){
    return s.sections[state.sectionId]
      ? { id: state.sectionId, ...s.sections[state.sectionId] }
      : null;
  }
  return null;
}

function applyEffect(effect){
  if(!effect) return;

  if(typeof effect.hp === "number"){
    const p = state.player;
    p.hp.cur = clamp(p.hp.cur + effect.hp, 0, p.hp.max);
  }

  if(effect.setFlag){
    state.player.flags[effect.setFlag] = true;
  }
  if(effect.clearFlag){
    delete state.player.flags[effect.clearFlag];
  }

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
  if(it.qty === 0){
    list.splice(list.indexOf(it), 1);
  }
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

  if(state.player.hp.cur <= 0){
    state.sectionId = "DEATH";
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

function ensureDeathSection(){
  const s = state.story;
  if(!s) return;

  const deathText =
`You collapse as your strength gives out.

This is the demo’s reminder: HP is your survival meter. When it hits zero, the run ends.

Try again—this time, watch for danger, and use your items when it matters.`;

  if(Array.isArray(s.sections)){
    const existing = s.sections.find(x => x.id === "DEATH");
    if(!existing){
      s.sections.push({
        id: "DEATH",
        text: deathText,
        system: "First death is expected. You’re learning the rules.",
        choices: [{ label: "Return To Main Menu", toMenu: true }]
      });
    }
  }else if(s.sections && typeof s.sections === "object"){
    if(!s.sections.DEATH){
      s.sections.DEATH = {
        text: deathText,
        system: "First death is expected. You’re learning the rules.",
        choices: [{ label: "Return To Main Menu", toMenu: true }]
      };
    }
  }
}

function openModal(type){
  state.ui.modal = { type };
  render();
}

function closeModal(){
  state.ui.modal = null;
  render();
}

/* ===== Inventory actions ===== */
function getInvList(cat){
  return state.player.inv[cat] || [];
}

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
  if(it.qty === 0){
    list.splice(list.indexOf(it), 1);
  }

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

/* ===== Render ===== */
function render(){
  const root = document.getElementById("app");
  if(!root) return;

  if(state.mode === "home"){
    root.innerHTML = renderHome();
  }else if(state.mode === "game"){
    root.innerHTML = renderGame();
  }else{
    root.innerHTML = renderBoot();
  }
}

/* ===== UI Templates ===== */
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

          <button class="vc-btn" id="btnTapStart">Tap To Start</button>
          <button class="vc-btn" id="btnStoryPicker">Load New Story</button>
          <button class="vc-btn ${continueClass}" id="btnContinue">Continue Story</button>
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

  const isMin = document.body.classList.contains("hud-min");
  const minLabel = isMin ? "Expand" : "Minimize";

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
              <button class="vc-minBtn" id="hudMinBtn">${minLabel}</button>
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
            <div class="vc-sceneTitle">Image Placeholder</div>
            <div class="vc-sceneSub">Future: scene image or video</div>
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
            ${stories.map(s => `
              <button class="vc-storyCard" data-pick-story="${escapeHtml(s.id)}">
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
      <div class="vc-modalMask">
        <div class="vc-modal">
          <div class="vc-modalHeader">
            <h2 class="vc-modalTitle">Character</h2>
            <button class="vc-closeBtn" data-close="1">Close</button>
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
  return `<button class="${cls}" data-inv-tab="${escapeHtml(id)}">${escapeHtml(label)}</button>`;
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
          ${canUse ? `<button class="vc-miniBtn" data-use-item="1" data-cat="${escapeHtml(cat)}" data-id="${escapeHtml(it.id)}">Use</button>` : ""}
          ${canEquip && it.equipSlot ? `<button class="vc-miniBtn" data-equip-item="1" data-cat="${escapeHtml(cat)}" data-id="${escapeHtml(it.id)}">Equip</button>` : ""}
        </div>
      </div>
    `;
  }).join("");
}

function escapeHtml(str){
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

/* ===== Global click delegation (iOS-safe) ===== */
function bindGlobalClicksOnce(){
  if(window.__vcClicksBound) return;
  window.__vcClicksBound = true;

  document.addEventListener("click", (e) => {
    const t = e.target;

    // modal mask outside click closes
    if(t && t.classList && t.classList.contains("vc-modalMask")){
      closeModal();
      return;
    }

    // close buttons
    if(t && t.matches && t.matches("[data-close]")){
      closeModal();
      return;
    }

    // HUD minimize
    if(t && t.id === "hudMinBtn"){
      document.body.classList.toggle("hud-min");
      render();
      return;
    }

    // Home buttons
    if(t && t.id === "btnStoryPicker"){
      openModal("picker");
      return;
    }

    if(t && t.id === "btnTapStart"){
      (async () => {
        const last = localStorage.getItem(LS.LAST_STORY) || state.storiesIndex?.defaultStoryId;
        if(!last){
          toastDialog("No Story", "No default story is set in stories.json");
          return;
        }
        try{
          await loadStoryById(last);
          ensureDeathSection();
          state.mode = "game";
          render();
        }catch(err){
          toastDialog("Start Failed", String(err?.message || err));
        }
      })();
      return;
    }

    if(t && t.id === "btnContinue"){
      const raw = localStorage.getItem(LS.SAVE);
      if(raw){
        loadGame();
      }else{
        (async () => {
          const last = localStorage.getItem(LS.LAST_STORY) || state.storiesIndex?.defaultStoryId;
          if(!last){
            toastDialog("No Story", "No default story is set in stories.json");
            return;
          }
          try{
            await loadStoryById(last);
            ensureDeathSection();
            state.mode = "game";
            render();
          }catch(err){
            toastDialog("Continue Failed", String(err?.message || err));
          }
        })();
      }
      return;
    }

    // picker story selection
    if(t && t.matches && t.matches("[data-pick-story]")){
      const id = t.getAttribute("data-pick-story");
      (async () => {
        try{
          await loadStoryById(id);
          ensureDeathSection();
          state.mode = "game";
          state.ui.modal = null;
          render();
        }catch(err){
          toastDialog("Story Switch Failed", String(err?.message || err));
        }
      })();
      return;
    }

    // HUD buttons
    if(t && t.id === "btnCharacter"){ openModal("character"); return; }
    if(t && t.id === "btnInventory"){ openModal("inventory"); return; }
    if(t && t.id === "btnSave"){ saveGame(); return; }
    if(t && t.id === "btnLoad"){ loadGame(); return; }
    if(t && t.id === "btnMainMenu"){
      document.body.classList.remove("hud-min");
      state.mode = "home";
      state.ui.modal = null;
      render();
      return;
    }

    // choices
    if(t && t.matches && t.matches("[data-choice]")){
      const idx = Number(t.getAttribute("data-choice"));
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

    // inventory tabs
    if(t && t.matches && t.matches("[data-inv-tab]")){
      state.ui.invTab = t.getAttribute("data-inv-tab");
      render();
      return;
    }

    // inventory use/equip
    if(t && t.matches && t.matches("[data-use-item]")){
      const cat = t.getAttribute("data-cat");
      const id = t.getAttribute("data-id");
      useItem(cat, id);
      return;
    }

    if(t && t.matches && t.matches("[data-equip-item]")){
      const cat = t.getAttribute("data-cat");
      const id = t.getAttribute("data-id");
      equipItem(cat, id);
      return;
    }
  }, { passive: true });
}

/* ===== Boot ===== */
(async function init(){
  bindGlobalClicksOnce();
  try{
    await loadStoriesIndex();
    state.mode = "home";

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
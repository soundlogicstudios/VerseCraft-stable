/* ============================================================
   VerseCraft MVP Shell (Full file replacement)
   FIXES IN THIS VERSION
   - Home is CLEAN (no Library under it)
   - Story Picker modal is the ONLY place the library appears
   - Per-story saves so Lorecraft gear doesn't leak into Code Blue
   - HUD buttons uniform sizing and consistent layout
   - Minimize collapses ONLY action buttons (keeps title + HP/XP/LVL)
   - Choice routing supports multiple destination keys; warns if missing
   - Lightweight status toast for HP/inventory/state changes
   ============================================================ */

const LS = {
  SAVE_PREFIX: "versecraft_save_v2__",     // + storyId
  LAST_STORY: "versecraft_last_story_id",
  LAST_SECTION_PREFIX: "versecraft_last_section__", // + storyId (optional)
};

const DEFAULT_PLAYER_TEMPLATE = () => ({
  hp: { cur: 10, max: 10 },
  xp: { cur: 0, max: 100 },
  lvl: 1,
  wealth: { W: 1, E: 1, A: 1, L: 1, T: 1, H: 1 },
  flags: {},
  inv: { consumables: [], items: [], weapons: [], armor: [], special: [] },
  equip: { weapon: null, armor: null, special: null },
});

function LORECRAFT_PLAYER_TEMPLATE(){
  // Only Lorecraft starts with the Rusty Dagger set, per your requirement.
  const p = DEFAULT_PLAYER_TEMPLATE();
  p.inv.consumables.push({ id: "bandage", name: "Bandage", qty: 1, value: 15, use: { type: "heal", amount: 3 } });
  p.inv.items.push({ id: "candle", name: "Candle", qty: 1, value: 10, use: { type: "story", tag: "CandleMoment" } });
  p.inv.weapons.push({ id: "rusty_dagger", name: "Rusty Dagger", qty: 1, value: 25, equipSlot: "weapon" });
  p.inv.armor.push({ id: "leather_jerkin", name: "Leather Jerkin", qty: 1, value: 30, equipSlot: "armor" });
  p.inv.special.push({ id: "candle_token", name: "Candle", qty: 1, value: 10, equipSlot: "special" });
  p.equip.weapon = "rusty_dagger";
  p.equip.armor  = "leather_jerkin";
  p.equip.special = "candle_token";
  return p;
}

function templateForStoryId(storyId){
  const id = String(storyId || "").toLowerCase();
  if(id.includes("lorecraft")) return LORECRAFT_PLAYER_TEMPLATE();
  // Everything else starts clean by default (no dagger bleed).
  return DEFAULT_PLAYER_TEMPLATE();
}

const state = {
  mode: "boot", // boot | home | game
  storiesIndex: null, // stories.json
  storyMetaById: new Map(),
  story: null,
  storyId: null,
  sectionId: null,

  player: templateForStoryId(""), // will be overwritten on load

  ui: {
    modal: null,     // {type: 'picker'|'character'|'inventory'|'dialog'}
    invTab: "consumables",
    hudMin: false,
    toast: null,     // {msg, t}
  },
};

function $(sel){ return document.querySelector(sel); }
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

function toast(msg){
  state.ui.toast = { msg: String(msg || ""), t: Date.now() };
  render();
  // auto-clear
  setTimeout(() => {
    if(state.ui.toast && (Date.now() - state.ui.toast.t) > 1800){
      state.ui.toast = null;
      render();
    }
  }, 2000);
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

function saveKeyForStory(storyId){
  return `${LS.SAVE_PREFIX}${storyId}`;
}

function hasSaveForStory(storyId){
  return !!localStorage.getItem(saveKeyForStory(storyId));
}

function getLastStoryId(){
  return localStorage.getItem(LS.LAST_STORY) || state.storiesIndex?.defaultStoryId || null;
}

async function loadStoryById(storyId, {fromSave=false} = {}){
  const meta = state.storyMetaById.get(storyId);
  if(!meta) throw new Error("Story not found in stories.json");

  const story = await fetchJson(meta.file);
  state.story = story;
  state.storyId = storyId;

  // start section
  const start = story.start || story.startSectionId || story.startSection || "START";
  state.sectionId = start;

  // IMPORTANT: per-story player isolation.
  // If we're NOT loading from save, reset to that story's template.
  if(!fromSave){
    state.player = templateForStoryId(storyId);
  }

  localStorage.setItem(LS.LAST_STORY, storyId);

  ensureDeathSection();
}

function saveGame(){
  if(!state.storyId){
    toastDialog("No Story Loaded", "Load a story before saving.");
    return;
  }
  const payload = {
    storyId: state.storyId,
    sectionId: state.sectionId,
    player: state.player,
    savedAt: Date.now(),
  };
  localStorage.setItem(saveKeyForStory(state.storyId), JSON.stringify(payload));
  localStorage.setItem(LS.LAST_STORY, state.storyId);
  toast("Saved");
}

function loadGameForStory(storyId){
  const raw = localStorage.getItem(saveKeyForStory(storyId));
  if(!raw){
    toastDialog("No Save Found", "There is no local save for this story yet.");
    return;
  }

  let data;
  try{ data = JSON.parse(raw); }
  catch{
    toastDialog("Save Corrupted", "The local save could not be read.");
    return;
  }

  (async () => {
    try{
      await loadStoryById(storyId, {fromSave:true});
      state.player = data.player || templateForStoryId(storyId);
      state.sectionId = data.sectionId || (state.story.start || "START");
      state.mode = "game";
      state.ui.modal = null;
      toast("Loaded");
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
    return s.sections[state.sectionId] ? { id: state.sectionId, ...s.sections[state.sectionId] } : null;
  }
  return null;
}

function ensureDeathSection(){
  const s = state.story;
  if(!s) return;

  const deathText =
`You collapse as your strength gives out.

This is the demo’s reminder: HP is your survival meter. When it hits zero, the run ends.

Try again—watch for danger, and use your items when it matters.`;

  const deathChoices = [{ label: "Return To Main Menu", toMenu: true }];

  if(Array.isArray(s.sections)){
    const existing = s.sections.find(x => x.id === "DEATH");
    if(!existing){
      s.sections.push({ id: "DEATH", text: deathText, system: "First death is expected. You’re learning the rules.", choices: deathChoices });
    }
  }else if(s.sections && typeof s.sections === "object"){
    if(!s.sections.DEATH){
      s.sections.DEATH = { text: deathText, system: "First death is expected. You’re learning the rules.", choices: deathChoices };
    }
  }
}

function applyEffect(effect){
  if(!effect) return;

  if(typeof effect.hp === "number"){
    const before = state.player.hp.cur;
    state.player.hp.cur = clamp(state.player.hp.cur + effect.hp, 0, state.player.hp.max);
    if(state.player.hp.cur !== before) toast(`HP ${before} → ${state.player.hp.cur}`);
  }

  if(effect.setFlag){
    state.player.flags[effect.setFlag] = true;
    toast(`State: ${effect.setFlag}`);
  }
  if(effect.clearFlag){
    delete state.player.flags[effect.clearFlag];
    toast(`State cleared: ${effect.clearFlag}`);
  }

  if(effect.addItem) addItem(effect.addItem);
  if(effect.removeItem) removeItem(effect.removeItem);

  if(typeof effect.xp === "number"){
    const before = state.player.xp.cur;
    state.player.xp.cur = clamp(state.player.xp.cur + effect.xp, 0, state.player.xp.max);
    if(state.player.xp.cur !== before) toast(`XP ${before} → ${state.player.xp.cur}`);
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
  toast(`+ ${safeTitleCaseName(spec.name || spec.id)}`);
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
  toast(`- ${safeTitleCaseName(it.name || it.id)}`);
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

function resolveChoiceDestination(choice, section){
  // Support different story JSON shapes
  return (
    choice.to ??
    choice.goto ??
    choice.next ??
    choice.target ??
    choice.section ??
    choice.sectionId ??
    choice.toSection ??
    choice.toSectionId ??
    section?.next ??
    section?.nextSection ??
    section?.nextSectionId ??
    null
  );
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

  const sec = getSection();
  const dest = resolveChoiceDestination(choice, sec);

  if(choice.toMenu){
    state.mode = "home";
    state.ui.modal = null;
    state.ui.hudMin = false;
    render();
    return;
  }

  if(dest){
    state.sectionId = dest;
    render();
    return;
  }

  // If we got here: choice has no destination
  toastDialog(
    "Choice Has No Destination",
    "This choice doesn’t specify where to go next (no 'to' / 'next' / 'target').\n\nFix the story JSON for this section so each choice points to a section id."
  );
}

/* ===== Inventory ===== */
function getInvList(cat){ return state.player.inv[cat] || []; }

function useItem(cat, id){
  const list = getInvList(cat);
  const it = list.find(x => x.id === id);
  if(!it) return;
  if((it.qty || 0) <= 0) return;

  const use = it.use;

  if(use?.type === "heal"){
    const before = state.player.hp.cur;
    const amt = use.amount || 0;
    state.player.hp.cur = clamp(state.player.hp.cur + amt, 0, state.player.hp.max);
    toast(`Used ${it.name} (HP ${before} → ${state.player.hp.cur})`);
  }else if(use?.type === "story"){
    if(use.tag){
      state.player.flags[use.tag] = true;
      toast(`Used ${it.name} (${use.tag})`);
    }else{
      toast(`Used ${it.name}`);
    }
  }else{
    toast(`Used ${it.name}`);
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
  toast(`Equipped ${it.name}`);
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

/* ===== Modals ===== */
function openModal(type){ state.ui.modal = { type }; render(); }
function closeModal(){ state.ui.modal = null; render(); }

/* ===== Render ===== */
function render(){
  const root = document.getElementById("app");
  if(!root) return;

  if(state.mode === "home") root.innerHTML = renderHome();
  else if(state.mode === "game") root.innerHTML = renderGame();
  else root.innerHTML = renderBoot();

  // modal mask click outside
  const modalMask = document.querySelector(".vc-modalMask");
  if(modalMask){
    modalMask.addEventListener("click", (e) => {
      if(e.target === modalMask) closeModal();
    });
  }

  // toast close
  const toastEl = document.getElementById("vcToast");
  if(toastEl){
    toastEl.addEventListener("click", () => {
      state.ui.toast = null;
      render();
    });
  }

  // home buttons
  const btnTap = document.getElementById("btnTapStart");
  if(btnTap){
    btnTap.addEventListener("click", async () => {
      const last = getLastStoryId();
      if(!last){
        toastDialog("No Story", "No default story is set in stories.json");
        return;
      }
      try{
        await loadStoryById(last, {fromSave:false});
        state.mode = "game";
        render();
      }catch(err){
        toastDialog("Start Failed", String(err?.message || err));
      }
    });
  }

  const btnPicker = document.getElementById("btnStoryPicker");
  if(btnPicker) btnPicker.addEventListener("click", () => openModal("picker"));

  const btnContinue = document.getElementById("btnContinue");
  if(btnContinue){
    btnContinue.addEventListener("click", async () => {
      const last = getLastStoryId();
      if(!last){
        toastDialog("No Story", "No default story is set in stories.json");
        return;
      }
      if(hasSaveForStory(last)){
        loadGameForStory(last);
      }else{
        // disabled placeholder behavior
        toastDialog("No Save Yet", "Start a story first, then you’ll be able to continue.");
      }
    });
  }

  // picker selection + per-story continue
  document.querySelectorAll("[data-pick-story]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-pick-story");
      try{
        await loadStoryById(id, {fromSave:false});
        state.mode = "game";
        state.ui.modal = null;
        render();
      }catch(err){
        toastDialog("Story Load Failed", String(err?.message || err));
      }
    });
  });

  document.querySelectorAll("[data-continue-story]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-continue-story");
      if(!id) return;
      if(hasSaveForStory(id)){
        loadGameForStory(id);
      }else{
        toastDialog("No Save Found", "There is no save for this story yet.");
      }
    });
  });

  // HUD minimize
  const minBtn = document.getElementById("hudMinBtn");
  if(minBtn){
    minBtn.addEventListener("click", () => {
      state.ui.hudMin = !state.ui.hudMin;
      minBtn.textContent = state.ui.hudMin ? "Expand" : "Minimize";
      render();
    });
  }

  // HUD buttons
  const bChar = document.getElementById("btnCharacter");
  if(bChar) bChar.addEventListener("click", () => openModal("character"));

  const bInv = document.getElementById("btnInventory");
  if(bInv) bInv.addEventListener("click", () => openModal("inventory"));

  const bSave = document.getElementById("btnSave");
  if(bSave) bSave.addEventListener("click", saveGame);

  const bLoad = document.getElementById("btnLoad");
  if(bLoad) bLoad.addEventListener("click", () => {
    if(!state.storyId) return;
    loadGameForStory(state.storyId);
  });

  const bMenu = document.getElementById("btnMainMenu");
  if(bMenu) bMenu.addEventListener("click", () => {
    state.mode = "home";
    state.ui.modal = null;
    state.ui.hudMin = false;
    render();
  });

  // choice buttons
  document.querySelectorAll("[data-choice]").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.getAttribute("data-choice"));
      const sec = getSection();
      if(!sec) return;
      const choices = (sec.choices || []).filter(canShowChoice);
      const choice = choices[idx];
      if(!choice) return;
      onChoose(choice);
    });
  });

  // inv tabs
  document.querySelectorAll("[data-inv-tab]").forEach(t => {
    t.addEventListener("click", () => {
      state.ui.invTab = t.getAttribute("data-inv-tab");
      render();
    });
  });

  // inv use/equip
  document.querySelectorAll("[data-use-item]").forEach(b => {
    b.addEventListener("click", () => {
      const cat = b.getAttribute("data-cat");
      const id = b.getAttribute("data-id");
      useItem(cat, id);
    });
  });

  document.querySelectorAll("[data-equip-item]").forEach(b => {
    b.addEventListener("click", () => {
      const cat = b.getAttribute("data-cat");
      const id = b.getAttribute("data-id");
      equipItem(cat, id);
    });
  });

  // modal close buttons
  document.querySelectorAll("[data-close]").forEach(b => {
    b.addEventListener("click", closeModal);
  });
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

/* HOME: CLEAN — NO LIBRARY HERE */
function renderHome(){
  const last = getLastStoryId();
  const hasSave = last ? hasSaveForStory(last) : false;
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

        ${renderToastIfAny()}
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

  // When minimized: hide action buttons only
  const actionsClass = state.ui.hudMin ? "vc-hudActions vc-hudActions--min" : "vc-hudActions";

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
              <button class="vc-minBtn" id="hudMinBtn">${state.ui.hudMin ? "Expand" : "Minimize"}</button>
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

            <div class="${actionsClass}">
              <div class="vc-hudBtnRow">
                <button class="vc-btn vc-btn--hud" id="btnCharacter">Character</button>
                <button class="vc-btn vc-btn--hud" id="btnInventory">Inventory</button>
                <button class="vc-btn vc-btn--hud" id="btnSave">Save</button>
              </div>
              <div class="vc-hudBtnRow">
                <button class="vc-btn vc-btn--hud" id="btnLoad">Load</button>
                <button class="vc-btn vc-btn--hud" id="btnMainMenu">Main Menu</button>
              </div>
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
              ${
                choices.length
                  ? choices.map((c, i) => `<button class="vc-choiceBtn" data-choice="${i}">${escapeHtml(c.label || "Continue")}</button>`).join("")
                  : `<button class="vc-choiceBtn" data-choice="0">Continue</button>`
              }
            </div>
          </div>
        </div>

        ${renderToastIfAny()}
        ${renderModalIfAny()}
      </div>
    </div>
  `;
}

function renderToastIfAny(){
  if(!state.ui.toast) return "";
  return `<div class="vc-toast" id="vcToast">${escapeHtml(state.ui.toast.msg)}</div>`;
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
            ${stories.length ? stories.map(s => {
              const canCont = hasSaveForStory(s.id);
              const contClass = canCont ? "" : "vc-miniBtn--disabled";
              return `
                <div class="vc-storyCardWrap">
                  <button class="vc-storyCard" data-pick-story="${s.id}">
                    <div class="vc-storyTitle">${escapeHtml(safeTitleCaseName(s.title))}</div>
                    <p class="vc-storySub">${escapeHtml(safeTitleCaseName(s.subtitle || ""))}</p>
                    <div class="vc-storyMeta">${escapeHtml(s.estimate || "")}</div>
                  </button>
                  <button class="vc-miniBtn ${contClass}" data-continue-story="${s.id}" ${canCont ? "" : "disabled"}>
                    Continue
                  </button>
                </div>
              `;
            }).join("") : `<div style="color: rgba(234,241,255,.7);">No stories found in stories.json</div>`}
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
  return `<button class="${cls}" data-inv-tab="${id}">${escapeHtml(label)}</button>`;
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
          ${canUse ? `<button class="vc-miniBtn" data-use-item="1" data-cat="${cat}" data-id="${it.id}">Use</button>` : ""}
          ${canEquip && it.equipSlot ? `<button class="vc-miniBtn" data-equip-item="1" data-cat="${cat}" data-id="${it.id}">Equip</button>` : ""}
        </div>
      </div>
    `;
  }).join("");
}

/* ===== Boot ===== */
(async function init(){
  try{
    await loadStoriesIndex();
    state.mode = "home";

    // keep LAST_STORY aligned if any per-story save exists for the last story
    const last = getLastStoryId();
    if(last) localStorage.setItem(LS.LAST_STORY, last);

    render();
  }catch(err){
    state.mode = "home";
    render();
    toastDialog("Boot Failed", "Could not load stories.json. Make sure it exists in the repo root.");
  }
})();
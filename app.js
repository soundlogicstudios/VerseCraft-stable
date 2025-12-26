/* ============================================================
   VerseCraft MVP Shell (Full file replacement)
   - Home: logo + Tap To Start / Load New Story / Continue Story
   - Story Picker modal (Option C)
   - In-game: fixed HUD + minimize + content scroll
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
  wealth: { W: 1, E: 1, A: 1, L: 1, T: 1, H: 1 }, // arrange WEALTH; H is stat tile, HP is separate resource
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
  storiesIndex: null, // stories.json
  storyMetaById: new Map(),
  story: null, // loaded story JSON
  storyId: null,
  sectionId: null,

  player: DEFAULT_PLAYER(),

  ui: {
    modal: null, // {type: 'picker'|'character'|'inventory'|'load'|'save'|'dialog', ...}
    invTab: "consumables", // consumables | items | weapons | armor | special
  },
};

function $(sel){ return document.querySelector(sel); }
function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

function safeTitleCaseName(name){
  // enforce your convention: capitalized, no underscores in display
  if(!name) return "";
  return String(name).replaceAll("_", " ");
}

function setBodyHudMin(isMin){
  document.body.classList.toggle("hud-min", !!isMin);
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
  if(!meta){
    throw new Error("Story not found in stories.json");
  }
  const story = await fetchJson(meta.file);
  state.story = story;
  state.storyId = storyId;

  // pick start section
  const start = story.start || story.startSectionId || "START";
  state.sectionId = start;

  // ensure player baseline when switching stories (silo story-specific later)
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
  // validate story exists in index
  if(!state.storyMetaById.get(data.storyId)){
    toastDialog("Saved Story Not Found", "Saved story not found in stories.json");
    return;
  }
  // load story then apply state
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

  // support both shapes:
  // 1) story.sections is object {ID: {text, choices}}
  // 2) story.sections is array [{id, text, choices}]
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

  // HP change
  if(typeof effect.hp === "number"){
    const p = state.player;
    p.hp.cur = clamp(p.hp.cur + effect.hp, 0, p.hp.max);
  }

  // flags
  if(effect.setFlag){
    state.player.flags[effect.setFlag] = true;
  }
  if(effect.clearFlag){
    delete state.player.flags[effect.clearFlag];
  }

  // inventory add/remove
  if(effect.addItem){
    addItem(effect.addItem);
  }
  if(effect.removeItem){
    removeItem(effect.removeItem);
  }

  // xp
  if(typeof effect.xp === "number"){
    const p = state.player;
    p.xp.cur = clamp(p.xp.cur + effect.xp, 0, p.xp.max);
  }
}

function addItem(spec){
  // spec: {category, id, name, qty, value, use, equipSlot}
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
  // spec: {category, id, qty}
  const cat = spec.category;
  if(!cat || !state.player.inv[cat]) return;
  const list = state.player.inv[cat];
  const it = list.find(x => x.id === spec.id);
  if(!it) return;
  const q = spec.qty ?? 1;
  it.qty = clamp((it.qty || 0) - q, 0, 9999);
  if(it.qty === 0){
    // keep row if it’s equip slot? remove it to be clean
    list.splice(list.indexOf(it), 1);
  }
}

function canShowChoice(choice){
  if(!choice) return true;
  const req = choice.requires;
  if(!req) return true;

  // requires: {flag:"x"} or {notFlag:"x"} or {hasItem:{category,id}} etc.
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
  // apply effects
  if(choice.effects){
    const arr = Array.isArray(choice.effects) ? choice.effects : [choice.effects];
    arr.forEach(applyEffect);
  }

  // death screen
  if(state.player.hp.cur <= 0){
    state.sectionId = "DEATH";
    render();
    return;
  }

  // go to section
  if(choice.to){
    state.sectionId = choice.to;
    render();
    return;
  }

  // if no target, just re-render
  render();
}

function ensureDeathSection(){
  const s = state.story;
  if(!s) return;

  const deathText =
`You collapse as your strength gives out.

This is the demo’s reminder: HP is your survival meter. When it hits zero, the run ends.

Try again—this time, watch for danger, and use your items when it matters.`;

  // add DEATH section if missing
  if(Array.isArray(s.sections)){
    const existing = s.sections.find(x => x.id === "DEATH");
    if(!existing){
      s.sections.push({
        id: "DEATH",
        text: deathText,
        system: "First death is expected. You’re learning the rules.",
        choices: [
          { label: "Return To Main Menu", toMenu: true }
        ]
      });
    }
  }else if(s.sections && typeof s.sections === "object"){
    if(!s.sections.DEATH){
      s.sections.DEATH = {
        text: deathText,
        system: "First death is expected. You’re learning the rules.",
        choices: [
          { label: "Return To Main Menu", toMenu: true }
        ]
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

  // If not consumable quantity, ignore
  if((it.qty || 0) <= 0) return;

  // default behavior:
  // - if heal: clamp hp
  // - if story tag: set flag to inform story logic (no auto-jump)
  const use = it.use;

  if(use?.type === "heal"){
    const amt = use.amount || 0;
    state.player.hp.cur = clamp(state.player.hp.cur + amt, 0, state.player.hp.max);
  }else if(use?.type === "story"){
    // defer to story logic: set a flag; story can branch based on it
    if(use.tag){
      state.player.flags[use.tag] = true;
    }
  }

  // consume 1
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
  // fallback if missing in inventory list
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

  // bind modal close
  const modalMask = document.querySelector(".vc-modalMask");
  if(modalMask){
    // click outside closes
    modalMask.addEventListener("click", (e) => {
      if(e.target === modalMask) closeModal();
    });
  }

  // hud minimize
  const minBtn = document.getElementById("hudMinBtn");
  if(minBtn){
    minBtn.addEventListener("click", () => {
      const isMin = document.body.classList.toggle("hud-min");
      minBtn.textContent = isMin ? "Expand" : "Minimize";
    });
  }

  // home buttons
  const btnTap = document.getElementById("btnTapStart");
  if(btnTap){
    btnTap.addEventListener("click", async () => {
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
    });
  }

  const btnPicker = document.getElementById("btnStoryPicker");
  if(btnPicker){
    btnPicker.addEventListener("click", () => openModal("picker"));
  }

  const btnContinue = document.getElementById("btnContinue");
  if(btnContinue){
    btnContinue.addEventListener("click", () => {
      // Continue means: load save if exists, else start last story
      const raw = localStorage.getItem(LS.SAVE);
      if(raw){
        loadGame();
      }else{
        const last = localStorage.getItem(LS.LAST_STORY) || state.storiesIndex?.defaultStoryId;
        if(!last){
          toastDialog("No Story", "No default story is set in stories.json");
          return;
        }
        (async () => {
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
    });
  }

  // picker selection
  document.querySelectorAll("[data-pick-story]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-pick-story");
      try{
        await loadStoryById(id);
        ensureDeathSection();
        state.mode = "game";
        state.ui.modal = null;
        render();
      }catch(err){
        toastDialog("Story Switch Failed", String(err?.message || err));
      }
    });
  });

  // in-game HUD buttons
  const bChar = document.getElementById("btnCharacter");
  if(bChar) bChar.addEventListener("click", () => openModal("character"));

  const bInv = document.getElementById("btnInventory");
  if(bInv) bInv.addEventListener("click", () => openModal("inventory"));

  const bSave = document.getElementById("btnSave");
  if(bSave) bSave.addEventListener("click", saveGame);

  const bLoad = document.getElementById("btnLoad");
  if(bLoad) bLoad.addEventListener("click", loadGame);

  const bMenu = document.getElementById("btnMainMenu");
  if(bMenu) bMenu.addEventListener("click", () => {
    setBodyHudMin(false);
    state.mode = "home";
    state.ui.modal = null;
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

      if(choice.toMenu){
        setBodyHudMin(false);
        state.mode = "home";
        state.ui.modal = null;
        render();
        return;
      }

      onChoose(choice);
    });
  });

  // inventory tabs
  document.querySelectorAll("[data-inv-tab]").forEach(t => {
    t.addEventListener("click", () => {
      state.ui.invTab = t.getAttribute("data-inv-tab");
      render();
    });
  });

  // inventory use/equip
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

          <div class="vc-divider"></div>

          <div class="vc-sectionTitle">Library</div>
          ${renderLibraryPreview()}
        </div>

        ${renderModalIfAny()}
      </div>
    </div>
  `;
}

function renderLibraryPreview(){
  const stories = state.storiesIndex?.stories || [];
  if(stories.length === 0){
    return `<div style="color: rgba(234,241,255,.7);">No stories found in stories.json</div>`;
  }
  // preview only (clean first menu); full picker opens separately
  const first3 = stories.slice(0, 3);
  return first3.map(s => `
    <div class="vc-storyCard" style="opacity:.92;">
      <div class="vc-storyTitle">${safeTitleCaseName(s.title)}</div>
      <p class="vc-storySub">${safeTitleCaseName(s.subtitle || "")}</p>
      <div class="vc-storyMeta">${s.estimate || ""}</div>
    </div>
  `).join("");
}

function renderGame(){
  const meta = state.storyMetaById.get(state.storyId);
  const title = safeTitleCaseName(meta?.title || state.story?.title || "Story");
  const subtitle = safeTitleCaseName(meta?.subtitle || "");

  const sec = getSection();
  const text = sec?.text || "Missing section content.";
  const system = sec?.system ? String(sec.system) : "";
  const choices = (sec?.choices || []).filter(canShowChoice);

  // bars
  const hpPct = state.player.hp.max > 0 ? (state.player.hp.cur / state.player.hp.max) * 100 : 0;
  const xpPct = state.player.xp.max > 0 ? (state.player.xp.cur / state.player.xp.max) * 100 : 0;

  return `
    <div class="vc-wrap">
      <div class="vc-panel vc-scroll">
        <div class="vc-hud">
          <div class="vc-hudInner">
            <div class="vc-hudTop">
              <div>
                <h1 class="vc-hudTitle">${title}</h1>
                ${subtitle ? `<div style="color: rgba(234,241,255,.68); font-weight:800; margin-top:2px;">${subtitle}</div>` : ""}
              </div>
              <button class="vc-minBtn" id="hudMinBtn">Minimize</button>
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
              <button class="vc-storyCard" data-pick-story="${s.id}">
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
          <div class="vc-itemName">${escapeHtml(name)}${qty > 1 ? ` x${qty}` : qty === 1 ? "" : ""}</div>
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

function escapeHtml(str){
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

/* ===== Boot ===== */
(async function init(){
  try{
    await loadStoriesIndex();
    // start at home
    state.mode = "home";

    // if a save exists, keep last story id aligned for Continue
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
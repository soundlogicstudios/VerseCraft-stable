/* ============================================================
   VerseCraft Stable UI Shell (Full file replacement)
   - Fix: DEFAULT_PLAYER is now module-agnostic (no story items baked in)
   - Add: module.loadout auto-seeds inventory + equips on NEW RUN start
   - Add: module.primaryResource drives bar label + range + failure routing
   - Add: schema validation for module.loadout + primaryResource (warns, doesn’t crash)
   - Fix: In-game "Load" will NOT silently switch stories; it warns if save is for another module
   - UI: Story Picker cards include a right-side thumbnail placeholder (uses stories.json thumb)
   - Keep: swipe/tap guard so scroll gestures don’t trigger choices
   ============================================================ */

const LS = {
  SAVE: "versecraft_save_v1",
  LAST_STORY: "versecraft_last_story_id",
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
   ✅ Module-agnostic default player
   - No story-specific items or equips live here anymore.
   - NEW RUN seeding comes from story.module.loadout (if present).
   - Primary resource is stored in player.hp (legacy key), but supports min/max.
   ============================================================ */
const DEFAULT_PLAYER = () => ({
  hp: { cur: 15, min: 0, max: 15 }, // legacy key "hp" but module may label it Reputation, etc.
  xp: { cur: 0, max: 100 },         // in-story xp (UI bar)
  lvl: 1,
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

/* ============================================================
   ✅ Schema validation (lightweight, non-blocking)
   - We warn via dialog, but do not crash the run.
   ============================================================ */
function validateStoryModule(story){
  const errors = [];
  if(!story || typeof story !== "object"){
    return { ok: false, errors: ["Story JSON is missing or invalid."] };
  }

  const pr = getPrimaryResource(story);
  if(typeof pr.min !== "number" || typeof pr.max !== "number"){
    errors.push("primaryResource.min/max must be numbers.");
  }else if(pr.max <= pr.min){
    errors.push("primaryResource.max must be greater than primaryResource.min.");
  }
  if(!pr.failureSectionId || typeof pr.failureSectionId !== "string"){
    errors.push("primaryResource.failureSectionId must be a string section id.");
  }

  const loadout = story?.module?.loadout;
  if(loadout != null){
    if(typeof loadout !== "object"){
      errors.push("module.loadout must be an object if present.");
    }else{
      const allowedCats = new Set(["consumables","items","weapons","armor","special"]);
      const slotToDefaultCategory = {
        weapon: "weapons",
        armor: "armor",
        special: "special",
      };
      for(const slot of ["weapon","armor","special"]){
        const spec = loadout[slot];
        if(!spec) continue;
        if(typeof spec !== "object"){
          errors.push(`module.loadout.${slot} must be an object.`);
          continue;
        }
        if(!spec.id){
          errors.push(`module.loadout.${slot}.id is required.`);
          continue;
        }
        const cat = spec.category || slotToDefaultCategory[slot];
        if(!allowedCats.has(cat)){
          errors.push(`module.loadout.${slot}.category "${cat}" is not a valid inventory category.`);
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/* ============================================================
   ✅ NEW RUN seeding from module.loadout
   - Also seeds primary resource min/max and starting value.
   ============================================================ */
function seedPlayerForStory(story){
  const p = DEFAULT_PLAYER();

  // Primary resource (legacy key "hp")
  const pr = getPrimaryResource(story);
  p.hp.min = pr.min;
  p.hp.max = pr.max;

  // Start value:
  // - If resource can go negative (e.g., Reputation -10..10), start at 0 (clamped).
  // - Else (e.g., HP 0..15), start at max.
  const startVal = (pr.min < 0) ? 0 : pr.max;
  p.hp.cur = clamp(startVal, pr.min, pr.max);

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

      // Add to inventory
      p.inv[cat].push({
        id: itemId,
        name: itemName,
        qty: 1,
        value: 0,
        equipSlot: slot,
      });

      // Equip by id
      p.equip[slot] = itemId;
    }
  }

  return p;
}

/* ============================================================
   Start story as a NEW RUN (always seeds from module.loadout)
   - Validates module config; warns if problems are found.
   ============================================================ */
async function startNewRun(storyId){
  await loadStoryById(storyId);

  const v = validateStoryModule(state.story);
  if(!v.ok){
    toastDialog(
      "Story Module Warning",
      "This story will still load, but its module config has issues:\n\n" +
      v.errors.map(e => `• ${e}`).join("\n")
    );
  }

  ensureFailureSection(); // inject module failure section if missing
  state.player = seedPlayerForStory(state.story);
  state.mode = "game";

  // If a warning dialog is showing, keep it; otherwise clear modal
  if(!state.ui.modal || state.ui.modal.type !== "dialog"){
    state.ui.modal = null;
  }
  render();
}

/* ============================================================
   Save / Load
   ============================================================ */
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

function getSavedPayload(){
  const raw = localStorage.getItem(LS.SAVE);
  if(!raw) return null;
  try{ return JSON.parse(raw); }catch{ return null; }
}

/* ============================================================
   Load game (two modes):
   - Home "Continue Story": allowed to switch to saved storyId.
   - In-game "Load": must match current storyId; otherwise show warning.
   ============================================================ */
async function loadGameAsync({ strictStoryMatch } = { strictStoryMatch: false }){
  const data = getSavedPayload();
  if(!data){
    toastDialog("No Save Found", "There is no local save on this device yet.");
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
        `Your save is for "${savedTitle}", but you currently have "${curTitle}" loaded.\n\nGo to Main Menu → Continue Story to load the saved module, or load the correct story first.`
      );
      return;
    }
  }

  await loadStoryById(data.storyId);

  const v = validateStoryModule(state.story);
  if(!v.ok){
    toastDialog(
      "Story Module Warning",
      "This story will still load, but its module config has issues:\n\n" +
      v.errors.map(e => `• ${e}`).join("\n")
    );
  }

  ensureFailureSection();

  // If save has player, use it; otherwise seed
  state.player = data.player || seedPlayerForStory(state.story);

  // Patch older saves that don’t have min/max
  const pr = getPrimaryResource(state.story);
  if(state.player?.hp){
    if(typeof state.player.hp.min !== "number") state.player.hp.min = pr.min;
    if(typeof state.player.hp.max !== "number") state.player.hp.max = pr.max;
    state.player.hp.cur = clamp(state.player.hp.cur ?? 0, state.player.hp.min, state.player.hp.max);
  }

  state.sectionId = data.sectionId || (state.story.start || "START");
  state.mode = "game";

  // If a warning dialog is showing, keep it; otherwise clear modal
  if(!state.ui.modal || state.ui.modal.type !== "dialog"){
    state.ui.modal = null;
  }
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
   Ensure module failure section exists (inject if missing)
   ============================================================ */
function ensureFailureSection(){
  const s = state.story;
  if(!s) return;

  const pr = getPrimaryResource(s);
  const failId = pr.failureSectionId || "DEATH";

  const failText =
`You falter as the pressure finally wins.

This is the demo’s reminder: when your primary resource bottoms out, the run ends.

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

function openModal(type){ state.ui.modal = { type }; render(); }
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

  // Display value string:
  // If min < 0 (Reputation), show just the current value.
  // Else show cur / max (HP style).
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
              ${loadoutRow(getSlotLabel("weapon"), getEquippedName("weapon"))}
              ${loadoutRow(getSlotLabel("armor"), getEquippedName("armor"))}
              ${loadoutRow(getSlotLabel("special"), getEquippedName("special"))}
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

/* ============================================================
   ✅ Swipe/Tap Guard (prevents “scroll triggers choice”)
   - If finger moves > threshold, we treat it as a scroll, not a tap.
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

document.addEventListener("pointerup", () => {
  TAP.active = false;
}, { passive: true });

document.addEventListener("pointercancel", () => {
  TAP.active = false;
}, { passive: true });

/* ============================================================
   Global click handler (event delegation)
   - Guarded: ignore clicks if the gesture was a scroll.
   ============================================================ */
document.addEventListener("click", async (e) => {
  if(TAP.moved){
    return;
  }

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
      const raw = localStorage.getItem(LS.SAVE);
      if(raw){
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
  if(t.id === "btnSave"){ saveGame(); return; }

  if(t.id === "btnLoad"){
    try{ await loadGameAsync({ strictStoryMatch: true }); }
    catch(err){ toastDialog("Load Failed", String(err?.message || err)); }
    return;
  }

  if(t.id === "btnMainMenu"){
    document.body.classList.remove("hud-min");
    state.mode = "home";
    state.ui.modal = null;
    render();
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

    const raw = localStorage.getItem(LS.SAVE);
    if(raw){
      try{
        const saved = JSON.parse(raw);
        if(saved?.storyId) localStorage.setItem(LS.LAST_STORY, saved.storyId);
      }catch{}
    }

    state.mode = "home";
    render();
  }catch(err){
    state.mode = "home";
    render();
    toastDialog("Boot Failed", "Could not load stories.json from repo root. Make sure it exists and is valid JSON.");
  }
})();
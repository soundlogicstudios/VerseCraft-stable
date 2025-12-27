/* ============================================================
   VerseCraft Stable UI Shell (Full file replacement)
   FIX PACK (V1.2.x):
   - Home tagline update: "Your Choices. Your RPG. Your Story."
   - Story-local reset on every story load (inventory/equip/wealth/flags/resource)
     while keeping GLOBAL XP/LVL intact.
   - Equip rule:
       * Equipped items do NOT appear in inventory
       * Equipping swaps previous equipped item back into inventory
   - HUD layout:
       Top row: Character / Inventory / Main Menu
       Bottom row: Save / Load
   - Keeps Swipe/Tap Guard to prevent scroll triggering choices
   ============================================================ */

const LS = {
  SAVE: "versecraft_save_v1",
  LAST_STORY: "versecraft_last_story_id",
};

// ---------- GLOBAL vs STORY-LOCAL ----------
// Global: XP/LVL (and later currency, achievements, etc.)
// Story-local: primary resource (HP/Reputation/etc), flags, wealth, inventory, equip
const DEFAULT_GLOBAL = () => ({
  xp: { cur: 0, max: 100 },
  lvl: 1,
  // future: currency, achievements, etc.
});

const DEFAULT_STORY_LOCAL = () => ({
  resource: { name: "HP", cur: 15, max: 15, min: 0, centered: false }, // per story.module.primaryResource
  wealth: { W: 5, E: 5, A: 5, L: 5, T: 5, H: 5 }, // per story baseline
  flags: {},
  inv: {
    consumables: [],
    items: [],
    weapons: [],
    armor: [],
    special: [],
  },
  // equipped items are stored OUTSIDE inventory
  equip: {
    weapon: null,
    armor: null,
    special: null,
  },
  equipped: {
    weapon: null, // {id,name,value,equipSlot,use,sourceCat}
    armor: null,
    special: null,
  },
});

// Optional per-story fallback kits (until story modules define starting kits)
const STORY_DEFAULT_KIT = {
  lorecraft_tutorial: () => ({
    resource: { name: "HP", cur: 15, max: 15, min: 0, centered: false },
    wealth: { W: 5, E: 5, A: 5, L: 5, T: 5, H: 5 },
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
    equip: { weapon: "rusty_dagger", armor: "leather_jerkin", special: "candle_token" },
    equipped: { weapon: null, armor: null, special: null },
  }),
};

const state = {
  mode: "boot", // boot | home | game
  storiesIndex: null,
  storyMetaById: new Map(),
  story: null,
  storyId: null,
  sectionId: null,

  global: DEFAULT_GLOBAL(),
  local: DEFAULT_STORY_LOCAL(),

  ui: {
    modal: null,
    invTab: "consumables",
  },
};

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function safeTitleCaseName(name) {
  if (!name) return "";
  return String(name).replaceAll("_", " ");
}
function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toastDialog(title, message) {
  state.ui.modal = { type: "dialog", title, message };
  render();
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} (${url})`);
  return await res.json();
}

async function loadStoriesIndex() {
  const idx = await fetchJson("stories.json");
  state.storiesIndex = idx;
  state.storyMetaById.clear();
  (idx.stories || []).forEach(s => state.storyMetaById.set(s.id, s));
}

/* ============================================================
   Story-local reset on story load
   ============================================================ */
function normalizePrimaryResource(story) {
  const mod = story?.module;
  const pr = mod?.primaryResource || { name: "HP", min: 0, max: 15, failureSectionId: "DEATH" };

  // Support centered meters later (Option A chosen for centered modes earlier)
  // For now: if story.module.primaryResource.centered === true,
  // we allow min negative and max positive but still store cur within [min,max].
  const centered = !!pr.centered;

  const min = (typeof pr.min === "number") ? pr.min : 0;
  const max = (typeof pr.max === "number") ? pr.max : 15;

  // Start full by default for non-centered; for centered, start at 0 unless story provides startAt.
  const startAt = (typeof pr.startAt === "number")
    ? pr.startAt
    : (centered ? 0 : max);

  return {
    name: String(pr.name || "HP"),
    min,
    max,
    centered,
    cur: clamp(startAt, min, max),
    failureSectionId: pr.failureSectionId || "DEATH",
  };
}

function applyStoryLocalKit(storyId, story) {
  // 1) Baseline local
  const base = DEFAULT_STORY_LOCAL();

  // 2) Story module primary resource config
  base.resource = normalizePrimaryResource(story);

  // 3) Wealth baseline: 5 across (and later floor/ceil rules can be enforced here)
  base.wealth = { W: 5, E: 5, A: 5, L: 5, T: 5, H: 5 };

  // 4) Starter kit
  if (STORY_DEFAULT_KIT[storyId]) {
    const kit = STORY_DEFAULT_KIT[storyId]();
    base.resource = kit.resource || base.resource;
    base.wealth = kit.wealth || base.wealth;
    base.flags = kit.flags || {};
    base.inv = kit.inv || base.inv;
    base.equip = kit.equip || base.equip;
    base.equipped = kit.equipped || base.equipped;
  } else {
    // If story provides a module.startingKit, use it (future-ready)
    const sk = story?.module?.startingKit;
    if (sk?.inv) base.inv = sk.inv;
    if (sk?.wealth) base.wealth = sk.wealth;
    if (sk?.equip) base.equip = sk.equip;
  }

  state.local = base;

  // Enforce equip rule: move equipped items OUT of inventory into state.local.equipped
  enforceEquipRuleAllSlots();
}

async function loadStoryById(storyId) {
  const meta = state.storyMetaById.get(storyId);
  if (!meta) throw new Error("Story not found in stories.json");

  const story = await fetchJson(meta.file);
  state.story = story;
  state.storyId = storyId;
  state.sectionId = story.start || story.startSectionId || "START";

  // ✅ Story-local reset happens here (keep global intact)
  applyStoryLocalKit(storyId, story);

  localStorage.setItem(LS.LAST_STORY, storyId);
}

function saveGame() {
  const payload = {
    storyId: state.storyId,
    sectionId: state.sectionId,
    // keep global + local
    global: state.global,
    local: state.local,
    savedAt: Date.now(),
  };
  localStorage.setItem(LS.SAVE, JSON.stringify(payload));
  toastDialog("Saved", "Your progress was saved locally on this device.");
}

async function loadGameAsync() {
  const raw = localStorage.getItem(LS.SAVE);
  if (!raw) {
    toastDialog("No Save Found", "There is no local save on this device yet.");
    return;
  }
  let data;
  try { data = JSON.parse(raw); }
  catch {
    toastDialog("Save Corrupted", "The local save could not be read.");
    return;
  }
  if (!data?.storyId) {
    toastDialog("Save Invalid", "Saved story data is missing.");
    return;
  }
  if (!state.storyMetaById.get(data.storyId)) {
    toastDialog("Saved Story Not Found", "Saved story not found in stories.json");
    return;
  }

  await loadStoryById(data.storyId);

  // Restore global/local from save (but still enforce equip rule)
  state.global = data.global || DEFAULT_GLOBAL();
  state.local = data.local || state.local;

  // Align resource bounds if story updated
  state.local.resource = { ...normalizePrimaryResource(state.story), ...(state.local.resource || {}) };
  state.local.resource.cur = clamp(state.local.resource.cur, state.local.resource.min, state.local.resource.max);

  enforceEquipRuleAllSlots();

  state.sectionId = data.sectionId || (state.story.start || "START");
  state.mode = "game";
  state.ui.modal = null;
  render();
}

/* ============================================================
   Story section helpers
   ============================================================ */
function getSection() {
  const s = state.story;
  if (!s) return null;
  if (Array.isArray(s.sections)) {
    return s.sections.find(x => x.id === state.sectionId) || null;
  }
  if (s.sections && typeof s.sections === "object") {
    return s.sections[state.sectionId] ? { id: state.sectionId, ...s.sections[state.sectionId] } : null;
  }
  return null;
}

/* ============================================================
   Effects
   - Supports effect.hp for legacy content
   - Supports effect.resourceDelta for future non-HP stories
   ============================================================ */
function applyEffect(effect) {
  if (!effect) return;

  // Legacy HP delta maps to primary resource delta for now
  if (typeof effect.hp === "number") {
    state.local.resource.cur = clamp(
      state.local.resource.cur + effect.hp,
      state.local.resource.min,
      state.local.resource.max
    );
  }

  if (typeof effect.resourceDelta === "number") {
    state.local.resource.cur = clamp(
      state.local.resource.cur + effect.resourceDelta,
      state.local.resource.min,
      state.local.resource.max
    );
  }

  if (effect.setFlag) state.local.flags[effect.setFlag] = true;
  if (effect.clearFlag) delete state.local.flags[effect.clearFlag];

  if (effect.addItem) addItem(effect.addItem);
  if (effect.removeItem) removeItem(effect.removeItem);

  if (typeof effect.xp === "number") {
    state.global.xp.cur = clamp(state.global.xp.cur + effect.xp, 0, state.global.xp.max);
  }
}

/* ============================================================
   Inventory & Equip rule
   ============================================================ */
function getInvList(cat) { return state.local.inv[cat] || []; }

function addItem(spec) {
  const cat = spec.category;
  if (!cat || !state.local.inv[cat]) return;

  const list = state.local.inv[cat];
  const id = spec.id;
  const existing = list.find(x => x.id === id);
  if (existing) {
    existing.qty = clamp((existing.qty || 0) + (spec.qty || 1), 0, 9999);
  } else {
    list.push({
      id,
      name: safeTitleCaseName(spec.name || id),
      qty: clamp(spec.qty || 1, 0, 9999),
      value: spec.value ?? 0,
      use: spec.use,
      equipSlot: spec.equipSlot,
    });
  }

  // If item is added and it’s currently equipped (shouldn't happen), enforce rule
  enforceEquipRuleAllSlots();
}

function removeItem(spec) {
  const cat = spec.category;
  if (!cat || !state.local.inv[cat]) return;
  const list = state.local.inv[cat];
  const it = list.find(x => x.id === spec.id);
  if (!it) return;

  const q = spec.qty ?? 1;
  it.qty = clamp((it.qty || 0) - q, 0, 9999);
  if (it.qty === 0) list.splice(list.indexOf(it), 1);
}

function catForSlot(slot) {
  if (slot === "weapon") return "weapons";
  if (slot === "armor") return "armor";
  if (slot === "special") return "special";
  return null;
}

function takeFromInventory(cat, id) {
  const list = getInvList(cat);
  const idx = list.findIndex(x => x.id === id);
  if (idx === -1) return null;
  const it = list[idx];

  // treat as stackable, but equip expects a single item record
  // if qty>1, decrement and return a copy
  if ((it.qty || 1) > 1) {
    it.qty = clamp((it.qty || 0) - 1, 0, 9999);
    return { ...it, qty: 1, sourceCat: cat };
  }

  list.splice(idx, 1);
  return { ...it, qty: 1, sourceCat: cat };
}

function putIntoInventory(cat, item) {
  if (!item || !cat || !state.local.inv[cat]) return;
  const list = getInvList(cat);
  const existing = list.find(x => x.id === item.id);
  if (existing) {
    existing.qty = clamp((existing.qty || 0) + (item.qty || 1), 0, 9999);
  } else {
    list.push({
      id: item.id,
      name: safeTitleCaseName(item.name || item.id),
      qty: clamp(item.qty || 1, 0, 9999),
      value: item.value ?? 0,
      use: item.use,
      equipSlot: item.equipSlot,
    });
  }
}

function enforceEquipRuleSlot(slot) {
  const equippedId = state.local.equip[slot];
  if (!equippedId) {
    state.local.equipped[slot] = null;
    return;
  }

  // If equipped object already matches, ensure item isn't present in inventory
  const cat = catForSlot(slot);
  if (!cat) return;

  // Remove any matching item row from inventory (equip items must not appear there)
  const list = getInvList(cat);
  const idx = list.findIndex(x => x.id === equippedId);
  if (idx !== -1) {
    const removed = list[idx];
    list.splice(idx, 1);

    state.local.equipped[slot] = {
      id: removed.id,
      name: removed.name,
      value: removed.value,
      use: removed.use,
      equipSlot: removed.equipSlot || slot,
      sourceCat: cat,
      qty: 1,
    };
  } else {
    // If not found in inventory, keep whatever we have in equipped, or create a minimal record
    if (!state.local.equipped[slot] || state.local.equipped[slot].id !== equippedId) {
      state.local.equipped[slot] = {
        id: equippedId,
        name: safeTitleCaseName(equippedId),
        value: 0,
        use: null,
        equipSlot: slot,
        sourceCat: cat,
        qty: 1,
      };
    }
  }
}

function enforceEquipRuleAllSlots() {
  enforceEquipRuleSlot("weapon");
  enforceEquipRuleSlot("armor");
  enforceEquipRuleSlot("special");
}

function useItem(cat, id) {
  const list = getInvList(cat);
  const it = list.find(x => x.id === id);
  if (!it) return;
  if ((it.qty || 0) <= 0) return;

  const use = it.use;
  if (use?.type === "heal") {
    const amt = use.amount || 0;
    // Heal affects primary resource (usually HP). Clamp to max.
    state.local.resource.cur = clamp(
      state.local.resource.cur + amt,
      state.local.resource.min,
      state.local.resource.max
    );
  } else if (use?.type === "story") {
    if (use.tag) state.local.flags[use.tag] = true;
  }

  it.qty = clamp((it.qty || 0) - 1, 0, 9999);
  if (it.qty === 0) list.splice(list.indexOf(it), 1);
  render();
}

function equipItem(cat, id) {
  const list = getInvList(cat);
  const it = list.find(x => x.id === id);
  if (!it) return;

  const slot = it.equipSlot;
  if (!slot) return;

  // swap old equipped back into inventory
  const oldEquipped = state.local.equipped[slot];
  const slotCat = catForSlot(slot);

  // take the new item out of inventory and put into equipped
  const newEquipped = takeFromInventory(cat, id);
  if (!newEquipped) return;

  state.local.equip[slot] = newEquipped.id;
  state.local.equipped[slot] = {
    id: newEquipped.id,
    name: newEquipped.name,
    value: newEquipped.value,
    use: newEquipped.use,
    equipSlot: newEquipped.equipSlot || slot,
    sourceCat: slotCat || cat,
    qty: 1,
  };

  if (oldEquipped && oldEquipped.id && slotCat) {
    putIntoInventory(slotCat, { ...oldEquipped, qty: 1 });
  }

  // Ensure rule holds (no equipped items in inventory)
  enforceEquipRuleAllSlots();
  render();
}

function getEquippedName(slot) {
  const eq = state.local.equipped[slot];
  if (eq && eq.name) return eq.name;
  if (state.local.equip[slot]) return safeTitleCaseName(state.local.equip[slot]);
  return "None";
}

/* ============================================================
   Choices / Requires
   ============================================================ */
function canShowChoice(choice) {
  if (!choice) return true;
  const req = choice.requires;
  if (!req) return true;

  if (req.flag && !state.local.flags[req.flag]) return false;
  if (req.notFlag && state.local.flags[req.notFlag]) return false;

  if (req.hasItem) {
    const { category, id } = req.hasItem;
    const list = state.local.inv[category] || [];
    const it = list.find(x => x.id === id);
    if (!it || (it.qty || 0) <= 0) return false;
  }

  return true;
}

function onChoose(choice) {
  if (choice.effects) {
    const arr = Array.isArray(choice.effects) ? choice.effects : [choice.effects];
    arr.forEach(applyEffect);
  }

  // death if primary resource hits its min boundary (typically 0)
  if (state.local.resource.cur <= state.local.resource.min) {
    state.sectionId = "DEATH";
    render();
    return;
  }

  if (choice.to) {
    state.sectionId = choice.to;
    render();
    return;
  }

  render();
}

function ensureDeathSection() {
  const s = state.story;
  if (!s) return;

  const resName = state.local.resource?.name || "HP";
  const deathText =
`You collapse as your strength gives out.

This is the tutorial’s reminder: when your ${resName} hits the limit, the run ends.

Try again—watch for danger, and use your items when it matters.`;

  const deathObj = {
    text: deathText,
    system: "First failure is expected. You’re learning the rules.",
    choices: [{ label: "Return To Main Menu", toMenu: true }]
  };

  if (Array.isArray(s.sections)) {
    const existing = s.sections.find(x => x.id === "DEATH");
    if (!existing) s.sections.push({ id: "DEATH", ...deathObj });
  } else if (s.sections && typeof s.sections === "object") {
    if (!s.sections.DEATH) s.sections.DEATH = deathObj;
  }
}

function openModal(type) { state.ui.modal = { type }; render(); }
function closeModal() { state.ui.modal = null; render(); }

/* ============================================================
   Render
   ============================================================ */
function render() {
  const root = document.getElementById("app");
  if (!root) return;

  if (state.mode === "home") root.innerHTML = renderHome();
  else if (state.mode === "game") root.innerHTML = renderGame();
  else root.innerHTML = renderBoot();
}

function renderBoot() {
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

function renderHome() {
  const hasSave = !!localStorage.getItem(LS.SAVE);
  const continueClass = hasSave ? "" : "vc-btn--disabled";

  return `
    <div class="vc-wrap">
      <div class="vc-panel vc-scroll">
        <div class="vc-panelPad">
          <div class="vc-homeTop">
            <img src="assets/versecraft-logo.png" alt="VerseCraft Logo" />
          </div>

          <div class="vc-tagline">Your Choices. Your RPG. Your Story.</div>

          <button class="vc-btn" id="btnTapStart">Tap To Start</button>
          <button class="vc-btn" id="btnStoryPicker">Load New Story</button>
          <button class="vc-btn ${continueClass}" id="btnContinue">Continue Story</button>
        </div>

        ${renderModalIfAny()}
      </div>
    </div>
  `;
}

function renderGame() {
  const meta = state.storyMetaById.get(state.storyId);
  const title = safeTitleCaseName(meta?.title || state.story?.title || "Story");
  const subtitle = safeTitleCaseName(meta?.subtitle || "");

  const sec = getSection();
  const text = sec?.text || "Missing section content.";
  const system = sec?.system ? String(sec.system) : "";
  const choices = (sec?.choices || []).filter(canShowChoice);

  // Primary resource bar (HP/Reputation/etc)
  const r = state.local.resource;
  const rSpan = (r.max - r.min) || 1;
  const rPct = ((r.cur - r.min) / rSpan) * 100;

  const xpPct = state.global.xp.max > 0 ? (state.global.xp.cur / state.global.xp.max) * 100 : 0;

  const minLabel = document.body.classList.contains("hud-min") ? "Expand" : "Minimize";

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
                <div class="vc-barLabel">${escapeHtml(r.name || "HP")}</div>
                <div class="vc-bar"><div class="vc-barFill" style="width:${clamp(rPct, 0, 100)}%;"></div></div>
                <div class="vc-barVal">${r.cur} / ${r.max}</div>
              </div>

              <div class="vc-barRow">
                <div class="vc-barLabel">XP</div>
                <div class="vc-bar"><div class="vc-barFill vc-barFill--xp" style="width:${xpPct}%;"></div></div>
                <div class="vc-barVal">${state.global.xp.cur} / ${state.global.xp.max}</div>
              </div>

              <div style="margin-top:2px; font-weight:900; color: rgba(234,241,255,.85);">LVL ${state.global.lvl}</div>
            </div>

            <!-- ✅ HUD button layout lock -->
            <div class="vc-hudBtns">
              <button class="vc-btn" id="btnCharacter">Character</button>
              <button class="vc-btn" id="btnInventory">Inventory</button>
              <button class="vc-btn" id="btnMainMenu">Main Menu</button>
            </div>
            <div class="vc-hudBtns2">
              <button class="vc-btn" id="btnSave">Save</button>
              <button class="vc-btn" id="btnLoad">Load</button>
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

function renderModalIfAny() {
  const m = state.ui.modal;
  if (!m) return "";

  if (m.type === "dialog") {
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

  if (m.type === "picker") {
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

  if (m.type === "character") {
    const w = state.local.wealth;
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

  if (m.type === "inventory") {
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
              ${tabBtn("consumables", "Consumables", tab)}
              ${tabBtn("items", "Items", tab)}
              ${tabBtn("weapons", "Weapons", tab)}
              ${tabBtn("armor", "Armor", tab)}
              ${tabBtn("special", "Special", tab)}
            </div>

            ${renderInvTab(tab)}
          </div>
        </div>
      </div>
    `;
  }

  return "";
}

function statTile(k, v) {
  return `
    <div class="vc-statTile">
      <span class="k">${escapeHtml(k)}</span>
      <span class="v">${escapeHtml(String(v))}</span>
    </div>
  `;
}

function loadoutRow(key, val) {
  return `
    <div class="vc-loadoutRow">
      <div class="vc-loadoutKey">${escapeHtml(key)}</div>
      <div class="vc-loadoutVal">${escapeHtml(val)}</div>
    </div>
  `;
}

function tabBtn(id, label, active) {
  const cls = id === active ? "vc-tab vc-tab--active" : "vc-tab";
  return `<button class="${cls}" data-inv-tab="${escapeHtml(id)}">${escapeHtml(label)}</button>`;
}

function renderInvTab(cat) {
  const list = getInvList(cat);
  if (!list || list.length === 0) {
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
  if (!TAP.active) return;
  const dx = Math.abs(e.clientX - TAP.startX);
  const dy = Math.abs(e.clientY - TAP.startY);
  if (dx > TAP.thresholdPx || dy > TAP.thresholdPx) TAP.moved = true;
}, { passive: true });

document.addEventListener("pointerup", () => { TAP.active = false; }, { passive: true });
document.addEventListener("pointercancel", () => { TAP.active = false; }, { passive: true });

/* ============================================================
   Global click handler (event delegation)
   - Guarded: ignore clicks if the gesture was a scroll.
   ============================================================ */
document.addEventListener("click", async (e) => {
  if (TAP.moved) return;

  const t = e.target;

  if (t.classList && t.classList.contains("vc-modalMask")) {
    closeModal();
    return;
  }

  if (t.matches && t.matches("[data-close]")) {
    closeModal();
    return;
  }

  if (t.id === "hudMinBtn") {
    document.body.classList.toggle("hud-min");
    render();
    return;
  }

  if (t.id === "btnTapStart") {
    const last = localStorage.getItem(LS.LAST_STORY) || state.storiesIndex?.defaultStoryId;
    if (!last) { toastDialog("No Story", "No default story is set in stories.json"); return; }
    try {
      await loadStoryById(last);
      ensureDeathSection();
      state.mode = "game";
      state.ui.modal = null;
      render();
    } catch (err) {
      toastDialog("Start Failed", String(err?.message || err));
    }
    return;
  }

  if (t.id === "btnStoryPicker") { openModal("picker"); return; }

  if (t.id === "btnContinue") {
    try {
      const raw = localStorage.getItem(LS.SAVE);
      if (raw) {
        await loadGameAsync();
      } else {
        const last = localStorage.getItem(LS.LAST_STORY) || state.storiesIndex?.defaultStoryId;
        if (!last) { toastDialog("No Story", "No default story is set in stories.json"); return; }
        await loadStoryById(last);
        ensureDeathSection();
        state.mode = "game";
        state.ui.modal = null;
        render();
      }
    } catch (err) {
      toastDialog("Continue Failed", String(err?.message || err));
    }
    return;
  }

  const pickBtn = t.closest && t.closest("[data-pick-story]");
  if (pickBtn) {
    const id = pickBtn.getAttribute("data-pick-story");
    try {
      await loadStoryById(id);
      ensureDeathSection();
      state.mode = "game";
      state.ui.modal = null;
      render();
    } catch (err) {
      toastDialog("Story Switch Failed", String(err?.message || err));
    }
    return;
  }

  if (t.id === "btnCharacter") { openModal("character"); return; }
  if (t.id === "btnInventory") { openModal("inventory"); return; }
  if (t.id === "btnSave") { saveGame(); return; }
  if (t.id === "btnLoad") {
    try { await loadGameAsync(); }
    catch (err) { toastDialog("Load Failed", String(err?.message || err)); }
    return;
  }
  if (t.id === "btnMainMenu") {
    document.body.classList.remove("hud-min");
    state.mode = "home";
    state.ui.modal = null;
    render();
    return;
  }

  const choiceBtn = t.closest && t.closest("[data-choice]");
  if (choiceBtn) {
    const idx = Number(choiceBtn.getAttribute("data-choice"));
    const sec = getSection();
    if (!sec) return;
    const choices = (sec.choices || []).filter(canShowChoice);
    const choice = choices[idx];
    if (!choice) return;

    if (choice.toMenu) {
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
  if (tabBtnEl) {
    state.ui.invTab = tabBtnEl.getAttribute("data-inv-tab");
    render();
    return;
  }

  const useBtn = t.closest && t.closest("[data-use-item]");
  if (useBtn) {
    useItem(useBtn.getAttribute("data-cat"), useBtn.getAttribute("data-id"));
    return;
  }

  const equipBtn = t.closest && t.closest("[data-equip-item]");
  if (equipBtn) {
    equipItem(equipBtn.getAttribute("data-cat"), equipBtn.getAttribute("data-id"));
    return;
  }
});

/* ============================================================
   Boot
   ============================================================ */
(async function init() {
  try {
    await loadStoriesIndex();

    // keep last story aligned to save if it exists
    const raw = localStorage.getItem(LS.SAVE);
    if (raw) {
      try {
        const saved = JSON.parse(raw);
        if (saved?.storyId) localStorage.setItem(LS.LAST_STORY, saved.storyId);
      } catch { }
    }

    state.mode = "home";
    render();
  } catch (err) {
    state.mode = "home";
    render();
    toastDialog("Boot Failed", "Could not load stories.json from repo root. Make sure it exists and is valid JSON.");
  }
})();
/* VerseCraft MVP UI Shell (Stable Restore)
   - Clean Home Menu (logo only)
   - Tap To Start opens Story Picker (decision)
   - Story Picker separate screen/modal
   - In-game HUD fixed, content scrolls beneath
   - Character/Inventory modals functional
   - No Rep/Timing in HUD (removed)
   - Main Menu requires confirm
*/

const APP = document.getElementById("app");

const STORAGE_KEY = "versecraft_save_v1";
const STORIES_INDEX = "./stories.json";

const DEFAULT_PLAYER = () => ({
  hp: 10,
  maxHp: 10,
  xp: 0,
  xpToLevel: 100,
  level: 1,
  wealth: { W: 1, E: 1, A: 1, L: 1, T: 1, H: 1 }, // displayed as W E A L T H
  loadout: {
    weapon: "Rusty Dagger",
    armor: "Leather Jerkin",
    special: "Candle"
  },
  inventory: {
    consumables: [
      { title: "Bandage", qty: 1, value: 15, effect: { hp: +2 } }
    ],
    items: [
      { title: "Candle", qty: 1, value: 25, equipSlot: "special" }
    ],
    keyItems: []
  }
});

let state = {
  view: "home", // "home" | "game"
  storiesIndex: null,
  storyPickerOpen: false,
  currentStoryMeta: null,
  storyData: null,
  sectionId: null,
  player: DEFAULT_PLAYER(),
  modal: null, // null | "character" | "inventory" | "storyPicker"
  inventoryTab: "consumables"
};

// ---------- Utilities ----------
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function safeText(s) {
  return (s ?? "").toString();
}

function loadSave() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function clearSave() {
  localStorage.removeItem(STORAGE_KEY);
}

function hasSave() {
  return !!loadSave();
}

function saveGame() {
  if (!state.currentStoryMeta || !state.sectionId || !state.storyData) return;
  const payload = {
    storyId: state.currentStoryMeta.id,
    sectionId: state.sectionId,
    player: state.player
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  toast("Saved.");
}

function toast(msg) {
  // simple alert for now (keeps iOS reliable)
  alert(msg);
}

async function fetchJson(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Fetch failed: ${path} (${res.status})`);
  return await res.json();
}

// ---------- Story Parsing ----------
function normalizeStoryData(raw) {
  // Accept either:
  // { start: "S1", sections: [{id,text,choices:[]}, ...] }
  // OR { sections: { "S1": {...}, "S2": {...} }, start:"S1" }
  const out = { start: "start", sections: {} };

  if (raw.start) out.start = raw.start;

  if (Array.isArray(raw.sections)) {
    raw.sections.forEach(s => {
      if (!s || !s.id) return;
      out.sections[s.id] = s;
    });
  } else if (raw.sections && typeof raw.sections === "object") {
    out.sections = raw.sections;
  } else if (raw && typeof raw === "object") {
    // fallback if someone used { "S1": {...}, ... }
    if (!raw.sections) {
      Object.keys(raw).forEach(k => {
        if (k === "start") return;
        if (raw[k] && typeof raw[k] === "object") out.sections[k] = raw[k];
      });
    }
  }

  // Default start section
  if (!out.sections[out.start]) {
    const firstKey = Object.keys(out.sections)[0];
    if (firstKey) out.start = firstKey;
  }

  return out;
}

function getSection(id) {
  if (!state.storyData) return null;
  return state.storyData.sections[id] || null;
}

// ---------- Choice Logic ----------
function canShowChoice(choice) {
  // supports:
  // choice.requires: { hasItem: "Candle" } OR { hasAny: ["A","B"] }
  const req = choice?.requires;
  if (!req) return true;

  if (req.hasItem) {
    return playerHasItem(req.hasItem);
  }
  if (Array.isArray(req.hasAny)) {
    return req.hasAny.some(t => playerHasItem(t));
  }
  return true;
}

function playerHasItem(title) {
  const t = title.toString().trim().toLowerCase();
  const inv = state.player.inventory;
  const all = [...inv.consumables, ...inv.items, ...inv.keyItems];
  return all.some(it => (it.title || "").toLowerCase() === t && (it.qty ?? 0) > 0);
}

function applyEffects(effects) {
  if (!effects) return;
  // supported effects:
  // { hp: -1/+1, xp:+10, setLoadout:{weapon:"..."}, addItem:{title,qty,value,type}, removeItem:"Candle" }
  if (typeof effects.hp === "number") {
    state.player.hp = clamp(state.player.hp + effects.hp, 0, state.player.maxHp);
  }
  if (typeof effects.xp === "number") {
    state.player.xp = clamp(state.player.xp + effects.xp, 0, 999999);
  }
  if (effects.setLoadout && typeof effects.setLoadout === "object") {
    const lo = state.player.loadout;
    if (effects.setLoadout.weapon) lo.weapon = effects.setLoadout.weapon;
    if (effects.setLoadout.armor) lo.armor = effects.setLoadout.armor;
    if (effects.setLoadout.special) lo.special = effects.setLoadout.special;
  }
  if (effects.addItem && typeof effects.addItem === "object") {
    addItem(effects.addItem);
  }
  if (effects.removeItem) {
    removeItemByTitle(effects.removeItem, 1);
  }
}

function addItem(item) {
  // item: { title, qty=1, value=0, type:"consumable"|"item"|"key", effect?, equipSlot? }
  const title = safeText(item.title);
  if (!title) return;

  const qty = Number(item.qty ?? 1);
  const value = Number(item.value ?? 0);

  const type = item.type || "item";
  const target =
    type === "consumable" ? state.player.inventory.consumables :
    type === "key" ? state.player.inventory.keyItems :
    state.player.inventory.items;

  const existing = target.find(x => (x.title || "").toLowerCase() === title.toLowerCase());
  if (existing) {
    existing.qty = Number(existing.qty ?? 0) + qty;
  } else {
    target.push({
      title,
      qty,
      value,
      effect: item.effect || null,
      equipSlot: item.equipSlot || null
    });
  }
}

function removeItemByTitle(title, qty = 1) {
  const t = safeText(title).toLowerCase();
  const inv = state.player.inventory;
  const buckets = [inv.consumables, inv.items, inv.keyItems];
  for (const b of buckets) {
    const it = b.find(x => (x.title || "").toLowerCase() === t);
    if (it) {
      it.qty = Math.max(0, Number(it.qty ?? 0) - qty);
      return true;
    }
  }
  return false;
}

function handleChoice(choice) {
  // Special UI targets (prevents "Missing section: INVENTORY" etc.)
  const goto = safeText(choice?.goto || choice?.to || "");
  const gotoUpper = goto.toUpperCase();

  if (gotoUpper === "INVENTORY") {
    openInventory();
    return;
  }
  if (gotoUpper === "CHARACTER") {
    openCharacter();
    return;
  }
  if (gotoUpper === "MAIN_MENU") {
    confirmMainMenu();
    return;
  }

  // Apply effects
  if (choice.effects) applyEffects(choice.effects);

  // Optional consumeItem (StoryLogic)
  if (choice.consumeItem) removeItemByTitle(choice.consumeItem, 1);

  // Death check
  if (state.player.hp <= 0) {
    alert("You collapse. HP reached 0.\n\nThis is a demo death. You’ll restart from the beginning of this story.");
    restartStory();
    return;
  }

  // Navigate
  if (goto && state.storyData.sections[goto]) {
    state.sectionId = goto;
    render();
    return;
  }

  // If goto missing, do nothing safely
  render();
}

// ---------- Navigation ----------
async function init() {
  try {
    state.storiesIndex = await fetchJson(STORIES_INDEX);
  } catch (e) {
    APP.innerHTML = `<div class="centerWrap"><div class="card"><div class="cardInner">
      <h2>Could not load stories.json</h2>
      <p style="color:rgba(234,242,255,.72)">Make sure stories.json is in the repo root.</p>
      <p style="color:rgba(234,242,255,.62)">${safeText(e.message)}</p>
    </div></div></div>`;
    return;
  }
  render();
}

function openStoryPicker() {
  state.modal = "storyPicker";
  render();
}

function closeModal() {
  state.modal = null;
  render();
}

async function startStoryById(storyId) {
  const meta = (state.storiesIndex?.stories || []).find(s => s.id === storyId);
  if (!meta) {
    toast("Story not found in stories.json.");
    return;
  }

  try {
    const raw = await fetchJson(`./${meta.file}`);
    state.currentStoryMeta = meta;
    state.storyData = normalizeStoryData(raw);
    state.sectionId = state.storyData.start || "start";

    // Reset player for fresh run (per-story items can be overridden in story JSON later)
    state.player = DEFAULT_PLAYER();

    state.view = "game";
    state.modal = null;
    render();
  } catch (e) {
    alert(`Could not load story file:\n${meta.file}\n\n${safeText(e.message)}`);
  }
}

function restartStory() {
  if (!state.currentStoryMeta) return;
  startStoryById(state.currentStoryMeta.id);
}

function continueStory() {
  const saved = loadSave();
  if (!saved) return;

  const meta = (state.storiesIndex?.stories || []).find(s => s.id === saved.storyId);
  if (!meta) {
    alert("Saved story not found in stories.json.\n\nClearing save so you can continue.");
    clearSave();
    render();
    return;
  }

  fetchJson(`./${meta.file}`)
    .then(raw => {
      state.currentStoryMeta = meta;
      state.storyData = normalizeStoryData(raw);
      state.sectionId = saved.sectionId && state.storyData.sections[saved.sectionId]
        ? saved.sectionId
        : state.storyData.start;

      state.player = saved.player || DEFAULT_PLAYER();

      state.view = "game";
      state.modal = null;
      render();
    })
    .catch(e => {
      alert(`Could not load saved story file:\n${meta.file}\n\n${safeText(e.message)}`);
    });
}

function confirmMainMenu() {
  const ok = confirm("Return to Main Menu?\n\nYou can Save first if you want.");
  if (!ok) return;
  state.view = "home";
  state.modal = null;
  render();
}

function openCharacter() {
  state.modal = "character";
  render();
}

function openInventory() {
  state.modal = "inventory";
  render();
}

// ---------- Inventory Actions ----------
function useConsumable(title) {
  const inv = state.player.inventory.consumables;
  const it = inv.find(x => (x.title || "").toLowerCase() === title.toLowerCase());
  if (!it || (it.qty ?? 0) <= 0) return;

  // apply effect if present
  if (it.effect && typeof it.effect.hp === "number") {
    state.player.hp = clamp(state.player.hp + it.effect.hp, 0, state.player.maxHp);
  }
  it.qty = Math.max(0, (it.qty ?? 0) - 1);
  render();
}

function equipItem(title) {
  const inv = state.player.inventory.items;
  const it = inv.find(x => (x.title || "").toLowerCase() === title.toLowerCase());
  if (!it || (it.qty ?? 0) <= 0) return;

  // Equip rules: if item has equipSlot, set that
  if (it.equipSlot === "weapon") state.player.loadout.weapon = it.title;
  else if (it.equipSlot === "armor") state.player.loadout.armor = it.title;
  else if (it.equipSlot === "special") state.player.loadout.special = it.title;
  else {
    // default: special
    state.player.loadout.special = it.title;
  }
  render();
}

// ---------- Rendering ----------
function render() {
  if (state.view === "home") {
    APP.innerHTML = renderHome();
  } else {
    APP.innerHTML = renderGame();
  }

  // Bind buttons after paint
  bindEvents();
}

function renderHome() {
  const canContinue = hasSave();

  return `
  <div class="screen">
    <div class="centerWrap">
      <div class="card">
        <div class="cardInner">
          <div class="logoBlock">
            <img class="logoImg" src="./assets/versecraft-logo.png" alt="VerseCraft logo" />
            <div class="tagline">Choose Your Paths. Live Your Story.</div>
          </div>

          <div class="menuButtons">
            <button class="btn" data-action="tapStart">Tap To Start</button>
            <button class="btn" data-action="loadNew">Load New Story</button>
            <button class="btn ${canContinue ? "" : "btnDisabled"}" data-action="continue" ${canContinue ? "" : "disabled"}>Continue Story</button>
          </div>

          <div class="smallNote">Local saves • Root GitHub Pages • Demo build</div>
        </div>
      </div>
    </div>

    ${state.modal === "storyPicker" ? renderStoryPickerModal() : ""}
  </div>
  `;
}

function renderGame() {
  const meta = state.currentStoryMeta;
  const storyTitle = meta ? meta.title : "Story";
  const storySubtitle = meta?.subtitle ? meta.subtitle : "";

  const hpPct = (state.player.maxHp > 0) ? (state.player.hp / state.player.maxHp) * 100 : 0;
  const xpPct = (state.player.xpToLevel > 0) ? (state.player.xp / state.player.xpToLevel) * 100 : 0;

  const section = getSection(state.sectionId) || { text: "Missing section.", choices: [] };

  const text = safeText(section.text);
  const systemLines = Array.isArray(section.system) ? section.system : [];

  const choices = Array.isArray(section.choices) ? section.choices : [];
  const visibleChoices = choices.filter(canShowChoice);

  return `
  <div class="gameWrap">
    <div class="hud">
      <div class="hudInner">
        <div class="hudTitle">${safeText(storyTitle)}</div>
        ${storySubtitle ? `<div class="hudSubtitle">${safeText(storySubtitle)}</div>` : ""}

        <div class="barRow">
          <div class="barLabel">HP</div>
          <div class="barTrack"><div class="barFillHP" style="width:${hpPct.toFixed(2)}%"></div></div>
          <div class="barValue">${state.player.hp} / ${state.player.maxHp}</div>
        </div>

        <div class="barRow">
          <div class="barLabel">XP</div>
          <div class="barTrack"><div class="barFillXP" style="width:${xpPct.toFixed(2)}%"></div></div>
          <div class="barValue">${state.player.xp} / ${state.player.xpToLevel}</div>
        </div>

        <div class="hudPills">
          <div class="pill">LVL ${state.player.level}</div>
        </div>

        <div class="hudButtons">
          <button class="btn" data-action="character">Character</button>
          <button class="btn" data-action="inventory">Inventory</button>
          <button class="btn" data-action="save">Save</button>
          <button class="btn" data-action="load">Load</button>
        </div>

        <div class="hudButtons2">
          <button class="btn" data-action="mainMenu">Main Menu</button>
        </div>
      </div>
    </div>

    <div class="contentScroll">
      <div class="panel">
        <div class="panelInner">
          <div class="sceneBox">Image Placeholder<br/><span style="font-weight:700;letter-spacing:.6px;opacity:.7">Future: scene image or video</span></div>
        </div>
      </div>

      <div class="panel">
        <div class="panelInner">
          <div class="storyText">${escapeHtml(text)}</div>

          ${systemLines.map(line => {
            const kind = line.kind || "emph"; // "emph" italic whispers, "neutral" bold-ish
            const cls = kind === "neutral" ? "neutral" : "emph";
            return `<div class="systemLine ${cls}">${escapeHtml(line.text || "")}</div>`;
          }).join("")}

          <div class="choiceList">
            ${visibleChoices.map((c, idx) => {
              const label = safeText(c.label || c.text || `Choice ${idx+1}`);
              return `<button class="choiceBtn" data-choice="${idx}">${escapeHtml(label)}</button>`;
            }).join("")}
          </div>
        </div>
      </div>
    </div>

    ${state.modal === "character" ? renderCharacterModal() : ""}
    ${state.modal === "inventory" ? renderInventoryModal() : ""}
  </div>
  `;
}

function renderStoryPickerModal() {
  const stories = state.storiesIndex?.stories || [];
  return `
    <div class="modalOverlay" data-action="modalOverlay">
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modalInner">
          <div class="modalHeader">
            <div class="modalTitle">Load New Story</div>
            <button class="modalClose" data-action="closeModal">Close</button>
          </div>

          <div class="itemList">
            ${stories.map(s => `
              <div class="itemRow" style="align-items:flex-start">
                <div>
                  <div class="itemName" style="color: var(--cyan)">${escapeHtml(s.title || s.id)}</div>
                  <div class="itemMeta">${escapeHtml(s.subtitle || "")}</div>
                  <div class="itemMeta">${escapeHtml(s.estimate || "")}</div>
                </div>
                <div class="itemActions">
                  <button class="miniBtn" data-action="startStory" data-storyid="${escapeHtml(s.id)}">Start</button>
                </div>
              </div>
            `).join("")}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderCharacterModal() {
  const w = state.player.wealth;
  return `
    <div class="modalOverlay" data-action="modalOverlay">
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modalInner">
          <div class="modalHeader">
            <div class="modalTitle">Character</div>
            <button class="modalClose" data-action="closeModal">Close</button>
          </div>

          <div class="avatarSilhouette" aria-label="Avatar placeholder"></div>

          <div class="wealthRow">
            ${renderStatTile("W", w.W)}
            ${renderStatTile("E", w.E)}
            ${renderStatTile("A", w.A)}
            ${renderStatTile("L", w.L)}
            ${renderStatTile("T", w.T)}
            ${renderStatTile("H", w.H)}
          </div>

          <div class="sectionBlock">
            <h3>Loadout</h3>
            <div class="kv"><div class="k">Weapon</div><div class="v">${escapeHtml(state.player.loadout.weapon)}</div></div>
            <div class="kv"><div class="k">Armor</div><div class="v">${escapeHtml(state.player.loadout.armor)}</div></div>
            <div class="kv"><div class="k">Special Item</div><div class="v">${escapeHtml(state.player.loadout.special)}</div></div>
          </div>

        </div>
      </div>
    </div>
  `;
}

function renderInventoryModal() {
  const inv = state.player.inventory;

  const tab = state.inventoryTab;
  const list =
    tab === "consumables" ? inv.consumables :
    tab === "items" ? inv.items :
    inv.keyItems;

  return `
    <div class="modalOverlay" data-action="modalOverlay">
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modalInner">
          <div class="modalHeader">
            <div class="modalTitle">Inventory</div>
            <button class="modalClose" data-action="closeModal">Close</button>
          </div>

          <div class="tabs">
            <button class="tab ${tab==="consumables"?"tabActive":""}" data-action="tab" data-tab="consumables">Consumables</button>
            <button class="tab ${tab==="items"?"tabActive":""}" data-action="tab" data-tab="items">Items</button>
            <button class="tab ${tab==="keyItems"?"tabActive":""}" data-action="tab" data-tab="keyItems">Key Items</button>
          </div>

          <div class="itemList">
            ${list.length ? list.map(it => renderInventoryRow(it, tab)).join("") : `
              <div class="sectionBlock" style="text-align:center;color:rgba(234,242,255,.70)">
                No items here yet.
              </div>
            `}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderInventoryRow(it, tab) {
  const title = safeText(it.title);
  const qty = Number(it.qty ?? 0);
  const value = Number(it.value ?? 0);

  let actionHtml = "";
  if (tab === "consumables") {
    actionHtml = `<button class="miniBtn" data-action="use" data-title="${escapeHtml(title)}" ${qty>0 ? "" : "disabled"}>Use</button>`;
  } else if (tab === "items") {
    // equip if item has equipSlot; otherwise no action yet
    const canEquip = !!it.equipSlot;
    actionHtml = `<button class="miniBtn" data-action="equip" data-title="${escapeHtml(title)}" ${canEquip && qty>0 ? "" : "disabled"}>Equip</button>`;
  } else {
    actionHtml = `<button class="miniBtn" disabled>Info</button>`;
  }

  return `
    <div class="itemRow">
      <div>
        <div class="itemName">${escapeHtml(title)}</div>
        <div class="itemMeta">Qty ${qty} • Value ${value}</div>
      </div>
      <div class="itemActions">${actionHtml}</div>
    </div>
  `;
}

function renderStatTile(k, v) {
  return `
    <div class="statTile">
      <div class="k">${k}</div>
      <div class="v">${Number(v ?? 0)}</div>
    </div>
  `;
}

function escapeHtml(str) {
  return safeText(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ---------- Event Binding ----------
function bindEvents() {
  APP.querySelectorAll("[data-action]").forEach(el => {
    el.addEventListener("click", (e) => {
      const action = el.getAttribute("data-action");

      if (action === "tapStart" || action === "loadNew") {
        // Decision: Tap To Start opens Story Picker
        openStoryPicker();
        return;
      }
      if (action === "continue") {
        continueStory();
        return;
      }
      if (action === "closeModal") {
        closeModal();
        return;
      }
      if (action === "modalOverlay") {
        // clicking overlay closes modal
        if (e.target === el) closeModal();
        return;
      }
      if (action === "startStory") {
        const id = el.getAttribute("data-storyid");
        startStoryById(id);
        return;
      }

      // In-game actions
      if (action === "character") { openCharacter(); return; }
      if (action === "inventory") { openInventory(); return; }
      if (action === "save") { saveGame(); return; }
      if (action === "load") { continueStory(); return; } // single-slot load
      if (action === "mainMenu") { confirmMainMenu(); return; }

      // Inventory modal actions
      if (action === "tab") {
        state.inventoryTab = el.getAttribute("data-tab");
        render();
        return;
      }
      if (action === "use") {
        useConsumable(el.getAttribute("data-title"));
        return;
      }
      if (action === "equip") {
        equipItem(el.getAttribute("data-title"));
        return;
      }
    });
  });

  // Choice buttons
  APP.querySelectorAll("[data-choice]").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.getAttribute("data-choice"));
      const section = getSection(state.sectionId);
      if (!section || !Array.isArray(section.choices)) return;

      const visible = section.choices.filter(canShowChoice);
      const choice = visible[idx];
      if (!choice) return;

      handleChoice(choice);
    });
  });
}

// ---------- Boot ----------
init();
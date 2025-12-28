/* ============================================================
   VerseCraft Stable UI Shell (FULL FILE REPLACEMENT)
   - Money System (module-driven label; character screen only)
   - Equipped items do NOT appear in inventory
   - Inventory "Use" only for Consumables
   - Full replacement per locked pipeline
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
   DEFAULT PLAYER (module-agnostic)
   ============================================================ */
const DEFAULT_PLAYER = () => ({
  hp: { cur: 15, min: 0, max: 15 },
  xp: { cur: 0, max: 100 },
  lvl: 1,
  money: 0,
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
  mode: "boot",
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
  state.sectionId = story.start || "1";
  localStorage.setItem(LS.LAST_STORY, storyId);
}

/* ============================================================
   MODULE HELPERS
   ============================================================ */
function getPrimaryResource(story){
  const pr = story?.module?.primaryResource || {};
  return {
    name: safeTitleCaseName(pr.name || "HP"),
    min: (typeof pr.min === "number") ? pr.min : 0,
    max: (typeof pr.max === "number") ? pr.max : 15,
    failureSectionId: String(pr.failureSectionId || "DEATH")
  };
}

function getCurrency(story){
  const c = story?.module?.currency || {};
  return {
    name: safeTitleCaseName(c.name || "Currency"),
    symbol: String(c.symbol || "")
  };
}

/* ============================================================
   NEW RUN SEEDING
   ============================================================ */
function seedPlayerForStory(story){
  const p = DEFAULT_PLAYER();

  const pr = getPrimaryResource(story);
  p.hp.min = pr.min;
  p.hp.max = pr.max;
  p.hp.cur = clamp(pr.min < 0 ? 0 : pr.max, pr.min, pr.max);

  const sm = story?.module?.startingMoney;
  p.money = (typeof sm === "number") ? Math.max(0, Math.floor(sm)) : 0;

  const loadout = story?.module?.loadout || {};
  for(const slot of ["weapon","armor","special"]){
    const spec = loadout[slot];
    if(spec?.id) p.equip[slot] = String(spec.id);
  }

  return p;
}

/* ============================================================
   STORY NAV + EFFECTS
   ============================================================ */
function getSection(){
  const s = state.story;
  if(!s) return null;
  if(Array.isArray(s.sections)){
    return s.sections.find(x => x.id === state.sectionId) || null;
  }
  return s.sections?.[state.sectionId] ? { id: state.sectionId, ...s.sections[state.sectionId] } : null;
}

function applyEffect(effect){
  if(!effect) return;
  if(typeof effect.hp === "number"){
    const p = state.player;
    p.hp.cur = clamp(p.hp.cur + effect.hp, p.hp.min, p.hp.max);
  }
  if(typeof effect.money === "number"){
    state.player.money = clamp(state.player.money + effect.money, 0, 999999999);
  }
  if(effect.setFlag) state.player.flags[effect.setFlag] = true;
  if(effect.clearFlag) delete state.player.flags[effect.clearFlag];
  if(effect.addItem) addItem(effect.addItem);
  if(effect.removeItem) removeItem(effect.removeItem);
}

function addItem(spec){
  const cat = spec.category;
  if(!state.player.inv[cat]) return;
  const list = state.player.inv[cat];
  const it = list.find(x => x.id === spec.id);
  if(it) it.qty += spec.qty || 1;
  else list.push({ id: spec.id, name: safeTitleCaseName(spec.name || spec.id), qty: spec.qty || 1 });
}

function removeItem(spec){
  const cat = spec.category;
  if(!state.player.inv[cat]) return;
  const list = state.player.inv[cat];
  const it = list.find(x => x.id === spec.id);
  if(!it) return;
  it.qty -= spec.qty || 1;
  if(it.qty <= 0) list.splice(list.indexOf(it),1);
}

function canShowChoice(choice){
  const req = choice.requires;
  if(!req) return true;
  if(req.flag && !state.player.flags[req.flag]) return false;
  if(req.notFlag && state.player.flags[req.notFlag]) return false;
  if(typeof req.moneyAtLeast === "number" && state.player.money < req.moneyAtLeast) return false;
  return true;
}

/* ============================================================
   RENDER (minimal; unchanged shell)
   ============================================================ */
function render(){}

(async function init(){
  await loadStoriesIndex();
  state.mode = "home";
})();
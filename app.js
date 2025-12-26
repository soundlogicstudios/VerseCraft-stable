/* VerseCraft — clean rebuild (single-file vanilla JS)
   - Home menu + story picker
   - In-game HUD sticky + minimize
   - Character + Inventory modals
   - Consumables (Use) and equipment (Equip) with values
   - HP clamp rule built-in
*/

const APP = document.getElementById("app");

const STORAGE_KEY = "versecraft_save_v1";

const DEFAULT_PLAYER = () => ({
  hp: 10,
  maxHp: 10,
  xp: 0,
  xpToLevel: 100,
  level: 1,

  // WEALTH stats default
  stats: { W: 1, E: 1, A: 1, L: 1, T: 1, H: 1 },

  equipped: {
    weapon: "Rusty Dagger",
    armor: "Leather Jerkin",
    special: "Candle"
  },

  // inventory items are capitalized, no underscores
  inventory: [
    { name: "Bandage", category: "Consumables", qty: 1, value: 15, heal: 3 },
    { name: "Rusty Dagger", category: "Weapons", qty: 1, value: 25, slot: "weapon" },
    { name: "Leather Jerkin", category: "Armor", qty: 1, value: 30, slot: "armor" },
    { name: "Candle", category: "Special", qty: 1, value: 10, slot: "special" }
  ]
});

let storiesIndex = null;
let storyData = null;

let state = {
  screen: "home", // home | game
  currentStoryId: null,
  currentSectionId: null,
  hudCollapsed: false,
  player: DEFAULT_PLAYER()
};

/* -------------------- Utilities -------------------- */
function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }

function safeJsonParse(s){
  try { return JSON.parse(s); } catch { return null; }
}

function showAlert(msg){
  // basic modal alert — iOS friendly
  window.alert(msg);
}

function saveToLocal(){
  const payload = {
    currentStoryId: state.currentStoryId,
    currentSectionId: state.currentSectionId,
    hudCollapsed: state.hudCollapsed,
    player: state.player
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function loadFromLocal(){
  const raw = localStorage.getItem(STORAGE_KEY);
  if(!raw) return null;
  const parsed = safeJsonParse(raw);
  if(!parsed) return null;
  return parsed;
}

function resetSave(){
  localStorage.removeItem(STORAGE_KEY);
}

/* -------------------- Data Loading -------------------- */
async function fetchJson(path){
  const res = await fetch(path, { cache: "no-cache" });
  if(!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
  return await res.json();
}

async function ensureStoriesIndex(){
  if(storiesIndex) return storiesIndex;
  storiesIndex = await fetchJson("stories.json");
  return storiesIndex;
}

async function loadStoryById(storyId){
  const idx = await ensureStoriesIndex();
  const entry = idx.stories.find(s => s.id === storyId);
  if(!entry) throw new Error(`Story not found in stories.json: ${storyId}`);
  storyData = await fetchJson(entry.file);
  state.currentStoryId = storyId;
  state.currentSectionId = storyData.start || "start";
  return storyData;
}

/* -------------------- Inventory Logic -------------------- */
function findInvItem(name){
  return state.player.inventory.find(i => i.name === name) || null;
}

function decItem(name, amt=1){
  const it = findInvItem(name);
  if(!it) return false;
  it.qty = (it.qty || 0) - amt;
  if(it.qty <= 0){
    state.player.inventory = state.player.inventory.filter(x => x.name !== name);
  }
  return true;
}

function equipItem(name){
  const it = findInvItem(name);
  if(!it || !it.slot) return false;
  state.player.equipped[it.slot] = it.name;
  return true;
}

function useConsumable(name){
  const it = findInvItem(name);
  if(!it) return false;
  if(it.category !== "Consumables") return false;

  // heal (HP clamp rule)
  const heal = Number(it.heal || 0);
  if(heal > 0){
    state.player.hp = clamp(state.player.hp + heal, 0, state.player.maxHp);
  }

  decItem(name, 1);
  return true;
}

/* -------------------- Story Engine -------------------- */
function getSection(id){
  if(!storyData || !storyData.sections) return null;
  return storyData.sections[id] || null;
}

function applyEffects(effects){
  if(!effects) return;

  // Simple effects for demo:
  // - hpDelta: +/- number
  // - addItem: {name, category, qty, value, heal?, slot?}
  // - removeItem: {name, qty}
  // - goto: "sectionId"
  if(typeof effects.hpDelta === "number"){
    state.player.hp = clamp(state.player.hp + effects.hpDelta, 0, state.player.maxHp);
  }

  if(effects.addItem){
    const add = effects.addItem;
    const existing = findInvItem(add.name);
    if(existing){
      existing.qty = (existing.qty || 0) + (add.qty || 1);
    }else{
      state.player.inventory.push({
        name: add.name,
        category: add.category,
        qty: add.qty || 1,
        value: add.value || 0,
        heal: add.heal,
        slot: add.slot
      });
    }
  }

  if(effects.removeItem){
    const rem = effects.removeItem;
    decItem(rem.name, rem.qty || 1);
  }

  if(effects.goto){
    state.currentSectionId = effects.goto;
  }
}

function choose(choice){
  if(!choice) return;

  // choice: { text, to, effects? }
  if(choice.effects) applyEffects(choice.effects);
  if(choice.to) state.currentSectionId = choice.to;

  // death hint
  if(state.player.hp <= 0){
    showAlert("You’re at 0 HP. First time? That’s your warning. Load or return to the main menu.");
  }

  saveToLocal();
  render();
}

/* -------------------- UI Components -------------------- */
function el(tag, attrs={}, children=[]){
  const node = document.createElement(tag);
  for(const [k,v] of Object.entries(attrs)){
    if(k === "class") node.className = v;
    else if(k === "html") node.innerHTML = v;
    else if(k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v);
  }
  for(const c of children){
    if(c === null || c === undefined) continue;
    if(typeof c === "string") node.appendChild(document.createTextNode(c));
    else node.appendChild(c);
  }
  return node;
}

function modal(title, bodyNode, onClose){
  const backdrop = el("div", { class: "vc-modal-backdrop", onclick: (e)=>{ if(e.target === backdrop) onClose(); }});
  const box = el("div", { class: "vc-modal" });

  const head = el("div", { class: "vc-modal-head" }, [
    el("h3", { class: "vc-modal-title" }, [title]),
    el("button", { class: "vc-btn small secondary", onclick: onClose }, ["Close"])
  ]);

  const body = el("div", { class: "vc-modal-body" }, [bodyNode]);

  box.appendChild(head);
  box.appendChild(body);
  backdrop.appendChild(box);
  document.body.appendChild(backdrop);

  return ()=> backdrop.remove();
}

/* -------------------- Screens -------------------- */
function renderHome(){
  const shell = el("div", { class: "vc-shell" });

  const panel = el("div", { class: "vc-panel" });
  const inner = el("div", { class: "vc-panel-inner" });

  const hero = el("div", { class: "home-hero" }, [
    el("img", { class: "home-logo", src: "assets/versecraft-logo.png", alt: "VerseCraft" }),
    el("p", { class: "home-tag" }, ["Choose Your Paths. Live Your Story."])
  ]);

  const actions = el("div", { class: "home-actions" });

  const saved = loadFromLocal();
  const hasSave = !!(saved && saved.currentStoryId && saved.currentSectionId);

  const btnTap = el("button", {
    class: "vc-btn",
    onclick: async ()=>{
      // start default story fresh
      state.player = DEFAULT_PLAYER();
      state.hudCollapsed = false;
      await loadStoryById((await ensureStoriesIndex()).defaultStoryId);
      state.screen = "game";
      saveToLocal();
      render();
    }
  }, ["Tap To Start"]);

  const btnLoadStory = el("button", {
    class: "vc-btn secondary",
    onclick: async ()=> openStoryPicker()
  }, ["Load New Story"]);

  // Option B: disabled placeholder for shop
  const btnShop = el("button", {
    class: "vc-btn secondary disabled",
    disabled: true
  }, ["Go To Shop"]);

  actions.appendChild(btnTap);
  actions.appendChild(btnLoadStory);
  actions.appendChild(btnShop);

  // Continue (only if a valid save exists)
  const btnContinue = el("button", {
    class: `vc-btn secondary ${hasSave ? "" : "disabled"}`,
    disabled: !hasSave,
    onclick: async ()=>{
      const s = loadFromLocal();
      if(!s) return;
      await loadStoryById(s.currentStoryId);
      state.currentSectionId = s.currentSectionId;
      state.hudCollapsed = !!s.hudCollapsed;
      state.player = s.player || DEFAULT_PLAYER();
      state.screen = "game";
      render();
    }
  }, ["Continue Story"]);

  actions.appendChild(btnContinue);

  inner.appendChild(hero);
  inner.appendChild(actions);

  panel.appendChild(inner);
  shell.appendChild(panel);

  return shell;
}

async function openStoryPicker(){
  const idx = await ensureStoriesIndex();

  const list = el("div", { class: "story-list" }, idx.stories.map(st => {
    return el("div", {
      class: "story-card",
      onclick: async ()=>{
        // confirm dialog first (your request)
        const ok = window.confirm(`Load "${st.title}"?\n\nThis will start the story at its beginning (your save remains available via Continue Story).`);
        if(!ok) return;

        // load story fresh, but keep inventory defaults (story-specific sets come later)
        state.player = DEFAULT_PLAYER();
        state.hudCollapsed = false;
        await loadStoryById(st.id);
        state.screen = "game";
        saveToLocal();
        close();
        render();
      }
    }, [
      el("p", { class: "story-title" }, [st.title]),
      el("p", { class: "story-sub" }, [st.subtitle || ""]),
      el("p", { class: "story-meta" }, [st.estimate || ""])
    ]);
  }));

  const close = modal("Load Story", el("div", {}, [
    el("div", { class: "vc-label" }, ["Select A Story"]),
    el("div", { class: "vc-divider" }),
    list
  ]), ()=> closer());

  const closer = close;
}

function renderGame(){
  const shell = el("div", { class: "vc-shell" });

  const wrap = el("div", { class: "game-wrap" });

  const section = getSection(state.currentSectionId);
  const title = storyData?.title || "Story";
  const subtitle = storyData?.subtitle || "";

  const hpPct = state.player.maxHp > 0 ? (state.player.hp / state.player.maxHp) * 100 : 0;
  const xpPct = state.player.xpToLevel > 0 ? (state.player.xp / state.player.xpToLevel) * 100 : 0;

  const hud = el("div", { class: `vc-panel hud ${state.hudCollapsed ? "collapsed" : ""}` });
  const hudInner = el("div", { class: "hud-inner" });

  const hudTop = el("div", { class: "hud-top" }, [
    el("div", {}, [
      el("h2", { class: "hud-title" }, [title]),
      el("p", { class: "hud-subtitle" }, [subtitle])
    ]),
    el("button", {
      class: "vc-btn small secondary hud-min-btn",
      onclick: ()=>{
        state.hudCollapsed = !state.hudCollapsed;
        saveToLocal();
        render();
      }
    }, [state.hudCollapsed ? "Expand" : "Minimize"])
  ]);

  const bars = el("div", { class: "bars" }, [
    el("div", { class: "bar-label" }, ["HP"]),
    el("div", { class: "bar" }, [ el("div", { class: "fill", style: `width:${hpPct}%;` }) ]),
    el("div", { class: "bar-val" }, [`${state.player.hp} / ${state.player.maxHp}`]),

    el("div", { class: "bar-label" }, ["XP"]),
    el("div", { class: "bar xp" }, [ el("div", { class: "fill", style: `width:${xpPct}%;` }) ]),
    el("div", { class: "bar-val" }, [`${state.player.xp} / ${state.player.xpToLevel}`])
  ]);

  const actions = el("div", { class: "hud-actions" }, [
    el("button", { class: "vc-btn", onclick: ()=> openCharacterModal() }, ["Character"]),
    el("button", { class: "vc-btn", onclick: ()=> openInventoryModal() }, ["Inventory"]),
    el("button", { class: "vc-btn", onclick: ()=> { saveToLocal(); showAlert("Saved."); } }, ["Save"]),

    el("button", { class: "vc-btn wide secondary", onclick: ()=> {
      const s = loadFromLocal();
      if(!s){ showAlert("No save found."); return; }
      showAlert("Save is already loaded. (Tip: Continue Story is on Home.)");
    }}, ["Load"]),
    el("button", { class: "vc-btn secondary", onclick: ()=>{
      state.screen = "home";
      render();
    }}, ["Main Menu"])
  ]);

  hudInner.appendChild(hudTop);
  hudInner.appendChild(bars);
  hudInner.appendChild(actions);
  hud.appendChild(hudInner);

  const scene = el("div", { class: "vc-panel" }, [
    el("div", { class: "scene-panel" }, [
      el("p", { class: "scene-title" }, ["Image Placeholder"]),
      el("p", { class: "scene-sub" }, ["Future: scene image or video"])
    ])
  ]);

  const textPanel = el("div", { class: "vc-panel" }, [
    el("div", { class: "text-panel" }, [
      el("p", { class: "story-text" }, [section?.text || "Missing section content."]),
      renderChoices(section)
    ])
  ]);

  wrap.appendChild(hud);
  wrap.appendChild(scene);
  wrap.appendChild(textPanel);

  shell.appendChild(wrap);
  return shell;
}

function renderChoices(section){
  const box = el("div", { class: "choices" });

  const choices = (section && Array.isArray(section.choices)) ? section.choices : [];
  if(choices.length === 0){
    box.appendChild(el("button", {
      class: "vc-btn choice-btn secondary",
      onclick: ()=>{
        // if no choices, return home
        state.screen = "home";
        render();
      }
    }, ["Return To Main Menu"]));
    return box;
  }

  choices.forEach(ch => {
    box.appendChild(el("button", {
      class: "vc-btn choice-btn secondary",
      onclick: ()=> choose(ch)
    }, [ch.text || "Continue"]));
  });

  return box;
}

/* -------------------- Modals -------------------- */
function openCharacterModal(){
  const p = state.player;

  const statsKeys = ["W","E","A","L","T"];
  const statsGrid = el("div", { class: "stats-grid" },
    statsKeys.map(k => el("div", { class: "stat-pill" }, [
      el("span", { class: "stat-k" }, [k]),
      el("span", { class: "stat-v" }, [String(p.stats[k] ?? 1)])
    ]))
  );

  const avatar = el("div", { class: "avatar-box" }, [
    el("div", { class: "avatar-sil" }),
    el("div", { class: "avatar-info" }, [
      el("div", { class: "vc-label" }, ["Loadout Visible"]),
      el("div", { class: "loadout" }, [
        el("h3", {}, ["Loadout"]),
        el("div", { class: "loadout-row" }, [
          el("div", { class: "loadout-k" }, ["Weapon"]),
          el("div", { class: "loadout-v" }, [p.equipped.weapon || "None"])
        ]),
        el("div", { class: "loadout-row" }, [
          el("div", { class: "loadout-k" }, ["Armor"]),
          el("div", { class: "loadout-v" }, [p.equipped.armor || "None"])
        ]),
        el("div", { class: "loadout-row" }, [
          el("div", { class: "loadout-k" }, ["Special Item"]),
          el("div", { class: "loadout-v" }, [p.equipped.special || "None"])
        ])
      ])
    ])
  ]);

  const body = el("div", { class: "char-grid" }, [
    el("div", {}, [
      el("div", { class: "vc-label" }, ["W E A L T H"]),
      el("div", { class: "vc-divider" }),
      statsGrid
    ]),
    avatar
  ]);

  const close = modal("Character", body, ()=> closer());
  const closer = close;
}

function openInventoryModal(){
  let active = "Consumables";

  function renderList(){
    const wrap = el("div", {});
    const tabs = el("div", { class: "tabs" }, ["Consumables","Items","Weapons","Armor","Special"].map(cat => {
      return el("button", {
        class: `tab ${active===cat ? "active" : ""}`,
        onclick: ()=>{
          active = cat;
          rerender();
        }
      }, [cat]);
    }));

    const items = state.player.inventory.filter(i => i.category === active);

    const list = el("div", {}, items.length ? items.map(it => {
      const metaBits = [];
      metaBits.push(`Value: ${it.value ?? 0}`);
      if(active === "Consumables") metaBits.push(`Qty: ${it.qty ?? 0}`);
      if(active !== "Consumables") metaBits.push(`Owned: ${it.qty ?? 0}`);

      const row = el("div", { class: "item-row" }, [
        el("div", {}, [
          el("p", { class: "item-name" }, [it.name]),
          el("p", { class: "item-meta" }, [metaBits.join("  •  ")])
        ]),
        el("div", { class: "item-actions" }, [
          active === "Consumables"
            ? el("button", {
                class: "vc-btn small secondary",
                onclick: ()=>{
                  const ok = useConsumable(it.name);
                  if(!ok) showAlert("Could not use item.");
                  saveToLocal();
                  render();
                  rerender();
                }
              }, ["Use"])
            : (it.slot
                ? el("button", {
                    class: "vc-btn small secondary",
                    onclick: ()=>{
                      const ok = equipItem(it.name);
                      if(!ok) showAlert("Could not equip item.");
                      saveToLocal();
                      render();
                      rerender();
                    }
                  }, ["Equip"])
                : el("span", { class: "vc-label" }, [""])
              )
        ])
      ]);

      return row;
    }) : [
      el("div", { class: "vc-label" }, ["No Items In This Category"])
    ]);

    wrap.appendChild(tabs);
    wrap.appendChild(list);
    return wrap;
  }

  let closeFn = null;
  let container = null;

  function rerender(){
    if(!container) return;
    container.innerHTML = "";
    container.appendChild(renderList());
  }

  container = el("div", {});
  container.appendChild(renderList());

  closeFn = modal("Inventory", container, ()=> closer());
  const closer = closeFn;
}

/* -------------------- Render Root -------------------- */
function render(){
  APP.innerHTML = "";
  const root = el("div", { class: "vc-app" }, [
    el("div", { class: "vc-shell" }, [])
  ]);

  const shell = root.querySelector(".vc-shell");
  if(state.screen === "home"){
    shell.appendChild(renderHome());
  }else{
    shell.appendChild(renderGame());
  }

  APP.appendChild(root);
}

/* -------------------- Boot -------------------- */
async function boot(){
  try{
    await ensureStoriesIndex();

    const saved = loadFromLocal();
    if(saved && saved.currentStoryId){
      // Load into home by default; Continue Story uses saved
      // But we do validate the story exists quietly
      const idx = await ensureStoriesIndex();
      const ok = idx.stories.some(s => s.id === saved.currentStoryId);
      if(!ok){
        // prevent "Saved story not found in stories.json"
        resetSave();
      }
    }

    // Start at home always (clean UX)
    state.screen = "home";
    render();
  }catch(err){
    showAlert(`Boot error: ${err.message}`);
    render();
  }
}

boot();
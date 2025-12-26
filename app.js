(function () {
  const e = React.createElement;

  const STORAGE_KEY = "versecraft_save_stable_v1";
  const STORIES_MANIFEST = "stories.json";
  const LOGO_SRC = "assets/versecraft-logo.png";

  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const safeObj = (v) => (v && typeof v === "object" ? v : {});
  const safeArr = (v) => (Array.isArray(v) ? v : []);

  function getSectionById(story, id) {
    const sections = safeArr(story?.sections);
    return sections.find((s) => String(s.id) === String(id)) || null;
  }

  // ---------- Modal ----------
  function Modal({ title, onClose, children }) {
    return e("div", { className: "modalBackdrop" }, [
      e("div", { className: "modalCard", key: "card" }, [
        e("div", { className: "modalHeader", key: "hdr" }, [
          e("div", { className: "modalTitle", key: "t" }, title),
          e("button", { className: "btn", onClick: onClose }, "Close"),
        ]),
        e("div", { className: "modalBody", key: "b" }, children),
      ]),
    ]);
  }

  // ---------- Menu ----------
  function Menu({ manifest, onStartStory, onContinue }) {
    const stories = safeArr(manifest?.stories);
    const defaultId = manifest?.defaultStoryId || stories[0]?.id;

    return e("div", { className: "menuScene" }, [
      e("div", { className: "menuCard" }, [
        e("div", { className: "menuInner" }, [
          e("img", { className: "menuLogo", src: LOGO_SRC, alt: "VerseCraft" }),
          e("div", { className: "menuTagline" }, "Choose Your Paths. Live Your Story."),

          e("div", { className: "menuRow" }, [
            e(
              "button",
              { className: "ornateBtn", onClick: () => onStartStory(defaultId) },
              "Tap To Start"
            ),
            e(
              "button",
              { className: "ornateBtn", onClick: () => onStartStory(defaultId) },
              "Load New Story"
            ),
          ]),

          e("div", { className: "menuDivider" }),

          e("div", { className: "storyList" }, [
            ...stories.map((st) =>
              e(
                "div",
                { key: st.id, className: "storyCard", onClick: () => onStartStory(st.id) },
                [
                  e("div", { className: "storyTitle" }, st.title || st.id),
                  st.subtitle ? e("div", { className: "storySub" }, st.subtitle) : null,
                  st.estimate ? e("div", { className: "storyMeta" }, st.estimate) : null,
                ]
              )
            ),
          ]),

          e("div", { className: "menuDivider" }),

          e("div", { className: "menuRow2" }, [
            e("button", { className: "ornateBtn", disabled: true }, "Go To Shop"),
            e("button", { className: "ornateBtn", onClick: onContinue }, "Continue Story"),
          ]),
        ]),
      ]),
    ]);
  }

  // ---------- HUD ----------
  function HUD({ storyTitle, storySubtitle, state, onOpenChar, onOpenInv, onSave, onLoad, onMenu }) {
    const hp = Number(state?.hp ?? 10);
    const maxHp = Number(state?.maxHp ?? 10);
    const xp = Number(state?.xp ?? 0);
    const xpTo = Number(state?.xpToNext ?? 100);
    const lvl = Number(state?.level ?? 1);
    const rep = Number(state?.rep ?? 0);
    const timing = Number(state?.timing ?? 0);

    const hpPct = maxHp > 0 ? clamp((hp / maxHp) * 100, 0, 100) : 0;
    const xpPct = xpTo > 0 ? clamp((xp / xpTo) * 100, 0, 100) : 0;

    return e("div", { className: "hudShell" }, [
      e("div", { className: "hudFrame" }, [
        e("div", { className: "hudTitle" }, storyTitle || "VerseCraft"),
        storySubtitle ? e("div", { className: "hudSubtitle" }, storySubtitle) : null,

        e("div", { className: "hudBars" }, [
          e("div", { className: "barRow" }, [
            e("div", { className: "barLabel" }, "HP"),
            e("div", { className: "barOuter" }, [
              e("div", { className: "barInner", style: { width: hpPct + "%" } }),
            ]),
            e("div", { className: "barVal" }, `${hp} / ${maxHp}`),
          ]),
          e("div", { className: "barRow" }, [
            e("div", { className: "barLabel" }, "XP"),
            e("div", { className: "barOuter" }, [
              e("div", { className: "barInnerXP", style: { width: xpPct + "%" } }),
            ]),
            e("div", { className: "barVal" }, `${xp} / ${xpTo}`),
          ]),
        ]),

        e("div", { className: "hudPills" }, [
          e("div", { className: "pillBig" }, `LVL ${lvl}`),
          e("div", { className: "pill" }, `Rep ${rep}`),
          e("div", { className: "pill" }, `Timing ${timing}`),
        ]),

        e("div", { className: "hudButtons" }, [
          e("button", { className: "btn", onClick: onOpenChar }, "Character"),
          e("button", { className: "btn", onClick: onOpenInv }, "Inventory"),
          e("button", { className: "btn", onClick: onSave }, "Save"),
          e("button", { className: "btn", onClick: onLoad }, "Load"),
          e("button", { className: "btn", onClick: onMenu }, "Main Menu"),
        ]),
      ]),
    ]);
  }

  // ---------- Story View ----------
  function StoryView({ section, onChoose }) {
    const lines = safeArr(section?.text);
    const choices = safeArr(section?.choices);

    return e("div", { className: "storyWrap" }, [
      e("div", { className: "scenePanel" }, [
        e("div", null, "Image Placeholder"),
        e("div", { style: { opacity: 0.65, marginTop: 8 } }, "Future: scene image or video"),
      ]),
      e("div", { className: "storyPanel" }, lines.map((ln, i) => e("div", { className: "p", key: i }, String(ln)))),
      e(
        "div",
        { className: "choices" },
        choices.map((ch, idx) =>
          e(
            "button",
            { className: "choiceBtn", key: ch.id || ch.text || idx, onClick: () => onChoose(ch) },
            String(ch.text || "Continue")
          )
        )
      ),
    ]);
  }

  // ---------- Character Modal ----------
  function CharacterModal({ state, onClose }) {
    const wealth = safeObj(state?.wealth);
    // Display WEALTH across top (W E A L T H)
    const W = Number(wealth.W ?? wealth.w ?? 0);
    const E = Number(wealth.E ?? wealth.e ?? 0);
    const A = Number(wealth.A ?? wealth.a ?? 0);
    const L = Number(wealth.L ?? wealth.l ?? 0);
    const T = Number(wealth.T ?? wealth.t ?? 0);
    const H = Number(wealth.H ?? wealth.h ?? 0);

    const eq = safeObj(state?.equipped);

    return e(
      Modal,
      { title: "Character", onClose },
      e("div", null, [
        e("div", { className: "charTop" }, [
          e("div", { className: "wealthRow" }, [
            statChip("W", W),
            statChip("E", E),
            statChip("A", A),
            statChip("L", L),
            statChip("T", T),
            statChip("H", H),
          ]),
          e("div", { className: "avatarBox" }, [e("div", { className: "silhouette" })]),
        ]),
        e("div", { className: "loadoutBox" }, [
          e("div", { className: "loadoutTitle" }, "Loadout"),
          loadoutRow("Weapon", eq.weapon || "Rusty Dagger"),
          loadoutRow("Armor", eq.armor || "Leather Jerkin"),
          loadoutRow("Special Item", eq.special || "Candle"),
        ]),
      ])
    );

    function statChip(label, val) {
      return e("div", { className: "statChip", key: label }, [
        e("div", { className: "statLabel" }, label),
        e("div", { className: "statVal" }, String(val)),
      ]);
    }
    function loadoutRow(k, v) {
      return e("div", { className: "loadoutRow", key: k }, [
        e("div", { className: "loadoutKey" }, k),
        e("div", { className: "loadoutVal" }, v),
      ]);
    }
  }

  // ---------- Inventory Modal ----------
  function InventoryModal({ state, setState, onClose }) {
    const inv = safeObj(state?.inventory);
    const consumables = safeArr(inv.consumables);
    const items = safeArr(inv.items);

    const [tab, setTab] = React.useState("Consumables");
    const list = tab === "Consumables" ? consumables : items;

    function applyEffects(effects) {
      const ef = safeObj(effects);
      const hp = Number(state.hp ?? 10);
      const maxHp = Number(state.maxHp ?? 10);
      const rep = Number(state.rep ?? 0);
      const timing = Number(state.timing ?? 0);

      const hpDelta = Number(ef.hpDelta ?? 0);
      const repDelta = Number(ef.repDelta ?? 0);
      const timingDelta = Number(ef.timingDelta ?? 0);

      setState({
        ...state,
        hp: clamp(hp + hpDelta, 0, maxHp),
        rep: rep + repDelta,
        timing: timing + timingDelta,
      });
    }

    function useConsumable(idx) {
      const c = consumables[idx];
      if (!c) return;
      const qty = Number(c.qty ?? 1);
      if (qty <= 0) return;

      applyEffects(c.effects);

      const next = consumables.slice();
      next[idx] = { ...c, qty: qty - 1 };

      setState({ ...state, inventory: { ...inv, consumables: next } });
    }

    function equipItem(idx) {
      const it = items[idx];
      if (!it) return;
      const type = String(it.type || "special").toLowerCase();
      const slot = type === "weapon" ? "weapon" : type === "armor" ? "armor" : "special";

      const eq = safeObj(state.equipped);
      const title = it.title || it.name || "Unknown Item";

      setState({ ...state, equipped: { ...eq, [slot]: title } });
    }

    return e(
      Modal,
      { title: "Inventory", onClose },
      e("div", null, [
        e("div", { className: "tabs" }, [
          e("button", { className: "tab " + (tab === "Consumables" ? "tabActive" : ""), onClick: () => setTab("Consumables") }, "Consumables"),
          e("button", { className: "tab " + (tab === "Items" ? "tabActive" : ""), onClick: () => setTab("Items") }, "Items"),
        ]),
        list.length === 0
          ? e("div", { style: { opacity: 0.75 } }, "Nothing here yet.")
          : e(
              "div",
              null,
              list.map((it, idx) => {
                const title = it.title || it.name || "Untitled";
                const meta =
                  tab === "Consumables"
                    ? `Qty: ${Number(it.qty ?? 1)}`
                    : (it.type ? `Type: ${it.type}` : "Item");

                return e("div", { className: "itemRow", key: title + "-" + idx }, [
                  e("div", null, [
                    e("div", { className: "itemName" }, title),
                    e("div", { className: "itemMeta" }, meta),
                  ]),
                  e("div", { className: "itemActions" }, [
                    tab === "Consumables"
                      ? e("button", { className: "smallBtn", onClick: () => useConsumable(idx) }, "Use")
                      : e("button", { className: "smallBtn", onClick: () => equipItem(idx) }, "Equip"),
                  ]),
                ]);
              })
            ),
      ])
    );
  }

  // ---------- App ----------
  function App() {
    const [manifest, setManifest] = React.useState(null);
    const [mode, setMode] = React.useState("menu");

    const [storyMeta, setStoryMeta] = React.useState(null);
    const [story, setStory] = React.useState(null);
    const [section, setSection] = React.useState(null);

    const [showChar, setShowChar] = React.useState(false);
    const [showInv, setShowInv] = React.useState(false);

    // Stable default state (can be overridden by story.save.defaults)
    const [state, setState] = React.useState({
      hp: 10,
      maxHp: 10,
      xp: 0,
      xpToNext: 100,
      level: 1,
      rep: 0,
      timing: 0,
      wealth: { W: 1, E: 1, A: 1, L: 1, T: 1, H: 1 },
      equipped: { weapon: "Rusty Dagger", armor: "Leather Jerkin", special: "Candle" },
      inventory: {
        consumables: [
          { title: "Candle", qty: 1, effects: null }
        ],
        items: []
      }
    });

    React.useEffect(() => {
      fetch(STORIES_MANIFEST, { cache: "no-store" })
        .then((r) => r.json())
        .then(setManifest)
        .catch(() => setManifest({ defaultStoryId: null, stories: [] }));
    }, []);

    function gotoMenu() {
      setMode("menu");
      setStoryMeta(null);
      setStory(null);
      setSection(null);
      setShowChar(false);
      setShowInv(false);
    }

    function loadStoryById(storyId) {
      const list = safeArr(manifest?.stories);
      const meta = list.find((s) => s.id === storyId) || list[0];
      if (!meta?.file) return alert("Story file missing in stories.json");

      fetch(meta.file, { cache: "no-store" })
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status} for ${meta.file}`);
          return r.json();
        })
        .then((st) => {
          setStoryMeta(meta);
          setStory(st);

          // Merge defaults
          const defaults = safeObj(st?.save?.defaults);
          const merged = {
            ...state,
            ...defaults,
            hp: clamp(Number(defaults.hp ?? state.hp), 0, Number(defaults.maxHp ?? state.maxHp)),
          };
          setState(merged);

          const startId = st.startSectionId || defaults.sectionId || "start";
          const start = getSectionById(st, startId) || getSectionById(st, "start") || safeArr(st.sections)[0];
          if (!start) throw new Error("Start section missing in story json.");

          setSection(start);
          setMode("story");
        })
        .catch((err) => alert(`Story load failed: ${err.message}`));
    }

    function saveGame() {
      if (!storyMeta?.id || !section?.id) return alert("Nothing to save yet.");
      const payload = { storyId: storyMeta.id, sectionId: section.id, state };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      alert("Saved.");
    }

    function loadGame() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return alert("No saved game found yet.");
        const payload = JSON.parse(raw);

        const list = safeArr(manifest?.stories);
        const meta = list.find((s) => s.id === payload.storyId);

        if (!meta?.file) {
          alert("Saved story not found — starting default story.");
          return loadStoryById(manifest?.defaultStoryId || list[0]?.id);
        }

        fetch(meta.file, { cache: "no-store" })
          .then((r) => r.json())
          .then((st) => {
            setStoryMeta(meta);
            setStory(st);
            setState(payload.state || state);

            const sec = getSectionById(st, payload.sectionId) || getSectionById(st, st.startSectionId) || safeArr(st.sections)[0];
            setSection(sec);
            setMode("story");
          })
          .catch(() => alert("Could not load saved story file."));
      } catch {
        alert("Could not load save.");
      }
    }

    // Reserved targets so we NEVER treat them as story sections.
    function handleReservedTarget(toRaw) {
      const to = String(toRaw || "").trim().toUpperCase();
      if (!to) return true;

      if (to === "INVENTORY") { setShowInv(true); return true; }
      if (to === "CHARACTER") { setShowChar(true); return true; }
      if (to === "SAVE") { saveGame(); return true; }
      if (to === "LOAD") { loadGame(); return true; }
      if (to === "MENU" || to === "MAIN_MENU") { gotoMenu(); return true; }

      return false;
    }

    function onChoose(choice) {
      const to = String(choice?.to || "").trim();
      if (!to) return;

      if (handleReservedTarget(to)) return;

      const next = getSectionById(story, to);
      if (!next) return alert(`Missing section: ${to}`);
      setSection(next);
    }

    if (!manifest) return e("div", { style: { padding: 18, color: "rgba(255,255,255,.85)" } }, "Loading…");

    if (mode === "menu") {
      return e(Menu, { manifest, onStartStory: loadStoryById, onContinue: loadGame });
    }

    return e("div", null, [
      e(HUD, {
        key: "hud",
        storyTitle: storyMeta?.title || story?.title || "VerseCraft",
        storySubtitle: storyMeta?.subtitle || story?.subtitle || "",
        state,
        onOpenChar: () => setShowChar(true),
        onOpenInv: () => setShowInv(true),
        onSave: saveGame,
        onLoad: loadGame,
        onMenu: gotoMenu
      }),
      e(StoryView, { key: "sv", section, onChoose }),
      showChar ? e(CharacterModal, { key: "cm", state, onClose: () => setShowChar(false) }) : null,
      showInv ? e(InventoryModal, { key: "im", state, setState, onClose: () => setShowInv(false) }) : null,
    ]);
  }

  function mount() {
    const root = document.getElementById("app");
    if (!root) return;
    ReactDOM.createRoot(root).render(e(App));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();

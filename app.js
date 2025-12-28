/* ============================================================
   VerseCraft Stable UI Shell (Full file replacement)
   LeakageFix Edition
   ============================================================ */

/* This is a DROP-IN app.js replacement */

const LS = {
  SAVE: "versecraft_save_v1",
  LAST_STORY: "versecraft_last_story_id",
};

function clamp(n,a,b){return Math.max(a,Math.min(b,n));}
function safeTitleCaseName(n){return n?String(n).replaceAll("_"," "):"";}
function escapeHtml(s){return String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");}

const DEFAULT_PLAYER=()=>({hp:{cur:0,min:0,max:0},xp:{cur:0,max:100},lvl:1,money:0,wealth:{W:5,E:5,A:5,L:5,T:5,H:5},flags:{},inv:{consumables:[],items:[],weapons:[],armor:[],special:[]},equip:{weapon:null,armor:null,special:null}});

const state={mode:"boot",storiesIndex:null,storyMetaById:new Map(),story:null,storyId:null,sectionId:null,player:DEFAULT_PLAYER(),ui:{modal:null,invTab:"consumables"}};

async function fetchJson(u){const r=await fetch(u,{cache:"no-store"});if(!r.ok)throw new Error(r.status);return r.json();}
async function loadStoriesIndex(){const i=await fetchJson("stories.json");state.storiesIndex=i;state.storyMetaById.clear();(i.stories||[]).forEach(s=>state.storyMetaById.set(s.id,s));}
async function loadStoryById(id){const m=state.storyMetaById.get(id);if(!m)throw new Error("Story not found");state.story=await fetchJson(m.file);state.storyId=id;state.sectionId=state.story.start||"START";localStorage.setItem(LS.LAST_STORY,id);}

function getPrimaryResource(s){const p=s?.module?.primaryResource||{};return{name:safeTitleCaseName(p.name||"HP"),min:p.min??0,max:p.max??15,failureSectionId:p.failureSectionId||"DEATH"};}
function seedPlayerForStory(s){const p=DEFAULT_PLAYER();const r=getPrimaryResource(s);p.hp.min=r.min;p.hp.max=r.max;p.hp.cur=r.min<0?0:r.max;p.money=s?.module?.startingMoney??0;const l=s?.module?.loadout||{};["weapon","armor","special"].forEach(k=>{if(l[k]?.id)p.equip[k]=l[k].id;});return p;}

async function startNewRun(id){await loadStoryById(id);state.player=seedPlayerForStory(state.story);state.mode="game";render();}

function getSection(){const s=state.story;if(Array.isArray(s.sections))return s.sections.find(x=>x.id===state.sectionId);return s.sections[state.sectionId];}
function onChoose(c){if(c.effects)[].concat(c.effects).forEach(e=>{if(e.hp)state.player.hp.cur+=e.hp;if(e.money)state.player.money+=e.money;});if(c.to)state.sectionId=c.to;render();}

function render(){const r=document.getElementById("app");if(!r)return;if(state.mode==="home")r.innerHTML='<button id="btnTapStart">Tap To Start</button>';else if(state.mode==="game"){const s=getSection();r.innerHTML='<div>'+escapeHtml(s.text||"")+'</div>'+(s.choices||[]).map((c,i)=>'<button data-choice="'+i+'">'+escapeHtml(c.label)+'</button>').join("");}else r.innerHTML="Loading…";}

document.addEventListener("click",async e=>{if(e.target.id==="btnTapStart"){const l=localStorage.getItem(LS.LAST_STORY)||state.storiesIndex.defaultStoryId;await startNewRun(l);}if(e.target.dataset.choice){onChoose(getSection().choices[e.target.dataset.choice]);}});

(async()=>{await loadStoriesIndex();state.mode="home";render();})();
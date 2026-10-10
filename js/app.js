/* ═══════════════════════════════════════════════
   HWARO 위기상담 앱 — 화면 로직
   (저장: 기기 내 localStorage, 서버 불필요)
═══════════════════════════════════════════════ */

const LEGACY_KEY = "hwaro_v1";          // 1차 버전 저장소 (샘플 계정으로 이전)
const USERS_KEY = "hwaro_users";         // 내담자 명부 (관리자 페이지용)
const CUR_KEY = "hwaro_current";         // 현재 로그인한 내담자 id
const ADMIN_PIN = "0000";                // 관리자 페이지 비밀번호
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/* ───────── 유틸 ───────── */
const $ = (s, el = document) => el.querySelector(s);
const pad = n => String(n).padStart(2, "0");
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayStr = () => ymd(new Date());
const dots = s => s.replace(/-/g, ".");                     // 2026-09-21 → 2026.09.21
const parse = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Math.random().toString(36).slice(2, 9);
const counselor = id => COUNSELORS.find(c => c.id === id) || COUNSELORS[0];
const nowTime = () => { const d = new Date(); return `${d.getHours() < 12 ? "오전" : "오후"} ${d.getHours() % 12 || 12}:${pad(d.getMinutes())}`; };

/* ───────── 상태 (회원별 분리 저장) ─────────
   U  : 내담자 명부 { seq, list: [{id, no, name, unit, birth, createdAt}] }
   S  : 현재 로그인한 내담자의 데이터 (자가진단·예약·일지·채팅·근무표)
   저장 위치는 이 기기의 localStorage. 관리자 페이지도 같은 기기의 명부를 읽는다. */
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { } };
let U = (() => { try { const r = lsGet(USERS_KEY); if (r) return JSON.parse(r); } catch (e) { } return { seq: 0, list: [] }; })();
let curId = lsGet(CUR_KEY) || null;
let S = null;
function saveUsers() { lsSet(USERS_KEY, JSON.stringify(U)); }
const dataKey = id => "hwaro_data_" + id;
function loadData(id) { try { const r = lsGet(dataKey(id)); if (r) return JSON.parse(r); } catch (e) { } return null; }
function saveData(id, data) { lsSet(dataKey(id), JSON.stringify(data)); }
let P = null;                                  // 클라우드 모드: 현재 내담자 프로필 {uid,no,name,unit,birth,createdAt}
function save() { if (!curId || !S) return; saveData(curId, S); if (Cloud.on) Cloud.saveData(curId, S); }
function userById(id) { if (Cloud.on) return P && P.uid === id ? { ...P, id } : null; return U.list.find(u => u.id === id); }
function newUserNo() { U.seq = (U.seq || 0) + 1; return "HW-" + String(U.seq).padStart(4, "0"); }
function blankData(name) {
  return { user: { name }, diag: [], lastDiag: null, appts: [], results: [], daily: [], counsel: [], chat: [], lastCid: null, schedule: {}, meals: {}, consentAt: null };
}
function registerUser(name, unit, birth, data) {
  const id = uid() + Date.now().toString(36);
  const u = { id, no: newUserNo(), name, unit, birth, createdAt: todayStr() };
  U.list.push(u); saveUsers(); saveData(id, data || blankData(name)); return u;
}
function loginAs(id) { curId = id; lsSet(CUR_KEY, id); S = loadData(id) || blankData(userById(id)?.name || ""); if (!S.schedule) S.schedule = {}; if (!S.meals) S.meals = {}; }
function logout() { curId = null; S = null; P = null; try { localStorage.removeItem(CUR_KEY); } catch (e) { } if (Cloud.on) Cloud.logout().catch(() => { }); }
// 클라우드 모드: 로그인된 내담자의 프로필·데이터를 불러와 세션 시작
async function enterCloudUser(uid) {
  const doc = await Cloud.loadUser(uid);
  if (!doc) throw new Error("profile-missing");
  P = { uid, no: doc.no, name: doc.name, unit: doc.unit, birth: doc.birth, createdAt: doc.createdAt };
  curId = uid; lsSet(CUR_KEY, uid);
  const local = loadData(uid);
  S = Object.assign(blankData(doc.name), local || {}, doc.data || {});     // 서버 데이터 우선, 로컬 캐시 보조
  if (!S.schedule) S.schedule = {}; if (!S.meals) S.meals = {}; S.user = S.user || { name: doc.name };
  saveData(uid, S);
  // 관리자가 바꾼 콘텐츠(영상·병원·전화·상담사·공지): 캐시 먼저 적용, 서버값 오면 갱신
  try { const cc = lsGet("hwaro_content"); if (cc) Cloud.applyContent(JSON.parse(cc)); } catch (e) { }
  Cloud.subscribeContent(c => { if (!c) return; const { updatedAt, ...rest } = c; lsSet("hwaro_content", JSON.stringify(rest)); Cloud.applyContent(rest); if (current) render(); });   // 관리자가 저장하면 즉시 반영
  Cloud.subscribeResults(uid, list => { S.results = list; saveData(uid, S); if (current && ["home", "results", "care", "connect"].includes(current.name)) render(); });
  // 상담사의 예약 승인·변경·취소 반영
  Cloud.db.collection("users").doc(uid).collection("approvals").onSnapshot(q => {
    let changed = false;
    q.docs.forEach(doc => { const ap = doc.data(), a = S.appts.find(x => x.id === doc.id); if (!a) return;
      if (ap.status === "cancelled" && a.status !== "cancelled") { a.status = "cancelled"; changed = true; }
      if (ap.date && (a.date !== ap.date || (ap.time && a.time !== ap.time))) { a.date = ap.date; if (ap.time) a.time = ap.time; a.changedBy = "counselor"; changed = true; }
      if (ap.status === "confirmed" && !a.confirmed) { a.confirmed = true; changed = true; } });
    if (changed) { save(); if (current && ["home", "care", "bookingList", "connect"].includes(current.name)) render(); toast("상담사가 예약을 확인·변경했습니다"); }
  }, e => console.warn(e));
}
const cloudBusy = msg => { const r = $("#modal-root"); r.innerHTML = `<div class="modal-bg"><div class="modal"><h3>${esc(msg)}</h3><div class="typing" style="justify-content:center;display:flex"><i></i><i></i><i></i></div></div></div>`; };
// 1차 버전 데이터가 있으면 '홍길동 (샘플)' 계정으로 이전, 없으면 샘플 계정 생성 (로컬 모드 전용)
(function migrate() {
  if (Cloud.init()) return;
  if (U.list.length) return;
  let legacy = null; try { const r = lsGet(LEGACY_KEY); if (r) legacy = JSON.parse(r); } catch (e) { }
  const data = legacy || seed(); data.schedule = data.schedule || sampleSchedule(); data.meals = data.meals || sampleMeals();
  registerUser(data.user?.name || "홍길동", "○○소방서 (샘플)", "1990-01-01", data);
})();
function sampleSchedule() { const t = todayStr(), m = {}, seq = ["D", "N", "O"]; for (let i = -10; i <= 20; i++) m[addDays(t, i)] = seq[((i % 3) + 3) % 3]; return m; }
function sampleMeals() { const w = weekKey(todayStr()); return { [w]: { "월": ["누룽지, 계란후라이", "제육볶음, 된장국", "닭갈비, 콩나물국"], "화": ["토스트, 우유", "김치찌개, 고등어구이", "불고기, 미역국"], "수": ["죽, 김", "순두부찌개, 오징어볶음", "카레라이스"], "목": ["시리얼, 바나나", "갈비탕", "돈까스, 우동"], "금": ["샌드위치", "비빔밥", "삼겹살, 상추"], "토": ["계란국, 김", "짜장밥", "치킨, 샐러드"], "일": ["빵, 잼", "라면, 김밥", "삼계탕"] } }; }
function weekKey(ds) { const d = parse(ds), dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return ymd(d); }   // 그 주 월요일
function seed() {
  const t = todayStr();
  return {
    user: { name: "홍길동" },
    diag: [                                                  // 주간 자가진단 기록 (샘플 3건)
      { date: addDays(t, -21), score: 38, answers: [] },
      { date: addDays(t, -14), score: 31, answers: [] },
      { date: addDays(t, -7), score: 26, answers: [] }
    ],
    lastDiag: addDays(t, -8),                                // 8일 전 → 첫 실행 시 자가진단 표시
    appts: [
      { id: uid(), cid: "kang", date: addDays(t, -16), time: "2:00", type: "대면", status: "done" },
      { id: uid(), cid: "kang", date: addDays(t, -2), time: "3:00", type: "대면", status: "done" },
      { id: uid(), cid: "kang", date: addDays(t, 5), time: "2:00", type: "화상", status: "booked" }
    ],
    results: [
      { no: 1, cid: "kang", date: addDays(t, -16), type: "대면",
        text: "첫 회기에서는 최근 출동 이후 반복되는 침습 기억과 수면 어려움을 함께 살펴보았습니다.\n이야기하는 동안 호흡이 빨라지는 순간을 스스로 알아차리신 점이 매우 의미 있었습니다.\n\n다음 회기까지: 취침 전 '앉아서 하는 안정화' 음성 듣기, 하루일지에 수면 시간 기록하기." },
      { no: 2, cid: "kang", date: addDays(t, -2), type: "대면",
        text: "2회기에서는 그라운딩 기법을 실제 상황에 적용해 본 경험을 나누었습니다.\n출동 후 긴장이 가라앉는 데 걸리는 시간이 이전보다 짧아졌다고 보고하셨습니다.\n\n다음 회기(화상)에서는 특정 장면에 대한 회피 패턴을 다루어 보겠습니다. 하루일지를 꾸준히 작성해 주세요." }
    ],
    daily: [
      { date: addDays(t, -6), score: 40, text: "야간 출동 후 잠을 거의 못 잤다. 머리가 무겁다." },
      { date: addDays(t, -5), score: 48, text: "동료와 점심. 조금 웃었다." },
      { date: addDays(t, -4), score: 55, text: "안정화 음성 듣고 잠들었다. 새벽에 한 번 깼다." },
      { date: addDays(t, -2), score: 62, text: "상담 다녀옴. 말하고 나니 좀 가벼워졌다." },
      { date: addDays(t, -1), score: 67, text: "비번. 오랜만에 산책했다." }
    ],
    counsel: [
      { date: addDays(t, -2), cid: "kang", stars: 4, text: "그라운딩이 실제로 도움이 됐다는 걸 말할 수 있어서 좋았다. 다음엔 회피에 대해 이야기하기로." }
    ],
    chat: [],
    lastCid: "kang"
  };
}

/* ───────── 라우터 ───────── */
const TABS = [
  { id: "care", label: "상담", icon: "chat" },
  { id: "home", label: "홈", icon: "home" },
  { id: "schedule", label: "근무표", icon: "cal" },
  { id: "info", label: "정보", icon: "info" }
];
const ICONS = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
  cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H9l-5 4z"/></svg>',
  note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 3h9l4 4v14H6z"/><path d="M9 12h6M9 16h6"/></svg>',
  video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3z"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M15 5l-7 7 7 7"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 11l18-8-8 18-2-8z"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="#1a3d7a"><path d="M8 5v14l11-7z"/></svg>'
};

let stack = [];           // [{name, params}]
let current = null;
function go(name, params = {}, replace = false) {
  if (current && !replace) stack.push(current);
  if (replace) stack = [];
  current = { name, params };
  render();
}
function back() { current = stack.pop() || { name: "home", params: {} }; render(); }
function home() { stack = []; current = { name: "home", params: {} }; render(); }

function render() {
  window.scrollTo(0, 0);
  const screen = $("#screen");
  const view = VIEWS[current.name];
  const out = view(current.params) || {};
  screen.innerHTML = out.html;
  screen.classList.toggle("no-tab", !!out.noTab);
  renderTabs(out.tab, out.noTab);
  if (out.after) out.after();
}
function renderTabs(active, hide) {
  const bar = $("#tabbar");
  if (hide) { bar.innerHTML = ""; return; }
  bar.innerHTML = TABS.map(t => `<button class="${active === t.id ? "on" : ""}" onclick="${t.id === "home" ? "home()" : `go('${t.id}', {}, true)`}">${ICONS[t.icon]}<span>${t.label}</span></button>`).join("");
}
function hdr(title, opt = {}) {
  const right = opt.right === "search"
    ? `<button class="ic" onclick="go('search')" aria-label="검색">${ICONS.search}</button>`
    : opt.right === "none" ? "<span></span>"
    : `<button class="ic" onclick="${opt.close || "back()"}" aria-label="닫기">${ICONS.x}</button>`;
  return `<header class="hdr ${opt.dark ? "hdr-dark" : ""}">
    <img class="logo" src="assets/logo.png" alt="HWARO" onclick="home()">
    <div class="ttl">${title || ""}</div>${right}</header>`;
}

/* ───────── 모달 / 토스트 ───────── */
function modal(title, text, buttons = [{ label: "확인" }]) {
  const root = $("#modal-root");
  root.innerHTML = `<div class="modal-bg" onclick="if(event.target===this)closeModal()"><div class="modal">
    <h3>${esc(title)}</h3><p>${esc(text)}</p>
    <div class="${buttons.length > 1 ? "row2" : ""}">${buttons.map((b, i) => `<button class="btn ${b.soft ? "soft" : ""}" data-i="${i}">${esc(b.label)}</button>`).join("")}</div>
  </div></div>`;
  root.querySelectorAll("[data-i]").forEach(b => b.onclick = () => { closeModal(); const f = buttons[+b.dataset.i].onClick; if (f) f(); });
}
function closeModal() { $("#modal-root").innerHTML = ""; }
let toastT;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 1800); }

/* ───────── 차트 (SVG) ───────── */
function barChart(items, max, opt = {}) {
  // items: [{label, value}]
  const W = 420, H = 230, L = 36, B = 30, T = 14;
  const cw = (W - L - 8) / Math.max(items.length, 1);
  const grid = [0, .25, .5, .75, 1].map(f => { const y = T + (H - B - T) * (1 - f); return `<line x1="${L}" x2="${W - 4}" y1="${y}" y2="${y}" stroke="#eadbd4"/><text x="${L - 8}" y="${y + 4}" text-anchor="end" font-size="12" fill="#9a8a84">${Math.round(max * f)}</text>`; }).join("");
  const bars = items.map((it, i) => {
    const h = Math.max(0, (H - B - T) * Math.min(it.value, max) / max);
    const x = L + i * cw + cw * .14, y = T + (H - B - T) - h;
    return `<rect x="${x}" y="${y}" width="${cw * .72}" height="${h}" rx="10" fill="${it.color || "#c98a72"}"/>
      <text x="${x + cw * .36}" y="${y - 5}" text-anchor="middle" font-size="12" fill="#b5674a">${it.value}</text>
      <text x="${x + cw * .36}" y="${H - 8}" text-anchor="middle" font-size="12" fill="#9a8a84">${esc(it.label)}</text>`;
  }).join("");
  return `<svg class="chart" viewBox="0 0 ${W} ${H}">${grid}${bars}${items.length ? "" : `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" fill="#b5674a" font-size="14">기록이 없습니다</text>`}</svg>`;
}
function lineChart(items, max) {
  const W = 420, H = 210, L = 36, B = 30, T = 14, R = 14;
  const grid = [0, .25, .5, .75, 1].map(f => { const y = T + (H - B - T) * (1 - f); return `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="#eadbd4"/><text x="${L - 8}" y="${y + 4}" text-anchor="end" font-size="12" fill="#9a8a84">${Math.round(max * f)}</text>`; }).join("");
  const n = items.length, step = n > 1 ? (W - L - R) / (n - 1) : 0;
  const pts = items.map((it, i) => [n > 1 ? L + i * step : (L + W - R) / 2, it.value == null ? null : T + (H - B - T) * (1 - it.value / max)]);
  let path = "", prev = null;
  pts.forEach(p => { if (p[1] == null) { prev = null; return; } if (!prev) path += `M${p[0]},${p[1]}`; else { const cx = (prev[0] + p[0]) / 2; path += ` C${cx},${prev[1]} ${cx},${p[1]} ${p[0]},${p[1]}`; } prev = p; });
  const dotsSvg = pts.map((p, i) => p[1] == null ? "" : `<circle cx="${p[0]}" cy="${p[1]}" r="5" fill="#b5674a"/><text x="${p[0]}" y="${p[1] - 10}" text-anchor="middle" font-size="11" fill="#b5674a">${items[i].value}</text>`).join("");
  const labels = pts.map((p, i) => `<text x="${p[0]}" y="${H - 8}" text-anchor="middle" font-size="12" fill="#9a8a84">${esc(items[i].label)}</text>`).join("");
  return `<svg class="chart" viewBox="0 0 ${W} ${H}">${grid}<path d="${path}" fill="none" stroke="#c98a72" stroke-width="3"/>${dotsSvg}${labels}</svg>`;
}
function donut(pct) {
  const r = 86, c = 2 * Math.PI * r;
  return `<div class="donut"><svg viewBox="0 0 220 220">
    <circle cx="110" cy="110" r="${r}" stroke="#c9d1da" stroke-width="30" fill="none"/>
    <circle id="donut-arc" cx="110" cy="110" r="${r}" stroke="#c98a72" stroke-width="30" fill="none" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct / 100)}" style="transition:stroke-dashoffset .2s"/>
  </svg><div class="val" id="donut-val">${pct}%</div></div>`;
}

/* ───────── 도우미 (데이터) ───────── */
const upcoming = () => S.appts.filter(a => a.status === "booked" && a.date >= todayStr()).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
const pastAppts = () => S.appts.filter(a => a.status === "done" || (a.status === "booked" && a.date < todayStr())).sort((a, b) => b.date.localeCompare(a.date));
const latestDiag = () => S.diag.length ? S.diag[S.diag.length - 1] : null;
function weekLabel(dateStr) { const d = parse(dateStr); return `${d.getMonth() + 1}/${d.getDate()}`; }
function dailyMsg(p) {
  if (p >= 80) return "오늘 정말 좋았네요!";
  if (p >= 60) return "잘 하고 있어요!";
  if (p >= 40) return "그럭저럭 버틴 하루도 소중해요.";
  if (p >= 20) return "힘든 하루였군요. 수고했어요.";
  return "많이 힘드셨죠. 오늘은 쉬어도 괜찮아요.";
}
function diagDue() { return !S.lastDiag || (Date.now() - parse(S.lastDiag).getTime()) >= WEEK_MS; }
const todayShift = () => S.schedule?.[todayStr()] || null;

/* ═══════════════ 화면들 ═══════════════ */
const VIEWS = {};

/* ── 로그인 / 내담자 등록 ── */
let lg = { mode: "login", name: "", unit: "", birth: "", pw: "", gender: "" };
VIEWS.login = () => ({ noTab: true, html: `
  <div class="body" style="min-height:100vh;justify-content:center;gap:18px">
    <img src="assets/logo.png" alt="HWARO" style="width:170px;margin:0 auto">
    <div class="center" style="color:var(--brand);font-size:15px;margin-top:-10px">소방공무원 마음건강 위기상담</div>
    <div class="card" style="display:flex;flex-direction:column;gap:10px">
      <div class="pill-row" style="margin-bottom:4px">
        <button class="pill ${lg.mode === "login" ? "" : "off"}" style="min-height:44px;font-size:15px" onclick="lg.mode='login';render()">로그인</button>
        <button class="pill ${lg.mode === "join" ? "" : "off"}" style="min-height:44px;font-size:15px" onclick="lg.mode='join';render()">처음 이용</button>
      </div>
      <label class="muted">이름</label>
      <input id="lg-name" class="inp" value="${esc(lg.name)}" placeholder="홍길동" oninput="lg.name=this.value">
      ${lg.mode === "join" ? `<label class="muted">소속 (소방서 · 센터)</label><input id="lg-unit" class="inp" value="${esc(lg.unit)}" placeholder="○○소방서 ○○119안전센터" oninput="lg.unit=this.value">` : ""}
      <label class="muted">생년월일</label>
      <input id="lg-birth" class="inp" type="date" value="${esc(lg.birth)}" oninput="lg.birth=this.value">
      ${lg.mode === "join" ? `<label class="muted">성별</label><div class="pill-row">${[["남", "남"], ["여", "여"], ["", "선택 안 함"]].map(([v, l]) => `<button class="pill ${lg.gender === v ? "" : "off"}" style="min-height:40px;font-size:14px" onclick="lg.gender='${v}';render()">${l}</button>`).join("")}</div>` : ""}
      ${Cloud.on ? `<label class="muted">비밀번호 ${lg.mode === "join" ? "(6자리 이상, 다른 폰에서 로그인할 때 사용)" : ""}</label>
      <input id="lg-pw" class="inp" type="password" value="${esc(lg.pw)}" placeholder="••••••" oninput="lg.pw=this.value" onkeydown="if(event.key==='Enter')loginSubmit()">` : ""}
      <button class="btn dark tall" onclick="loginSubmit()">${lg.mode === "login" ? "로그인" : "등록하고 자가진단 시작"}</button>
      ${lg.mode === "join" ? `<div class="muted" style="font-size:12px">등록하면 내담자 번호가 자동으로 부여되고, 첫 PTSD 자가진단이 바로 시작됩니다.</div>` : ""}
      ${Cloud.on ? "" : `<div class="muted" style="font-size:12px;color:#b5423a">※ 클라우드 연결 실패: 이 기기에만 저장되는 모드로 동작합니다. 인터넷 연결 후 앱을 다시 열어주세요.</div>`}
    </div>
    ${!Cloud.on && U.list.length ? `<div class="card" style="padding:12px 16px"><div class="muted" style="font-size:12px;margin-bottom:6px">이 기기에 등록된 내담자</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">${U.list.map(u => `<button class="tag" style="background:#fff;color:var(--brand);padding:6px 12px;border-radius:999px;font-size:13px" onclick="quickLogin('${u.id}')">${esc(u.name)} <span class="muted">${u.no}</span></button>`).join("")}</div></div>` : ""}
    <button class="muted" style="font-size:12px;text-decoration:underline" onclick="openAdmin()">관리자 페이지</button>
  </div>` });
async function loginSubmit() {
  const name = lg.name.trim(), birth = lg.birth, pw = lg.pw;
  if (!name) return toast("이름을 입력해 주세요");
  if (Cloud.on) {
    if (!birth) return toast("생년월일을 입력해 주세요");
    if (!pw || pw.length < 6) return toast("비밀번호를 6자리 이상 입력해 주세요");
    try {
      if (lg.mode === "login") {
        cloudBusy("로그인 중"); const uid = await Cloud.login(name, birth, pw); await enterCloudUser(uid); closeModal();
        lg = { mode: "login", name: "", unit: "", birth: "", pw: "" }; diagState = null; if (diagDue()) go("diag", {}, true); else home();
      } else {
        cloudBusy("등록 중"); const prof = await Cloud.register(name, lg.unit.trim(), birth, pw, lg.gender); await enterCloudUser(prof.uid); closeModal();
        lg = { mode: "login", name: "", unit: "", birth: "", pw: "", gender: "" }; diagState = null; go("diag", {}, true);
        modal("등록되었습니다", `${prof.name}님의 내담자 번호는 ${prof.no} 입니다.\n이제 첫 PTSD 자가진단을 시작합니다.`, [{ label: "자가진단 시작" }]);
      }
    } catch (e) { closeModal(); console.warn(e); modal(lg.mode === "login" ? "로그인 실패" : "등록 실패", Cloud.msg(e)); }
    return;
  }
  if (lg.mode === "login") {
    const u = U.list.find(x => x.name === name && (!birth || x.birth === birth));
    if (!u) return modal("등록된 내담자가 없습니다", "이름과 생년월일을 확인하거나 '처음 이용'으로 등록해 주세요.", [{ label: "확인" }, { label: "처음 이용", onClick: () => { lg.mode = "join"; render(); } }]);
    quickLogin(u.id); return;
  }
  if (!birth) return toast("생년월일을 입력해 주세요");
  if (U.list.some(x => x.name === name && x.birth === birth)) return toast("이미 등록된 내담자입니다. 로그인해 주세요");
  const u = registerUser(name, lg.unit.trim(), birth); u.gender = lg.gender; saveUsers(); loginAs(u.id); lg = { mode: "login", name: "", unit: "", birth: "" };
  modal("등록되었습니다", `${u.name}님의 내담자 번호는 ${u.no} 입니다.\n이제 첫 PTSD 자가진단을 시작합니다.`, [{ label: "자가진단 시작", onClick: () => { diagState = null; go("diag", {}, true); } }]);
  diagState = null; go("diag", {}, true);
}
function quickLogin(id) { loginAs(id); lg = { mode: "login", name: "", unit: "", birth: "" }; diagState = null; if (diagDue()) go("diag", {}, true); else home(); }

/* ── 상담 동의서 ── */
let consentOk = false;
VIEWS.consent = ({ next, params }) => ({ html: hdr("상담 동의") + `
  <div class="body">
    <div class="card wm" style="min-height:300px;display:flex;flex-direction:column;justify-content:center;gap:14px">
      <div style="font-size:18px;color:var(--brand)">상담은 아래의 내용을 숙지해 주세요</div>
      <ul style="margin:0;padding-left:18px;line-height:1.8;font-size:15px">${CONSENT_TEXT.map(t => `<li>${esc(t)}</li>`).join("")}</ul>
      <label style="display:flex;align-items:center;gap:10px;margin-top:8px;font-size:16px;background:#fff;border-radius:12px;padding:12px 14px">
        <input type="checkbox" id="consent-chk" style="width:22px;height:22px;accent-color:var(--brand)" ${consentOk ? "checked" : ""} onchange="consentOk=this.checked;document.getElementById('consent-go').disabled=!this.checked">
        위 내용을 확인했으며 상담 진행에 동의합니다.
      </label>
    </div>
    <button id="consent-go" class="btn dark tall" ${consentOk ? "" : "disabled"} onclick="consentDone('${next}')">동의하고 시작</button>
    <button class="btn soft" onclick="consentOk=false;back()">취소</button>
  </div>` });
function consentDone(next) {
  if (!consentOk) return; S.consentAt = new Date().toISOString(); save(); consentOk = false;
  stack.pop();                                  // 동의 화면은 뒤로가기 경로에서 제외
  if (next === "chat") go("chat", {}, true);
  else if (next === "call") { const a = upcoming().filter(x => x.type === "화상")[0]; if (a) go("call", { id: a.id }, false); else home(); }
  else go(next, {}, false);
}

/* ── 상담 (통합 허브) ── */
VIEWS.care = () => {
  const up = upcoming()[0], c = up ? counselor(up.cid) : null;
  // 지난 상담 내역: 회차순 / 년도·월·일·시간 / 화상 or 대면 or 채팅 (상담 결과 + 완료된 예약 합침)
  const hist = [];
  S.results.forEach(r => hist.push({ no: r.no, date: r.date, time: "", type: r.type, cid: r.cid, kind: "result" }));
  pastAppts().forEach(a => { if (!hist.some(h => h.date === a.date)) hist.push({ no: null, date: a.date, time: a.time, type: a.type, cid: a.cid, kind: "appt" }); });
  hist.sort((a, b) => (b.date + (b.time || "")).localeCompare(a.date + (a.time || "")));
  return { tab: "care", html: hdr("", { close: "home()" }) + `
    <div class="body" style="min-height:calc(100vh - 76px - var(--tab-h))">
      <div class="card" onclick="go('bookingList')">
        <div class="card-tt">나의 예약 내역</div>
        <div class="hello">안녕하세요, <span class="nm">${esc(S.user.name)}</span> 님</div>
        ${up ? `<div class="dday">상담 예약일까지 <b>D-${daysBetween(todayStr(), up.date) || "DAY"}</b></div><div class="muted" style="text-align:right">${c.name} ${c.title} · ${dots(up.date)} ${up.time} · ${up.type}</div>`
             : `<div class="dday"><small>예정된 상담이 없습니다</small></div>`}
        <span class="sec-link">예약 목록 · 변경 · 취소 ›</span>
      </div>
      <div class="card" style="flex:1">
        <div class="card-tt">지난 상담 내역</div>
        ${hist.length ? `<div style="display:flex;flex-direction:column;gap:8px">${hist.map(h => `<button class="entry" style="text-align:left;display:flex;justify-content:space-between;align-items:center;gap:8px" onclick="${h.kind === "result" ? `go('results',{no:${h.no}})` : "go('results')"}">
            <span><b style="color:var(--brand)">${h.no ? h.no + "회차" : "상담"}</b> <span class="muted">· ${counselor(h.cid).name} ${counselor(h.cid).title}</span></span>
            <span class="muted" style="font-size:13px;white-space:nowrap">${dots(h.date)}${h.time ? " " + h.time : ""} · ${h.type}</span></button>`).join("")}</div>
            <span class="sec-link">상담 결과 / 코멘트 보기 ›</span>`
          : `<div class="empty" style="padding:60px 10px">회차순 / 년도, 월, 일 시간 / 화상 OR 채팅<br><br>아직 상담 기록이 없습니다</div>`}
      </div>
      <div class="care-nav">
        <button onclick="go('booking')">상담예약</button>
        <button onclick="go('connect')">상담시작</button>
        <button onclick="chatOpen()">채팅상담</button>
      </div>
    </div>` };
};
function chatOpen() { if (S.consentAt) go("chat"); else go("consent", { next: "chat" }); }

/* ── 근무표: 스케줄표 + 식단표 ── */
let sch = null;
VIEWS.schedule = () => {
  const t = todayStr();
  if (!sch) { const d = parse(t); sch = { y: d.getFullYear(), m: d.getMonth(), sel: t, week: weekKey(t) }; }
  const first = new Date(sch.y, sch.m, 1), days = new Date(sch.y, sch.m + 1, 0).getDate();
  let cells = ""; for (let i = 0; i < first.getDay(); i++) cells += `<div class="sd"></div>`;
  for (let d = 1; d <= days; d++) {
    const ds = `${sch.y}-${pad(sch.m + 1)}-${pad(d)}`, code = S.schedule[ds], st = code && SHIFT_TYPES[code], dow = new Date(sch.y, sch.m, d).getDay();
    cells += `<button class="sd ${ds === t ? "today" : ""} ${sch.sel === ds ? "sel" : ""} ${dow === 0 ? "sun" : ""} ${dow === 6 ? "sat" : ""}" onclick="schTap('${ds}')"><span class="n">${d}</span>${st ? `<span class="sh k-${code}">${st.label[0]}</span>` : `<span class="sh none"></span>`}</button>`;
  }
  const counts = {}; Object.entries(S.schedule).forEach(([k, v]) => { if (k.startsWith(`${sch.y}-${pad(sch.m + 1)}`)) counts[v] = (counts[v] || 0) + 1; });
  const ts = todayShift();
  // 식단표 (이번 주)
  const wk = sch.week, m = S.meals[wk] || {}, end = addDays(wk, 6);
  return { tab: "schedule", html: hdr("", { close: "home()" }) + `
    <div class="body">
      <div class="card" style="padding:12px">
        <div class="cal-h"><button onclick="schMonth(-1)">‹</button><span>${sch.y}.${pad(sch.m + 1)} <span class="muted" style="font-weight:400;font-size:12px">· 오늘 ${ts ? SHIFT_TYPES[ts].label : "미입력"}</span></span>
          <span style="display:flex;gap:4px;align-items:center"><button class="today-btn" onclick="schToday()">오늘</button><button onclick="schMonth(1)">›</button></span></div>
        <div class="sgrid">${["일", "월", "화", "수", "목", "금", "토"].map((w, i) => `<div class="w ${i === 0 ? "sun" : i === 6 ? "sat" : ""}">${w}</div>`).join("")}${cells}</div>
        <div class="legend" style="flex-wrap:wrap;gap:8px 12px;margin-top:8px">${Object.entries(SHIFT_TYPES).map(([k, v]) => `<span><i class="k-${k}"></i>${v.label} ${counts[k] ? `<b>${counts[k]}</b>` : ""}</span>`).join("")}</div>
        <div class="muted center" style="font-size:12px;margin-top:6px">날짜를 누를 때마다 주간 → 야간 → 비번 → 휴무 → 당번 → 없음 순으로 바뀝니다</div>
        <details style="margin-top:8px"><summary class="muted" style="font-size:13px;cursor:pointer">교대 패턴으로 한 달 자동 채우기 (선택한 날짜 ${dots(sch.sel)}부터)</summary>
          <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px">${SHIFT_PATTERNS.map((p, i) => `<button class="btn soft" style="min-height:42px;font-size:14px" onclick="schFill(${i})">${p.name}</button>`).join("")}
          <button class="btn soft" style="min-height:38px;font-size:13px;color:#b5423a" onclick="schClear()">이번 달 지우기</button></div></details>
      </div>
      <div class="card" style="padding:12px">
        <div class="cal-h"><button onclick="mealWeek(-1)">‹</button><span>식단표 <span class="muted" style="font-weight:400;font-size:12px">${dots(wk).slice(5)} ~ ${dots(end).slice(5)}</span></span><button onclick="mealWeek(1)">›</button></div>
        <div class="mtable">
          <div class="mh"></div>${MEAL_SLOTS.map(s => `<div class="mh">${s}</div>`).join("")}
          ${DAY_NAMES.map((d, i) => { const ds = addDays(wk, i), sh = S.schedule[ds]; return `<div class="md ${ds === todayStr() ? "today" : ""}">${d}<small>${dots(ds).slice(8)}${sh ? ` · ${SHIFT_TYPES[sh].label}` : ""}</small></div>` + MEAL_SLOTS.map((s, j) => `<textarea class="mc" rows="2" placeholder="-" oninput="mealSet('${wk}','${d}',${j},this.value)">${esc((m[d] || [])[j] || "")}</textarea>`).join(""); }).join("")}
        </div>
        <div class="muted center" style="font-size:12px;margin-top:8px">칸을 눌러 바로 입력하면 자동 저장됩니다</div>
      </div>
    </div>` };
};
function schToday() { const d = parse(todayStr()); sch.y = d.getFullYear(); sch.m = d.getMonth(); sch.sel = todayStr(); render(); }
function schMonth(n) { const d = new Date(sch.y, sch.m + n, 1); sch.y = d.getFullYear(); sch.m = d.getMonth(); render(); }
function schTap(ds) {
  const order = ["D", "N", "O", "H", "A", null], cur = S.schedule[ds] || null, next = order[(order.indexOf(cur) + 1) % order.length];
  if (next) S.schedule[ds] = next; else delete S.schedule[ds];
  sch.sel = ds; save(); render();
}
function schFill(i) {
  const p = SHIFT_PATTERNS[i], start = sch.sel, days = new Date(sch.y, sch.m + 1, 0).getDate();
  for (let d = 1; d <= days; d++) { const ds = `${sch.y}-${pad(sch.m + 1)}-${pad(d)}`; if (ds < start) continue; const k = daysBetween(start, ds) % p.seq.length; S.schedule[ds] = p.seq[k]; }
  save(); toast(`${p.name} 패턴으로 채웠습니다`); render();
}
function schClear() { modal("이번 달 근무를 모두 지울까요?", `${sch.y}년 ${sch.m + 1}월`, [{ label: "아니오", soft: true }, { label: "지우기", onClick: () => { Object.keys(S.schedule).forEach(k => { if (k.startsWith(`${sch.y}-${pad(sch.m + 1)}`)) delete S.schedule[k]; }); save(); render(); } }]); }
function mealWeek(n) { sch.week = addDays(sch.week, n * 7); render(); }
function mealSet(wk, day, j, v) { S.meals[wk] = S.meals[wk] || {}; S.meals[wk][day] = S.meals[wk][day] || ["", "", ""]; S.meals[wk][day][j] = v; save(); }

/* ── 관리자 페이지 ──
   클라우드 모드: 관리자 이메일 로그인 → Firestore의 모든 내담자
   로컬 모드  : 비밀번호 0000 → 이 기기에 등록된 내담자 */
let adminOk = false, adminSel = null, adminPin = "";
let adm = { mode: "login", email: "", pw: "", key: "", users: null, loading: false, detail: null };
VIEWS.admin = ({ id }) => {
  if (!adminOk) {
    if (Cloud.on) return { noTab: true, html: hdr("관리자", { close: "adminOk=false;back()" }) + `
      <div class="body" style="padding-top:30px">
        <div class="card" style="display:flex;flex-direction:column;gap:10px">
          <div class="pill-row" style="margin-bottom:4px">
            <button class="pill ${adm.mode === "login" ? "" : "off"}" style="min-height:44px;font-size:15px" onclick="adm.mode='login';render()">관리자 로그인</button>
            <button class="pill ${adm.mode === "join" ? "" : "off"}" style="min-height:44px;font-size:15px" onclick="adm.mode='join';render()">관리자 등록</button>
          </div>
          <label class="muted">이메일</label><input class="inp" type="email" value="${esc(adm.email)}" placeholder="admin@example.com" oninput="adm.email=this.value">
          <label class="muted">비밀번호</label><input class="inp" type="password" value="${esc(adm.pw)}" placeholder="••••••" oninput="adm.pw=this.value" onkeydown="if(event.key==='Enter')adminLogin()">
          ${adm.mode === "join" ? `<label class="muted">관리자 등록 키</label><input class="inp" type="password" value="${esc(adm.key)}" placeholder="등록 키" oninput="adm.key=this.value">
            <div class="muted" style="font-size:12px">등록 키는 앱 관리자(개발자)에게 받으세요. 키가 맞아야 관리자 권한이 부여됩니다.</div>` : ""}
          <button class="btn dark" onclick="adminLogin()">${adm.mode === "login" ? "입장" : "등록하고 입장"}</button>
        </div>
      </div>` };
    return { noTab: true, html: hdr("관리자", { close: "adminOk=false;back()" }) + `
    <div class="body" style="padding-top:60px">
      <div class="card center" style="padding:28px 16px">
        <div style="font-size:18px;color:var(--brand);margin-bottom:12px">관리자 비밀번호</div>
        <input id="admin-pin" class="inp" type="password" inputmode="numeric" maxlength="8" placeholder="●●●●" style="text-align:center;font-size:22px;letter-spacing:8px" onkeydown="if(event.key==='Enter')adminLogin()">
        <button class="btn dark" style="margin-top:14px" onclick="adminLogin()">입장</button>
        <div class="muted" style="font-size:12px;margin-top:10px">초기 비밀번호 0000 · 이 기기에 등록된 내담자만 표시됩니다</div>
      </div>
    </div>` };
  }
  if (Cloud.on) return adminCloudView(id);
  const sel = id ? userById(id) : null;
  if (sel) {
    const d = loadData(sel.id) || blankData(sel.name), dg = d.diag[d.diag.length - 1];
    return { noTab: true, html: hdr("내담자 정보", { close: "go('admin',{},false);stack.pop()" }) + `
      <div class="body">
        <div class="pcard"><b>${esc(sel.name)} <span style="font-size:13px;opacity:.9">${sel.no}</span></b>${esc(sel.unit || "소속 미입력")}<br>생년월일 ${sel.birth || "-"} · 등록일 ${dots(sel.createdAt)}</div>
        <div class="card"><div class="card-tt">PTSD 자가진단 이력</div>
          ${d.diag.length ? barChart(d.diag.slice(-8).map(x => ({ label: weekLabel(x.date), value: x.score, color: diagGrade(x.score).color })), 88) + `<div class="muted">최근 ${dg.score}점 · ${diagGrade(dg.score).name} (${dots(dg.date)})</div>` : `<div class="empty">아직 검사 기록이 없습니다</div>`}</div>
        <div class="card"><div class="card-tt">기록 현황</div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;text-align:center">
            <div><div style="font-size:24px;color:var(--brand)">${d.daily.length}</div><div class="muted" style="font-size:12px">하루일지</div></div>
            <div><div style="font-size:24px;color:var(--brand)">${d.counsel.length}</div><div class="muted" style="font-size:12px">상담일지</div></div>
            <div><div style="font-size:24px;color:var(--brand)">${d.appts.length}</div><div class="muted" style="font-size:12px">예약</div></div></div>
          ${d.daily.length ? `<div class="entry" style="margin-top:10px"><div class="d"><span>최근 하루일지 ${dots(d.daily[d.daily.length - 1].date)}</span><span>${d.daily[d.daily.length - 1].score}%</span></div><p>${esc(d.daily[d.daily.length - 1].text || "(내용 없음)")}</p></div>` : ""}
          ${d.consentAt ? `<div class="muted" style="font-size:12px;margin-top:8px">상담 동의: ${d.consentAt.slice(0, 10)}</div>` : `<div class="muted" style="font-size:12px;margin-top:8px">상담 동의서 미작성</div>`}</div>
        <div class="card"><div class="card-tt">상담 결과 / 코멘트 입력 <span class="muted">(내담자 앱의 '상담결과'에 표시)</span></div>
          <div style="display:flex;gap:8px;margin-bottom:8px">
            <select id="ar-cid" class="inp" style="flex:1">${COUNSELORS.map(c => `<option value="${c.id}">${c.name} ${c.title}</option>`).join("")}</select>
            <select id="ar-type" class="inp" style="width:90px"><option>대면</option><option>화상</option><option>채팅</option></select></div>
          <textarea id="ar-text" class="ta" style="min-height:120px;background:#fff" placeholder="이번 회차 상담 결과와 다음 회차까지의 과제를 적어주세요"></textarea>
          <button class="btn" style="margin-top:8px" onclick="adminAddResult('${sel.id}')">${d.results.length + 1}회차 결과 저장</button>
          <div style="display:flex;flex-direction:column;gap:8px;margin-top:12px">${[...d.results].reverse().map(r => `<div class="entry"><div class="d"><span>${r.no}회차 · ${counselor(r.cid).name} ${counselor(r.cid).title} · ${r.type}</span><span>${dots(r.date)}</span></div><p>${esc(r.text)}</p></div>`).join("")}</div></div>
        <button class="btn soft" style="color:#b5423a" onclick="adminDelete('${sel.id}')">이 내담자 삭제</button>
      </div>` };
  }
  return { noTab: true, html: hdr("관리자 페이지", { close: "adminOk=false;back()" }) + `
    <div class="body">
      <div class="muted">등록 내담자 ${U.list.length}명 · 번호 순</div>
      ${U.list.map(u => { const d = loadData(u.id), dg = d && d.diag[d.diag.length - 1]; return `<button class="pcard light" style="text-align:left" onclick="go('admin',{id:'${u.id}'})"><b>${esc(u.name)} <span style="font-size:13px">${u.no}</span></b>${esc(u.unit || "소속 미입력")} · 등록 ${dots(u.createdAt)}<br>${dg ? `최근 자가진단 <b style="display:inline;color:${diagGrade(dg.score).color}">${dg.score}점 ${diagGrade(dg.score).name}</b>` : "자가진단 기록 없음"} · 일지 ${d ? d.daily.length : 0}건</button>`; }).join("") || `<div class="empty">등록된 내담자가 없습니다</div>`}
      <div class="muted" style="font-size:12px">※ 현재는 이 기기 안의 데이터만 보입니다. 여러 폰의 내담자를 한곳에서 보려면 서버(클라우드 DB) 연동이 필요합니다.</div>
    </div>` };
};
async function adminLogin() {
  if (!Cloud.on) { if ($("#admin-pin").value === ADMIN_PIN) { adminOk = true; render(); } else toast("비밀번호가 틀렸습니다"); return; }
  const email = adm.email.trim(), pw = adm.pw;
  if (!email || !pw) return toast("이메일과 비밀번호를 입력해 주세요");
  try {
    cloudBusy(adm.mode === "login" ? "확인 중" : "등록 중");
    if (adm.mode === "join") await Cloud.adminRegister(email, pw, adm.key.trim());
    const ok = await Cloud.adminLogin(email, pw);
    closeModal();
    if (!ok) { await Cloud.auth.signOut(); return modal("관리자 권한이 없습니다", "이 계정은 관리자로 등록되어 있지 않습니다. '관리자 등록'에서 등록 키로 등록해 주세요."); }
    adminOk = true; adm.users = null; adm.pw = ""; render();
  } catch (e) { closeModal(); modal("실패", Cloud.msg(e)); }
}
function adminCloudView(id) {
  if (id) {
    if (!adm.detail || adm.detail.uid !== id) {
      if (!adm.loading) { adm.loading = true; Promise.all([Cloud.loadUser(id), Cloud.loadResults(id)]).then(([u, r]) => { adm.detail = { uid: id, u, r }; adm.loading = false; render(); }).catch(e => { adm.loading = false; toast(Cloud.msg(e)); }); }
      return { noTab: true, html: hdr("내담자 정보", { close: "go('admin',{},false);stack.pop()" }) + `<div class="empty">불러오는 중…</div>` };
    }
    const { u, r } = adm.detail, d = Object.assign(blankData(u.name), u.data || {}), dg = d.diag[d.diag.length - 1];
    return { noTab: true, html: hdr("내담자 정보", { close: "go('admin',{},false);stack.pop()" }) + `
      <div class="body">
        <div class="pcard"><b>${esc(u.name)} <span style="font-size:13px;opacity:.9">${u.no}</span></b>${esc(u.unit || "소속 미입력")}<br>생년월일 ${u.birth || "-"} · 등록일 ${dots(u.createdAt || "")}</div>
        <div class="card"><div class="card-tt">PTSD 자가진단 이력</div>
          ${d.diag.length ? barChart(d.diag.slice(-8).map(x => ({ label: weekLabel(x.date), value: x.score, color: diagGrade(x.score).color })), 88) + `<div class="muted">최근 ${dg.score}점 · ${diagGrade(dg.score).name} (${dots(dg.date)})</div>` : `<div class="empty">아직 검사 기록이 없습니다</div>`}</div>
        <div class="card"><div class="card-tt">기록 현황</div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;text-align:center">
            <div><div style="font-size:24px;color:var(--brand)">${d.daily.length}</div><div class="muted" style="font-size:12px">하루일지</div></div>
            <div><div style="font-size:24px;color:var(--brand)">${d.counsel.length}</div><div class="muted" style="font-size:12px">상담일지</div></div>
            <div><div style="font-size:24px;color:var(--brand)">${d.appts.length}</div><div class="muted" style="font-size:12px">예약</div></div></div>
          ${[...d.daily].slice(-3).reverse().map(x => `<div class="entry" style="margin-top:8px"><div class="d"><span>하루일지 ${dots(x.date)}</span><span>${x.score}%</span></div><p>${esc(x.text || "(내용 없음)")}</p></div>`).join("")}
          ${[...d.counsel].slice(-2).reverse().map(x => `<div class="entry" style="margin-top:8px"><div class="d"><span>상담일지 ${dots(x.date)} · ${counselor(x.cid).name}</span><span>${"★".repeat(x.stars)}</span></div><p>${esc(x.text || "")}</p></div>`).join("")}
          ${d.appts.filter(a => a.status === "booked").map(a => `<div class="muted" style="font-size:12px;margin-top:6px">예약: ${dots(a.date)} ${a.time} · ${counselor(a.cid).name} · ${a.type}</div>`).join("")}
          <div class="muted" style="font-size:12px;margin-top:8px">${d.consentAt ? "상담 동의: " + d.consentAt.slice(0, 10) : "상담 동의서 미작성"}</div></div>
        <div class="card"><div class="card-tt">상담 결과 / 코멘트 입력 <span class="muted">(내담자 앱의 '상담결과'에 바로 표시)</span></div>
          <div style="display:flex;gap:8px;margin-bottom:8px">
            <select id="ar-cid" class="inp" style="flex:1">${COUNSELORS.map(c => `<option value="${c.id}">${c.name} ${c.title}</option>`).join("")}</select>
            <select id="ar-type" class="inp" style="width:90px"><option>대면</option><option>화상</option><option>채팅</option></select></div>
          <textarea id="ar-text" class="ta" style="min-height:120px;background:#fff" placeholder="이번 회차 상담 결과와 다음 회차까지의 과제를 적어주세요"></textarea>
          <button class="btn" style="margin-top:8px" onclick="adminAddResult('${id}')">${r.length + 1}회차 결과 저장</button>
          <div style="display:flex;flex-direction:column;gap:8px;margin-top:12px">${[...r].reverse().map(x => `<div class="entry"><div class="d"><span>${x.no}회차 · ${counselor(x.cid).name} ${counselor(x.cid).title} · ${x.type}</span><span>${dots(x.date)}</span></div><p>${esc(x.text)}</p></div>`).join("")}</div></div>
        <button class="btn soft" style="color:#b5423a" onclick="adminDelete('${id}')">이 내담자 기록 삭제</button>
      </div>` };
  }
  if (!adm.users) {
    if (!adm.loading) { adm.loading = true; Cloud.listUsers().then(l => { adm.users = l; adm.loading = false; render(); }).catch(e => { adm.loading = false; adm.users = []; modal("목록을 불러올 수 없습니다", Cloud.msg(e)); }); }
    return { noTab: true, html: hdr("관리자 페이지", { close: "adminExit()" }) + `<div class="empty">불러오는 중…</div>` };
  }
  return { noTab: true, html: hdr("관리자 페이지", { close: "adminExit()" }) + `
    <div class="body">
      <div style="display:flex;justify-content:space-between;align-items:center"><span class="muted">등록 내담자 ${adm.users.length}명 · 번호 순</span><button class="muted" style="font-size:12px;text-decoration:underline" onclick="adm.users=null;render()">새로고침</button></div>
      ${adm.users.map(u => { const d = u.data || {}, dg = d.diag && d.diag[d.diag.length - 1]; return `<button class="pcard light" style="text-align:left" onclick="adm.detail=null;go('admin',{id:'${u.uid}'})"><b>${esc(u.name)} <span style="font-size:13px">${u.no}</span></b>${esc(u.unit || "소속 미입력")} · 등록 ${dots(u.createdAt || "")}<br>${dg ? `최근 자가진단 <b style="display:inline;color:${diagGrade(dg.score).color}">${dg.score}점 ${diagGrade(dg.score).name}</b>` : "자가진단 기록 없음"} · 일지 ${(d.daily || []).length}건</button>`; }).join("") || `<div class="empty">등록된 내담자가 없습니다</div>`}
      <button class="btn soft" onclick="adminExit()">관리자 로그아웃</button>
    </div>` };
}
async function adminExit() { adminOk = false; adm = { mode: "login", email: "", pw: "", key: "", users: null, loading: false, detail: null }; if (Cloud.on) { try { await Cloud.auth.signOut(); } catch (e) { } } stack = []; go("login", {}, true); }
async function adminAddResult(id) {
  const text = $("#ar-text").value.trim(); if (!text) return toast("내용을 입력해 주세요");
  if (Cloud.on) {
    try { cloudBusy("저장 중"); const r = adm.detail ? adm.detail.r : []; await Cloud.addResult(id, { no: r.length + 1, cid: $("#ar-cid").value, date: todayStr(), type: $("#ar-type").value, text }); closeModal(); adm.detail = null; toast("저장되었습니다"); render(); }
    catch (e) { closeModal(); modal("저장 실패", Cloud.msg(e)); }
    return;
  }
  const d = loadData(id) || blankData(userById(id).name);
  d.results.push({ no: d.results.length + 1, cid: $("#ar-cid").value, date: todayStr(), type: $("#ar-type").value, text });
  saveData(id, d); if (id === curId) S = d; toast("저장되었습니다"); render();
}
function adminDelete(id) {
  if (Cloud.on) { const u = adm.detail?.u; return modal("내담자 기록을 삭제할까요?", `${u?.name} (${u?.no})의 자가진단·일지·상담 결과가 모두 지워집니다.`, [{ label: "아니오", soft: true }, { label: "삭제", onClick: async () => { try { cloudBusy("삭제 중"); await Cloud.deleteUser(id); closeModal(); adm.users = null; adm.detail = null; stack.pop(); go("admin", {}, false); } catch (e) { closeModal(); modal("삭제 실패", Cloud.msg(e)); } } }]); }
  const u = userById(id); modal("내담자를 삭제할까요?", `${u.name} (${u.no})의 모든 기록이 지워집니다.`, [{ label: "아니오", soft: true }, { label: "삭제", onClick: () => {
    U.list = U.list.filter(x => x.id !== id); saveUsers(); try { localStorage.removeItem(dataKey(id)); } catch (e) { }
    if (id === curId) logout(); stack.pop(); go("admin", {}, false);
  } }]);
}

/* ── 자가진단 (주 1회) ── */
let diagState = null;
VIEWS.diag = ({ force }) => {
  if (!diagState) diagState = { step: -1, answers: Array(DIAG_ITEMS.length).fill(null), force: !!force };
  const d = diagState;
  if (d.step === -1) {
    return { noTab: true, html: hdr("자가진단", { right: d.force ? "close" : "none" }) + `
      <div class="body">
        <div class="card wm" style="min-height:260px;display:flex;flex-direction:column;justify-content:center">
          <div class="muted">이번 주 마음 상태 점검</div>
          <div class="intro-h">${esc(S.user.name)}님,<br>지난 한 주는 어떠셨나요?</div>
          <p class="muted" style="margin:6px 0 0">최근 1주일 동안 아래 ${DIAG_ITEMS.length}개 항목이 얼마나 자주 있었는지 체크해 주세요. 약 3분 걸립니다.<br>자가진단은 일주일에 한 번만 표시됩니다.</p>
        </div>
        <label class="muted">이름 (홈 화면 인사말에 사용)</label>
        <input id="nm" value="${esc(S.user.name)}" style="width:100%;border:1.5px solid var(--line);border-radius:12px;padding:12px 14px;outline:none">
        <button class="btn dark tall" onclick="diagStart()">시작하기</button>
        ${d.force ? "" : `<button class="btn soft" onclick="diagSkip()">이번 주는 건너뛰기</button>`}
      </div>` };
  }
  if (d.step < DIAG_ITEMS.length) {
    const i = d.step;
    return { noTab: true, html: hdr("자가진단", { right: "close", close: "diagCancel()" }) + `
      <div class="body">
        <div class="diag-prog"><i style="width:${(i / DIAG_ITEMS.length) * 100}%"></i></div>
        <div class="q-no">${i + 1} / ${DIAG_ITEMS.length}</div>
        <div class="q-txt">${esc(DIAG_ITEMS[i])}</div>
        <div class="scale">${DIAG_SCALE.map((s, v) => `<button class="${d.answers[i] === v ? "on" : ""}" onclick="diagAnswer(${v})"><span class="n">${v}</span>${s}</button>`).join("")}</div>
        <div class="row2" style="margin-top:8px">
          <button class="btn soft" onclick="diagPrev()" ${i === 0 ? "disabled" : ""}>이전</button>
          <button class="btn" onclick="diagNext()" ${d.answers[i] == null ? "disabled" : ""}>${i === DIAG_ITEMS.length - 1 ? "결과 보기" : "다음"}</button>
        </div>
      </div>` };
  }
  // 결과
  const score = d.answers.reduce((a, b) => a + b, 0), g = diagGrade(score);
  return { noTab: true, html: hdr("자가진단 결과", { right: "none" }) + `
    <div class="body">
      <div class="card">
        <div class="grade">이번 주 마음건강 점수는<br><b>${score}점</b> <small>/ 88</small></div>
        <div class="gauge"><i style="width:${Math.max(6, score / 88 * 100)}%"></i></div>
        <div class="grade" style="color:${g.color}">${g.name} <small style="font-size:13px">(${g.en})</small><p>${g.desc}</p><p style="color:var(--brand);opacity:1">${g.tip}</p></div>
      </div>
      <div class="muted" style="font-size:12px">0~23 정상 범위 · 24~32 임상적 관심 · 33~36 PTSD 추정 · 37~88 중증<br>총점 20점 이상이거나 특정 증상이 일상생활·대인관계·사회 활동에 지장을 준다면 전문가와 상담을 권합니다.</div>
      ${g.level >= 2 ? `<div class="card" style="background:#fdebea;color:#b5423a;font-size:14px">지금 많이 힘드시다면 정신건강 위기상담전화 <a href="tel:1577-0199" style="color:inherit;font-weight:600">1577-0199</a>로 전화해 주세요. 24시간 연결됩니다.</div>` : ""}
      <button class="btn dark tall" onclick="diagFinish(${score})">홈으로</button>
      ${g.level >= 1 ? `<button class="btn soft" onclick="diagFinish(${score},'booking')">상담 예약하기</button>` : ""}
    </div>` };
};
function diagStart() { S.user.name = ($("#nm").value.trim() || "홍길동"); save(); diagState.step = 0; render(); }
function diagSkip() { S.lastDiag = todayStr(); save(); diagState = null; home(); }
function diagCancel() { if (diagState.force) { diagState = null; back(); } else diagSkip(); }
function diagAnswer(v) { diagState.answers[diagState.step] = v; render(); setTimeout(diagNext, 180); }
function diagNext() { if (diagState.answers[diagState.step] == null) return; diagState.step++; render(); }
function diagPrev() { if (diagState.step > 0) { diagState.step--; render(); } }
function diagFinish(score, next) {
  S.diag.push({ date: todayStr(), score, answers: diagState.answers }); S.lastDiag = todayStr(); save(); diagState = null;
  if (next) go(next, {}, true); else home();
}

/* ── 홈 (p.12) ── */
VIEWS.home = () => {
  const up = upcoming()[0], lastR = S.results[S.results.length - 1];
  const last = pastAppts()[0] || (lastR ? { cid: lastR.cid, date: lastR.date, type: lastR.type } : null);
  const weeks = S.diag.slice(-5).map(d => ({ label: weekLabel(d.date), value: d.score }));
  const cur = latestDiag();
  return { tab: "home", html: hdr("", { right: "search" }) + `
    <div class="body">
      ${window.APP_NOTICE ? `<div class="card" style="background:#fff7e6;border-left:4px solid #e2a33b"><div class="card-tt">공지</div><div style="white-space:pre-wrap;font-size:14px;line-height:1.5">${esc(window.APP_NOTICE.text)}</div></div>` : ""}
      <div class="card" onclick="go('bookingList')">
        <div class="card-tt">나의 예약 내역</div>
        <div class="hello">안녕하세요, <span class="nm">${esc(S.user.name)}</span> 님 <span class="muted" style="font-size:12px">${userById(curId)?.no || ""}</span></div>
        ${todayShift() ? `<div class="muted" style="text-align:right;font-size:12px">오늘 근무: <b style="color:${SHIFT_TYPES[todayShift()].color};-webkit-text-stroke:.3px #777">${SHIFT_TYPES[todayShift()].label}</b></div>` : ""}
        ${up ? `<div class="dday">상담 예약일까지 <b>D-${daysBetween(todayStr(), up.date) || "DAY"}</b></div>
                <div class="muted" style="text-align:right">${counselor(up.cid).name} ${counselor(up.cid).title} · ${dots(up.date)} ${up.time} · ${up.type}</div>`
            : `<div class="dday"><small>예정된 상담이 없습니다</small></div><div class="sec-link">상담 예약하기 ›</div>`}
      </div>
      <div class="card" onclick="go('diagDetail')">
        <div class="card-tt">매주 자가진단 점수 ${cur ? `<span class="muted">· 최근 ${cur.score}점 (${diagGrade(cur.score).name})</span>` : ""}</div>
        ${barChart(weeks, 88)}
      </div>
      <div class="card" style="min-height:220px" onclick="go('results')">
        <div class="card-tt">지난 상담 내역</div>
        ${last ? `<div class="pcard"><b>${counselor(last.cid).name} ${counselor(last.cid).title}</b>${counselor(last.cid).phone}<br>상담일: ${dots(last.date)}<br>${last.type} 예약</div>` : `<div class="empty">아직 상담 기록이 없습니다</div>`}
        <span class="sec-link">상담 결과 / 코멘트 보기 ›</span>
      </div>
      <div class="row2">
        <button class="btn soft" style="min-height:64px" onclick="go('records')">기록<small class="muted" style="margin-left:6px">하루일지 · 상담일지</small></button>
        <button class="btn soft" style="min-height:64px" onclick="diagState=null;go('diag',{force:true})">자가진단<small class="muted" style="margin-left:6px">다시 하기</small></button>
      </div>
    </div>` };
};

/* ── 자가진단 상세 (p.13) ── */
let diagMode = "week";
VIEWS.diagDetail = () => {
  const cur = latestDiag();
  let items;
  if (diagMode === "week") items = S.diag.slice(-8).map(d => ({ label: weekLabel(d.date), value: d.score }));
  else {
    const m = {}; S.diag.forEach(d => { const k = d.date.slice(0, 7); (m[k] = m[k] || []).push(d.score); });
    items = Object.keys(m).sort().slice(-6).map(k => ({ label: `${+k.slice(5)}월`, value: Math.round(m[k].reduce((a, b) => a + b) / m[k].length) }));
  }
  const avg = cur ? Math.round(S.diag.slice(-4).reduce((a, d) => a + d.score, 0) / Math.min(4, S.diag.length)) : 0;
  const g = diagGrade(avg);
  return { html: hdr("", { dark: true }) + `
    <div class="body">
      <div style="display:flex;align-items:center;gap:10px;color:var(--brand);font-size:18px">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="#c98a72"><path d="M12 21s-7-4.6-9.3-8.6C.7 8.6 3 4.5 7 4.5c2 0 3.4 1 5 2.6 1.6-1.6 3-2.6 5-2.6 4 0 6.3 4.1 4.3 7.9C19 16.4 12 21 12 21z"/><path d="M4 12h4l1.5-3 2 6 1.5-3h7" fill="none" stroke="#fff" stroke-width="1.6"/></svg>
        나의 마음건강 점수는?</div>
      <div class="card">${barChart(items, 88)}</div>
      <div class="pill-row">
        <button class="pill ${diagMode === "month" ? "" : "off"}" onclick="diagMode='month';render()">월 평균 📅</button>
        <button class="pill ${diagMode === "week" ? "" : "off"}" onclick="diagMode='week';render()">주 그래프 📅</button>
      </div>
      <div class="card">
        <div class="gauge-arrow"><i style="left:${Math.min(97, Math.max(3, avg / 88 * 100))}%"></i></div>
        <div class="gauge"><i style="width:${Math.max(6, avg / 88 * 100)}%"></i></div>
        <div class="grade">나의 마음건강 점수는<br><b>${avg}점</b> 입니다.<p>최근 4주 평균 · ${g.name} 단계입니다.<br>${g.tip}</p></div>
      </div>
      <button class="btn soft" onclick="diagState=null;go('diag',{force:true})">자가진단 다시 하기</button>
      <div class="muted" style="font-size:12px">0~23 정상 범위 · 24~32 임상적 관심 · 33~36 PTSD 추정 · 37~88 중증</div>
    </div>` };
};

/* ── 상담 결과 / 코멘트 (p.14) ── */
VIEWS.results = ({ no }) => {
  const list = [...S.results].sort((a, b) => b.no - a.no);
  const sel = list.find(r => r.no === no) || list[0];
  return { html: hdr("", { dark: true }) + `
    <div class="body"><div class="card wm">
      ${sel ? `<div class="res-big"><h4>${sel.no}회차 상담결과 <small style="opacity:.8">· ${counselor(sel.cid).name} ${counselor(sel.cid).title} · ${dots(sel.date)}</small></h4><p>${esc(sel.text)}</p></div>` : `<div class="empty">아직 상담 결과가 없습니다.<br>상담 후 선생님이 작성한 결과와 코멘트가 이곳에 누적됩니다.</div>`}
      <div class="card-tt" style="margin-top:22px">지난 상담 내역 보기</div>
      <div style="display:flex;flex-direction:column;gap:12px">
        ${list.map(r => `<button class="pcard ${sel && r.no === sel.no ? "sel" : ""}" style="text-align:left" onclick="go('results',{no:${r.no}},false)"><b>${r.no}회차 · ${counselor(r.cid).name} ${counselor(r.cid).title}</b>${counselor(r.cid).phone}<br>상담일: ${dots(r.date)}<br>${r.type} 예약</button>`).join("")}
      </div>
    </div></div>` };
};

/* ── 예약 (p.15) ── */
let pickCid = null;
VIEWS.booking = () => ({ tab: "care", html: hdr("예약하기", { close: "go('care',{},true)" }) + `
  <div class="body">
    <div class="muted center" style="font-size:13px">선생님 프로필을 누르면 소개를 볼 수 있어요</div>
    <div class="cgrid">
      ${COUNSELORS.map(c => cTile(c)).join("")}
    </div>
    <div class="row2" style="margin-top:6px">
      <button class="btn" onclick="go('bookingList')">예약 목록</button>
      <button class="btn" onclick="go('bookingForm',{cid:pickCid})">예약하기</button>
    </div>
    <div class="muted center" style="font-size:12px">선생님을 선택하지 않고 예약하면 지난 회차 상담자(없으면 무작위)로 배정됩니다.</div>
  </div>` });
function cTile(c) {
  return `<div class="c ${pickCid === c.id ? "sel" : ""}" onclick="showCounselor('${c.id}')">
    <div class="avatar" style="background:${c.color}"><span>${c.name[0]}</span><div class="sp">${esc(c.spec)}</div></div>
    <div class="cname">${c.name} ${c.title}</div></div>`;
}
function showCounselor(id) {
  const c = counselor(id);
  modal(`${c.name} ${c.title}`, `${c.spec}\n${c.career}\n\n${c.intro}`, [
    { label: "닫기", soft: true }, { label: "이 선생님으로 예약", onClick: () => { pickCid = id; go("bookingForm", { cid: id }); } }
  ]);
}

/* ── 예약하기 폼 (p.16) ── */
let bk = null;
VIEWS.bookingForm = ({ cid, edit }) => {
  if (!bk || bk.editId !== (edit || null) || (cid && bk.cid !== cid && !bk.touched)) {
    const e = edit ? S.appts.find(a => a.id === edit) : null;
    const t = todayStr(), base = parse(t);
    bk = { editId: edit || null, cid: e ? e.cid : (cid || S.lastCid || COUNSELORS[Math.floor(Math.random() * COUNSELORS.length)].id),
      y: base.getFullYear(), m: base.getMonth(), date: e ? e.date : null, time: e ? e.time : null, type: e ? e.type : null, touched: false };
    if (e) { const d = parse(e.date); bk.y = d.getFullYear(); bk.m = d.getMonth(); }
  }
  const c = counselor(bk.cid);
  const first = new Date(bk.y, bk.m, 1), days = new Date(bk.y, bk.m + 1, 0).getDate(), t = todayStr();
  let cells = "";
  for (let i = 0; i < first.getDay(); i++) cells += `<div class="d"></div>`;
  for (let d = 1; d <= days; d++) {
    const ds = `${bk.y}-${pad(bk.m + 1)}-${pad(d)}`, dow = new Date(bk.y, bk.m, d).getDay();
    const past = ds < t, booked = S.appts.some(a => a.status === "booked" && a.date === ds && a.id !== bk.editId);
    cells += `<div class="d ${dow === 0 ? "sun" : ""} ${past ? "past" : ""} ${ds === t ? "today" : ""}">
      <button ${past ? "disabled" : ""} class="${bk.date === ds ? "on" : ""}" onclick="bk.date='${ds}';bk.touched=true;render()">${d}${ds === t ? `<span class="lbl">오늘</span>` : ""}${booked ? `<span class="dot"></span>` : ""}</button></div>`;
  }
  return { html: hdr(bk.editId ? "예약 변경" : "예약하기") + `
    <div class="body">
      <div class="pcard light" style="display:flex;justify-content:space-between;align-items:center">
        <div><b>${c.name} ${c.title}</b><span class="muted">${esc(c.spec)}</span></div>
        <select onchange="bk.cid=this.value;bk.touched=true;render()" style="border:1px solid var(--line);border-radius:10px;padding:6px 8px;background:#fff">
          ${COUNSELORS.map(x => `<option value="${x.id}" ${x.id === bk.cid ? "selected" : ""}>${x.name} ${x.title}</option>`).join("")}</select>
      </div>
      <div class="cal">
        <div class="cal-h"><button onclick="bkMonth(-1)">‹</button><span>${bk.y}년 ${bk.m + 1}월</span><button onclick="bkMonth(1)">›</button></div>
        <div class="cal-g">${["일", "월", "화", "수", "목", "금", "토"].map(w => `<div class="w">${w}</div>`).join("")}${cells}</div>
      </div>
      ${bk.date ? Object.entries(TIME_SLOTS).map(([k, arr]) => `<div class="slots-h">${k}</div><div class="slots">${arr.map(s => {
        const taken = S.appts.some(a => a.status === "booked" && a.date === bk.date && a.time === s && a.id !== bk.editId);
        return `<button ${taken ? "disabled style='opacity:.35'" : ""} class="${bk.time === s ? "on" : ""}" onclick="bk.time='${s}';render()">${s}</button>`; }).join("")}</div>`).join("")
      : `<div class="muted center">날짜를 선택하세요</div>`}
      <div class="row2" style="margin-top:6px">
        <button class="btn soft ${bk.type === "화상" ? "on" : ""}" onclick="bk.type='화상';render()">화상</button>
        <button class="btn soft ${bk.type === "대면" ? "on" : ""}" onclick="bk.type='대면';render()">대면</button>
      </div>
      <button class="btn tall" onclick="bkSubmit()" ${bk.date && bk.time && bk.type ? "" : "disabled"}>${bk.editId ? "변경 완료" : "예약"}</button>
    </div>` };
};
function bkMonth(n) { const d = new Date(bk.y, bk.m + n, 1); bk.y = d.getFullYear(); bk.m = d.getMonth(); render(); }
function bkSubmit() {
  if (bk.editId) { const a = S.appts.find(x => x.id === bk.editId); Object.assign(a, { cid: bk.cid, date: bk.date, time: bk.time, type: bk.type }); }
  else S.appts.push({ id: uid(), cid: bk.cid, date: bk.date, time: bk.time, type: bk.type, status: "booked" });
  S.lastCid = bk.cid; save(); const c = counselor(bk.cid), msg = `${c.name} ${c.title}\n${dots(bk.date)} ${bk.time} · ${bk.type} 상담`; bk = null; pickCid = null;
  modal("예약이 완료되었습니다", msg, [{ label: "예약 목록 보기", onClick: () => go("bookingList", {}, true) }]);
}

/* ── 예약 목록 (p.17) ── */
let selAppt = null;
VIEWS.bookingList = () => {
  const list = upcoming();
  if (!list.find(a => a.id === selAppt)) selAppt = list[0]?.id || null;
  return { html: hdr("예약 목록") + `
    <div class="body" style="min-height:calc(100vh - 64px - var(--tab-h))">
      ${list.length ? list.map(a => { const c = counselor(a.cid); return `<button class="pcard light ${selAppt === a.id ? "sel" : ""}" style="text-align:left" onclick="selAppt='${a.id}';render()"><b>${c.name} ${c.title}</b>${c.phone}<br>상담 예정일: ${dots(a.date)} ${a.time}<br>${a.type} 예약 <span class="tag">D-${daysBetween(todayStr(), a.date) || "DAY"}</span>${a.confirmed ? ' <span class="tag" style="background:#dcebe8;color:#174744">상담사 승인</span>' : ""}${a.changedBy ? ' <span class="tag" style="background:#fbefd2;color:#7a4a00">일시 변경됨</span>' : ""}</button>`; }).join("")
      : `<div class="empty">예정된 예약이 없습니다</div>`}
      <div class="spacer" style="min-height:120px;background:url(assets/logo.png) center/180px no-repeat;opacity:.25"></div>
      <div class="row2">
        <button class="btn" onclick="apptCancel()" ${selAppt ? "" : "disabled"}>예약 취소</button>
        <button class="btn" onclick="bk=null;go('bookingForm',{edit:selAppt})" ${selAppt ? "" : "disabled"}>예약 변경</button>
      </div>
      <button class="btn soft" onclick="go('booking',{},true)">새 예약하기</button>
    </div>` };
};
function apptCancel() {
  const a = S.appts.find(x => x.id === selAppt); if (!a) return;
  modal("예약을 취소할까요?", `${counselor(a.cid).name} ${counselor(a.cid).title} · ${dots(a.date)} ${a.time}`, [
    { label: "아니오", soft: true }, { label: "취소하기", onClick: () => { S.appts = S.appts.filter(x => x.id !== a.id); save(); toast("예약이 취소되었습니다"); render(); } }]);
}

/* ── 채팅 상담 (p.18) ── */
function msgHtml(m) {
  const btn = m.btn ? `<button class="chat-btn" onclick="go('${m.to}')">👉 ${esc(m.btn)}</button>` : "";
  return `<div class="msg ${m.role}">${esc(m.text)}${btn}<span class="ts">${esc(m.ts)}</span></div>`;
}
VIEWS.chat = () => ({ tab: "care", html: hdr("채팅상담", { close: "go('care',{},true)" }) + `
  <div class="chat-wrap">
    <div class="chat-note">💬 <span>이용 시간: <b>24시간</b> · 대화 내용은 모두 저장되어 이어서 볼 수 있습니다.</span></div>
    <div class="chat-list" id="chat-list">
      <div class="msg sys">화로 채팅상담</div>
      ${msgHtml({ role: "bot", text: CHAT_WELCOME, ts: "안내" })}
      ${S.chat.map(msgHtml).join("")}
    </div>
    <div class="chat-in">
      <textarea id="chat-ta" placeholder="메시지를 입력하세요" rows="1" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();chatSend()}"></textarea>
      <button onclick="chatSend()" aria-label="보내기">${ICONS.send}</button>
    </div>
  </div>`, after: () => { const l = $("#chat-list"); l.scrollTop = l.scrollHeight; } });
function chatSend() {
  const ta = $("#chat-ta"), text = ta.value.trim(); if (!text) return;
  ta.value = ""; S.chat.push({ role: "me", text, ts: nowTime() }); save();
  const list = $("#chat-list");
  list.insertAdjacentHTML("beforeend", `<div class="msg me">${esc(text)}<span class="ts">${nowTime()}</span></div><div class="msg bot" id="typing"><span class="typing"><i></i><i></i><i></i></span></div>`);
  list.scrollTop = list.scrollHeight;
  setTimeout(() => {
    // 1) 이용 안내 상황 → 안내 멘트 + 이동 버튼
    const g = CHAT_GUIDES.find(r => r.k.some(k => text.includes(k)));
    const replies = [];
    if (g) replies.push({ role: "bot", text: g.r, btn: g.btn, to: g.to, ts: nowTime() });
    // 2) 그 외 모든 상황 → 불안·위기 신호로 보고 상담자 연결 안내
    else { replies.push({ role: "bot", text: CHAT_CRISIS, btn: "상담자 연결하기", to: "connect", ts: nowTime() }); replies.push({ role: "bot", text: CHAT_CRISIS_AFTER, ts: nowTime() }); }
    S.chat.push(...replies); save();
    const t = $("#typing"); if (t) { t.outerHTML = replies.map(msgHtml).join(""); list.scrollTop = list.scrollHeight; }
  }, 900 + Math.random() * 600);
}

/* ── 기록 (p.19) ── */
VIEWS.records = () => {
  const t = todayStr(), week = [];
  for (let i = 6; i >= 0; i--) { const ds = addDays(t, -i); const e = S.daily.find(x => x.date === ds); const d = parse(ds); week.push({ label: `${d.getMonth() + 1}/${d.getDate()}`, value: e ? e.score : null }); }
  const rows = [...S.daily.map(x => ({ date: x.date, kind: "daily" })), ...S.counsel.map(x => ({ date: x.date, kind: "counsel" }))].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
  const up = upcoming()[0];
  return { tab: "records", html: hdr("기록", { close: "home()" }) + `
    <div class="body">
      <div class="card"><div class="card-tt">하루일지 <span class="muted">(일주일 점수 그래프)</span></div>${lineChart(week, 100)}</div>
      <div class="card">
        <div style="color:var(--brand);padding:4px 6px 10px">지난 기록 보기</div>
        <div class="rec-list">
          ${rows.length ? rows.map(r => `<button class="rec-row" style="width:100%" onclick="go('${r.kind}',{date:'${r.date}'})"><span class="dot ${r.kind === "counsel" ? "blue" : ""}"></span>${dots(r.date)}.<span class="sub">${r.kind === "counsel" ? "상담일지" : "하루일지"}</span></button>`).join("") : `<div class="empty">아직 기록이 없습니다</div>`}
        </div>
        <div class="legend"><span><i style="background:#f23b2f"></i>하루일지</span><span><i style="background:#4d79f6"></i>상담일지</span></div>
        <button class="sec-link" style="width:100%" onclick="go('bookingList')">》 다음 예약일 확인하기 ${up ? `(${dots(up.date)})` : ""}</button>
      </div>
      <div class="row2">
        <button class="btn tall" onclick="go('daily')">하루일지</button>
        <button class="btn tall" onclick="go('counsel')">상담일지</button>
      </div>
    </div>` };
};

/* ── 하루일지 달력 (p.20) ── */
let dcal = null;
VIEWS.daily = ({ date }) => {
  const t = todayStr();
  if (!dcal) { const d = parse(date || t); dcal = { y: d.getFullYear(), m: d.getMonth(), sel: date || t }; }
  else if (date && dcal.sel !== date) { const d = parse(date); dcal = { y: d.getFullYear(), m: d.getMonth(), sel: date }; }
  const first = new Date(dcal.y, dcal.m, 1), days = new Date(dcal.y, dcal.m + 1, 0).getDate();
  let cells = ""; for (let i = 0; i < first.getDay(); i++) cells += `<div class="d"></div>`;
  for (let d = 1; d <= days; d++) {
    const ds = `${dcal.y}-${pad(dcal.m + 1)}-${pad(d)}`, has = S.daily.some(x => x.date === ds), dow = new Date(dcal.y, dcal.m, d).getDay();
    cells += `<div class="d ${dow === 0 ? "sun" : ""} ${ds === t ? "today" : ""}"><button class="${dcal.sel === ds ? "on" : ""}" style="${has && dcal.sel !== ds ? "box-shadow:inset 0 0 0 2px var(--brand-soft);border-radius:50%" : ""}" onclick="dcal.sel='${ds}';render()">${d}${has ? `<span class="dot"></span>` : ""}</button></div>`;
  }
  const e = S.daily.find(x => x.date === dcal.sel);
  return { html: hdr("하루일지") + `
    <div class="body">
      <div class="cal" style="border:1px solid var(--line);border-radius:18px">
        <div class="cal-h"><button onclick="dcalMonth(-1)">‹</button><span>${dcal.y}년 ${dcal.m + 1}월</span><button onclick="dcalMonth(1)">›</button></div>
        <div class="cal-g">${["일", "월", "화", "수", "목", "금", "토"].map(w => `<div class="w">${w}</div>`).join("")}${cells}</div>
        <div class="muted center" style="font-size:12px;padding:6px">● 표시가 있는 날은 일지를 작성한 날입니다</div>
      </div>
      ${e ? `<div class="card"><div class="entry"><div class="d"><span>${dots(e.date)}</span><span>하루 점수 ${e.score}%</span></div><p>${esc(e.text) || "<span class='muted'>(내용 없음)</span>"}</p></div></div>`
          : `<div class="muted center">${dots(dcal.sel)} 에는 작성한 일지가 없습니다</div>`}
      <button class="btn tall" onclick="go('dailyWrite',{date:dcal.sel})" ${dcal.sel > t ? "disabled" : ""}>${e ? "하루 일지 수정" : "하루 일지 작성"}</button>
    </div>` };
};
function dcalMonth(n) { const d = new Date(dcal.y, dcal.m + n, 1); dcal.y = d.getFullYear(); dcal.m = d.getMonth(); render(); }

/* ── 하루일지 작성 (p.21) ── */
VIEWS.dailyWrite = ({ date }) => {
  const ds = date || todayStr(), e = S.daily.find(x => x.date === ds), pct = e ? e.score : 67;
  return { html: hdr("하루일지 작성") + `
    <div class="body">
      <div class="donut-wrap">${donut(pct)}</div>
      <div class="donut-msg"><b id="donut-msg">${dailyMsg(pct)}</b><div>${esc(S.user.name)}님의 ${ds === todayStr() ? "하루" : dots(ds)}를 기록해 보세요.</div></div>
      <input type="range" class="slider" min="0" max="100" value="${pct}" oninput="dailySlide(this.value)">
      <div class="muted center" style="font-size:12px;margin-top:-4px">슬라이더를 움직여 오늘의 하루 점수를 정해주세요</div>
      <div class="muted center" style="font-size:13px;margin-bottom:-6px">일지 작성 (오늘의 하루를 가볍게 기록해 보세요)</div>
      <textarea id="daily-ta" class="ta ta-guide" placeholder="${esc(DAILY_PLACEHOLDER)}">${esc(e ? e.text : "")}</textarea>
      <div class="row2">
        <button class="btn" onclick="back()">취소</button>
        <button class="btn" onclick="dailySave('${ds}')">저장</button>
      </div>
    </div>` };
};
function dailySlide(v) {
  const c = 2 * Math.PI * 86; $("#donut-arc").style.strokeDashoffset = c * (1 - v / 100);
  $("#donut-val").textContent = v + "%"; $("#donut-msg").textContent = dailyMsg(+v);
}
function dailySave(ds) {
  const score = +$("input.slider").value, text = $("#daily-ta").value.trim();
  const i = S.daily.findIndex(x => x.date === ds);
  if (i >= 0) S.daily[i] = { date: ds, score, text }; else S.daily.push({ date: ds, score, text });
  S.daily.sort((a, b) => a.date.localeCompare(b.date)); save(); toast("하루일지가 저장되었습니다"); dcal = null; stack.pop(); go("daily", { date: ds }, false); stack.pop();
}

/* ── 상담일지 목록 (p.22) ── */
VIEWS.counsel = ({ date }) => {
  const list = [...S.counsel].sort((a, b) => b.date.localeCompare(a.date));
  return { html: hdr("상담일지") + `
    <div class="body">
      ${list.length ? list.map(x => { const c = counselor(x.cid); return `<div class="card ${x.date === date ? "" : ""}" style="${x.date === date ? "outline:2px solid var(--brand)" : ""}">
        <div class="pcard" style="margin-bottom:10px"><b>${c.name} ${c.title}</b>${c.phone}<br>상담일 ${dots(x.date)}<br>만족도: <span style="color:#ffd66b">${"★".repeat(x.stars)}</span>${"☆".repeat(5 - x.stars)}</div>
        <div class="entry"><p>${esc(x.text)}</p></div>
        <div class="row2" style="margin-top:10px"><button class="btn soft" style="min-height:40px" onclick="go('counselWrite',{date:'${x.date}'})">수정</button><button class="btn soft" style="min-height:40px" onclick="counselDel('${x.date}')">삭제</button></div></div>`; }).join("")
      : `<div class="card wm" style="min-height:300px"><div class="empty">상담 후 느낀 점과 만족도를 기록해 보세요</div></div>`}
      <button class="btn tall" onclick="go('counselWrite',{})">상담 일지 작성</button>
    </div>` };
};
function counselDel(d) { modal("상담일지를 삭제할까요?", dots(d), [{ label: "아니오", soft: true }, { label: "삭제", onClick: () => { S.counsel = S.counsel.filter(x => x.date !== d); save(); render(); } }]); }

/* ── 상담일지 작성 (p.23) ── */
let cw = null;
VIEWS.counselWrite = ({ date }) => {
  const past = pastAppts();
  if (!cw || cw.key !== (date || "new")) {
    const e = date ? S.counsel.find(x => x.date === date) : null;
    const ref = past[0];
    cw = { key: date || "new", date: e ? e.date : (ref ? ref.date : todayStr()), cid: e ? e.cid : (ref ? ref.cid : S.lastCid), stars: e ? e.stars : 0, text: e ? e.text : "" };
  }
  const c = counselor(cw.cid);
  return { html: hdr("상담일지 작성") + `
    <div class="body"><div class="card wm" style="min-height:420px;display:flex;flex-direction:column;gap:12px">
      <div class="pcard">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
          <div><b>${c.name} ${c.title}</b>${c.phone}</div>
          <select onchange="cw.cid=this.value;render()" style="border:0;border-radius:8px;padding:4px 6px;font-size:12px">${COUNSELORS.map(x => `<option value="${x.id}" ${x.id === cw.cid ? "selected" : ""}>${x.name} ${x.title}</option>`).join("")}</select>
        </div>
        상담일 <input type="date" value="${cw.date}" max="${todayStr()}" onchange="cw.date=this.value" style="border:0;border-radius:8px;padding:2px 6px;font-size:13px">
        <div style="display:flex;align-items:center;gap:10px;margin-top:6px">만족도: <span class="stars">${[1, 2, 3, 4, 5].map(n => `<button class="${cw.stars >= n ? "on" : ""}" onclick="cw.stars=${n};render()">★</button>`).join("")}</span></div>
      </div>
      <textarea id="cw-ta" class="ta" style="background:#fff;flex:1" placeholder="만족도 및 일지 작성&#10;(상담에서 느낀 점, 기억하고 싶은 말을 적어보세요)" oninput="cw.text=this.value">${esc(cw.text)}</textarea>
    </div>
    <div class="row2"><button class="btn" onclick="cw=null;back()">취소</button><button class="btn" onclick="counselSave()">저장</button></div></div>` };
};
function counselSave() {
  if (!cw.stars) return toast("만족도를 선택해 주세요");
  const i = S.counsel.findIndex(x => x.date === cw.date && (cw.key === "new" || cw.key === cw.date));
  const rec = { date: cw.date, cid: cw.cid, stars: cw.stars, text: cw.text.trim() };
  if (cw.key !== "new") { const j = S.counsel.findIndex(x => x.date === cw.key); if (j >= 0) S.counsel[j] = rec; else S.counsel.push(rec); }
  else if (i >= 0) S.counsel[i] = rec; else S.counsel.push(rec);
  save(); cw = null; toast("상담일지가 저장되었습니다"); stack.pop(); go("counsel", {}, false); stack.pop();
}

/* ── 상담 시작 / 연결 (p.24) ── */
VIEWS.connect = () => {
  const vids = upcoming().filter(a => a.type === "화상");
  const a = vids[0], c = a ? counselor(a.cid) : null;
  const dg = latestDiag(), dl = S.daily[S.daily.length - 1];
  const topics = [];
  if (dg) { const g = diagGrade(dg.score); topics.push(g.level >= 2 ? "자가진단에서 높은 점수를 보인 침습·과각성 증상 다루기" : g.level === 1 ? "자가진단에서 나타난 수면·과각성 증상 점검" : "안정 상태 유지와 재발 예방 계획"); }
  if (dl && dl.score < 50) topics.push("최근 하루일지에서 낮은 점수를 보인 날의 상황 살펴보기");
  if (dl && dl.text) topics.push(`하루일지 내용: "${dl.text.slice(0, 30)}${dl.text.length > 30 ? "…" : ""}"`);
  if (S.results.length) topics.push(`지난 회차 과제 점검 (${S.results[S.results.length - 1].no}회차 코멘트 참고)`);
  if (!topics.length) topics.push("첫 만남: 현재 어려움과 상담 목표 정하기");
  return { tab: "care", html: hdr("연 결", { close: "go('care',{},true)" }) + `
    <div class="body">
      <div class="card wm" style="min-height:380px">
        ${c ? `<div class="pcard" style="background:${c.color}"><b>${c.name} ${c.title}</b>${c.phone}<br>${esc(c.spec)}<br><span style="font-size:13px;opacity:.9">${esc(c.career)}</span><p style="margin:8px 0 0;font-size:13px">${esc(c.intro)}</p></div>
          <div style="margin:14px 0 6px;color:var(--brand)">예약 일시</div><div>${dots(a.date)} ${a.time} · 화상 상담 <span class="tag" style="background:#fff;padding:2px 10px;border-radius:999px;font-size:12px;color:var(--brand)">D-${daysBetween(todayStr(), a.date) || "DAY"}</span></div>
          <div style="margin:14px 0 6px;color:var(--brand)">상담 주제 <span class="muted">(자가진단·일지 기반, 선생님 지정)</span></div>
          <ol style="margin:0;padding-left:18px;font-size:14px;line-height:1.7">${topics.map(t => `<li>${esc(t)}</li>`).join("")}</ol>`
        : `<div class="empty" style="padding-top:80px">예약된 화상 상담이 없습니다.<br><br>상담예약에서 '화상'을 선택해 예약하면<br>이곳에서 선생님과 연결됩니다.</div>`}
      </div>
      <button class="btn soft tall" style="font-size:18px" onclick="startCall()">상담시작</button>
    </div>` };
};
function startCall() {
  const a = upcoming().filter(x => x.type === "화상")[0];
  if (!a) return modal("예약날짜가 아닙니다.", "예약된 화상 상담이 없습니다.\n화상 상담을 먼저 예약해 주세요.", [{ label: "닫기", soft: true }, { label: "예약하기", onClick: () => go("booking", {}, true) }]);
  if (a.date !== todayStr()) return modal("예약날짜가 아닙니다.", `상담 예정일: ${dots(a.date)} ${a.time}\n(D-${daysBetween(todayStr(), a.date)})`);
  modal("화상통화 시작", `${counselor(a.cid).name} ${counselor(a.cid).title}과 화상 상담을 시작할까요?\n시작 전 상담 동의서를 확인합니다.`, [{ label: "취소", soft: true }, { label: "시작", onClick: () => { consentOk = false; go("consent", { next: "call" }); } }]);
}

/* ── 화상 상담 (p.25) ── */
let callT = null, callStream = null;
VIEWS.call = ({ id }) => {
  const a = S.appts.find(x => x.id === id), c = counselor(a ? a.cid : S.lastCid);
  return { noTab: true, html: `<div class="call">
    <div class="remote">
      <div class="timer" id="call-timer">연결 중…</div>
      <div class="who"><div class="av" style="background:${c.color}">${c.name[0]}</div><div style="font-size:20px">${c.name} ${c.title}</div><div style="opacity:.7;font-size:13px;margin-top:4px">HWARO 화상 상담</div></div>
      <div class="local"><video id="local-v" autoplay muted playsinline></video></div>
    </div>
    <div class="ctrl">
      <button id="mic-btn" onclick="toggleMic()" aria-label="마이크"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg></button>
      <button class="end" onclick="endCall('${id}')" aria-label="종료"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.6 14.4a15 15 0 0 1 16.8 0l-2.1 2.1a1 1 0 0 1-1.1.2l-2.6-1.2a1 1 0 0 1-.6-.9v-1.9a11 11 0 0 0-4 0v1.9a1 1 0 0 1-.6.9l-2.6 1.2a1 1 0 0 1-1.1-.2z"/></svg></button>
      <button onclick="go('chat')" aria-label="채팅"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H9l-5 4z"/></svg></button>
    </div></div>`, after: async () => {
      let sec = 0; callT = setInterval(() => { sec++; const el = $("#call-timer"); if (el) el.textContent = `${pad(Math.floor(sec / 60))}:${pad(sec % 60)}`; }, 1000);
      try { callStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: true }); const v = $("#local-v"); if (v) v.srcObject = callStream; } catch (e) { }
    } };
};
function toggleMic() { if (!callStream) return; const t = callStream.getAudioTracks()[0]; if (!t) return; t.enabled = !t.enabled; $("#mic-btn").classList.toggle("off", !t.enabled); }
function endCall(id) {
  clearInterval(callT); if (callStream) { callStream.getTracks().forEach(t => t.stop()); callStream = null; }
  modal("상담을 종료할까요?", "", [{ label: "계속하기", soft: true, onClick: () => render() }, { label: "종료", onClick: () => {
    const a = S.appts.find(x => x.id === id); if (a) { a.status = "done"; save(); }
    stack = []; current = { name: "home", params: {} }; render();
    modal("상담이 종료되었습니다", "선생님이 작성한 상담 결과는 '지난 상담 내역'에서 확인할 수 있습니다.\n오늘 상담에 대한 상담일지를 남겨보세요.", [{ label: "나중에", soft: true }, { label: "상담일지 작성", onClick: () => { cw = null; go("counselWrite", {}); } }]);
  } }]);
}

/* ── 정보 (p.26) ── */
VIEWS.info = () => ({ tab: "info", html: hdr("정 보", { close: "home()" }) + `
  <div class="body" style="padding-top:60px">
    <div class="row2">
      <button class="btn soft sq" onclick="go('ptsd')">PTSD란?<small class="muted">카드뉴스</small></button>
      <button class="btn soft sq" onclick="go('stab')">안정화<small class="muted">훈련 · 음성 · 영상</small></button>
      <button class="btn soft sq" onclick="go('hospitals')">치료연계<small class="muted">연계 병원 · 긴급전화</small></button>
      <button class="btn soft sq" onclick="go('support')">지원제도<small class="muted">카드뉴스</small></button>
    </div>
  </div>` });

/* ── 카드뉴스 (p.27, p.34) ── */
function cardNews(title, folder, n) {
  return { html: hdr(title) + `
    <div style="padding:16px 0 0">
      <div class="cards-slider" id="slider" onscroll="sliderDots()">${Array.from({ length: n }, (_, i) => `<img src="assets/${folder}/${i + 1}.jpg" alt="${title} ${i + 1}" loading="lazy">`).join("")}</div>
      <div class="dots" id="dots">${Array.from({ length: n }, (_, i) => `<i class="${i === 0 ? "on" : ""}"></i>`).join("")}</div>
      <div class="muted center" style="margin-top:10px;font-size:12px">← 좌우로 넘겨 보세요 →</div>
    </div>` };
}
function sliderDots() { const s = $("#slider"), i = Math.round(s.scrollLeft / (s.firstElementChild.offsetWidth + 12)); document.querySelectorAll("#dots i").forEach((d, k) => d.classList.toggle("on", k === i)); }
VIEWS.ptsd = () => cardNews("PTSD란?", "ptsd", PTSD_CARDS);
VIEWS.support = () => cardNews("지원제도", "support", SUPPORT_CARDS);

/* ── 안정화 훈련 (p.28) ── */
VIEWS.stab = () => ({ html: hdr("안정화 훈련") + `
  <div class="body">
    <div class="card wm guide">
      <h3 style="margin-top:0">안정화(Stabilization)란?</h3><p>${STAB_GUIDE.what}</p>
      <h3>왜 안정화가 필요할까요?</h3><p>${STAB_GUIDE.why}</p>
      <h3>일상에서 실천하는 3가지 핵심 기법</h3>
      ${STAB_GUIDE.methods.map((m, i) => `<p><b>${["①", "②", "③"][i]} ${m.title}</b></p><ol>${m.steps.map(s => `<li>${s}</li>`).join("")}</ol>`).join("")}
      <h3>언제, 어디서 연습하면 좋을까요?</h3><p>${STAB_GUIDE.when}</p>
      <p class="q">"${STAB_GUIDE.quote}"</p>
    </div>
    <button class="btn soft" style="min-height:64px" onclick="go('breath')">🫁 호흡 안정화 따라하기 (4-2-6)</button>
    <div class="row2">
      <button class="btn soft sq" onclick="go('audio')">소리로 배우는<br>안정화 훈련</button>
      <button class="btn soft sq" onclick="go('video')">영상으로 보는<br>안정화 훈련</button>
    </div>
  </div>` });

/* ── 호흡 가이드 ── */
let breathT = null;
VIEWS.breath = () => ({ html: hdr("호흡 안정화") + `
  <div class="body" style="align-items:center;text-align:center;padding-top:40px">
    <div id="bcircle" style="width:200px;height:200px;border-radius:50%;background:var(--brand-soft);display:grid;place-items:center;color:#fff;font-size:22px;transition:transform 4s ease-in-out, background 1s">준비</div>
    <div id="bmsg" class="muted" style="font-size:16px;min-height:48px">편안한 자세로 앉아 시작을 눌러주세요</div>
    <div class="row2" style="width:100%"><button class="btn soft" onclick="breathStop()">정지</button><button class="btn" onclick="breathStart()">시작</button></div>
    <div class="muted" style="font-size:13px">코로 4초 들이쉬고 → 2초 멈추고 → 입으로 6초 내쉬기 · 5회 반복</div>
  </div>` });
function breathStart() {
  breathStop(); const c = $("#bcircle"), m = $("#bmsg"); let round = 0;
  const phases = [["들이쉬기", 4, 1.5, "#c98a72"], ["멈추기", 2, 1.5, "#b5674a"], ["내쉬기", 6, 1, "#d8a999"]];
  let p = 0;
  const step = () => {
    if (round >= 5) { c.textContent = "완료"; c.style.transform = "scale(1)"; m.textContent = "수고하셨어요. 지금 몸의 느낌을 잠시 느껴보세요."; return; }
    const [name, sec, scale, col] = phases[p];
    c.textContent = `${name} ${sec}초`; c.style.transition = `transform ${sec}s ease-in-out, background 1s`; c.style.transform = `scale(${scale})`; c.style.background = col;
    m.textContent = `${round + 1} / 5 회`;
    p++; if (p === phases.length) { p = 0; round++; }
    breathT = setTimeout(step, sec * 1000);
  };
  step();
}
function breathStop() { clearTimeout(breathT); const c = $("#bcircle"); if (c) { c.style.transform = "scale(1)"; c.textContent = "준비"; } }

/* ── 음성 안정화 목록 (p.29) / 재생 (p.30) ── */
VIEWS.audio = ({ sel }) => ({ html: hdr("안정화 훈련") + `
  <div class="body"><div class="card" style="background:#f4f1ee">
    <div style="color:#d33f3f;font-size:14px">안정화 배우기</div>
    <div style="font-size:24px;font-weight:700;margin:4px 0 6px">음성으로 천천히 따라해 보세요</div>
    <div class="muted" style="margin-bottom:14px">지금 편안한 자세를 찾고, 원하는 훈련을 선택하세요.</div>
    <div class="alist">${AUDIO_LIST.map(a => `<button class="${sel === a.id ? "on" : ""}" onclick="go('audioPlay',{id:${a.id}})"><span class="han">${a.han}</span><span><b>${a.title}</b><small>${a.sub}</small></span><span class="len">${a.len}</span></button>`).join("")}</div>
  </div></div>` });
VIEWS.audioPlay = ({ id }) => {
  const a = AUDIO_LIST.find(x => x.id === id) || AUDIO_LIST[0];
  return { html: hdr("안정화 훈련") + `
    <div class="body"><div class="player">
      <div class="hp"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#d33f3f" stroke-width="2"><path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="13" width="4" height="7" rx="2"/><rect x="17" y="13" width="4" height="7" rx="2"/></svg></div>
      <h3>${a.title} 훈련</h3><p>${a.desc}</p>
      <audio controls preload="metadata" src="${a.file}" style="width:100%"></audio>
      <div class="warn">ⓘ 운전 또는 장비 조작 중에는 사용하지 말고, 안전하고 편안한 장소에서 이용해 주세요.</div>
    </div>
    <div class="alist">${AUDIO_LIST.filter(x => x.id !== a.id).map(x => `<button onclick="go('audioPlay',{id:${x.id}},false)"><span class="han">${x.han}</span><span><b>${x.title}</b><small>${x.sub}</small></span><span class="len">${x.len}</span></button>`).join("")}</div>
    </div>` };
};

/* ── 영상 안정화 (p.31~32) ── */
VIEWS.video = () => ({ html: hdr("안정화 훈련") + `
  <div class="body"><div class="card" style="background:#f4f4f6">
    <div class="vlist">${VIDEO_LIST.map((v, i) => `<a class="vitem" target="_blank" rel="noopener" href="https://www.youtube.com/watch?v=${v.id}" style="text-decoration:none;color:inherit">
      <div class="th" style="background:#eee url(https://img.youtube.com/vi/${v.id}/mqdefault.jpg) center/cover"><span class="playov">${ICONS.play}</span></div><div><b>${i + 1}. ${v.title}</b><small>${v.desc}</small></div></a>`).join("")}</div>
    <div class="muted center" style="font-size:12px;margin-top:12px">순서대로 보세요 · 영상은 유튜브에서 재생됩니다 (인터넷 연결 필요)</div>
  </div></div>` });

/* ── 치료 연계 (p.33) ── */
VIEWS.hospitals = () => ({ html: hdr("치료 연계") + `
  <div class="body">
    <div class="muted" style="margin:-4px 0">긴급 상담 전화</div>
    ${HELPLINES.map(h => `<div class="hosp" style="background:#fdebea;color:#b5423a"><b>${h.name}</b><a href="tel:${h.tel.replace(/[^0-9]/g, "") || ""}" style="color:#b5423a;font-size:22px;font-weight:600">${h.tel}</a><div style="font-size:13px;margin-top:4px">${h.desc}</div></div>`).join("")}
    <div class="muted" style="margin:6px 0 -4px">연계 병원</div>
    ${HOSPITALS.map(h => `<div class="hosp"><b>${h.name}</b>주소: ${h.addr}<br>전화번호: <a href="tel:${h.tel}">${h.tel}</a></div>`).join("")}
  </div>` });

/* ── 검색 / 빠른 메뉴 (p.35) ── */
VIEWS.search = () => ({ html: hdr("", { close: "home()" }) + `
  <div class="search-in"><input id="sq" placeholder="메뉴 검색 (예: 예약, 일지, 안정화)" oninput="searchFilter(this.value)"></div>
  <div class="quick" id="quick">${quickBtns("")}</div>
  <div class="body" style="padding-top:0">
    <div class="muted center" style="font-size:12px">${esc(S.user.name)} · ${userById(curId)?.no || ""} 로 로그인됨</div>
    <div class="row2"><button class="btn soft" style="min-height:44px;font-size:13px" onclick="doLogout()">로그아웃 / 계정 전환</button><button class="btn soft" style="min-height:44px;font-size:13px" onclick="openAdmin()">관리자 페이지</button></div>
    <button class="btn soft" style="min-height:44px;font-size:13px" onclick="resetData()">내 기록 초기화</button></div>` });
function openAdmin() { if (Cloud.on) location.href = "admin.html"; else { adminOk = false; go("admin"); } }
function doLogout() { logout(); stack = []; current = null; go("login", {}, true); }
const QUICK = [["상담예약", "booking"], ["상담결과", "results"], ["채팅상담", "chat"], ["하루일지 작성", "dailyWrite"], ["근무표", "schedule"], ["자가진단", "diagDetail"], ["예약 목록", "bookingList"], ["상담일지", "counsel"], ["상담 시작", "connect"], ["PTSD란?", "ptsd"], ["안정화 훈련", "stab"], ["음성 안정화", "audio"], ["영상 안정화", "video"], ["치료연계", "hospitals"], ["지원제도", "support"]];
function quickBtns(q) { return QUICK.filter(([l]) => !q || l.includes(q)).slice(0, q ? 20 : 4).map(([l, v]) => `<button class="btn soft" onclick="go('${v}')">${l}</button>`).join("") || `<div class="empty">검색 결과가 없습니다</div>`; }
function searchFilter(q) { $("#quick").innerHTML = quickBtns(q.trim()); }
function resetData() { modal("내 기록을 초기화할까요?", "이 계정의 자가진단·예약·일지·채팅·근무표 기록이 모두 지워집니다.", [{ label: "아니오", soft: true }, { label: "초기화", onClick: () => { const nm = S.user.name; S = blankData(nm); save(); diagState = null; go("diag", {}, true); } }]); }

/* ───────── 시작 ───────── */
/* 안드로이드/브라우저 뒤로가기 버튼 처리
   - 히스토리에 "가드" 항목 하나를 두고, 뒤로가기(popstate)가 오면 앱 내부에서 이전 화면으로 이동한 뒤 가드를 다시 넣는다.
   - 홈 화면에서 누르면 안내만 띄우고 가드를 넣지 않아, 한 번 더 누르면 앱이 종료된다. */
let guardOn = false;
function pushGuard() { if (!guardOn) { try { history.pushState({ hwaro: 1 }, ""); guardOn = true; } catch (e) { } } }
window.addEventListener("popstate", () => {
  guardOn = false;
  if ($("#modal-root").firstChild) { closeModal(); pushGuard(); return; }
  if (!S || current.name === "login") { if (current.name === "admin") { adminOk = false; go("login", {}, true); return; } toast("한 번 더 누르면 앱이 종료됩니다"); return; }
  if (current.name === "call") { endCall(current.params.id); pushGuard(); return; }
  if (current.name === "diag" && diagState && !diagState.force && diagState.step >= 0) { diagState.step = -1; render(); pushGuard(); return; }
  if (stack.length) { if (current.name === "diag") diagState = null; back(); pushGuard(); return; }
  if (current.name !== "home") { diagState = null; home(); pushGuard(); return; }
  toast("한 번 더 누르면 앱이 종료됩니다");
});
const _go = go;
go = function (name, params, replace) { _go(name, params, replace); pushGuard(); };
(function boot() {
  if (Cloud.on) {
    $("#screen").innerHTML = `<div class="body" style="min-height:100vh;justify-content:center;align-items:center"><img src="assets/logo.png" alt="HWARO" style="width:160px"><div class="typing" style="display:flex"><i></i><i></i><i></i></div></div>`;
    let first = true;
    Cloud.auth.onAuthStateChanged(async user => {
      if (!first) return; first = false;
      try {
        if (user && Cloud.isClient(user)) { await enterCloudUser(user.uid); diagState = null; if (diagDue()) _go("diag", {}, true); else home(); }
        else if (user && await Cloud.isAdmin(user.email)) { adminOk = true; _go("admin", {}, true); }
        else { if (user) await Cloud.auth.signOut(); curId = null; S = null; _go("login", {}, true); }
      } catch (e) { console.warn(e); curId = null; S = null; _go("login", {}, true); toast(Cloud.msg(e)); }
      pushGuard();
    });
    return;
  }
  if (curId && userById(curId)) { loginAs(curId); if (diagDue()) _go("diag", {}, true); else home(); }
  else { logout(); _go("login", {}, true); }
  pushGuard();
})();

/* ═══════════════════════════════════════════════
   화로 관리자 (상담자용, EMR형) — 관리자 페이지 디자인.pdf 기준
   화면: AdminHome(PTSD 사정 탭) · AdminComments(회차별 코멘트) · AdminStats(통계)
   부품: RiskBadge · ClientList · ScoreChart · SubscaleBars · SoapNote · SchedulePanel · ClientMemo
═══════════════════════════════════════════════ */

/* ── 유틸 (cloud.js가 참조) ── */
const $ = (s, el = document) => el.querySelector(s);
const pad = n => String(n).padStart(2, "0");
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayStr = () => ymd(new Date());
const parse = s => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
const md = s => s ? String(s).slice(5).replace("-", "/") : "";             // 10/09
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const counselor = id => COUNSELORS.find(c => c.id === id) || COUNSELORS[0];
function blankData(name) { return { user: { name }, diag: [], lastDiag: null, appts: [], results: [], daily: [], counsel: [], chat: [], lastCid: null, schedule: {}, meals: {}, consentAt: null }; }
const age = b => { if (!b) return null; const d = parse(b), t = new Date(); let a = t.getFullYear() - d.getFullYear(); if (t < new Date(t.getFullYear(), d.getMonth(), d.getDate())) a--; return a; };

/* ── 설정 (판정 기준, 설정 화면에서 변경) ── */
const SETTINGS_KEY = "hwaro_admin_settings";
const DEF_SET = { t1: 24, t2: 33, t3: 37, name: "" };   // 자가진단 문서 기준: 0~23 정상 / 24~32 임상적 관심 / 33~36 PTSD 추정 / 37+ 중증
let SET = (() => { try { const o = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"); if (o.t1 === 18 && o.t2 === 25) { o.t1 = 24; o.t2 = 33; } return Object.assign({}, DEF_SET, o); } catch (e) { return { ...DEF_SET }; } })();
function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(SET)); } catch (e) { } }

/* ── IES-R-K 하위 영역 (문항 번호 1부터) ── */
const SUB = {
  intrusion: { label: "침입", en: "Intrusion", items: [1, 2, 3, 6, 9, 14, 16, 20], max: 32, color: "var(--chart-intrusion)", shape: "circle" },
  avoidance: { label: "회피", en: "Avoidance", items: [5, 7, 8, 11, 12, 13, 17, 22], max: 32, color: "var(--chart-avoidance)", shape: "square" },
  hyper: { label: "과각성", en: "Hyperarousal", items: [4, 10, 15, 18, 19, 21], max: 24, color: "var(--chart-hyper)", shape: "triangle" }
};
function subscales(answers) {
  if (!answers || answers.length < 22) return null;
  const o = {}; for (const k in SUB) o[k] = SUB[k].items.reduce((s, i) => s + (answers[i - 1] || 0), 0); return o;
}
/* RiskBadge: 색 + 도형 + 글자 */
function risk(score) {
  if (score == null) return { lv: "l", name: "기록 없음", shape: "●", cls: "l" };
  if (score >= SET.t3) return { lv: "h", name: "중증", shape: "▲", cls: "h" };
  if (score >= SET.t2) return { lv: "h", name: "PTSD 추정", shape: "▲", cls: "h" };
  if (score >= SET.t1) return { lv: "m", name: "임상적 관심", shape: "◆", cls: "m" };
  return { lv: "l", name: "정상 범위", shape: "●", cls: "l" };
}
const badge = (score, lg) => { const r = risk(score); return `<span class="risk ${r.cls} ${lg ? "lg" : ""}">${r.shape} ${r.name}</span>`; };

/* ── 위험 신호 ── */
function signals(u) {
  const d = u.data || {}, dg = d.diag || [], out = [];
  const last = dg[dg.length - 1], prev = dg[dg.length - 2];
  if (last && last.score >= SET.t2) out.push({ lv: "h", t: last.score >= SET.t3 ? "중증 구간" : "PTSD 추정 구간" });
  if (last && prev && last.score - prev.score >= 5) out.push({ lv: "h", t: `직전 대비 +${last.score - prev.score} 급상승` });
  const dl = (d.daily || []).slice(-3);
  if (dl.length === 3 && dl.every(x => x.score < 40)) out.push({ lv: "m", t: "하루일지 3일 연속 낮음" });
  const chat = (d.chat || []).filter(m => m.role === "me").slice(-10);
  if (chat.some(m => /죽|자살|끝내|사라지|해치/.test(m.text))) out.push({ lv: "h", t: "채팅 위기 표현" });
  return out;
}
const lastScore = u => { const dg = (u.data && u.data.diag) || []; return dg.length ? dg[dg.length - 1].score : null; };
const lastSession = u => { const a = ((u.data && u.data.appts) || []).filter(x => x.date < todayStr() || x.status === "done").sort((a, b) => b.date.localeCompare(a.date))[0]; return a ? a.date : null; };
const nextAppt = u => ((u.data && u.data.appts) || []).filter(x => x.status === "booked" && x.date >= todayStr()).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))[0] || null;
const toMin = t => { const [h, m] = (t || "0:00").split(":").map(Number); return (h < 9 ? h + 12 : h) * 60 + m; };   // 앱 시간표(오전 9~11, 오후 1~8)
const fmtT = t => { const [h, m] = (t || "0:00").split(":").map(Number); const hh = h < 9 ? h + 12 : h; return `${pad(hh)}:${pad(m)}`; };

/* ── 상태 ── */
let A = { email: null, users: null, sel: null, tab: "ptsd", view: "clients", q: "", filter: "all", cfilter: "", results: {}, memos: {}, approvals: {}, nursing: {}, vitals: {}, content: null, ctab: "videos", chartMode: "total", chartRange: "3m", dailyOverlay: false, schedMode: "week", statRange: 6, avail: null, busy: false };
// data.js 기본 콘텐츠 스냅샷 (콘텐츠 관리에서 "기본값으로" 되돌릴 때 사용 — applyContent가 배열을 제자리 교체하므로 먼저 복사)
const DEF_CONTENT = JSON.parse(JSON.stringify({ videos: VIDEO_LIST, hospitals: HOSPITALS, helplines: HELPLINES, counselors: COUNSELORS, notice: { on: false, text: "" } }));

/* ── 모달/토스트 ── */
function modal(html) { $("#modal-root").innerHTML = `<div class="modal-bg" onclick="if(event.target===this)closeModal()"><div class="modal">${html}</div></div>`; }
function closeModal() { $("#modal-root").innerHTML = ""; }
let toastT; function toast(m) { const t = $("#toast"); t.textContent = m; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 1800); }
function busy(on) { A.busy = on; }

/* ═══════════════ 렌더 ═══════════════ */
function render() {
  const app = $("#app");
  if (!A.email) { app.innerHTML = loginView(); return; }
  if (!A.users) { app.innerHTML = shell(`<div class="empty">내담자 목록을 불러오는 중…</div>`, true); return; }
  if (A.view === "stats") return app.innerHTML = shell(statsView(), true);
  if (A.view === "settings") return app.innerHTML = shell(settingsView(), true);
  if (A.view === "chats") return app.innerHTML = shell(chatsView(), true);
  if (A.view === "schedule") return app.innerHTML = shell(scheduleView(), true);
  if (A.view === "content") return app.innerHTML = shell(contentView(), true);
  app.innerHTML = shell(clientList() + `<div class="center">${centerView()}</div><div class="right">${schedulePanel()}${memoPanel()}</div>`);
}
function shell(inner, wide) {
  const alerts = (A.users || []).filter(u => signals(u).some(s => s.lv === "h")).length;
  const chatAlerts = (A.users || []).filter(u => (u.data?.chat || []).some(m => m.role === "me" && /죽|자살|끝내|사라지|해치/.test(m.text))).length;
  const pending = allAppts().filter(a => a.status === "booked" && a.date >= todayStr() && !(A.approvals[a.uid] || {})[a.id]).length;
  const nav = [["home", "홈", ICON.home], ["clients", "내담자", ICON.users], ["schedule", "일정", ICON.cal], ["chats", "채팅상담", ICON.chat, chatAlerts], ["stats", "통계", ICON.stats], ["content", "콘텐츠", ICON.book], ["settings", "설정", ICON.cog]];
  const notis = alerts + pending;
  return `<div class="shell">
    <div class="topbar"><span class="wordmark">화로</span><span class="chip">관리자</span><span class="sp"></span>
      <button class="bell" title="위험 신호 ${alerts} · 승인 대기 ${pending}" onclick="showNotis()">${ICON.bell}${notis ? `<span class="badge">${notis}</span>` : ""}</button>
      <span class="avatar">${esc((SET.name || A.email)[0])}</span><span class="sm">${esc(SET.name || A.email)}</span>
      <button class="btn outline sm" onclick="doLogout()">${ICON.logout} 로그아웃</button></div>
    <div class="main ${wide ? "wide" : ""}">
      <nav class="rail">${nav.map(([v, l, ic, n]) => `<button class="${(A.view === v || (v === "clients" && A.view === "home")) && !(v === "home" && A.view === "clients") ? "on" : ""}" onclick="A.view='${v === "home" ? "clients" : v}';render()">${ic}<span>${l}</span>${n ? `<span class="badge">${n}</span>` : ""}</button>`).join("")}</nav>
      ${inner}</div></div>`;
}
const ICON = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
  bell: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-5-6.3"/></svg>',
  cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H9l-5 4z"/></svg>',
  stats: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  cog: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  lock: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  eye: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  pin: '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M14 2l8 8-4 1-3 3 1 6-3-3-6 6-1-1 6-6-3-3 6 1 3-3z"/></svg>',
  book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 4h6a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4zM20 4h-6a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h7z"/></svg>',
  logout: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5M15 8l4 4-4 4M19 12H9"/></svg>',
  print: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 8V3h10v5M5 8h14a2 2 0 0 1 2 2v6h-4v5H7v-5H3v-6a2 2 0 0 1 2-2zM7 14h10"/></svg>',
  search: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></svg>',
  flag: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4h12l-2 4 2 4H5"/></svg>',
  play: '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M7 4l12 8-12 8z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  trash: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>'
};

/* ── 로그인 ── */
let lg = { mode: "login", email: "", pw: "", key: "", name: "" };
function loginView() {
  return `<div class="login"><div class="panel">
    <div><span class="wordmark">화로</span> <span class="chip">관리자</span></div>
    <div class="muted sm">상담자용 관리자 계정 · 내담자 관리 · 회차별 기록</div>
    <div class="seg" style="align-self:flex-start"><button class="${lg.mode === "login" ? "on" : ""}" onclick="lg.mode='login';render()">로그인</button><button class="${lg.mode === "join" ? "on" : ""}" onclick="lg.mode='join';render()">관리자 등록</button></div>
    <label class="label">이메일</label><input class="inp" type="email" value="${esc(lg.email)}" oninput="lg.email=this.value" placeholder="admin@example.com">
    <label class="label">비밀번호</label><input class="inp" type="password" value="${esc(lg.pw)}" oninput="lg.pw=this.value" onkeydown="if(event.key==='Enter')doLogin()">
    ${lg.mode === "join" ? `<label class="label">표시 이름 (예: 이지원 상담사)</label><input class="inp" value="${esc(lg.name)}" oninput="lg.name=this.value">
      <label class="label">관리자 등록 키</label><input class="inp" type="password" value="${esc(lg.key)}" oninput="lg.key=this.value"><div class="faint">등록 키는 앱 관리자(개발자)에게 받으세요.</div>` : ""}
    <button class="btn primary" style="justify-content:center;padding:9px" onclick="doLogin()">${lg.mode === "login" ? "입장" : "등록하고 입장"}</button>
    <div class="faint">${Cloud.on ? "Firebase 연결됨" : "⚠ Firebase 연결 실패 · 인터넷을 확인하세요"}</div>
    <a class="faint" href="index.html" style="color:var(--brand)">← 내담자 앱으로</a>
  </div></div>`;
}
async function doLogin() {
  const email = lg.email.trim(), pw = lg.pw; if (!email || !pw) return toast("이메일과 비밀번호를 입력해 주세요");
  try {
    if (lg.mode === "join") { await Cloud.adminRegister(email, pw, lg.key.trim()); if (lg.name.trim()) { SET.name = lg.name.trim(); saveSettings(); } }
    const ok = await Cloud.adminLogin(email, pw);
    if (!ok) { await Cloud.auth.signOut(); return toast("관리자 권한이 없는 계정입니다"); }
    A.email = email; render(); loadUsers();
  } catch (e) { toast(Cloud.msg(e)); }
}
async function doLogout() { try { await Cloud.auth.signOut(); } catch (e) { } A = Object.assign(A, { email: null, users: null, sel: null, results: {}, memos: {} }); render(); }
async function loadUsers() {
  try {
    const c = await Cloud.loadContent(); if (c) { Cloud.applyContent(c); A.content = normContent(c); }
    A.users = await Cloud.listUsers(); if (!A.sel && A.users.length) A.sel = sortedUsers()[0]?.uid; render(); if (A.sel) loadDetail(A.sel);
  }
  catch (e) { A.users = []; render(); toast(Cloud.msg(e)); }
}
async function loadDetail(uid) {
  try {
    const sub = (name, order) => { let q = Cloud.db.collection("users").doc(uid).collection(name); if (order) q = q.orderBy(order, "desc"); return q.get().then(q => q.docs.map(d => ({ id: d.id, ...d.data() }))).catch(() => []); };
    const [r, m, ap, nd, vt] = await Promise.all([Cloud.loadResults(uid), sub("memos", "createdAt"),
      Cloud.db.collection("users").doc(uid).collection("approvals").get().then(q => Object.fromEntries(q.docs.map(d => [d.id, d.data()]))).catch(() => ({})),
      sub("nursing", "createdAt"), sub("vitals", "date")]);
    A.results[uid] = r; A.memos[uid] = m; A.approvals[uid] = ap; A.nursing[uid] = nd; A.vitals[uid] = vt; if (A.sel === uid) render();
  } catch (e) { toast(Cloud.msg(e)); }
}
async function assignCounselor(uid, cid) { try { await Cloud.db.collection("users").doc(uid).set({ counselor: cid }, { merge: true }); const u = (A.users || []).find(x => x.uid === uid); if (u) u.counselor = cid; toast(cid ? "담당 상담자를 지정했습니다" : "담당 지정을 해제했습니다"); render(); } catch (e) { toast(Cloud.msg(e)); } }
function selectUser(uid) { A.sel = uid; A.tab = A.tab || "ptsd"; render(); if (!A.results[uid]) loadDetail(uid); }
const cur = () => (A.users || []).find(u => u.uid === A.sel);

/* ── ClientList ── */
function sortedUsers() {
  const q = A.q.trim();
  let list = (A.users || []).filter(u => !q || (u.name || "").includes(q) || (u.no || "").includes(q));
  if (A.cfilter) list = list.filter(u => (u.counselor || "") === A.cfilter);
  if (A.filter === "booked") list = list.filter(u => nextAppt(u));
  if (A.filter === "active") list = list.filter(u => (u.data?.appts || []).length);
  if (A.filter === "done") list = list.filter(u => !nextAppt(u) && (u.data?.appts || []).length);
  const w = u => { const s = signals(u); return s.some(x => x.lv === "h") ? 2 : s.length ? 1 : 0; };
  return list.sort((a, b) => w(b) - w(a) || (lastScore(b) || 0) - (lastScore(a) || 0));
}
function clientList() {
  const all = A.users || [], list = sortedUsers(), risky = list.filter(u => signals(u).length), rest = list.filter(u => !signals(u).length);
  const row = u => { const s = signals(u), sc = lastScore(u), nx = nextAppt(u), ls = lastSession(u);
    return `<button class="crow ${A.sel === u.uid ? "on" : ""}" onclick="selectUser('${u.uid}')">
      <span class="avatar">${esc((u.name || "?")[0])}</span>
      <span><div class="nm">${esc(u.name)}<small>${[age(u.birth) != null ? age(u.birth) + "세" : "", u.gender || ""].filter(Boolean).join(" · ")}</small> ${sc != null ? badge(sc) : ""}</div>
        <div class="meta">최근 ${ls ? md(ls) : "—"} · 다음 ${nx ? md(nx.date) : "미정"} ${nx && !(A.approvals[u.uid] || {})[nx.id] ? '<span class="chip gray">승인 대기</span>' : ""}</div>
        ${s.length ? `<div class="sig ${s[0].lv}">↑ ${esc(s[0].t)}</div>` : ""}</span>
      <span class="sc">${sc ?? ""}</span></button>`; };
  const cnt = { all: all.length, booked: all.filter(u => nextAppt(u)).length, active: all.filter(u => (u.data?.appts || []).length).length };
  return `<div class="col clist">
    <div class="tools">
      <input class="inp" placeholder="이름 · 등록번호 검색" value="${esc(A.q)}" oninput="A.q=this.value;render()">
      <div class="chips">${[["all", `전체 ${cnt.all}`], ["booked", `예약 대기 ${cnt.booked}`], ["active", `상담 중 ${cnt.active}`], ["done", "종결"]].map(([k, l]) => `<button class="${A.filter === k ? "on" : ""}" onclick="A.filter='${k}';render()">${l}</button>`).join("")}</div>
      <div class="faint" style="display:flex;justify-content:space-between;align-items:center"><select class="inp" style="width:auto;padding:2px 6px;font-size:12px" onchange="A.cfilter=this.value;render()"><option value="">담당 상담자 · 전체</option>${COUNSELORS.map(c => `<option value="${c.id}" ${A.cfilter === c.id ? "selected" : ""}>${c.name} ${c.title}</option>`).join("")}</select><span>위험도 순</span></div>
    </div>
    ${risky.length ? `<div class="sect">${ICON.flag} 위험 신호 · 상단 고정</div>${risky.map(row).join("")}` : ""}
    ${rest.length ? `<div class="sect">그 외 내담자</div>${rest.map(row).join("")}` : ""}
    ${!list.length ? `<div class="empty">내담자가 없습니다</div>` : ""}
  </div>`;
}

/* ── 가운데: 상세 ── */
function centerView() {
  const u = cur(); if (!u) return `<div class="panel empty">왼쪽에서 내담자를 선택하세요</div>`;
  const d = Object.assign(blankData(u.name), u.data || {}), sc = lastScore(u), r = A.results[u.uid] || [];
  const head = `<div class="panel">
    <div class="dhead"><span class="avatar lg">${esc(u.name[0])}</span>
      <div><h1>${esc(u.name)} ${sc != null ? badge(sc) : ""}</h1><div class="sm muted">${[age(u.birth) != null ? age(u.birth) + "세" : "", u.gender || ""].filter(Boolean).join(" · ")}${age(u.birth) != null || u.gender ? " · " : ""}No. <span class="mono">${u.no}</span> · 상담 <b>${r.length}회</b> · ${esc(u.unit || "소속 미입력")}
        · 담당 <select class="inp" style="width:auto;padding:1px 6px;font-size:12px;display:inline-block" onchange="assignCounselor('${u.uid}', this.value)"><option value="">미지정</option>${COUNSELORS.map(c => `<option value="${c.id}" ${u.counselor === c.id ? "selected" : ""}>${c.name} ${c.title}</option>`).join("")}</select></div></div>
      <span class="sp"></span>
      <button class="btn outline" onclick="printSummary()">${ICON.print} 요약지 PDF</button>
      <button class="btn primary" onclick="openSoapForm()">${ICON.plus} 회차 기록 작성</button></div>
    <div class="tabs">${[["info", "내담자 정보"], ["ptsd", "PTSD 사정"], ["nursing", "간호진단명", (A.nursing[u.uid] || []).filter(x => x.status !== "resolved").length], ["objective", "객관적 정보"], ["comments", "회차별 코멘트"]].map(([k, l, n]) => `<button class="${A.tab === k ? "on" : ""}" onclick="A.tab='${k}';render()">${l}${n ? ` <span class="chip">${n}</span>` : ""}</button>`).join("")}</div>
    ${A.tab === "ptsd" ? ptsdTab(u, d) : A.tab === "comments" ? commentsTab(u, d, r) : A.tab === "nursing" ? nursingTab(u, d) : A.tab === "objective" ? objectiveTab(u, d) : infoTab(u, d)}
  </div>`;
  return head + (A.tab === "ptsd" ? `<div class="panel">${scoreChartPanel(d, r)}</div>` : "");
}

/* PTSD 사정 탭: 총점 · SubscaleBars · 판정 구간 · 권장 조치 */
function ptsdTab(u, d) {
  const dg = d.diag, last = dg[dg.length - 1], prev = dg[dg.length - 2];
  if (!last) return `<div class="empty">아직 자가진단 기록이 없습니다</div>`;
  const rk = risk(last.score), sub = subscales(last.answers), delta = prev ? last.score - prev.score : null;
  const p1 = SET.t1 / 88 * 100, p2 = SET.t2 / 88 * 100, p3 = SET.t3 / 88 * 100;
  const hi = sub ? Object.entries(sub).sort((a, b) => b[1] / SUB[b[0]].max - a[1] / SUB[a[0]].max)[0] : null;
  const advice = last.score >= SET.t3 ? `<b>권장 조치</b> · 적극적인 의학적·심리적 치료가 필요한 구간입니다. 치료연계(전문의 평가)를 바로 안내하고 상담 일정을 앞당깁니다.${hi ? ` ${SUB[hi[0]].label} 영역이 두드러져 소견란에 따로 기록합니다.` : ""}`
    : rk.lv === "h" ? `<b>권장 조치</b> · PTSD 진단 기준에 부합할 가능성이 높은 구간입니다. 정밀 심리검사와 치료연계 안내를 검토합니다.${hi ? ` ${SUB[hi[0]].label} 영역이 두드러져 소견란에 따로 기록합니다.` : ""}`
    : rk.lv === "m" ? `<b>권장 조치</b> · 임상적 개입과 지속 관찰이 권장되는 구간입니다. 주 1회 자가진단 추이 관찰, 안정화 콘텐츠 권장.${hi ? ` ${SUB[hi[0]].label} 영역 변화를 다음 회차에서 확인합니다.` : ""}`
    : `<b>안내</b> · 정상 범위입니다. 현재 상태 유지와 재발 예방 계획을 다룹니다.`;
  return `<div class="sub">
    <div><div class="label">IES-R-K 총점 · ${md(last.date)} 자가진단</div>
      <div><span class="score-lg">${last.score}</span><span class="muted">/88</span></div>
      <div style="margin:6px 0 8px">${badge(last.score, true)}</div>
      <div class="sm ${delta > 0 ? "" : "muted"}" style="color:${delta >= 5 ? "var(--risk-high-text)" : "inherit"}">${delta == null ? "첫 검사" : `${delta >= 0 ? "↑ +" : "↓ "}${delta} 전주 ${prev.score}점`}</div></div>
    <div><div class="label">하위 영역</div>
      ${sub ? Object.entries(SUB).map(([k, s]) => `<div class="bar"><span><div class="sm" style="font-weight:600">${s.label}</div><div class="faint">${s.en}</div></span><span class="tr"><i style="width:${sub[k] / s.max * 100}%;background:${s.color}"></i></span><span class="v">${sub[k]}<span class="muted">/${s.max}</span></span></div>`).join("")
          : `<div class="faint">문항별 응답이 없어 하위 영역을 계산할 수 없습니다 (앱에서 완료한 검사만 표시)</div>`}</div>
  </div>
  <div class="label" style="margin-top:16px">판정 구간</div>
  <div class="band" style="--p1:${p1}%;--p2:${p2}%;--p3:${p3}%"><span class="mk" style="left:${Math.min(99, last.score / 88 * 100)}%"></span></div>
  <div class="band-l"><span>0–${SET.t1 - 1} 정상 범위</span><span>${SET.t1} 임상적 관심</span><span>${SET.t2} PTSD 추정</span><span>${SET.t3}+ 중증</span></div>
  <div class="advice ${rk.lv}">${advice}</div>`;
}

/* ScoreChart: 주 1회 IES-R-K 꺾은선 + 18/25 점선·띠 + 상담일 세로선 + 하위영역/하루일지 겹쳐보기 */
function scoreChartPanel(d, results) {
  const range = { "1m": 31, "3m": 93, all: 100000 }[A.chartRange];
  const from = addDays(todayStr(), -range);
  const dg = d.diag.filter(x => x.date >= from);
  const W = 720, H = 230, L = 36, R = 90, T = 18, B = 30, max = 88;
  const X = i => dg.length > 1 ? L + i * (W - L - R) / (dg.length - 1) : (L + W - R) / 2, Y = v => T + (H - T - B) * (1 - v / max);
  const yMax = Math.max(40, ...dg.map(x => x.score + 6)); const Yc = v => T + (H - T - B) * (1 - v / yMax);
  let svg = `<rect x="${L}" y="${Yc(yMax)}" width="${W - L - R}" height="${Yc(SET.t2) - Yc(yMax)}" fill="var(--risk-high-tint)"/><rect x="${L}" y="${Yc(SET.t2)}" width="${W - L - R}" height="${Yc(SET.t1) - Yc(SET.t2)}" fill="var(--risk-mid-tint)"/>`;
  [0, 10, 20, 30, 40, 50, 60, 70, 80].filter(v => v <= yMax).forEach(v => svg += `<line x1="${L}" x2="${W - R}" y1="${Yc(v)}" y2="${Yc(v)}" stroke="var(--chart-grid)"/><text x="${L - 6}" y="${Yc(v) + 4}" text-anchor="end" font-size="10" fill="var(--ink-muted)">${v}</text>`);
  svg += `<line x1="${L}" x2="${W - R}" y1="${Yc(SET.t2)}" y2="${Yc(SET.t2)}" stroke="var(--risk-high)" stroke-dasharray="4 3"/><text x="${W - R + 6}" y="${Yc(SET.t2) + 4}" font-size="11" font-weight="600" fill="var(--risk-high-text)">${SET.t2} PTSD 추정</text>`;
  svg += `<line x1="${L}" x2="${W - R}" y1="${Yc(SET.t1)}" y2="${Yc(SET.t1)}" stroke="var(--risk-mid)" stroke-dasharray="4 3"/><text x="${W - R + 6}" y="${Yc(SET.t1) + 4}" font-size="11" font-weight="600" fill="var(--risk-mid-text)">${SET.t1} 임상적 관심</text>`;
  // 상담일 세로 점선
  results.filter(r => r.date >= from).forEach(r => { const i = dg.findIndex(x => x.date >= r.date); if (i < 0 || dg.length < 2) return; const x = X(Math.max(0, i - .5)); svg += `<line x1="${x}" x2="${x}" y1="${T}" y2="${H - B}" stroke="var(--ink-muted)" stroke-dasharray="2 3"/><text x="${x}" y="${T - 4}" text-anchor="middle" font-size="10" fill="var(--ink-muted)">${r.no}회차</text>`; });
  const line = (pts, color, w) => { let p = ""; pts.forEach(([x, y], i) => p += (i ? " L" : "M") + x + "," + y); return `<path d="${p}" fill="none" stroke="${color}" stroke-width="${w}"/>`; };
  const mark = (x, y, shape, color) => shape === "triangle" ? `<path d="M${x},${y - 6} L${x + 6},${y + 5} L${x - 6},${y + 5}Z" fill="${color}"/>` : shape === "square" ? `<rect x="${x - 5}" y="${y - 5}" width="10" height="10" fill="${color}"/>` : shape === "diamond" ? `<path d="M${x},${y - 6} L${x + 6},${y} L${x},${y + 6} L${x - 6},${y}Z" fill="${color}"/>` : `<circle cx="${x}" cy="${y}" r="5" fill="${color}"/>`;
  if (A.chartMode === "total") {
    svg += line(dg.map((x, i) => [X(i), Yc(x.score)]), "var(--chart-total)", 2.5);
    dg.forEach((x, i) => { const rk = risk(x.score); svg += mark(X(i), Yc(x.score), rk.lv === "h" ? "triangle" : rk.lv === "m" ? "diamond" : "circle", rk.lv === "h" ? "var(--risk-high)" : rk.lv === "m" ? "var(--risk-mid)" : "var(--risk-low)"); });
    if (dg.length) svg += `<text x="${X(dg.length - 1) + 10}" y="${Yc(dg[dg.length - 1].score) - 8}" font-size="12" font-weight="700" fill="var(--ink)" class="mono">${dg[dg.length - 1].score}</text>`;
  } else {
    for (const k in SUB) { const pts = dg.map((x, i) => { const s = subscales(x.answers); return s ? [X(i), Yc(s[k])] : null; }).filter(Boolean); if (!pts.length) continue;
      svg += line(pts, SUB[k].color, 2); pts.forEach(([x, y]) => svg += mark(x, y, SUB[k].shape, SUB[k].color)); const e = pts[pts.length - 1]; svg += `<text x="${e[0] + 10}" y="${e[1] + 4}" font-size="11" font-weight="600" fill="${SUB[k].color}">${SUB[k].label}</text>`; }
  }
  if (A.dailyOverlay) { const dl = d.daily.filter(x => x.date >= from); if (dg.length > 1 && dl.length) { const x0 = parse(dg[0].date), x1 = parse(dg[dg.length - 1].date), span = Math.max(1, x1 - x0); const pts = dl.map(x => [L + (parse(x.date) - x0) / span * (W - L - R), Yc(x.score / 100 * yMax)]).filter(p => p[0] >= L && p[0] <= W - R); svg += line(pts, "var(--brand)", 1.5).replace('fill="none"', 'fill="none" stroke-dasharray="3 3"'); } }
  dg.forEach((x, i) => svg += `<text x="${X(i)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="var(--ink-muted)">${md(x.date)}</text>`);
  return `<div class="panel-h"><div><span class="h2">IES-R-K 점수 추이</span> <span class="faint">주 1회 자가진단</span></div>
    <div style="display:flex;gap:8px"><div class="seg"><button class="${A.chartMode === "total" ? "on" : ""}" onclick="A.chartMode='total';render()">총점</button><button class="${A.chartMode === "sub" ? "on" : ""}" onclick="A.chartMode='sub';render()">하위 영역</button><button class="${A.dailyOverlay ? "on" : ""}" onclick="A.dailyOverlay=!A.dailyOverlay;render()">+ 하루일지</button></div>
    <div class="seg">${[["1m", "1개월"], ["3m", "3개월"], ["all", "전체"]].map(([k, l]) => `<button class="${A.chartRange === k ? "on" : ""}" onclick="A.chartRange='${k}';render()">${l}</button>`).join("")}</div></div></div>
    ${dg.length ? `<svg class="chart" viewBox="0 0 ${W} ${H}">${svg}</svg>` : `<div class="empty">기간 내 자가진단 기록이 없습니다</div>`}`;
}

/* 회차별 코멘트: SOAP 타임라인 */
function commentsTab(u, d, r) {
  if (!r.length) return `<div class="empty">아직 회차 기록이 없습니다. 오른쪽 위 "회차 기록 작성"으로 첫 기록을 남기세요.</div>`;
  const sc = (date) => { const x = [...d.diag].filter(g => g.date <= date).pop(); return x ? x.score : null; };
  const lvOrder = { l: 0, m: 1, h: 2 };
  const badgeAt = (x) => { const s = sc(x.date), prev = r.find(v => v.no === x.no - 1); const rk = risk(s); if (s == null) return ""; const ps = prev ? sc(prev.date) : null; const up = ps != null && lvOrder[rk.lv] > lvOrder[risk(ps).lv]; return `<span class="risk ${rk.cls}">${rk.shape} ${rk.name}${up ? " 진입" : ""}</span>`; };
  return `<div class="tl" style="margin-top:14px">${[...r].reverse().map(x => `<div class="sess">
    <div class="sess-h"><b>${x.no}회차</b><span class="mono">${(x.date || "").replace(/-/g, ".")}</span><span>· ${esc(x.type || "")}</span>${badgeAt(x)}${x.topic ? `<span class="muted">주제: ${esc(x.topic)}</span>` : ""}<span class="sp" style="flex:1"></span><button class="btn ghost sm" onclick="openSoapForm('${x.id}')">수정</button></div>
    <div class="soap">
      <div class="cell"><div class="k"><i>S</i>주관적 호소</div>${esc(x.s || "—")}</div>
      <div class="cell"><div class="k"><i>O</i>객관적 관찰</div>${esc(x.o || "—")}</div>
      <div class="cell"><div class="k"><i>A</i>평가</div>${esc(x.a || "—")}</div>
      <div class="cell"><div class="k"><i>P</i>계획</div>${esc(x.p || "—")}</div></div>
    <div class="pub"><div class="k">${ICON.eye} 내담자 공개용 코멘트 · 앱에 전달됨</div>${esc(x.text || "—")}</div>
    ${x.history && x.history.length ? `<div class="hist">수정 ${x.history.length}회 · 마지막 ${(x.history[x.history.length - 1].at || "").slice(0, 16).replace("T", " ")}</div>` : ""}
  </div>`).join("")}</div>`;
}

/* 내담자 정보 탭 */
function infoTab(u, d) {
  const chat = (d.chat || []).slice(-30);
  return `<div style="margin-top:14px;display:flex;flex-direction:column;gap:16px">
    <div><div class="label" style="margin-bottom:6px">기본 정보</div>
      <div class="kv"><span class="k">등록번호</span><span class="mono">${u.no}</span><span class="k">생년월일</span><span>${u.birth || "—"}${age(u.birth) != null ? ` (${age(u.birth)}세)` : ""}</span><span class="k">성별</span><span>${u.gender || "—"}</span><span class="k">담당 상담자</span><span>${u.counselor ? counselor(u.counselor).name + " " + counselor(u.counselor).title : "미지정"}</span><span class="k">소속</span><span>${esc(u.unit || "—")}</span><span class="k">등록일</span><span>${u.createdAt || "—"}</span><span class="k">상담 동의</span><span>${d.consentAt ? d.consentAt.slice(0, 10) + " 동의" : '<span class="chip gray">미작성</span>'}</span><span class="k">오늘 근무</span><span>${d.schedule && d.schedule[todayStr()] ? SHIFT_TYPES[d.schedule[todayStr()]].label : "—"}</span></div></div>
    <div><div class="label">예약</div>${(d.appts || []).length ? [...d.appts].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6).map(a => `<div class="entry"><div class="d"><span>${a.date.replace(/-/g, ".")} ${fmtT(a.time)} · ${counselor(a.cid).name} ${counselor(a.cid).title} · ${a.type}</span><span>${a.status === "done" ? "완료" : a.date < todayStr() ? "지남" : (A.approvals[u.uid] || {})[a.id]?.status === "confirmed" ? "승인됨" : "승인 대기"}</span></div></div>`).join("") : `<div class="faint">예약 없음</div>`}</div>
    <div><div class="label">하루일지 <span class="faint">최근 5건</span></div>${(d.daily || []).slice(-5).reverse().map(x => `<div class="entry"><div class="d"><span>${x.date.replace(/-/g, ".")}</span><span class="mono">${x.score}%</span></div>${esc(x.text || "(내용 없음)")}</div>`).join("") || `<div class="faint">기록 없음</div>`}</div>
    <div><div class="label">상담일지 <span class="faint">내담자 작성</span></div>${(d.counsel || []).slice(-3).reverse().map(x => `<div class="entry"><div class="d"><span>${x.date.replace(/-/g, ".")} · ${counselor(x.cid).name}</span><span>${"★".repeat(x.stars || 0)}</span></div>${esc(x.text || "")}</div>`).join("") || `<div class="faint">기록 없음</div>`}</div>
    <div><div class="label">채팅상담 기록 ${ICON.lock} <span class="faint">상담자만 열람 · 최근 30건</span></div>
      <div class="chatlog" style="margin-top:6px">${chat.length ? chat.map(m => `<div class="b ${m.role === "me" ? "me" : ""} ${m.role === "me" && /죽|자살|끝내|사라지|해치/.test(m.text) ? "flag" : ""}">${esc(m.text)}<div class="faint">${esc(m.ts || "")}</div></div>`).join("") : `<div class="faint">채팅 기록 없음</div>`}</div></div>
  </div>`;
}

/* SOAP 작성/수정 폼 */
function openSoapForm(id) {
  const u = cur(); if (!u) return; const r = A.results[u.uid] || [], x = id ? r.find(v => v.id === id) : null;
  const d = Object.assign(blankData(u.name), u.data || {}), last = d.diag[d.diag.length - 1], sub = last && subscales(last.answers);
  const hi = sub ? Object.entries(sub).sort((a, b) => b[1] / SUB[b[0]].max - a[1] / SUB[a[0]].max)[0][0] : null;
  const f = x || { no: r.length + 1, date: todayStr(), type: "화상", cid: d.lastCid || COUNSELORS[0].id, topic: hi ? SUB[hi].label + " 완화" : "", s: "", o: "", a: "", p: "", text: "" };
  modal(`<h3>${x ? x.no + "회차 기록 수정" : f.no + "회차 기록 작성"} <span class="faint">· ${esc(u.name)} ${u.no}</span></h3>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px">
      <div><div class="label">상담일</div><input id="f-date" class="inp" type="date" value="${f.date}"></div>
      <div><div class="label">방식</div><select id="f-type" class="inp">${["화상", "대면", "채팅"].map(t => `<option ${f.type === t ? "selected" : ""}>${t}</option>`).join("")}</select></div>
      <div><div class="label">상담자</div><select id="f-cid" class="inp">${COUNSELORS.map(c => `<option value="${c.id}" ${f.cid === c.id ? "selected" : ""}>${c.name} ${c.title}</option>`).join("")}</select></div>
      <div><div class="label">상담 주제 ${hi ? `<span class="faint">(후보: ${SUB[hi].label})</span>` : ""}</div><input id="f-topic" class="inp" value="${esc(f.topic)}"></div></div>
    <div class="soap">
      <div><div class="label">S · 주관적 호소</div><textarea id="f-s" class="inp" placeholder='"밤에 자주 깨고 꿈이 반복돼요"'>${esc(f.s)}</textarea></div>
      <div><div class="label">O · 객관적 관찰</div><textarea id="f-o" class="inp" placeholder="IES-R-K 22 → 27점, 침입 영역 상승">${esc(f.o)}</textarea></div>
      <div><div class="label">A · 평가</div><textarea id="f-a" class="inp" placeholder="수면양상 장애 지속, 침입 증상 악화">${esc(f.a)}</textarea></div>
      <div><div class="label">P · 계획</div><textarea id="f-p" class="inp" placeholder="수면 위생 교육, 소리 안정화 콘텐츠 권장">${esc(f.p)}</textarea></div></div>
    <div><div class="label">${ICON.eye} 내담자 공개용 코멘트 <span class="faint">앱에 전달됨 · 진단명·점수 구간 이름은 쓰지 않음 · 부드러운 존댓말</span></div><textarea id="f-pub" class="inp" style="min-height:80px" placeholder="요즘 잠드는 게 많이 힘드셨을 것 같아요. 오늘 이야기한 수면 습관을 이번 주에 한 가지만 해 보고, 다음 상담에서 함께 확인해요.">${esc(f.text)}</textarea></div>
    <div style="display:flex;justify-content:flex-end;gap:8px"><button class="btn outline" onclick="closeModal()">취소</button><button class="btn primary" onclick="saveSoap('${id || ""}')">저장</button></div>`);
}
async function saveSoap(id) {
  const u = cur(); const v = k => $(k).value.trim();
  const rec = { date: $("#f-date").value, type: v("#f-type"), cid: v("#f-cid"), topic: v("#f-topic"), s: v("#f-s"), o: v("#f-o"), a: v("#f-a"), p: v("#f-p"), text: v("#f-pub") };
  if (!rec.text && !rec.s && !rec.a) return toast("내용을 입력해 주세요");
  try {
    const ref = Cloud.db.collection("users").doc(u.uid).collection("results");
    if (id) { const old = (A.results[u.uid] || []).find(x => x.id === id); const history = [...(old.history || []), { at: new Date().toISOString(), by: A.email, prev: { s: old.s, o: old.o, a: old.a, p: old.p, text: old.text, topic: old.topic } }]; await ref.doc(id).set({ ...rec, history, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true }); }
    else { const no = (A.results[u.uid] || []).length + 1; await ref.add({ ...rec, no, createdAt: firebase.firestore.FieldValue.serverTimestamp(), by: A.email }); }
    closeModal(); toast("저장되었습니다 · 공개용 코멘트가 앱에 전달됩니다"); A.tab = "comments"; await loadDetail(u.uid);
  } catch (e) { toast(Cloud.msg(e)); }
}

/* SchedulePanel */
function allAppts() { const out = []; (A.users || []).forEach(u => ((u.data && u.data.appts) || []).forEach(a => out.push({ ...a, uid: u.uid, name: u.name, sessionNo: (A.results[u.uid] || []).length + 1 }))); return out; }
/* 상담 주제 후보: 최근 자가진단에서 가장 높은 하위 영역 */
function topicHint(uid) { const u = (A.users || []).find(x => x.uid === uid); const dg = u?.data?.diag || []; const s = dg.length && subscales(dg[dg.length - 1].answers); if (!s) return ""; const k = Object.entries(s).sort((a, b) => b[1] / SUB[b[0]].max - a[1] / SUB[a[0]].max)[0][0]; return SUB[k].label; }
function effAppt(a) { const ap = (A.approvals[a.uid] || {})[a.id]; return ap && ap.date ? { ...a, date: ap.date, time: ap.time || a.time, changed: true } : a; }
function apptRow(a, isNext) {
  const ap = (A.approvals[a.uid] || {})[a.id], e = effAppt(a), done = a.status === "done" || (a.date < todayStr());
  const last = (A.results[a.uid] || []).find(r => r.date === a.date);
  const hint = topicHint(a.uid);
  return `<div class="srow ${isNext ? "next" : ""}"><span class="t">${fmtT(e.time)}</span><div><b>${esc(a.name)} · ${last ? last.no : a.sessionNo}회차</b>
    <div class="faint">${a.type}${done ? " · 완료" : last && last.topic ? ` · 주제: ${esc(last.topic)}` : hint ? ` · 주제 후보 <b>${hint}</b>` : ""}${e.changed ? " · 변경됨" : ""}</div>
    ${done ? "" : `<div class="acts">${ap?.status === "confirmed" || ap?.date ? '<span class="chip">승인</span>' : `<button class="btn primary sm" onclick="approve('${a.uid}','${a.id}')">승인</button>`}<button class="btn outline sm" onclick="openChange('${a.uid}','${a.id}')">변경</button>${!(ap?.status === "confirmed" || ap?.date) ? '<span class="chip gray">승인 대기</span>' : ""}${isNext ? `<button class="btn primary sm" onclick="selectUser('${a.uid}');A.tab='comments';render()">${ICON.play} 상담 시작</button>` : ""}</div>`}</div></div>`;
}
function schedulePanel() {
  const t = todayStr(), all = allAppts().map(effAppt), mon = addDays(t, -((parse(t).getDay() + 6) % 7));
  const days = Array.from({ length: 7 }, (_, i) => addDays(mon, i));
  const todays = all.filter(a => a.date === t).sort((a, b) => toMin(a.time) - toMin(b.time));
  const nowM = new Date().getHours() * 60 + new Date().getMinutes();
  const next = todays.find(a => a.status === "booked" && toMin(a.time) + 60 >= nowM) || null;
  const u = cur(), mine = u ? (u.data?.appts || []).map(a => effAppt({ ...a, uid: u.uid, name: u.name, sessionNo: (A.results[u.uid] || []).length + 1 })).filter(a => a.status === "booked" && a.date > t).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))[0] : null;
  return `<div class="panel"><div class="panel-h"><span class="h2">일정 관리</span><div class="seg">${[["day", "일"], ["week", "주"], ["month", "월"]].map(([k, l]) => `<button class="${A.schedMode === k ? "on" : ""}" onclick="A.schedMode='${k}';A.view='schedule';render()">${l}</button>`).join("")}</div></div>
    <div class="sm" style="font-weight:600">${t.slice(0, 7).replace("-", ".")} · 오늘 ${md(t)} (${"일월화수목금토"[parse(t).getDay()]})</div>
    <div class="week">${days.map(ds => `<div><div class="d">${"월화수목금토일"[days.indexOf(ds)]}</div><div class="n ${ds === t ? "today" : ""}">${+ds.slice(8)}${all.some(a => a.date === ds && a.status === "booked") ? '<span class="dot"></span>' : ""}</div></div>`).join("")}</div>
    ${todays.length ? todays.map(a => apptRow(a, a === next)).join("") : `<div class="faint" style="padding:8px 0">오늘 예약이 없습니다</div>`}
    ${mine ? `<div class="label" style="margin-top:8px">${esc(u.name)} 다음 예약 · ${md(mine.date)} (D-${daysBetween(t, mine.date)})</div>${apptRow(mine, false)}` : ""}
    <button class="btn ghost sm" style="margin-top:6px" onclick="openAvail()">상담 가능 시간 열기·닫기</button>
    <button class="btn ghost sm" style="margin-top:2px" onclick="A.view='schedule';render()">전체 일정 보기 ›</button></div>`;
}
/* 예약 변경: approvals/{apptId}에 새 일시 저장 → 내담자 앱이 읽어 반영 */
function openChange(uid, apptId) {
  const u = (A.users || []).find(x => x.uid === uid), a = (u?.data?.appts || []).find(x => x.id === apptId); if (!a) return;
  const e = effAppt({ ...a, uid });
  modal(`<h3>예약 변경 · ${esc(u.name)} ${u.no}</h3><div class="faint">현재 ${a.date.replace(/-/g, ".")} ${fmtT(a.time)} · ${a.type}${e.changed ? ` (변경됨: ${e.date.replace(/-/g, ".")} ${fmtT(e.time)})` : ""}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><div><div class="label">새 날짜</div><input id="c-date" class="inp" type="date" value="${e.date}"></div>
    <div><div class="label">새 시간</div><select id="c-time" class="inp">${[...TIME_SLOTS["오전"], ...TIME_SLOTS["오후"]].map(s => `<option value="${s}" ${s === e.time ? "selected" : ""}>${fmtT(s)}</option>`).join("")}</select></div></div>
    <div class="faint">저장하면 승인 처리와 함께 내담자 앱의 예약 일시가 바뀝니다. 알림 발송은 푸시 서버 연동 후 제공됩니다.</div>
    <div style="display:flex;justify-content:flex-end;gap:8px"><button class="btn outline" onclick="closeModal()">취소</button><button class="btn danger sm" onclick="cancelAppt('${uid}','${apptId}')">예약 취소</button><button class="btn primary" onclick="saveChange('${uid}','${apptId}')">변경 저장</button></div>`);
}
async function saveChange(uid, apptId) {
  const date = $("#c-date").value, time = $("#c-time").value; if (!date) return toast("날짜를 선택해 주세요");
  try { await Cloud.db.collection("users").doc(uid).collection("approvals").doc(apptId).set({ status: "confirmed", date, time, by: A.email, at: new Date().toISOString() }, { merge: true }); (A.approvals[uid] = A.approvals[uid] || {})[apptId] = { status: "confirmed", date, time }; closeModal(); toast("예약을 변경했습니다"); render(); } catch (e) { toast(Cloud.msg(e)); }
}
async function cancelAppt(uid, apptId) {
  try { await Cloud.db.collection("users").doc(uid).collection("approvals").doc(apptId).set({ status: "cancelled", by: A.email, at: new Date().toISOString() }, { merge: true }); (A.approvals[uid] = A.approvals[uid] || {})[apptId] = { status: "cancelled" }; closeModal(); toast("예약을 취소 처리했습니다"); render(); } catch (e) { toast(Cloud.msg(e)); }
}
/* 상담 가능 시간 (admins/{email} 문서에 저장) */
async function openAvail() {
  if (!A.avail) { try { const s = await Cloud.db.collection("admins").doc(A.email).get(); A.avail = (s.exists && s.data().avail) || { days: [1, 2, 3, 4, 5], start: "9:00", end: "6:00", open: true }; } catch (e) { A.avail = { days: [1, 2, 3, 4, 5], start: "9:00", end: "6:00", open: true }; } }
  const v = A.avail, slots = [...TIME_SLOTS["오전"], ...TIME_SLOTS["오후"]];
  modal(`<h3>상담 가능 시간</h3>
    <label class="sm" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="av-open" ${v.open ? "checked" : ""}> 예약 받기 (끄면 '닫힘' 상태로 표시)</label>
    <div class="label">요일</div><div class="chips">${["일", "월", "화", "수", "목", "금", "토"].map((d, i) => `<button class="${v.days.includes(i) ? "on" : ""}" onclick="this.classList.toggle('on')" data-d="${i}">${d}</button>`).join("")}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><div><div class="label">시작</div><select id="av-s" class="inp">${slots.map(s => `<option value="${s}" ${s === v.start ? "selected" : ""}>${fmtT(s)}</option>`).join("")}</select></div><div><div class="label">종료</div><select id="av-e" class="inp">${slots.map(s => `<option value="${s}" ${s === v.end ? "selected" : ""}>${fmtT(s)}</option>`).join("")}</select></div></div>
    <div style="display:flex;justify-content:flex-end;gap:8px"><button class="btn outline" onclick="closeModal()">취소</button><button class="btn primary" onclick="saveAvail()">저장</button></div>`);
}
async function saveAvail() {
  const avail = { open: $("#av-open").checked, days: [...document.querySelectorAll(".modal .chips button.on")].map(b => +b.dataset.d), start: $("#av-s").value, end: $("#av-e").value };
  try { await Cloud.db.collection("admins").doc(A.email).set({ avail }, { merge: true }); A.avail = avail; closeModal(); toast(avail.open ? "상담 가능 시간을 저장했습니다" : "예약 받기를 닫았습니다"); } catch (e) { toast(Cloud.msg(e)); }
}
function showNotis() {
  const risky = (A.users || []).filter(u => signals(u).some(s => s.lv === "h"));
  const pend = allAppts().filter(a => a.status === "booked" && a.date >= todayStr() && !(A.approvals[a.uid] || {})[a.id]);
  modal(`<h3>알림</h3>${risky.map(u => `<div class="srow" style="grid-template-columns:1fr"><div><span class="risk h">▲</span> <b>${esc(u.name)}</b> · ${esc(signals(u).filter(s => s.lv === "h").map(s => s.t).join(", "))} <button class="btn ghost sm" onclick="closeModal();A.view='clients';selectUser('${u.uid}')">열기</button></div></div>`).join("")}
    ${pend.map(a => `<div class="srow" style="grid-template-columns:1fr"><div><span class="chip gray">승인 대기</span> <b>${esc(a.name)}</b> · ${a.date.replace(/-/g, ".")} ${fmtT(a.time)} · ${a.type} <button class="btn primary sm" onclick="approve('${a.uid}','${a.id}');closeModal()">승인</button></div></div>`).join("")}
    ${!risky.length && !pend.length ? `<div class="empty">새 알림이 없습니다</div>` : ""}`);
}
async function approve(uid, apptId) { try { await Cloud.db.collection("users").doc(uid).collection("approvals").doc(apptId).set({ status: "confirmed", by: A.email, at: new Date().toISOString() }); (A.approvals[uid] = A.approvals[uid] || {})[apptId] = { status: "confirmed" }; toast("승인했습니다"); render(); } catch (e) { toast(Cloud.msg(e)); } }
function scheduleView() {
  const t = todayStr(), all = allAppts().filter(a => a.status === "booked").sort((a, b) => (a.date + pad(toMin(a.time))).localeCompare(b.date + pad(toMin(b.time))));
  const groups = {}; all.filter(a => a.date >= addDays(t, -7)).forEach(a => (groups[a.date] = groups[a.date] || []).push(a));
  return `<div class="center"><div class="panel"><div class="panel-h"><span class="h2">일정 · 앱에서 들어온 예약</span><span class="faint">승인·변경 시 내담자 앱 알림은 서버 알림 연동 후 제공</span></div>
    ${Object.keys(groups).sort().map(ds => `<div class="label" style="margin:12px 0 4px">${ds.replace(/-/g, ".")} (${"일월화수목금토"[parse(ds).getDay()]}) ${ds === t ? '<span class="chip">오늘</span>' : ""}</div>${groups[ds].map(a => { const ap = (A.approvals[a.uid] || {})[a.id]; return `<div class="srow"><span class="t">${fmtT(a.time)}</span><div><b>${esc(a.name)}</b> · ${a.sessionNo}회차 · ${a.type} · ${counselor(a.cid).name}<div class="acts">${ap?.status === "confirmed" || ap?.date ? '<span class="chip">승인</span>' : `<button class="btn primary sm" onclick="approve('${a.uid}','${a.id}')">승인</button><span class="chip gray">승인 대기</span>`}<button class="btn outline sm" onclick="openChange('${a.uid}','${a.id}')">변경</button><button class="btn outline sm" onclick="A.view='clients';selectUser('${a.uid}')">내담자 열기</button></div></div></div>`; }).join("")}`).join("") || `<div class="empty">예약이 없습니다</div>`}
  </div></div>`;
}

/* ClientMemo */
function memoPanel() {
  const u = cur(); if (!u) return "";
  const memos = [...(A.memos[u.uid] || [])].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  return `<div class="panel"><div class="panel-h"><span class="h2">내담자 메모</span><span class="faint">${ICON.lock} 상담자만 열람</span></div>
    ${memos.map(m => `<div class="memo ${m.pinned ? "pin" : ""}">${m.pinned ? ICON.pin + " " : ""}${esc(m.text)}<div class="m"><span>${m.pinned ? "고정 · " : ""}${(m.at || "").slice(5, 10).replace("-", "/")}</span><button onclick="memoPin('${m.id}',${!m.pinned})">${m.pinned ? "고정 해제" : "고정"}</button><button onclick="memoDel('${m.id}')">삭제</button></div></div>`).join("")}
    <input class="inp" placeholder="메모 추가… (Enter)" onkeydown="if(event.key==='Enter'){memoAdd(this.value);this.value=''}"></div>`;
}
async function memoAdd(text) { text = text.trim(); if (!text) return; const u = cur(); try { await Cloud.db.collection("users").doc(u.uid).collection("memos").add({ text, pinned: false, at: todayStr(), by: A.email, createdAt: firebase.firestore.FieldValue.serverTimestamp() }); await loadDetail(u.uid); } catch (e) { toast(Cloud.msg(e)); } }
async function memoPin(id, pinned) { const u = cur(); try { await Cloud.db.collection("users").doc(u.uid).collection("memos").doc(id).set({ pinned }, { merge: true }); await loadDetail(u.uid); } catch (e) { toast(Cloud.msg(e)); } }
async function memoDel(id) { const u = cur(); try { await Cloud.db.collection("users").doc(u.uid).collection("memos").doc(id).delete(); await loadDetail(u.uid); } catch (e) { toast(Cloud.msg(e)); } }

/* ── 통계 대시보드 ── */
function statsView() {
  const us = A.users || [], t = todayStr(), months = [];
  const nM = A.statRange === 1 ? 1 : A.statRange === 6 ? 6 : Math.max(6, (() => { const f = us.map(u => u.createdAt || t).sort()[0] || t; const a = parse(f), b = parse(t); return (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth() + 1; })());
  for (let i = nM - 1; i >= 0; i--) { const d = new Date(); d.setMonth(d.getMonth() - i, 1); months.push(ymd(d).slice(0, 7)); }
  const byLv = { l: 0, m: 0, h: 0 }; us.forEach(u => { const s = lastScore(u); if (s != null) byLv[risk(s).lv]++; });
  const scored = byLv.l + byLv.m + byLv.h;
  const newBy = months.map(m => us.filter(u => (u.createdAt || "").startsWith(m)).length), cum = []; newBy.reduce((a, b, i) => cum[i] = a + b, us.filter(u => (u.createdAt || "") < months[0]).length);
  const avgBy = months.map(m => { const v = []; us.forEach(u => (u.data?.diag || []).filter(x => x.date.startsWith(m)).forEach(x => v.push(x.score))); return v.length ? +(v.reduce((a, b) => a + b) / v.length).toFixed(1) : null; });
  const mon = addDays(t, -((parse(t).getDay() + 6) % 7)), sun = addDays(mon, 6);
  const wk = allAppts().filter(a => a.date >= mon && a.date <= sun), ages = { "20대": 0, "30대": 0, "40대": 0, "50대+": 0 }, agF = { ...ages }, agM = { ...ages };
  us.forEach(u => { const a = age(u.birth); if (a == null) return; const k = a < 30 ? "20대" : a < 40 ? "30대" : a < 50 ? "40대" : "50대+"; ages[k]++; if (u.gender === "여") agF[k]++; else if (u.gender === "남") agM[k]++; });
  const agesSvg = (() => { const W = 420, H = 150, keys = Object.keys(ages), n = keys.length, bw = (W - 40) / n, max = Math.max(1, ...Object.values(agF), ...Object.values(agM)); return `<svg class="chart" viewBox="0 0 ${W} ${H}">${keys.map((k, i) => { const x0 = 20 + i * bw; const b = (v, off, col) => { const h = (H - 40) * v / max; return `<rect x="${x0 + bw * off}" y="${H - 24 - h}" width="${bw * .22}" height="${h}" fill="${col}" rx="2"/><text x="${x0 + bw * off + bw * .11}" y="${H - 28 - h}" text-anchor="middle" font-size="10" fill="var(--ink)">${v}</text>`; }; return b(agF[k], .25, "var(--chart-intrusion)") + b(agM[k], .53, "var(--chart-avoidance)") + `<text x="${x0 + bw / 2}" y="${H - 8}" text-anchor="middle" font-size="10" fill="var(--ink-muted)">${k}</text>`; }).join("")}</svg>`; })();
  const r = 56, c = 2 * Math.PI * r; let off = 0; const seg = (n, col) => { const len = scored ? n / scored * c : 0; const s = `<circle cx="75" cy="75" r="${r}" fill="none" stroke="${col}" stroke-width="18" stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-off}" transform="rotate(-90 75 75)"/>`; off += len; return s; };
  const bars = (vals, col, max) => { const W = 420, H = 150, n = vals.length, bw = (W - 40) / n; return `<svg class="chart" viewBox="0 0 ${W} ${H}">${vals.map((v, i) => { const h = max ? (H - 40) * v / max : 0; return `<rect x="${20 + i * bw + bw * .3}" y="${H - 24 - h}" width="${bw * .4}" height="${h}" fill="${col}" rx="2"/><text x="${20 + i * bw + bw / 2}" y="${H - 28 - h}" text-anchor="middle" font-size="10" fill="var(--ink)">${v}</text><text x="${20 + i * bw + bw / 2}" y="${H - 8}" text-anchor="middle" font-size="10" fill="var(--ink-muted)">${months[i] ? +months[i].slice(5) + "월" : Object.keys(ages)[i]}</text>`; }).join("")}</svg>`; };
  const lineSvg = (vals, max, min = 0) => { const W = 420, H = 150, n = vals.length, X = i => 30 + i * (W - 50) / (n - 1), Y = v => 16 + (H - 46) * (1 - (v - min) / (max - min || 1)); let p = ""; vals.forEach((v, i) => { if (v == null) return; p += (p ? " L" : "M") + X(i) + "," + Y(v); }); return `<svg class="chart" viewBox="0 0 ${W} ${H}"><line x1="30" x2="${W - 20}" y1="${Y(SET.t1)}" y2="${Y(SET.t1)}" stroke="var(--ink-muted)" stroke-dasharray="3 3"/><text x="${W - 18}" y="${Y(SET.t1) + 3}" font-size="9" fill="var(--ink-muted)">${SET.t1}</text><path d="${p}" fill="none" stroke="var(--chart-total)" stroke-width="2"/>${vals.map((v, i) => v == null ? "" : `<path d="M${X(i)},${Y(v) - 5} L${X(i) + 5},${Y(v)} L${X(i)},${Y(v) + 5} L${X(i) - 5},${Y(v)}Z" fill="var(--risk-mid)"/><text x="${X(i)}" y="${H - 6}" text-anchor="middle" font-size="10" fill="var(--ink-muted)">${+months[i].slice(5)}월</text>`).join("")}</svg>`; };
  return `<div class="center"><div class="panel-h" style="margin:0"><div><span class="h2" style="font-size:18px">통계 대시보드</span> <span class="faint">${months[0].replace("-", ".")} – ${months[months.length - 1].replace("-", ".")}</span></div><div class="seg">${[[1, "1개월"], [6, "6개월"], [0, "전체"]].map(([k, l]) => `<button class="${A.statRange === k ? "on" : ""}" onclick="A.statRange=${k};render()">${l}</button>`).join("")}</div></div>
    <div class="stats-grid">
      <div class="panel stat"><div class="label">전체 내담자</div><div class="v">${us.length}<span class="sm muted"> 명</span></div><div class="faint">이번 달 신규 ${newBy[newBy.length - 1]}명</div></div>
      <div class="panel stat"><div class="label">상담 진행 중</div><div class="v">${us.filter(u => (u.data?.appts || []).length).length}<span class="sm muted"> 명</span></div><div class="faint">예약 대기 ${us.filter(u => nextAppt(u)).length}</div></div>
      <div class="panel stat hi"><div class="label">PTSD 추정·중증 (${SET.t2}+)</div><div class="v">${byLv.h}<span class="sm muted"> 명</span></div><div class="faint">치료연계 검토 대상</div></div>
      <div class="panel stat"><div class="label">이번 주 상담</div><div class="v">${wk.length}<span class="sm muted"> 건</span></div><div class="faint">화상 ${wk.filter(a => a.type === "화상").length} · 대면 ${wk.filter(a => a.type === "대면").length}</div></div></div>
    <div class="stats-row">
      <div class="panel"><div class="h2">IES-R-K 판정 구간 비율</div><div class="donut-wrap"><svg viewBox="0 0 150 150"><circle cx="75" cy="75" r="${r}" fill="none" stroke="var(--surface-300)" stroke-width="18"/>${seg(byLv.l, "var(--risk-low)")}${seg(byLv.m, "var(--risk-mid)")}${seg(byLv.h, "var(--risk-high)")}<text x="75" y="80" text-anchor="middle" font-size="24" font-weight="600" fill="var(--ink)">${scored}</text><text x="75" y="96" text-anchor="middle" font-size="10" fill="var(--ink-muted)">명</text></svg>
        <div class="dleg">${[["● 정상 범위", byLv.l, "var(--risk-low)"], ["◆ 임상적 관심", byLv.m, "var(--risk-mid-text)"], ["▲ PTSD 추정·중증", byLv.h, "var(--risk-high-text)"]].map(([l, n, col]) => `<div><span style="color:${col}">${l}</span><span class="mono">${n}명 · ${scored ? Math.round(n / scored * 100) : 0}%</span></div>`).join("")}</div></div></div>
      <div class="panel"><div class="panel-h"><span class="h2">월별 신규 · 누적 내담자</span><span class="legend-row"><span><i style="background:var(--brand)"></i>신규</span><span><i style="background:var(--chart-total);border-radius:50%"></i>누적</span></span></div>${(() => { const W = 420, H = 170, n = months.length, bw = (W - 50) / n, maxC = Math.max(1, ...cum), Y = v => 16 + (H - 50) * (1 - v / maxC); let line = ""; cum.forEach((v, i) => line += (i ? " L" : "M") + (25 + i * bw + bw / 2) + "," + Y(v)); return `<svg class="chart" viewBox="0 0 ${W} ${H}">${[0, .25, .5, .75, 1].map(f => `<line x1="25" x2="${W - 10}" y1="${Y(maxC * f)}" y2="${Y(maxC * f)}" stroke="var(--chart-grid)"/><text x="20" y="${Y(maxC * f) + 3}" text-anchor="end" font-size="9" fill="var(--ink-muted)">${Math.round(maxC * f)}</text>`).join("")}${newBy.map((v, i) => { const h = (H - 50) * v / maxC; return `<rect x="${25 + i * bw + bw * .35}" y="${Y(v)}" width="${bw * .3}" height="${h}" fill="var(--brand)" rx="2"/><text x="${25 + i * bw + bw / 2}" y="${H - 20}" text-anchor="middle" font-size="10" fill="var(--ink-muted)">${+months[i].slice(5)}월</text><text x="${25 + i * bw + bw / 2}" y="${H - 7}" text-anchor="middle" font-size="10" font-weight="600" fill="var(--ink)">신규 ${v}</text>`; }).join("")}<path d="${line}" fill="none" stroke="var(--chart-total)" stroke-width="2"/>${cum.map((v, i) => `<circle cx="${25 + i * bw + bw / 2}" cy="${Y(v)}" r="4" fill="var(--surface-200)" stroke="var(--chart-total)" stroke-width="2"/>`).join("")}<text x="${25 + (n - 1) * bw + bw / 2 - 8}" y="${Y(cum[n - 1] || 0) - 8}" text-anchor="end" font-size="10" font-weight="700" fill="var(--ink)">누적 ${cum[n - 1] || 0}</text></svg>`; })()}</div></div>
    <div class="stats-row2">
      <div class="panel"><div class="h2">IES-R-K 평균 점수 변화 <span class="faint">점선 ${SET.t1}점</span></div>${lineSvg(avgBy, Math.max(30, ...avgBy.filter(v => v != null)) + 4, 0)}</div>
      <div class="panel"><div class="panel-h"><span class="h2">연령 · 성별 분포</span><span class="legend-row"><span><i style="background:var(--chart-intrusion)"></i>여</span><span><i style="background:var(--chart-avoidance)"></i>남</span></span></div>${agesSvg}<div class="faint">성별 미선택 ${us.filter(u => age(u.birth) != null && !u.gender).length}명은 막대에서 제외</div></div></div>
  </div>`;
}

/* ── 채팅상담 관리 ── */
function chatsView() {
  const rows = (A.users || []).map(u => { const c = u.data?.chat || []; const last = c[c.length - 1]; return { u, c, last, flag: c.some(m => m.role === "me" && /죽|자살|끝내|사라지|해치/.test(m.text)) }; }).filter(r => r.c.length).sort((a, b) => (b.flag ? 1 : 0) - (a.flag ? 1 : 0));
  return `<div class="center"><div class="panel"><div class="panel-h"><span class="h2">채팅상담 · 위기 표현 감지</span><span class="faint">앱 채팅은 자동응답이며, 위기 표현이 감지된 내담자를 상단에 둡니다</span></div>
    ${rows.length ? rows.map(r => `<div class="srow" style="grid-template-columns:36px 1fr"><span class="avatar">${esc(r.u.name[0])}</span><div><b>${esc(r.u.name)}</b> <span class="faint">${r.u.no}</span> ${r.flag ? '<span class="risk h">▲ 채팅 위기 표현</span>' : ""}<div class="sm muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.last.text)}</div><div class="acts"><button class="btn outline sm" onclick="A.view='clients';A.tab='info';selectUser('${r.u.uid}')">기록 열기</button></div></div></div>`).join("") : `<div class="empty">채팅 기록이 있는 내담자가 없습니다</div>`}
  </div></div>`;
}

/* ── 설정 ── */
function settingsView() {
  return `<div class="center"><div class="panel" style="max-width:560px"><div class="h2">설정</div>
    <div class="faint" style="margin-bottom:12px">판정 기준은 배지와 그래프의 띠·점선에 바로 반영됩니다 (이 브라우저에 저장)</div>
    <div class="kv" style="grid-template-columns:160px 1fr;align-items:center;gap:10px">
      <span class="k">임상적 관심 기준</span><input id="s-t1" class="inp" type="number" value="${SET.t1}" style="width:100px">
      <span class="k">PTSD 추정 기준</span><input id="s-t2" class="inp" type="number" value="${SET.t2}" style="width:100px">
      <span class="k">중증 기준</span><input id="s-t3" class="inp" type="number" value="${SET.t3}" style="width:100px">
      <span class="k">표시 이름</span><input id="s-name" class="inp" value="${esc(SET.name)}" placeholder="이지원 상담사"></div>
    <div style="display:flex;gap:8px;margin-top:14px"><button class="btn primary" onclick="saveSet()">저장</button><button class="btn outline" onclick="SET.t1=24;SET.t2=33;SET.t3=37;saveSettings();render()">기본값(24 / 33 / 37)</button></div>
    <div class="faint" style="margin-top:16px">※ 기본값은 자가진단 문서 기준(0~23 정상 범위 / 24~32 임상적 관심 / 33~36 PTSD 추정 / 37+ 중증)이며 내담자 앱과 동일합니다. 여기서 바꾸면 관리자 화면에만 적용됩니다.</div>
  </div></div>`;
}
function saveSet() { const t1 = +$("#s-t1").value, t2 = +$("#s-t2").value, t3 = +$("#s-t3").value; if (!(t1 > 0 && t2 > t1 && t3 > t2)) return toast("기준 점수를 확인해 주세요"); SET.t1 = t1; SET.t2 = t2; SET.t3 = t3; SET.name = $("#s-name").value.trim(); saveSettings(); toast("저장되었습니다"); render(); }

/* ── 요약지 (인쇄) ── */
function printSummary() {
  const u = cur(); if (!u) return; const d = Object.assign(blankData(u.name), u.data || {}), r = A.results[u.uid] || [], last = d.diag[d.diag.length - 1], sub = last && subscales(last.answers);
  const w = window.open("", "_blank"); if (!w) return toast("팝업이 차단되었습니다");
  w.document.write(`<html><head><meta charset="utf-8"><title>요약지 ${esc(u.name)}</title><style>body{font-family:"IBM Plex Sans KR","Malgun Gothic",sans-serif;padding:32px;color:#222;font-size:13px;line-height:1.6}h1{font-size:20px}h2{font-size:14px;margin:18px 0 6px;border-bottom:1px solid #ccc}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px;text-align:left}</style></head><body>
    <h1>화로 상담 요약지 · ${esc(u.name)} <small>${u.no}</small></h1><div>생년월일 ${u.birth || "-"} · 소속 ${esc(u.unit || "-")} · 등록 ${u.createdAt || "-"} · 출력 ${todayStr()}</div>
    <h2>IES-R-K 최근 결과</h2>${last ? `총점 ${last.score}/88 (${risk(last.score).name}, ${last.date})${sub ? `<br>침입 ${sub.intrusion}/32 · 회피 ${sub.avoidance}/32 · 과각성 ${sub.hyper}/24` : ""}` : "기록 없음"}
    <h2>검사 이력</h2><table><tr><th>날짜</th><th>총점</th><th>판정</th></tr>${d.diag.map(x => `<tr><td>${x.date}</td><td>${x.score}</td><td>${risk(x.score).name}</td></tr>`).join("")}</table>
    <h2>간호진단 (NANDA-I)</h2>${(A.nursing[u.uid] || []).filter(x => x.status !== "resolved").map(x => `<p><b>${esc(x.label)}</b> <small>${x.code} · ${esc(x.en || "")}</small><br>관련 요인: ${esc((x.related || []).join(", ") || "-")}<br>증상·징후: ${esc((x.evidence || []).join(", ") || "-")}<br>목표: ${esc(x.goal || "-")}<br>계획: ${esc(x.plan || "-")}</p>`).join("") || "없음"}
    <h2>상담자 측정 기록 (최근 5건)</h2>${(A.vitals[u.uid] || []).slice(0, 5).map(v => `<p><b>${v.date}</b> · 수면 ${v.sleepH ?? "-"}시간 (질 ${v.sleepQ ?? "-"}/5) · 음주 ${v.alcohol ?? "-"}회/주 · 카페인 ${v.caffeine ?? "-"}잔/일 · 혈압 ${v.sbp || "-"}/${v.dbp || "-"} · 맥박 ${v.pulse || "-"}${v.meds ? ` · 복약 ${esc(v.meds)}` : ""}${v.obs ? `<br>관찰: ${esc(v.obs)}` : ""}</p>`).join("") || "없음"}
    <h2>회차별 기록</h2>${r.map(x => `<p><b>${x.no}회차 · ${x.date} · ${x.type}</b>${x.topic ? ` · 주제: ${esc(x.topic)}` : ""}<br>S: ${esc(x.s || "-")}<br>O: ${esc(x.o || "-")}<br>A: ${esc(x.a || "-")}<br>P: ${esc(x.p || "-")}<br>공개 코멘트: ${esc(x.text || "-")}</p>`).join("") || "없음"}
    <script>window.print()<\/script></body></html>`); w.document.close();
}

/* ═══════════════ 간호진단명 탭 (NANDA-I) ═══════════════
   users/{uid}/nursing/{id} = { code,label,en, related:[], evidence:[], goal, plan, status:"active"|"resolved", date, by }
   자동 제안은 IES-R-K 문항·하위영역·하루일지·채팅 신호에서 계산하고, 확정은 상담자가 한다. */
const NANDA = [
  { code: "00141", label: "외상 후 증후군", en: "Post-Trauma Syndrome", rel: ["외상성 사건에 대한 반복 노출", "심각한 사고·사상자 목격", "자신의 생명을 위협받는 상황", "동료 상실"], def: ["침습적 기억·플래시백", "악몽", "사건 회상 시 신체 반응", "과경계", "정서적 무감각", "사건 관련 자극 회피"] },
  { code: "00145", label: "외상 후 증후군 위험성", en: "Risk for Post-Trauma Syndrome", rel: ["외상 노출 직후 기간", "지지 체계 부족", "반복 출동", "이전 외상 경험"], def: [] },
  { code: "00146", label: "불안", en: "Anxiety", rel: ["상황적 위기", "스트레스 요인", "위협에 대한 지각", "미충족 욕구"], def: ["신경 예민·쉽게 놀람", "안절부절", "집중 곤란", "두근거림·발한", "걱정 호소"] },
  { code: "00148", label: "두려움", en: "Fear", rel: ["익숙하지 않은 상황", "위협 자극", "학습된 반응"], def: ["특정 상황 회피", "긴장 증가", "두려움 언어화"] },
  { code: "00198", label: "수면 양상 장애", en: "Disturbed Sleep Pattern", rel: ["교대 근무로 인한 수면 주기 변화", "야간 출동", "환경적 방해 요인", "불안"], def: ["잠들기 어려움", "자주 깸", "악몽으로 각성", "주간 피로", "수면 불만족"] },
  { code: "00095", label: "불면증", en: "Insomnia", rel: ["불안", "두려움", "카페인·음주", "불규칙한 수면 일정", "신체 불편감"], def: ["수면 개시 어려움 지속", "수면 유지 어려움", "이른 각성", "기능 저하 호소"] },
  { code: "00069", label: "비효과적 대처", en: "Ineffective Coping", rel: ["부적절한 지지 체계", "높은 수준의 위협", "휴식 부족", "대처 전략 부족"], def: ["문제 해결 능력 저하", "음주·회피로 대처", "도움 요청 못 함", "집중 곤란", "피로"] },
  { code: "00125", label: "무력감", en: "Powerlessness", rel: ["통제할 수 없는 사건", "반복되는 좌절", "낮은 자기효능감"], def: ["통제력 상실 표현", "수동성", "하루일지 기분 지속 저조", "의욕 저하"] },
  { code: "00053", label: "사회적 고립", en: "Social Isolation", rel: ["교대 근무로 인한 관계 단절", "사건 관련 이야기 회피", "정서적 무감각"], def: ["대인 접촉 회피", "혼자 있고 싶다는 표현", "사건 이야기 거부", "가족·동료와 거리감"] },
  { code: "00289", label: "자살행동 위험성", en: "Risk for Suicidal Behavior", rel: ["무망감", "외상 후 증상", "사회적 고립", "음주", "충동성"], def: [] },
  { code: "00301", label: "부적응적 비애", en: "Maladaptive Grieving", rel: ["동료·요구조자 사망", "애도 과정 방해", "지지 부족"], def: ["지속되는 슬픔", "죄책감", "일상 기능 저하", "사망 사건 반복 회상"] },
  { code: "00119", label: "만성 낮은 자존감", en: "Chronic Low Self-Esteem", rel: ["반복된 실패 경험", "구조 실패에 대한 자책", "부정적 피드백"], def: ["자기 비난", "자신의 역할 평가절하", "결정 주저"] },
  { code: "00093", label: "피로", en: "Fatigue", rel: ["수면 박탈", "교대 근무", "지속적 긴장", "불안"], def: ["에너지 부족 호소", "집중 곤란", "일상 활동 수행 저하", "졸림"] },
  { code: "00066", label: "영적 고뇌", en: "Spiritual Distress", rel: ["삶의 의미에 대한 혼란", "죽음 목격", "죄책감"], def: ["의미·목적에 대한 질문", "희망 상실 표현", "분노"] },
  { code: "00060", label: "가족 과정 중단", en: "Interrupted Family Processes", rel: ["교대 근무", "정서적 철수", "역할 변화"], def: ["가족과의 소통 감소", "가족 갈등 호소", "가정 내 역할 수행 어려움"] }
];
const nanda = code => NANDA.find(n => n.code === code);
// 문항 점수 조회 (1부터 시작하는 문항 번호)
const itemScore = (dg, i) => dg && dg.answers && dg.answers.length >= 22 ? (dg.answers[i - 1] || 0) : null;
const nightCount = (d, days) => { const from = addDays(todayStr(), -days); return Object.entries(d.schedule || {}).filter(([k, v]) => k >= from && k <= todayStr() && (v === "N" || v === "A")).length; };
function suggestNursing(u, d) {
  const dg = d.diag, last = dg[dg.length - 1]; if (!last) return [];
  const sub = subscales(last.answers), it = i => itemScore(last, i), out = [], add = (code, why, ev) => { const x = out.find(o => o.code === code); if (x) { if (why) x.why.push(why); if (ev) x.ev.push(...ev); } else out.push({ code, why: why ? [why] : [], ev: ev || [] }); };
  if (last.score >= SET.t2) add("00141", `IES-R-K ${last.score}점 · ${risk(last.score).name} 구간`, [it(14) >= 3 ? "침습적 기억·플래시백" : null, it(20) >= 3 ? "악몽" : null, it(19) >= 3 ? "사건 회상 시 신체 반응" : null, it(21) >= 3 ? "과경계" : null, it(13) >= 3 ? "정서적 무감각" : null].filter(Boolean));
  else if (last.score >= SET.t1) add("00145", `IES-R-K ${last.score}점 · 임상적 관심 구간`);
  if (sub && (sub.hyper / 24 >= .5 || it(4) >= 3 || it(10) >= 3)) add("00146", `과각성 ${sub.hyper}/24`, [it(10) >= 3 ? "신경 예민·쉽게 놀람" : null, it(18) >= 3 ? "집중 곤란" : null, it(19) >= 3 ? "두근거림·발한" : null].filter(Boolean));
  if (it(2) >= 3 && it(15) >= 3) add("00095", `수면 문항 2·15번 ${it(2)}·${it(15)}점`, ["수면 개시 어려움 지속", "수면 유지 어려움"]);
  else if (it(2) >= 2 || it(15) >= 2 || it(20) >= 3) add("00198", `수면 문항 ${[it(2) >= 2 ? "2번" : "", it(15) >= 2 ? "15번" : "", it(20) >= 3 ? "20번(꿈)" : ""].filter(Boolean).join("·")}`, [it(15) >= 2 ? "잠들기 어려움" : null, it(2) >= 2 ? "자주 깸" : null, it(20) >= 3 ? "악몽으로 각성" : null].filter(Boolean));
  if (nightCount(d, 30) >= 8) add("00198", `최근 30일 야간·당번 ${nightCount(d, 30)}회`);
  if (sub && sub.avoidance / 32 >= .5) add("00069", `회피 ${sub.avoidance}/32`, [it(17) >= 3 ? "회피로 대처" : null].filter(Boolean));
  if (it(8) >= 3 && it(22) >= 3) add("00053", "회피 문항 8·22번 높음", ["사건 이야기 거부", "대인 접촉 회피"]);
  if ((d.chat || []).filter(m => m.role === "me").slice(-10).some(m => /죽|자살|끝내|사라지|해치/.test(m.text))) add("00289", "채팅 위기 표현 감지");
  const dl = (d.daily || []).slice(-3); if (dl.length === 3 && dl.every(x => x.score < 40)) add("00125", "하루일지 3일 연속 40% 미만", ["하루일지 기분 지속 저조"]);
  if (it(18) >= 3 && (it(2) >= 2 || it(15) >= 2)) add("00093", "집중 곤란 + 수면 문항 높음", ["집중 곤란", "졸림"]);
  return out;
}
function nursingTab(u, d) {
  const list = A.nursing[u.uid] || [], active = list.filter(x => x.status !== "resolved"), done = list.filter(x => x.status === "resolved");
  const sug = suggestNursing(u, d).filter(s => !active.some(x => x.code === s.code));
  const chips = arr => arr.length ? arr.map(t => `<span class="chip gray">${esc(t)}</span>`).join(" ") : '<span class="faint">—</span>';
  const card = x => `<div class="ndx ${x.status === "resolved" ? "done" : ""}">
      <div class="ndx-h"><b>${esc(x.label)}</b><span class="faint mono">${x.code}</span><span class="faint">${esc(x.en || "")}</span>${x.status === "resolved" ? `<span class="chip gray">해결 ${md(x.resolvedAt || "")}</span>` : '<span class="chip">진행 중</span>'}<span class="sp"></span>
        <button class="btn ghost sm" onclick="openNursingForm('${x.id}')">수정</button>${x.status === "resolved" ? `<button class="btn ghost sm" onclick="nursingStatus('${x.id}','active')">다시 열기</button>` : `<button class="btn ghost sm" onclick="nursingStatus('${x.id}','resolved')">${ICON.check} 해결</button>`}<button class="btn ghost sm" style="color:var(--risk-high-text)" onclick="nursingDel('${x.id}')">${ICON.trash}</button></div>
      <div class="kv" style="grid-template-columns:84px 1fr;margin-top:6px"><span class="k">관련 요인</span><span>${chips(x.related || [])}</span><span class="k">증상·징후</span><span>${chips(x.evidence || [])}</span>${x.goal ? `<span class="k">목표</span><span>${esc(x.goal)}</span>` : ""}${x.plan ? `<span class="k">중재 계획</span><span style="white-space:pre-wrap">${esc(x.plan)}</span>` : ""}</div>
      <div class="hist">${x.date || ""} · ${esc(x.by || "")}${x.updatedAt ? " · 수정됨" : ""}</div></div>`;
  return `<div style="margin-top:14px;display:flex;flex-direction:column;gap:14px">
    <div class="panel-h" style="margin:0"><div><span class="h2">간호진단 <span class="faint">NANDA-I 기준 · 상담자가 확정</span></span></div><button class="btn primary sm" onclick="openNursingForm()">${ICON.plus} 진단 추가</button></div>
    ${sug.length ? `<div><div class="label" style="margin-bottom:6px">자동 제안 <span class="faint">자가진단 문항·하루일지·채팅에서 계산 · 눌러서 확정</span></div>
      <div class="sugs">${sug.map(s => { const n = nanda(s.code); return `<button class="sug" onclick="openNursingForm(null,'${s.code}')"><b>${n.label}</b><small>${esc(s.why.join(" · "))}</small></button>`; }).join("")}</div></div>` : `<div class="faint">${d.diag.length ? "현재 자동 제안할 진단이 없습니다" : "자가진단 기록이 생기면 여기에 진단 후보가 제안됩니다"}</div>`}
    <div><div class="label" style="margin-bottom:6px">확정된 진단 ${active.length}건</div>${active.map(card).join("") || `<div class="faint">아직 확정한 간호진단이 없습니다. 위 제안을 누르거나 "진단 추가"로 시작하세요.</div>`}</div>
    ${done.length ? `<details><summary class="label" style="cursor:pointer">해결된 진단 ${done.length}건</summary><div style="margin-top:8px">${done.map(card).join("")}</div></details>` : ""}
  </div>`;
}
function openNursingForm(id, code) {
  const u = cur(); if (!u) return; const d = Object.assign(blankData(u.name), u.data || {});
  const x = id ? (A.nursing[u.uid] || []).find(v => v.id === id) : null;
  const sg = !x && code ? suggestNursing(u, d).find(s => s.code === code) : null;
  const f = x || { code: code || NANDA[0].code, related: [], evidence: sg ? [...new Set(sg.ev)] : [], goal: "", plan: "", status: "active" };
  const n = nanda(f.code) || NANDA[0];
  const boxes = (name, cat, sel) => { const all = [...new Set([...cat, ...sel])]; return all.map(t => `<label class="chk"><input type="checkbox" name="${name}" value="${esc(t)}" ${sel.includes(t) ? "checked" : ""}> ${esc(t)}</label>`).join("") + `<input class="inp" style="margin-top:6px" placeholder="직접 입력 후 Enter (여러 개 가능)" onkeydown="if(event.key==='Enter'){event.preventDefault();const v=this.value.trim();if(v){this.insertAdjacentHTML('beforebegin','<label class=chk><input type=checkbox name=${name} checked value=\\''+v.replace(/'/g,'')+'\\'> '+v+'</label>');this.value=''}}">`; };
  modal(`<h3>${x ? "간호진단 수정" : "간호진단 추가"} <span class="faint">· ${esc(u.name)} ${u.no}</span></h3>
    <div><div class="label">진단명 (NANDA-I)</div><select id="n-code" class="inp" onchange="nursingPick(this.value)">${NANDA.map(v => `<option value="${v.code}" ${v.code === f.code ? "selected" : ""}>${v.label} · ${v.en} (${v.code})</option>`).join("")}</select></div>
    ${sg && sg.why.length ? `<div class="advice m" style="margin-top:0"><b>제안 근거</b> · ${esc(sg.why.join(" · "))}</div>` : ""}
    <div id="n-body"><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div><div class="label">관련 요인 <span class="faint">r/t</span></div><div class="chks">${boxes("rel", n.rel, f.related || [])}</div></div>
      <div><div class="label">증상·징후 <span class="faint">a.e.b.${n.def.length ? "" : " · 위험 진단은 위험 요인만"}</span></div><div class="chks">${boxes("ev", n.def, f.evidence || [])}</div></div></div></div>
    <div><div class="label">목표 (기대 결과)</div><input id="n-goal" class="inp" value="${esc(f.goal)}" placeholder="4주 내 주 3회 이상 6시간 수면 유지"></div>
    <div><div class="label">중재 계획</div><textarea id="n-plan" class="inp" placeholder="수면 위생 교육, 취침 전 안정화 음성 2번 권장, 다음 회차 수면 문항 재확인">${esc(f.plan)}</textarea></div>
    <div style="display:flex;justify-content:flex-end;gap:8px"><button class="btn outline" onclick="closeModal()">취소</button><button class="btn primary" onclick="saveNursing('${id || ""}')">저장</button></div>`);
}
function nursingPick(code) { const n = nanda(code); const u = cur(), d = Object.assign(blankData(u.name), u.data || {}), sg = suggestNursing(u, d).find(s => s.code === code);
  const boxes = (name, cat, sel) => [...new Set([...cat, ...sel])].map(t => `<label class="chk"><input type="checkbox" name="${name}" value="${esc(t)}" ${sel.includes(t) ? "checked" : ""}> ${esc(t)}</label>`).join("") + `<input class="inp" style="margin-top:6px" placeholder="직접 입력 후 Enter" onkeydown="if(event.key==='Enter'){event.preventDefault();const v=this.value.trim();if(v){this.insertAdjacentHTML('beforebegin','<label class=chk><input type=checkbox name=${name} checked value=\\''+v.replace(/'/g,'')+'\\'> '+v+'</label>');this.value=''}}">`;
  $("#n-body").innerHTML = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div><div class="label">관련 요인 <span class="faint">r/t</span></div><div class="chks">${boxes("rel", n.rel, [])}</div></div><div><div class="label">증상·징후 <span class="faint">a.e.b.</span></div><div class="chks">${boxes("ev", n.def, sg ? [...new Set(sg.ev)] : [])}</div></div></div>`; }
async function saveNursing(id) {
  const u = cur(); const code = $("#n-code").value, n = nanda(code);
  const pick = name => [...document.querySelectorAll(`.modal input[name=${name}]:checked`)].map(i => i.value);
  const rec = { code, label: n.label, en: n.en, related: pick("rel"), evidence: pick("ev"), goal: $("#n-goal").value.trim(), plan: $("#n-plan").value.trim() };
  try {
    const ref = Cloud.db.collection("users").doc(u.uid).collection("nursing");
    if (id) await ref.doc(id).set({ ...rec, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
    else await ref.add({ ...rec, status: "active", date: todayStr(), by: A.email, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    closeModal(); toast("간호진단을 저장했습니다"); await loadDetail(u.uid);
  } catch (e) { toast(Cloud.msg(e)); }
}
async function nursingStatus(id, status) { const u = cur(); try { await Cloud.db.collection("users").doc(u.uid).collection("nursing").doc(id).set({ status, resolvedAt: status === "resolved" ? todayStr() : null }, { merge: true }); toast(status === "resolved" ? "해결 처리했습니다" : "다시 열었습니다"); await loadDetail(u.uid); } catch (e) { toast(Cloud.msg(e)); } }
async function nursingDel(id) { if (!confirm("이 간호진단을 삭제할까요?")) return; const u = cur(); try { await Cloud.db.collection("users").doc(u.uid).collection("nursing").doc(id).delete(); await loadDetail(u.uid); } catch (e) { toast(Cloud.msg(e)); } }

/* ═══════════════ 객관적 정보 탭 ═══════════════
   위: 앱에서 자동 수집된 지표 (자가진단 문항·하루일지·출석·근무·채팅)
   아래: 상담자 측정 기록 users/{uid}/vitals/{id} = { date, sleepH, sleepQ, alcohol, caffeine, sbp, dbp, pulse, meds, obs, by } */
const OBJ_ITEMS = [[2, "수면 지속 어려움"], [15, "잠들기 어려움"], [20, "사건 관련 꿈"], [10, "쉽게 놀람"], [21, "과경계"], [18, "집중 곤란"], [19, "신체 반응"], [4, "예민·분노"]];
function objectiveTab(u, d) {
  const t = todayStr(), dg = d.diag, last = dg[dg.length - 1], prev = dg[dg.length - 2];
  const avg = arr => arr.length ? Math.round(arr.reduce((a, b) => a + b.score, 0) / arr.length) : null;
  const dl7 = (d.daily || []).filter(x => x.date > addDays(t, -7)), dl14 = (d.daily || []).filter(x => x.date > addDays(t, -14) && x.date <= addDays(t, -7));
  const a7 = avg(dl7), a14 = avg(dl14);
  const appts = d.appts || [], done = appts.filter(a => a.status === "done" || (a.status === "booked" && a.date < t)).length, canc = appts.filter(a => a.status === "cancelled").length;
  const chat7 = (d.chat || []).filter(m => m.role === "me").length;
  const nights = nightCount(d, 30);
  const tile = (l, v, s, hi) => `<div class="otile ${hi ? "hi" : ""}"><div class="label">${l}</div><div class="v mono">${v}</div><div class="faint">${s}</div></div>`;
  const arrow = (a, b) => a == null || b == null ? "" : a > b ? `<span style="color:var(--risk-high-text)">↑${a - b}</span>` : a < b ? `<span style="color:var(--brand)">↓${b - a}</span>` : "→";
  const vitals = A.vitals[u.uid] || [];
  const sl = vitals.filter(v => v.sleepH != null).slice(0, 4), slAvg = sl.length ? (sl.reduce((a, v) => a + +v.sleepH, 0) / sl.length).toFixed(1) : null;
  return `<div style="margin-top:14px;display:flex;flex-direction:column;gap:16px">
    <div><div class="label" style="margin-bottom:6px">앱에서 수집된 지표 <span class="faint">자동 · 내담자 입력 기반</span></div>
      <div class="otiles">
        ${tile("IES-R-K 최근 총점", last ? last.score : "—", last ? `${md(last.date)} · ${prev ? arrow(last.score, prev.score) + " 직전 " + prev.score : "첫 검사"}` : "기록 없음", last && last.score >= SET.t2)}
        ${tile("하루일지 7일 평균", a7 != null ? a7 + "%" : "—", a7 != null ? `${dl7.length}일 작성 · ${a14 != null ? "전주 " + a14 + "% " + arrow(a7, a14) : "전주 기록 없음"}` : "최근 7일 기록 없음", a7 != null && a7 < 40)}
        ${tile("상담 출석", `${done}<span class="muted sm">/${appts.length}</span>`, `완료 ${done} · 취소 ${canc} · 예정 ${appts.filter(a => a.status === "booked" && a.date >= t).length}`)}
        ${tile("야간·당번 근무", nights + "<span class='muted sm'>회</span>", "최근 30일 근무표 기준", nights >= 10)}
        ${tile("채팅 메시지", chat7 + "<span class='muted sm'>건</span>", "누적 · 내담자 발화만", false)}
        ${tile("측정 수면시간", slAvg != null ? slAvg + "<span class='muted sm'>h</span>" : "—", slAvg != null ? `최근 ${sl.length}회 평균` : "아래 측정 기록에서 입력", slAvg != null && slAvg < 6)}
      </div></div>
    ${last && last.answers && last.answers.length >= 22 ? `<div><div class="label" style="margin-bottom:6px">수면·각성 관련 문항 <span class="faint">0~4점 · 3점 이상 강조</span></div>
      <table class="tbl"><tr><th>문항</th><th>내용</th><th>최근</th><th>직전</th><th>변화</th></tr>${OBJ_ITEMS.map(([i, l]) => { const a = itemScore(last, i), b = itemScore(prev, i); return `<tr><td class="mono">${i}</td><td>${l}</td><td class="mono ${a >= 3 ? "hi" : ""}">${a}</td><td class="mono">${b ?? "—"}</td><td>${arrow(a, b)}</td></tr>`; }).join("")}</table></div>` : ""}
    ${dg.length ? `<div><div class="label" style="margin-bottom:6px">자가진단 이력 <span class="faint">최근 8회</span></div>
      <table class="tbl"><tr><th>날짜</th><th>총점</th><th>침입</th><th>회피</th><th>과각성</th><th>판정</th></tr>${dg.slice(-8).reverse().map(x => { const s = subscales(x.answers); return `<tr><td class="mono">${x.date.replace(/-/g, ".")}</td><td class="mono"><b>${x.score}</b></td><td class="mono">${s ? s.intrusion : "—"}</td><td class="mono">${s ? s.avoidance : "—"}</td><td class="mono">${s ? s.hyper : "—"}</td><td>${badge(x.score)}</td></tr>`; }).join("")}</table></div>` : ""}
    <div><div class="panel-h" style="margin-bottom:6px"><span class="label">상담자 측정 기록 <span class="faint">${ICON.lock} 상담자만 열람</span></span><button class="btn primary sm" onclick="openVitalForm()">${ICON.plus} 측정 기록</button></div>
      ${vitals.length ? `<table class="tbl"><tr><th>날짜</th><th>수면</th><th>수면질</th><th>음주</th><th>카페인</th><th>혈압</th><th>맥박</th><th>복약</th><th>관찰</th><th></th></tr>${vitals.map(v => `<tr><td class="mono">${(v.date || "").slice(2).replace(/-/g, ".")}</td><td class="mono ${v.sleepH != null && v.sleepH < 6 ? "hi" : ""}">${v.sleepH ?? "—"}h</td><td class="mono">${v.sleepQ ? v.sleepQ + "/5" : "—"}</td><td class="mono ${v.alcohol >= 3 ? "hi" : ""}">${v.alcohol ?? "—"}</td><td class="mono">${v.caffeine ?? "—"}</td><td class="mono ${v.sbp >= 140 || v.dbp >= 90 ? "hi" : ""}">${v.sbp || "—"}/${v.dbp || "—"}</td><td class="mono">${v.pulse || "—"}</td><td>${esc(v.meds || "—")}</td><td style="white-space:pre-wrap;max-width:220px">${esc(v.obs || "")}</td><td><button class="btn ghost sm" onclick="vitalDel('${v.id}')">${ICON.trash}</button></td></tr>`).join("")}</table>`
        : `<div class="faint">아직 측정 기록이 없습니다. 상담 중 확인한 수면·음주·혈압 등을 남기면 추이로 볼 수 있습니다.</div>`}</div>
  </div>`;
}
function openVitalForm() {
  const u = cur(); if (!u) return;
  const num = (id, l, ph, step) => `<div><div class="label">${l}</div><input id="${id}" class="inp" type="number" step="${step || 1}" placeholder="${ph}"></div>`;
  modal(`<h3>측정 기록 <span class="faint">· ${esc(u.name)} ${u.no}</span></h3>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">
      <div><div class="label">날짜</div><input id="v-date" class="inp" type="date" value="${todayStr()}"></div>
      ${num("v-sleepH", "수면 시간(h)", "6.5", .5)}
      <div><div class="label">수면의 질</div><select id="v-sleepQ" class="inp"><option value="">—</option>${[1, 2, 3, 4, 5].map(n => `<option value="${n}">${n} ${["매우 나쁨", "나쁨", "보통", "좋음", "매우 좋음"][n - 1]}</option>`).join("")}</select></div>
      ${num("v-alcohol", "음주(회/주)", "0")}
      ${num("v-caffeine", "카페인(잔/일)", "2")}
      ${num("v-sbp", "수축기 혈압", "120")}${num("v-dbp", "이완기 혈압", "80")}${num("v-pulse", "맥박", "72")}</div>
    <div><div class="label">복약</div><input id="v-meds" class="inp" placeholder="졸피뎀 10mg 취침 전 / 없음"></div>
    <div><div class="label">관찰 소견 <span class="faint">외모·행동·정서 등</span></div><textarea id="v-obs" class="inp" placeholder="눈 밑 다크서클, 말 느리고 시선 회피, 손 떨림 없음"></textarea></div>
    <div style="display:flex;justify-content:flex-end;gap:8px"><button class="btn outline" onclick="closeModal()">취소</button><button class="btn primary" onclick="saveVital()">저장</button></div>`);
}
async function saveVital() {
  const u = cur(); const n = id => { const v = $(id).value; return v === "" ? null : +v; };
  const rec = { date: $("#v-date").value, sleepH: n("#v-sleepH"), sleepQ: n("#v-sleepQ"), alcohol: n("#v-alcohol"), caffeine: n("#v-caffeine"), sbp: n("#v-sbp"), dbp: n("#v-dbp"), pulse: n("#v-pulse"), meds: $("#v-meds").value.trim(), obs: $("#v-obs").value.trim(), by: A.email };
  if (!rec.date) return toast("날짜를 입력해 주세요");
  if (Object.values(rec).every(v => v == null || v === "" || v === rec.date || v === A.email)) return toast("측정값을 하나 이상 입력해 주세요");
  try { await Cloud.db.collection("users").doc(u.uid).collection("vitals").add({ ...rec, createdAt: firebase.firestore.FieldValue.serverTimestamp() }); closeModal(); toast("측정 기록을 저장했습니다"); await loadDetail(u.uid); } catch (e) { toast(Cloud.msg(e)); }
}
async function vitalDel(id) { if (!confirm("이 측정 기록을 삭제할까요?")) return; const u = cur(); try { await Cloud.db.collection("users").doc(u.uid).collection("vitals").doc(id).delete(); await loadDetail(u.uid); } catch (e) { toast(Cloud.msg(e)); } }

/* ═══════════════ 콘텐츠 관리 ═══════════════
   content/app 한 문서. 내담자 앱은 로그인 후 읽어 data.js 기본값을 덮어쓴다 (빈 목록이면 기본값 유지). */
const CSEC = {
  videos: { label: "안정화 영상", cols: [["id", "유튜브 ID", "0akeNdOuwLE"], ["title", "제목", "안정화 영상 1"], ["desc", "설명", "순서대로 따라 보세요"]], hint: "유튜브 주소의 v= 뒤 11자리를 넣습니다. 앱에는 순서대로 번호가 붙습니다." },
  hospitals: { label: "연계 병원", cols: [["name", "병원명", "○○ 병원"], ["addr", "주소", "충북 청주시 …"], ["tel", "전화", "043-000-0000"]], hint: "앱 정보 → 치료연계에 그대로 표시됩니다." },
  helplines: { label: "긴급 상담 전화", cols: [["name", "이름", "정신건강 위기상담전화"], ["tel", "번호", "1577-0199"], ["desc", "설명", "24시간"]], hint: "치료연계 화면 맨 위 빨간 칸에 표시됩니다." },
  counselors: { label: "상담사", cols: [["id", "ID (변경 금지)", "kang"], ["name", "이름", "강○○"], ["title", "직함", "선생님"], ["phone", "연락처", "043-000-0000"], ["spec", "전문 분야", "외상 후 스트레스"], ["career", "경력", "임상심리전문가"], ["intro", "소개", "…"]], hint: "ID는 예약 기록과 연결되므로 기존 상담사의 ID는 바꾸지 마세요. 새 상담사는 영문 ID를 새로 정합니다." },
  notice: { label: "앱 공지" }
};
function normContent(c) { const o = JSON.parse(JSON.stringify(DEF_CONTENT)); if (!c) return o; for (const k of ["videos", "hospitals", "helplines", "counselors"]) if (Array.isArray(c[k])) o[k] = c[k].map(x => ({ ...x })); if (c.notice) o.notice = { on: !!c.notice.on, text: c.notice.text || "" }; return o; }
function contentView() {
  if (!A.content) A.content = normContent(null);
  const k = A.ctab, c = A.content, sec = CSEC[k];
  let body;
  if (k === "notice") body = `<label class="sm" style="display:flex;gap:8px;align-items:center"><input type="checkbox" ${c.notice.on ? "checked" : ""} onchange="A.content.notice.on=this.checked"> 앱 홈 화면에 공지 표시</label>
    <textarea class="inp" style="min-height:120px;margin-top:8px" placeholder="예) 10월 셋째 주 상담은 센터 사정으로 화상만 진행합니다." oninput="A.content.notice.text=this.value">${esc(c.notice.text)}</textarea>
    <div class="faint" style="margin-top:6px">내담자 앱 홈 화면 맨 위 카드에 표시됩니다. 끄면 사라집니다.</div>`;
  else {
    const rows = c[k];
    body = `<div class="faint" style="margin-bottom:8px">${sec.hint}</div>
      <table class="tbl edit"><tr><th style="width:28px">#</th>${sec.cols.map(([, l]) => `<th>${l}</th>`).join("")}<th style="width:70px"></th></tr>
      ${rows.map((r, i) => `<tr><td class="mono">${i + 1}</td>${sec.cols.map(([f, , ph]) => `<td>${f === "intro" || f === "desc" ? `<textarea class="inp" rows="2" placeholder="${esc(ph)}" oninput="A.content.${k}[${i}].${f}=this.value">${esc(r[f] || "")}</textarea>` : `<input class="inp" placeholder="${esc(ph)}" value="${esc(r[f] || "")}" oninput="A.content.${k}[${i}].${f}=this.value">`}</td>`).join("")}
        <td style="white-space:nowrap"><button class="btn ghost sm" title="위로" ${i === 0 ? "disabled" : ""} onclick="contentMove('${k}',${i},-1)">↑</button><button class="btn ghost sm" title="아래로" ${i === rows.length - 1 ? "disabled" : ""} onclick="contentMove('${k}',${i},1)">↓</button><button class="btn ghost sm" style="color:var(--risk-high-text)" onclick="contentDel('${k}',${i})">${ICON.trash}</button></td></tr>`).join("")}</table>
      ${!rows.length ? `<div class="faint" style="padding:8px 0">목록이 비어 있으면 앱은 기본값(data.js)을 보여줍니다.</div>` : ""}
      <div style="display:flex;gap:8px;margin-top:8px"><button class="btn outline sm" onclick="contentAdd('${k}')">${ICON.plus} 행 추가</button><button class="btn ghost sm" onclick="contentReset('${k}')">기본값으로 되돌리기</button></div>`;
  }
  return `<div class="center"><div class="panel-h" style="margin:0"><div><span class="h2" style="font-size:18px">콘텐츠 관리</span> <span class="faint">내담자 앱의 영상·병원·전화·상담사·공지를 여기서 바꿉니다</span></div><button class="btn primary" onclick="saveContentAll()">${ICON.check} 앱에 저장</button></div>
    <div class="panel"><div class="tabs" style="margin:0 0 12px">${Object.entries(CSEC).map(([key, s]) => `<button class="${A.ctab === key ? "on" : ""}" onclick="A.ctab='${key}';render()">${s.label}${key !== "notice" ? ` <span class="faint">${c[key].length}</span>` : c.notice.on ? ' <span class="chip">켜짐</span>' : ""}</button>`).join("")}</div>${body}</div>
    <div class="faint">저장하면 내담자가 다음에 앱을 열 때(로그인 상태 포함) 바로 반영됩니다. 사진·로고 파일 교체는 앱 재빌드가 필요합니다.</div></div>`;
}
function contentAdd(k) { const o = {}; CSEC[k].cols.forEach(([f]) => o[f] = ""); if (k === "counselors") o.id = "c" + Date.now().toString(36).slice(-4); A.content[k].push(o); render(); }
function contentDel(k, i) { A.content[k].splice(i, 1); render(); }
function contentMove(k, i, dir) { const a = A.content[k], j = i + dir; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; render(); }
function contentReset(k) { if (!confirm(`${CSEC[k].label} 목록을 기본값으로 되돌릴까요? (저장 전까지는 앱에 반영되지 않습니다)`)) return; A.content[k] = JSON.parse(JSON.stringify(DEF_CONTENT[k])); render(); }
async function saveContentAll() {
  const c = normContent(A.content);
  for (const k of ["videos", "hospitals", "helplines", "counselors"]) c[k] = c[k].filter(r => Object.values(r).some(v => String(v || "").trim()));
  const bad = c.videos.find(v => !/^[\w-]{11}$/.test((v.id || "").trim())); if (bad) return toast(`영상 ID 형식 확인: "${bad.id}" (11자리)`);
  if (c.counselors.some(x => !x.id || !x.name)) return toast("상담사는 ID와 이름이 필요합니다");
  const ids = c.counselors.map(x => x.id); if (new Set(ids).size !== ids.length) return toast("상담사 ID가 중복됩니다");
  try { await Cloud.saveContent(c, A.email); Cloud.applyContent(c); A.content = normContent(c); toast("앱에 저장했습니다"); render(); } catch (e) { toast(Cloud.msg(e)); }
}

/* ── 시작 ── */
(function boot() {
  if (!Cloud.init()) { render(); return; }
  Cloud.auth.onAuthStateChanged(async user => {
    if (user && !Cloud.isClient(user) && await Cloud.isAdmin(user.email)) { A.email = user.email; render(); loadUsers(); }
    else { if (user && Cloud.isClient(user)) { /* 내담자 세션은 건드리지 않음 */ } A.email = null; render(); }
  });
})();

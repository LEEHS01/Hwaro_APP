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
let A = { email: null, users: null, sel: null, tab: "ptsd", view: "clients", q: "", filter: "all", results: {}, memos: {}, approvals: {}, chartMode: "total", chartRange: "3m", dailyOverlay: false, schedMode: "week", busy: false };

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
  app.innerHTML = shell(clientList() + `<div class="center">${centerView()}</div><div class="right">${schedulePanel()}${memoPanel()}</div>`);
}
function shell(inner, wide) {
  const alerts = (A.users || []).filter(u => signals(u).some(s => s.lv === "h")).length;
  const nav = [["clients", "내담자", ICON.users], ["schedule", "일정", ICON.cal], ["chats", "채팅상담", ICON.chat, alerts], ["stats", "통계", ICON.stats], ["settings", "설정", ICON.cog]];
  return `<div class="shell">
    <div class="topbar"><span class="wordmark">화로</span><span class="chip">관리자</span><span class="sp"></span>
      <span class="avatar">${esc((SET.name || A.email)[0])}</span><span class="sm">${esc(SET.name || A.email)}</span>
      <button class="btn outline sm" onclick="doLogout()">⎋ 로그아웃</button></div>
    <div class="main ${wide ? "wide" : ""}">
      <nav class="rail">${nav.map(([v, l, ic, n]) => `<button class="${A.view === v ? "on" : ""}" onclick="A.view='${v}';render()">${ic}<span>${l}</span>${n ? `<span class="badge">${n}</span>` : ""}</button>`).join("")}</nav>
      ${inner}</div></div>`;
}
const ICON = {
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-5-6.3"/></svg>',
  cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H9l-5 4z"/></svg>',
  stats: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  cog: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  lock: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  eye: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  pin: '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M14 2l8 8-4 1-3 3 1 6-3-3-6 6-1-1 6-6-3-3 6 1 3-3z"/></svg>'
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
  try { A.users = await Cloud.listUsers(); if (!A.sel && A.users.length) A.sel = sortedUsers()[0]?.uid; render(); if (A.sel) loadDetail(A.sel); }
  catch (e) { A.users = []; render(); toast(Cloud.msg(e)); }
}
async function loadDetail(uid) {
  try {
    const [r, m, ap] = await Promise.all([Cloud.loadResults(uid), Cloud.db.collection("users").doc(uid).collection("memos").orderBy("createdAt", "desc").get().then(q => q.docs.map(d => ({ id: d.id, ...d.data() }))).catch(() => []),
      Cloud.db.collection("users").doc(uid).collection("approvals").get().then(q => Object.fromEntries(q.docs.map(d => [d.id, d.data()]))).catch(() => ({}))]);
    A.results[uid] = r; A.memos[uid] = m; A.approvals[uid] = ap; if (A.sel === uid) render();
  } catch (e) { toast(Cloud.msg(e)); }
}
function selectUser(uid) { A.sel = uid; A.tab = A.tab || "ptsd"; render(); if (!A.results[uid]) loadDetail(uid); }
const cur = () => (A.users || []).find(u => u.uid === A.sel);

/* ── ClientList ── */
function sortedUsers() {
  const q = A.q.trim();
  let list = (A.users || []).filter(u => !q || (u.name || "").includes(q) || (u.no || "").includes(q));
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
      <span><div class="nm">${esc(u.name)}<small>${age(u.birth) != null ? age(u.birth) + "세" : ""}</small> ${sc != null ? badge(sc) : ""}</div>
        <div class="meta">최근 ${ls ? md(ls) : "—"} · 다음 ${nx ? md(nx.date) : "미정"} ${nx && !(A.approvals[u.uid] || {})[nx.id] ? '<span class="chip gray">승인 대기</span>' : ""}</div>
        ${s.length ? `<div class="sig ${s[0].lv}">↑ ${esc(s[0].t)}</div>` : ""}</span>
      <span class="sc">${sc ?? ""}</span></button>`; };
  const cnt = { all: all.length, booked: all.filter(u => nextAppt(u)).length, active: all.filter(u => (u.data?.appts || []).length).length };
  return `<div class="col clist">
    <div class="tools">
      <input class="inp" placeholder="🔍 이름 · 등록번호 검색" value="${esc(A.q)}" oninput="A.q=this.value;render()">
      <div class="chips">${[["all", `전체 ${cnt.all}`], ["booked", `예약 대기 ${cnt.booked}`], ["active", `상담 중 ${cnt.active}`], ["done", "종결"]].map(([k, l]) => `<button class="${A.filter === k ? "on" : ""}" onclick="A.filter='${k}';render()">${l}</button>`).join("")}</div>
      <div class="faint" style="display:flex;justify-content:space-between"><span>담당 상담자 · 전체</span><span>위험도 순</span></div>
    </div>
    ${risky.length ? `<div class="sect">⚑ 위험 신호 · 상단 고정</div>${risky.map(row).join("")}` : ""}
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
      <div><h1>${esc(u.name)} ${sc != null ? badge(sc) : ""}</h1><div class="sm muted">${age(u.birth) != null ? age(u.birth) + "세 · " : ""}No. <span class="mono">${u.no}</span> · 상담 <b>${r.length}회</b> · ${esc(u.unit || "소속 미입력")}</div></div>
      <span class="sp"></span>
      <button class="btn outline" onclick="printSummary()">🗎 요약지</button>
      <button class="btn primary" onclick="openSoapForm()">+ 회차 기록 작성</button></div>
    <div class="tabs">${[["info", "내담자 정보"], ["ptsd", "PTSD 사정"], ["comments", "회차별 코멘트"]].map(([k, l]) => `<button class="${A.tab === k ? "on" : ""}" onclick="A.tab='${k}';render()">${l}</button>`).join("")}</div>
    ${A.tab === "ptsd" ? ptsdTab(u, d) : A.tab === "comments" ? commentsTab(u, d, r) : infoTab(u, d)}
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
  return `<div class="tl" style="margin-top:14px">${[...r].reverse().map(x => `<div class="sess">
    <div class="sess-h"><b>${x.no}회차</b><span class="mono">${(x.date || "").replace(/-/g, ".")}</span><span>· ${esc(x.type || "")}</span>${badge(sc(x.date))}${x.topic ? `<span class="muted">주제: ${esc(x.topic)}</span>` : ""}<span class="sp" style="flex:1"></span><button class="btn ghost sm" onclick="openSoapForm('${x.id}')">수정</button></div>
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
      <div class="kv"><span class="k">등록번호</span><span class="mono">${u.no}</span><span class="k">생년월일</span><span>${u.birth || "—"}${age(u.birth) != null ? ` (${age(u.birth)}세)` : ""}</span><span class="k">소속</span><span>${esc(u.unit || "—")}</span><span class="k">등록일</span><span>${u.createdAt || "—"}</span><span class="k">상담 동의</span><span>${d.consentAt ? d.consentAt.slice(0, 10) + " 동의" : '<span class="chip gray">미작성</span>'}</span><span class="k">오늘 근무</span><span>${d.schedule && d.schedule[todayStr()] ? SHIFT_TYPES[d.schedule[todayStr()]].label : "—"}</span></div></div>
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
function schedulePanel() {
  const t = todayStr(), all = allAppts(), mon = addDays(t, -((parse(t).getDay() + 6) % 7));
  const days = Array.from({ length: 7 }, (_, i) => addDays(mon, i));
  const todays = all.filter(a => a.date === t && a.status === "booked").sort((a, b) => toMin(a.time) - toMin(b.time));
  const next = todays.find(a => toMin(a.time) >= new Date().getHours() * 60 + new Date().getMinutes()) || todays[0];
  const u = cur(), mine = u ? (u.data?.appts || []).filter(a => a.status === "booked" && a.date >= t).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))[0] : null;
  return `<div class="panel"><div class="panel-h"><span class="h2">일정 관리</span><div class="seg">${[["day", "일"], ["week", "주"], ["month", "월"]].map(([k, l]) => `<button class="${A.schedMode === k ? "on" : ""}" onclick="A.schedMode='${k}';A.view='schedule';render()">${l}</button>`).join("")}</div></div>
    <div class="faint">${t.slice(0, 7).replace("-", ".")} · 오늘 ${md(t)} (${"일월화수목금토"[parse(t).getDay()]})</div>
    <div class="week">${days.map(ds => `<div><div class="d">${"월화수목금토일"[days.indexOf(ds)]}</div><div class="n ${ds === t ? "today" : ""}">${+ds.slice(8)}${all.some(a => a.date === ds && a.status === "booked") ? '<span class="dot"></span>' : ""}</div></div>`).join("")}</div>
    ${todays.length ? todays.map(a => { const ap = (A.approvals[a.uid] || {})[a.id]; return `<div class="srow ${a === next ? "next" : ""}"><span class="t">${fmtT(a.time)}</span><div><b>${esc(a.name)} · ${a.sessionNo}회차</b><div class="faint">${a.type}${a.topicHint ? " · " + a.topicHint : ""}</div>
        <div class="acts">${ap?.status === "confirmed" ? '<span class="chip">승인</span>' : `<button class="btn primary sm" onclick="approve('${a.uid}','${a.id}')">승인</button><span class="chip gray">승인 대기</span>`}${a === next ? `<button class="btn primary sm" onclick="selectUser('${a.uid}');A.tab='comments';render()">▶ 상담 시작</button>` : ""}</div></div></div>`; }).join("")
      : `<div class="faint" style="padding:8px 0">오늘 예약이 없습니다</div>`}
    ${mine && mine.date !== t ? `<div class="srow"><span class="t">${md(mine.date)}</span><div><b>${esc(u.name)} · 다음 예약</b><div class="faint">${fmtT(mine.time)} · ${mine.type} · D-${daysBetween(t, mine.date)}</div><div class="acts">${(A.approvals[u.uid] || {})[mine.id]?.status === "confirmed" ? '<span class="chip">승인</span>' : `<button class="btn primary sm" onclick="approve('${u.uid}','${mine.id}')">승인</button><span class="chip gray">승인 대기</span>`}</div></div></div>` : ""}
    <button class="btn ghost sm" style="margin-top:6px" onclick="A.view='schedule';render()">전체 일정 보기 ›</button></div>`;
}
async function approve(uid, apptId) { try { await Cloud.db.collection("users").doc(uid).collection("approvals").doc(apptId).set({ status: "confirmed", by: A.email, at: new Date().toISOString() }); (A.approvals[uid] = A.approvals[uid] || {})[apptId] = { status: "confirmed" }; toast("승인했습니다"); render(); } catch (e) { toast(Cloud.msg(e)); } }
function scheduleView() {
  const t = todayStr(), all = allAppts().filter(a => a.status === "booked").sort((a, b) => (a.date + pad(toMin(a.time))).localeCompare(b.date + pad(toMin(b.time))));
  const groups = {}; all.filter(a => a.date >= addDays(t, -7)).forEach(a => (groups[a.date] = groups[a.date] || []).push(a));
  return `<div class="center"><div class="panel"><div class="panel-h"><span class="h2">일정 · 앱에서 들어온 예약</span><span class="faint">승인·변경 시 내담자 앱 알림은 서버 알림 연동 후 제공</span></div>
    ${Object.keys(groups).sort().map(ds => `<div class="label" style="margin:12px 0 4px">${ds.replace(/-/g, ".")} (${"일월화수목금토"[parse(ds).getDay()]}) ${ds === t ? '<span class="chip">오늘</span>' : ""}</div>${groups[ds].map(a => { const ap = (A.approvals[a.uid] || {})[a.id]; return `<div class="srow"><span class="t">${fmtT(a.time)}</span><div><b>${esc(a.name)}</b> · ${a.sessionNo}회차 · ${a.type} · ${counselor(a.cid).name}<div class="acts">${ap?.status === "confirmed" ? '<span class="chip">승인</span>' : `<button class="btn primary sm" onclick="approve('${a.uid}','${a.id}')">승인</button><span class="chip gray">승인 대기</span>`}<button class="btn outline sm" onclick="A.view='clients';selectUser('${a.uid}')">내담자 열기</button></div></div></div>`; }).join("")}`).join("") || `<div class="empty">예약이 없습니다</div>`}
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
  for (let i = 5; i >= 0; i--) { const d = new Date(); d.setMonth(d.getMonth() - i, 1); months.push(ymd(d).slice(0, 7)); }
  const byLv = { l: 0, m: 0, h: 0 }; us.forEach(u => { const s = lastScore(u); if (s != null) byLv[risk(s).lv]++; });
  const scored = byLv.l + byLv.m + byLv.h;
  const newBy = months.map(m => us.filter(u => (u.createdAt || "").startsWith(m)).length), cum = []; newBy.reduce((a, b, i) => cum[i] = a + b, us.filter(u => (u.createdAt || "") < months[0]).length);
  const avgBy = months.map(m => { const v = []; us.forEach(u => (u.data?.diag || []).filter(x => x.date.startsWith(m)).forEach(x => v.push(x.score))); return v.length ? +(v.reduce((a, b) => a + b) / v.length).toFixed(1) : null; });
  const mon = addDays(t, -((parse(t).getDay() + 6) % 7)), sun = addDays(mon, 6);
  const wk = allAppts().filter(a => a.date >= mon && a.date <= sun), ages = { "20대": 0, "30대": 0, "40대": 0, "50대+": 0 };
  us.forEach(u => { const a = age(u.birth); if (a == null) return; ages[a < 30 ? "20대" : a < 40 ? "30대" : a < 50 ? "40대" : "50대+"]++; });
  const r = 56, c = 2 * Math.PI * r; let off = 0; const seg = (n, col) => { const len = scored ? n / scored * c : 0; const s = `<circle cx="75" cy="75" r="${r}" fill="none" stroke="${col}" stroke-width="18" stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-off}" transform="rotate(-90 75 75)"/>`; off += len; return s; };
  const bars = (vals, col, max) => { const W = 420, H = 150, n = vals.length, bw = (W - 40) / n; return `<svg class="chart" viewBox="0 0 ${W} ${H}">${vals.map((v, i) => { const h = max ? (H - 40) * v / max : 0; return `<rect x="${20 + i * bw + bw * .3}" y="${H - 24 - h}" width="${bw * .4}" height="${h}" fill="${col}" rx="2"/><text x="${20 + i * bw + bw / 2}" y="${H - 28 - h}" text-anchor="middle" font-size="10" fill="var(--ink)">${v}</text><text x="${20 + i * bw + bw / 2}" y="${H - 8}" text-anchor="middle" font-size="10" fill="var(--ink-muted)">${months[i] ? +months[i].slice(5) + "월" : Object.keys(ages)[i]}</text>`; }).join("")}</svg>`; };
  const lineSvg = (vals, max, min = 0) => { const W = 420, H = 150, n = vals.length, X = i => 30 + i * (W - 50) / (n - 1), Y = v => 16 + (H - 46) * (1 - (v - min) / (max - min || 1)); let p = ""; vals.forEach((v, i) => { if (v == null) return; p += (p ? " L" : "M") + X(i) + "," + Y(v); }); return `<svg class="chart" viewBox="0 0 ${W} ${H}"><line x1="30" x2="${W - 20}" y1="${Y(SET.t1)}" y2="${Y(SET.t1)}" stroke="var(--ink-muted)" stroke-dasharray="3 3"/><text x="${W - 18}" y="${Y(SET.t1) + 3}" font-size="9" fill="var(--ink-muted)">${SET.t1}</text><path d="${p}" fill="none" stroke="var(--chart-total)" stroke-width="2"/>${vals.map((v, i) => v == null ? "" : `<path d="M${X(i)},${Y(v) - 5} L${X(i) + 5},${Y(v)} L${X(i)},${Y(v) + 5} L${X(i) - 5},${Y(v)}Z" fill="var(--risk-mid)"/><text x="${X(i)}" y="${H - 6}" text-anchor="middle" font-size="10" fill="var(--ink-muted)">${+months[i].slice(5)}월</text>`).join("")}</svg>`; };
  return `<div class="center"><div class="panel-h" style="margin:0"><div><span class="h2" style="font-size:18px">통계 대시보드</span> <span class="faint">${months[0].replace("-", ".")} – ${months[5].replace("-", ".")}</span></div></div>
    <div class="stats-grid">
      <div class="panel stat"><div class="label">전체 내담자</div><div class="v">${us.length}<span class="sm muted"> 명</span></div><div class="faint">이번 달 신규 ${newBy[5]}명</div></div>
      <div class="panel stat"><div class="label">상담 진행 중</div><div class="v">${us.filter(u => (u.data?.appts || []).length).length}<span class="sm muted"> 명</span></div><div class="faint">예약 대기 ${us.filter(u => nextAppt(u)).length}</div></div>
      <div class="panel stat hi"><div class="label">PTSD 추정·중증 (${SET.t2}+)</div><div class="v">${byLv.h}<span class="sm muted"> 명</span></div><div class="faint">치료연계 검토 대상</div></div>
      <div class="panel stat"><div class="label">이번 주 상담</div><div class="v">${wk.length}<span class="sm muted"> 건</span></div><div class="faint">화상 ${wk.filter(a => a.type === "화상").length} · 대면 ${wk.filter(a => a.type === "대면").length}</div></div></div>
    <div class="stats-row">
      <div class="panel"><div class="h2">IES-R-K 판정 구간 비율</div><div class="donut-wrap"><svg viewBox="0 0 150 150"><circle cx="75" cy="75" r="${r}" fill="none" stroke="var(--surface-300)" stroke-width="18"/>${seg(byLv.l, "var(--risk-low)")}${seg(byLv.m, "var(--risk-mid)")}${seg(byLv.h, "var(--risk-high)")}<text x="75" y="80" text-anchor="middle" font-size="24" font-weight="600" fill="var(--ink)">${scored}</text><text x="75" y="96" text-anchor="middle" font-size="10" fill="var(--ink-muted)">명</text></svg>
        <div class="dleg">${[["● 정상 범위", byLv.l, "var(--risk-low)"], ["◆ 임상적 관심", byLv.m, "var(--risk-mid-text)"], ["▲ PTSD 추정·중증", byLv.h, "var(--risk-high-text)"]].map(([l, n, col]) => `<div><span style="color:${col}">${l}</span><span class="mono">${n}명 · ${scored ? Math.round(n / scored * 100) : 0}%</span></div>`).join("")}</div></div></div>
      <div class="panel"><div class="panel-h"><span class="h2">월별 신규 · 누적 내담자</span><span class="legend-row"><span><i style="background:var(--brand)"></i>신규</span><span><i style="background:var(--chart-total);border-radius:50%"></i>누적 ${cum[5] || 0}</span></span></div>${bars(newBy, "var(--brand)", Math.max(1, ...newBy))}</div></div>
    <div class="stats-row2">
      <div class="panel"><div class="h2">IES-R-K 평균 점수 변화 <span class="faint">점선 ${SET.t1}점</span></div>${lineSvg(avgBy, Math.max(30, ...avgBy.filter(v => v != null)) + 4, 0)}</div>
      <div class="panel"><div class="panel-h"><span class="h2">연령 분포</span><span class="faint">성별은 등록 항목에 없어 표시하지 않음</span></div>${bars(Object.values(ages), "var(--chart-intrusion)", Math.max(1, ...Object.values(ages)))}</div></div>
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
    <h2>회차별 기록</h2>${r.map(x => `<p><b>${x.no}회차 · ${x.date} · ${x.type}</b>${x.topic ? ` · 주제: ${esc(x.topic)}` : ""}<br>S: ${esc(x.s || "-")}<br>O: ${esc(x.o || "-")}<br>A: ${esc(x.a || "-")}<br>P: ${esc(x.p || "-")}<br>공개 코멘트: ${esc(x.text || "-")}</p>`).join("") || "없음"}
    <script>window.print()<\/script></body></html>`); w.document.close();
}

/* ── 시작 ── */
(function boot() {
  if (!Cloud.init()) { render(); return; }
  Cloud.auth.onAuthStateChanged(async user => {
    if (user && !Cloud.isClient(user) && await Cloud.isAdmin(user.email)) { A.email = user.email; render(); loadUsers(); }
    else { if (user && Cloud.isClient(user)) { /* 내담자 세션은 건드리지 않음 */ } A.email = null; render(); }
  });
})();

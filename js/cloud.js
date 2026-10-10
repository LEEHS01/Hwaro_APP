/* ═══════════════════════════════════════════════
   HWARO — Firebase(Firestore + Auth) 연결 계층
   - 내담자: 이름+생년월일로 만든 가상 이메일 + 비밀번호로 가입/로그인
   - 관리자: 실제 이메일 + 비밀번호 (admins/{email} 문서가 있어야 함)
   - 데이터 구조
       meta/counter                 { seq }                      내담자 번호 카운터
       users/{uid}                  { uid,no,name,unit,birth,createdAt, data:{...} }
       users/{uid}/results/{id}     { no,cid,date,type,text }    상담사가 쓰는 결과/코멘트
       admins/{email}               { key, createdAt }
═══════════════════════════════════════════════ */

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBKjDh3hWwSBDzsivGCT_VGUj8B9hlij2s",
  authDomain: "hawro-91fd5.firebaseapp.com",
  projectId: "hawro-91fd5",
  storageBucket: "hawro-91fd5.firebasestorage.app",
  messagingSenderId: "542745398328",
  appId: "1:542745398328:web:4b0ac031094df02b31aacd"
};
const CLIENT_SUFFIX = "@hwaro.app";     // 내담자 가상 이메일 접미사
const ADMIN_SETUP_KEY = "HWARO-ADMIN-2026";   // 관리자 최초 등록 키 (Firestore 규칙과 동일해야 함)

const Cloud = {
  on: false, db: null, auth: null, unsubResults: null, saveT: null,

  // name을 주면(관리자: "admin") 별도 Firebase 앱 인스턴스를 써서 같은 브라우저에서 내담자 로그인과 세션이 섞이지 않음
  init(name) {
    try {
      if (!window.firebase || !firebase.initializeApp) return false;
      const app = name ? firebase.initializeApp(FIREBASE_CONFIG, name) : firebase.initializeApp(FIREBASE_CONFIG);
      this.auth = app.auth();
      this.db = app.firestore();
      this.db.enablePersistence({ synchronizeTabs: true }).catch(() => { });   // 오프라인 캐시
      this.on = true; return true;
    } catch (e) { console.warn("Firebase init 실패", e); return false; }
  },

  /* ── 내담자 ── */
  synthEmail(name, birth) {
    const bytes = new TextEncoder().encode(name.trim().replace(/\s+/g, "") + "|" + birth);
    return "u" + [...bytes].map(b => b.toString(16).padStart(2, "0")).join("") + CLIENT_SUFFIX;
  },
  isClient(user) { return !!user && (user.email || "").endsWith(CLIENT_SUFFIX); },
  async register(name, unit, birth, pw, gender) {
    const cred = await this.auth.createUserWithEmailAndPassword(this.synthEmail(name, birth), pw);
    const uid = cred.user.uid, no = await this.nextNo();
    const prof = { uid, no, name: name.trim(), unit, birth, gender: gender || "", createdAt: todayStr() };
    await this.db.collection("users").doc(uid).set({ ...prof, data: blankData(prof.name), updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    return prof;
  },
  async nextNo() {
    const ref = this.db.collection("meta").doc("counter");
    return this.db.runTransaction(async tx => { const s = await tx.get(ref); const n = (s.exists ? s.data().seq : 0) + 1; tx.set(ref, { seq: n }); return "HW-" + String(n).padStart(4, "0"); });
  },
  async login(name, birth, pw) { const cred = await this.auth.signInWithEmailAndPassword(this.synthEmail(name, birth), pw); return cred.user.uid; },
  async loadUser(uid) { const s = await this.db.collection("users").doc(uid).get(); return s.exists ? s.data() : null; },
  subscribeResults(uid, cb) {
    if (this.unsubResults) this.unsubResults();
    this.unsubResults = this.db.collection("users").doc(uid).collection("results").orderBy("no")
      .onSnapshot(q => cb(q.docs.map(d => ({ id: d.id, ...d.data() }))), e => console.warn(e));
  },
  saveData(uid, data) {
    clearTimeout(this.saveT);
    this.saveT = setTimeout(() => {
      const { results, ...rest } = data;                       // results는 상담사 전용 하위 컬렉션
      const clean = JSON.parse(JSON.stringify(rest));           // undefined 제거
      this.db.collection("users").doc(uid).set({ data: clean, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true }).catch(e => console.warn("저장 실패", e));
    }, 500);
  },
  async flush() { if (this.saveT) { clearTimeout(this.saveT); this.saveT = null; } },
  async logout() { if (this.unsubResults) { this.unsubResults(); this.unsubResults = null; } if (this.unsubContent) { this.unsubContent(); this.unsubContent = null; } await this.auth.signOut(); },

  /* ── 관리자 ── */
  async adminLogin(email, pw) { await this.auth.signInWithEmailAndPassword(email, pw); return this.isAdmin(email); },
  async adminRegister(email, pw, key) {
    if (key !== ADMIN_SETUP_KEY) throw new Error("setup-key");
    let cred; try { cred = await this.auth.createUserWithEmailAndPassword(email, pw); }
    catch (e) { if (e.code === "auth/email-already-in-use") cred = await this.auth.signInWithEmailAndPassword(email, pw); else throw e; }
    await this.db.collection("admins").doc(email).set({ key, createdAt: todayStr() });
    return true;
  },
  async isAdmin(email) { try { const s = await this.db.collection("admins").doc(email).get(); return s.exists; } catch (e) { return false; } },
  async listUsers() { const q = await this.db.collection("users").orderBy("no").get(); return q.docs.map(d => d.data()); },
  async loadResults(uid) { const q = await this.db.collection("users").doc(uid).collection("results").orderBy("no").get(); return q.docs.map(d => ({ id: d.id, ...d.data() })); },
  async addResult(uid, r) { await this.db.collection("users").doc(uid).collection("results").add({ ...r, createdAt: firebase.firestore.FieldValue.serverTimestamp() }); },
  async deleteUser(uid) {
    const col = await this.db.collection("users").doc(uid).collection("results").get();
    const b = this.db.batch(); col.docs.forEach(d => b.delete(d.ref)); b.delete(this.db.collection("users").doc(uid)); await b.commit();
  },

  /* ── 콘텐츠 (관리자가 수정하는 영상·병원·긴급전화·상담사·공지) content/app ── */
  async loadContent() { try { const s = await this.db.collection("content").doc("app").get(); return s.exists ? s.data() : null; } catch (e) { console.warn("콘텐츠 불러오기 실패", e); return null; } },
  subscribeContent(cb) { if (this.unsubContent) this.unsubContent(); this.unsubContent = this.db.collection("content").doc("app").onSnapshot(s => cb(s.exists ? s.data() : null), e => console.warn("콘텐츠 구독 실패", e)); },
  async saveContent(c, by) { await this.db.collection("content").doc("app").set({ ...c, by: by || "", updatedAt: firebase.firestore.FieldValue.serverTimestamp() }); },
  // data.js의 상수 배열을 제자리에서 교체 (const라서 splice 사용). 비어 있는 항목은 기본값 유지
  applyContent(c) {
    if (!c) return;
    const rep = (arr, v) => { if (Array.isArray(v) && v.length) arr.splice(0, arr.length, ...v.map(x => ({ ...x }))); };
    rep(VIDEO_LIST, c.videos); rep(HOSPITALS, c.hospitals); rep(HELPLINES, c.helplines);
    if (Array.isArray(c.counselors) && c.counselors.length) {
      const colors = ["#c98a72", "#b0876f", "#d4a08c", "#a46a55", "#9c7b6a", "#c4a08a"];
      rep(COUNSELORS, c.counselors.map((x, i) => ({ ...x, color: x.color || colors[i % colors.length] })));
    }
    window.APP_NOTICE = c.notice && c.notice.on && (c.notice.text || "").trim() ? c.notice : null;
    window.APP_AVAIL = c.avail && typeof c.avail === "object" ? c.avail : {};
  },

  /* 오류 메시지 한글화 */
  msg(e) {
    const c = (e && e.code) || (e && e.message) || "";
    if (c.includes("wrong-password") || c.includes("invalid-credential") || c.includes("invalid-login")) return "비밀번호가 맞지 않습니다.";
    if (c.includes("user-not-found")) return "등록된 계정이 없습니다. '처음 이용'으로 등록해 주세요.";
    if (c.includes("email-already-in-use")) return "이미 등록된 이름·생년월일입니다. 로그인해 주세요.";
    if (c.includes("weak-password")) return "비밀번호는 6자리 이상이어야 합니다.";
    if (c.includes("too-many-requests")) return "시도가 너무 많습니다. 잠시 후 다시 해주세요.";
    if (c.includes("network")) return "인터넷 연결을 확인해 주세요.";
    if (c.includes("permission-denied")) return "권한이 없습니다. (관리자 계정 또는 보안 규칙 확인)";
    if (c.includes("setup-key")) return "관리자 등록 키가 맞지 않습니다.";
    if (c.includes("operation-not-allowed")) return "Firebase 콘솔에서 이메일/비밀번호 로그인을 켜 주세요.";
    return "오류: " + c;
  }
};

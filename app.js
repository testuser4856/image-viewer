const $ = (s) => document.querySelector(s);

let db;
let lastObjectURL = null;

let current = {
  bookId: null,
  pages: [],
  index: 0,
  fit: "fitWidth",
  margin: 8,
};

const DB_NAME = "viewerDB";
const DB_VER = 2;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);

    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains("books")) d.createObjectStore("books", { keyPath: "id" });

      if (!d.objectStoreNames.contains("pages")) {
        const p = d.createObjectStore("pages", { keyPath: "pid" });
        p.createIndex("byBook", "bookId");
      }

      if (!d.objectStoreNames.contains("progress")) d.createObjectStore("progress", { keyPath: "bookId" });

      if (!d.objectStoreNames.contains("bookmarks")) {
        const b = d.createObjectStore("bookmarks", { keyPath: "id" });
        b.createIndex("byBook", "bookId");
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function store(name, mode = "readonly") {
  return db.transaction(name, mode).objectStore(name);
}

function put(name, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, "readwrite");
    tx.objectStore(name).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function del(name, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, "readwrite");
    tx.objectStore(name).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function get(name, key) {
  return new Promise((resolve, reject) => {
    const req = store(name).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getAll(name) {
  return new Promise((resolve, reject) => {
    const req = store(name).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getAllByIndex(name, indexName, key) {
  return new Promise((resolve, reject) => {
    const req = store(name).index(indexName).getAll(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function fmtDate(ts) {
  if (!ts) return "-";
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}/${m}/${dd} ${hh}:${mm}`;
}

/* ===== Views ===== */
function showLibrary() {
  $("#readerView")?.classList.add("hidden");
  $("#libraryView")?.classList.remove("hidden");
  $("#readerHud")?.classList.add("hidden");
}

function showReader() {
  $("#libraryView")?.classList.add("hidden");
  $("#readerView")?.classList.remove("hidden");
  $("#readerHud")?.classList.remove("hidden");
}

/* ===== HUD Auto Hide ===== */
let hudTimer = null;
function showHudTemporarily() {
  const hud = $("#readerHud");
  if (!hud) return;
  hud.classList.remove("hidden");
  if (hudTimer) clearTimeout(hudTimer);
  hudTimer = setTimeout(() => {
    hud.classList.add("hidden");
  }, 2500);
}

function toggleHud() {
  const hud = $("#readerHud");
  if (!hud) return;
  const isHidden = hud.classList.contains("hidden");
  if (isHidden) showHudTemporarily();
  else hud.classList.add("hidden");
}

/* ===== Reader render ===== */
function applyFit() {
  const img = $("#readerImg");
  const stage = $("#readerStage");
  if (!img || !stage) return;

  if (current.fit === "fitWidth") {
    img.style.width = "100%";
    img.style.height = "auto";
  } else if (current.fit === "fitHeight") {
    img.style.width = "auto";
    img.style.height = "100%";
  } else {
    img.style.width = "auto";
    img.style.height = "auto";
  }

  stage.style.padding = `${Number(current.margin) || 0}px`;
}

function renderPage() {
  const img = $("#readerImg");
  if (!img) return;

  const p = current.pages[current.index];
  if (!p) return;

  if (lastObjectURL) URL.revokeObjectURL(lastObjectURL);
  lastObjectURL = URL.createObjectURL(p.blob);
  img.src = lastObjectURL;

  $("#pageInfo").textContent = `${current.index + 1}/${current.pages.length}`;
  const range = $("#rangePage");
  range.max = String(current.pages.length);
  range.value = String(current.index + 1);

  applyFit();
  showHudTemporarily();

  // progress + book updatedAt
  const now = Date.now();
  put("progress", { bookId: current.bookId, lastIndex: current.index, updatedAt: now }).catch(() => {});
  // books の updatedAt も更新して本棚ソートに効かせる
  get("books", current.bookId).then((b) => {
    if (!b) return;
    b.updatedAt = now;
    put("books", b).catch(() => {});
  });
}

function nextPage() {
  if (current.index < current.pages.length - 1) {
    current.index += 1;
    renderPage();
  }
}
function prevPage() {
  if (current.index > 0) {
    current.index -= 1;
    renderPage();
  }
}

/* ===== Library ===== */
function sortBooks(books) {
  const mode = $("#selSort")?.value ?? "updatedDesc";

  if (mode === "titleAsc") {
    books.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
    return books;
  }
  // updatedDesc default
  books.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  return books;
}

async function renderLibrary() {
  const grid = $("#libraryGrid");
  if (!grid) return;

  let books = await getAll("books");
  books = sortBooks(books);

  grid.innerHTML = "";

  for (const b of books) {
    const card = document.createElement("div");
    card.className = "card";

    const title = document.createElement("div");
    title.className = "cardTitle";
    title.textContent = b.title || "(no title)";

    const meta = document.createElement("div");
    meta.className = "cardMeta";
    meta.innerHTML = `<span>${b.pageCount ?? "?"} pages</span><span>更新: ${fmtDate(b.updatedAt)}</span>`;

    const actions = document.createElement("div");
    actions.className = "cardActions";

    const btnOpen = document.createElement("button");
    btnOpen.className = "btn";
    btnOpen.textContent = "開く";
    btnOpen.onclick = () => openBook(b.id);

    const btnRename = document.createElement("button");
    btnRename.className = "btn";
    btnRename.textContent = "名前";
    btnRename.onclick = async () => {
      const v = prompt("新しいタイトル", b.title || "");
      if (v == null) return;
      b.title = v.trim() || b.title;
      await put("books", b);
      await renderLibrary();
    };

    const btnDelete = document.createElement("button");
    btnDelete.className = "btn";
    btnDelete.textContent = "削除";
    btnDelete.onclick = async () => {
      if (!confirm(`「${b.title}」を削除しますか？（ページ/しおり/進捗も消えます）`)) return;
      await deleteBookAll(b.id);
      await renderLibrary();
    };

    actions.append(btnOpen, btnRename, btnDelete);
    card.append(title, meta, actions);
    grid.appendChild(card);
  }
}

async function deleteBookAll(bookId) {
  // pages
  const pages = await getAllByIndex("pages", "byBook", bookId);
  for (const p of pages) await del("pages", p.pid);

  // bookmarks
  const bms = await getAllByIndex("bookmarks", "byBook", bookId);
  for (const bm of bms) await del("bookmarks", bm.id);

  // progress + book
  await del("progress", bookId);
  await del("books", bookId);
}

/* ===== Import ===== */
async function importFiles(files) {
  const list = [...files].filter((f) => f.type.startsWith("image/"));
  list.sort((a, b) => a.name.localeCompare(b.name));
  if (!list.length) return;

  const titleDefault = list[0].name.replace(/\.[^.]+$/, "");
  const title = prompt("本のタイトル", titleDefault) || titleDefault;

  const id = crypto.randomUUID();
  const now = Date.now();
  await put("books", { id, title, pageCount: list.length, createdAt: now, updatedAt: now });

  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    await put("pages", { pid: `${id}:${i}`, bookId: id, index: i, blob: f, name: f.name });
  }

  await put("progress", { bookId: id, lastIndex: 0, updatedAt: now });
  await renderLibrary();
}

/* ===== Reader open ===== */
async function openBook(bookId) {
  current.bookId = bookId;
  const pages = await getAllByIndex("pages", "byBook", bookId);
  pages.sort((a, b) => a.index - b.index);
  current.pages = pages;

  const prog = await get("progress", bookId);
  current.index = Math.min(Math.max(prog?.lastIndex ?? 0, 0), pages.length - 1);

  showReader();
  renderPage();
}

/* ===== Bookmarks ===== */
async function addBookmark() {
  if (!current.bookId) return;
  const note = prompt("しおりメモ（任意）", "") ?? "";
  await put("bookmarks", {
    id: crypto.randomUUID(),
    bookId: current.bookId,
    index: current.index,
    note,
    createdAt: Date.now(),
  });
}

async function renderBookmarksList() {
  const list = $("#bmList");
  list.innerHTML = "";

  const bms = await getAllByIndex("bookmarks", "byBook", current.bookId);
  bms.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

  if (!bms.length) {
    const empty = document.createElement("div");
    empty.style.padding = "8px";
    empty.textContent = "しおりがありません";
    list.appendChild(empty);
    return;
  }

  for (const bm of bms) {
    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.justifyContent = "space-between";
    row.style.alignItems = "center";
    row.style.gap = "10px";
    row.style.padding = "8px";
    row.style.borderBottom = "1px solid rgba(255,255,255,0.1)";

    const left = document.createElement("div");
    left.style.cursor = "pointer";
    left.innerHTML = `<div><strong>${bm.index + 1}p</strong> <span style="color:var(--muted);font-size:12px">${fmtDate(bm.createdAt)}</span></div>
                      <div style="color:var(--muted);font-size:12px">${(bm.note || "（メモなし）")}</div>`;
    left.onclick = () => {
      current.index = bm.index;
      renderPage();
      closeBookmarksModal();
    };

    const btnDel = document.createElement("button");
    btnDel.className = "btn";
    btnDel.textContent = "削除";
    btnDel.onclick = async () => {
      await del("bookmarks", bm.id);
      await renderBookmarksList();
    };

    row.append(left, btnDel);
    list.appendChild(row);
  }
}

async function openBookmarksModal() {
  document.body.classList.add("modal-open");
  await renderBookmarksList();
  $("#bmModal").classList.remove("hidden");
}

function closeBookmarksModal() {
  $("#bmModal").classList.add("hidden");
  document.body.classList.remove("modal-open");
}

/* ===== Backup / Restore ===== */
async function backupToJsonDownload() {
  const dump = {
    version: 1,
    exportedAt: Date.now(),
    books: await getAll("books"),
    progress: await getAll("progress"),
    bookmarks: await getAll("bookmarks"),
    pages: [],
  };

  // pages は blob が重いので段階的に入れる
  const pages = await getAll("pages");
  // blob は JSONに直接入らないので base64 へ
  for (const p of pages) {
    const b64 = await blobToBase64(p.blob);
    dump.pages.push({
      pid: p.pid,
      bookId: p.bookId,
      index: p.index,
      name: p.name,
      blobBase64: b64,
      blobType: p.blob?.type || "application/octet-stream",
    });
  }

  const text = JSON.stringify(dump);
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `viewer-backup-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result)); // data:...base64,....
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

function base64ToBlob(dataUrl, mime) {
  // data:[mime];base64,xxxx
  const parts = dataUrl.split(",");
  const b64 = parts[1] || "";
  const bin = atob(b64);
  const len = bin.length;
  const buf = new Uint8Array(len);
  for (let i = 0; i < len; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type: mime || "application/octet-stream" });
}

async function restoreFromJsonFile(file) {
  const text = await file.text();
  const dump = JSON.parse(text);

  if (!dump || !Array.isArray(dump.books) || !Array.isArray(dump.pages)) {
    alert("バックアップ形式が不正です");
    return;
  }

  if (!confirm("復元すると、今のデータに“追加”されます（重複に注意）。続けますか？")) return;

  // books/progress/bookmarks
  for (const b of dump.books) await put("books", b);
  for (const p of dump.progress || []) await put("progress", p);
  for (const bm of dump.bookmarks || []) await put("bookmarks", bm);

  // pages
  for (const p of dump.pages) {
    const blob = base64ToBlob(p.blobBase64, p.blobType);
    await put("pages", { pid: p.pid, bookId: p.bookId, index: p.index, name: p.name, blob });
  }

  await renderLibrary();
  alert("復元が完了しました");
}

/* ===== Events ===== */
function wireEvents() {
  $("#btnImport")?.addEventListener("click", () => $("#filePicker")?.click());
  $("#filePicker")?.addEventListener("change", async (e) => {
    const files = e.target.files;
    if (!files || !files.length) return;
    await importFiles(files);
    e.target.value = "";
  });

  $("#selSort")?.addEventListener("change", () => renderLibrary());

  // Reader: tap zones (left/right) + center HUD toggle
  $("#readerStage")?.addEventListener("click", (e) => {
    const w = window.innerWidth;
    if (e.clientX < w * 0.3) prevPage();
    else if (e.clientX > w * 0.7) nextPage();
    else toggleHud();
  });

  $("#rangePage")?.addEventListener("input", (e) => {
    const v = Number(e.target.value);
    if (!Number.isFinite(v)) return;
    current.index = Math.min(Math.max(v - 1, 0), current.pages.length - 1);
    renderPage();
  });

  $("#selFit")?.addEventListener("change", (e) => {
    current.fit = e.target.value;
    applyFit();
    showHudTemporarily();
  });

  $("#rangeMargin")?.addEventListener("input", (e) => {
    current.margin = Number(e.target.value);
    applyFit();
    showHudTemporarily();
  });

  $("#btnBack")?.addEventListener("click", async () => {
    showLibrary();
    await renderLibrary();
  });

  $("#btnBookmarkAdd")?.addEventListener("click", async () => {
    await addBookmark();
    showHudTemporarily();
  });

  $("#btnBookmarks")?.addEventListener("click", async () => {
    await openBookmarksModal();
  });

  $("#btnBmClose")?.addEventListener("click", closeBookmarksModal);

  $("#bmModal")?.addEventListener("click", (e) => {
    if (e.target === $("#bmModal")) closeBookmarksModal();
  });

  $("#btnBackup")?.addEventListener("click", async () => {
    if (!confirm("バックアップJSONをダウンロードしますか？（容量が大きくなる場合があります）")) return;
    await backupToJsonDownload();
  });

  $("#btnRestore")?.addEventListener("click", () => $("#restorePicker")?.click());

  $("#restorePicker")?.addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    await restoreFromJsonFile(f);
    e.target.value = "";
  });
}

/* ===== Boot ===== */
(async function main() {
  db = await openDB();
  wireEvents();
  await renderLibrary();
  showLibrary();
})();

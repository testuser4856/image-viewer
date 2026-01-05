const $ = (s) => document.querySelector(s);

let db;

// state
let current = {
  bookId: null,
  pages: [],
  index: 0,
  fit: "fitWidth", // fitWidth | fitHeight | contain
  margin: 8,
};

// ---------- IndexedDB ----------
const DB_NAME = "viewerDB";
const DB_VER = 2;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);

    req.onupgradeneeded = () => {
      const d = req.result;

      if (!d.objectStoreNames.contains("books")) {
        d.createObjectStore("books", { keyPath: "id" });
      }
      if (!d.objectStoreNames.contains("pages")) {
        const p = d.createObjectStore("pages", { keyPath: "pid" });
        p.createIndex("byBook", "bookId");
      }
      if (!d.objectStoreNames.contains("progress")) {
        d.createObjectStore("progress", { keyPath: "bookId" });
      }
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

// ---------- UI helpers ----------
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

function applyFit() {
  const img = $("#readerImg");
  const stage = $("#readerStage");
  if (!img || !stage) return;

  // fit
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

  // margin
  stage.style.padding = `${Number(current.margin) || 0}px`;
}

let lastObjectURL = null;

function renderPage() {
  const img = $("#readerImg");
  if (!img) return;

  const p = current.pages[current.index];
  if (!p) return;

  // revoke old URL to avoid memory leak
  if (lastObjectURL) URL.revokeObjectURL(lastObjectURL);
  lastObjectURL = URL.createObjectURL(p.blob);
  img.src = lastObjectURL;

  $("#pageInfo").textContent = `${current.index + 1}/${current.pages.length}`;
  const range = $("#rangePage");
  range.max = String(current.pages.length);
  range.value = String(current.index + 1);

  applyFit();

  // save progress (non-blocking)
  put("progress", { bookId: current.bookId, lastIndex: current.index }).catch(() => {});
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

// ---------- Library ----------
async function renderLibrary() {
  const grid = $("#libraryGrid");
  if (!grid) return;

  const books = await getAll("books");
  grid.innerHTML = "";

  for (const b of books) {
    const div = document.createElement("div");
    div.className = "card";
    div.textContent = b.title || "(no title)";
    div.addEventListener("click", () => openBook(b.id));
    grid.appendChild(div);
  }
}

// ---------- Import ----------
async function importFiles(files) {
  const list = [...files].filter((f) => f.type.startsWith("image/"));
  list.sort((a, b) => a.name.localeCompare(b.name));
  if (!list.length) return;

  const id = crypto.randomUUID();
  const titleDefault = list[0].name.replace(/\.[^.]+$/, "");
  const title = prompt("本のタイトル", titleDefault) || titleDefault;

  await put("books", { id, title, pageCount: list.length });

  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    // File/Blob は IndexedDB にそのまま入る
    await put("pages", { pid: `${id}:${i}`, bookId: id, index: i, blob: f, name: f.name });
  }

  await put("progress", { bookId: id, lastIndex: 0 });
  await renderLibrary();
}

// ---------- Reader open ----------
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

// ---------- Bookmarks ----------
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

async function openBookmarksModal() {
  document.body.classList.add("modal-open");

  const list = $("#bmList");
  list.innerHTML = "";

  const bms = await getAllByIndex("bookmarks", "byBook", current.bookId);
  bms.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

  if (!bms.length) {
    const empty = document.createElement("div");
    empty.textContent = "しおりがありません";
    list.appendChild(empty);
  } else {
    for (const bm of bms) {
      const row = document.createElement("div");
      row.style.padding = "8px";
      row.style.borderBottom = "1px solid rgba(255,255,255,0.1)";
      row.style.cursor = "pointer";
      row.textContent = `${bm.index + 1}p  ${bm.note || ""}`;
      row.addEventListener("click", () => {
        current.index = bm.index;
        renderPage();
        closeBookmarksModal();
      });
      list.appendChild(row);
    }
  }

  $("#bmModal").classList.remove("hidden");
}

function closeBookmarksModal() {
  $("#bmModal").classList.add("hidden");
  document.body.classList.remove("modal-open");
}

// ---------- Event wiring ----------
function wireEvents() {
  // Import
  $("#btnImport")?.addEventListener("click", () => $("#filePicker")?.click());
  $("#filePicker")?.addEventListener("change", async (e) => {
    const files = e.target.files;
    if (!files || !files.length) return;
    await importFiles(files);
    e.target.value = "";
  });

  // Reader tap zones
  $("#readerStage")?.addEventListener("click", (e) => {
    const w = window.innerWidth;
    if (e.clientX < w * 0.3) prevPage();
    else if (e.clientX > w * 0.7) nextPage();
    // 真ん中タップはHUDの出し入れ等を入れたければここ
  });

  // Slider jump
  $("#rangePage")?.addEventListener("input", (e) => {
    const v = Number(e.target.value);
    if (!Number.isFinite(v)) return;
    current.index = Math.min(Math.max(v - 1, 0), current.pages.length - 1);
    renderPage();
  });

  // Fit/margin
  $("#selFit")?.addEventListener("change", (e) => {
    current.fit = e.target.value;
    applyFit();
  });

  $("#rangeMargin")?.addEventListener("input", (e) => {
    current.margin = Number(e.target.value);
    applyFit();
  });

  // Bookmarks
  $("#btnBookmarks")?.addEventListener("click", async () => {
    // ついでに「追加」も欲しいなら、ここで addBookmark() を先に呼ぶかUI追加
    await openBookmarksModal();
  });

  $("#btnBmClose")?.addEventListener("click", closeBookmarksModal);

  // Modal background click close
  $("#bmModal")?.addEventListener("click", (e) => {
    if (e.target === $("#bmModal")) closeBookmarksModal();
  });

  // Back
  $("#btnBack")?.addEventListener("click", () => {
    showLibrary();
    renderLibrary();
  });
}

// ---------- Boot ----------
(async function main() {
  db = await openDB();
  wireEvents();
  await renderLibrary();
  showLibrary();
})();

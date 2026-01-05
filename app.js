const $ = s => document.querySelector(s);

let db;
let current = {
  bookId:null,
  pages:[],
  index:0,
  fit:"fitWidth",
  margin:8
};

/* ---------- IndexedDB ---------- */
const DB_NAME="viewerDB", DB_VER=2;
function openDB(){
  return new Promise((res,rej)=>{
    const r=indexedDB.open(DB_NAME,DB_VER);
    r.onupgradeneeded=e=>{
      const d=r.result;
      d.createObjectStore("books",{keyPath:"id"});
      const p=d.createObjectStore("pages",{keyPath:"pid"});
      p.createIndex("byBook","bookId");
      d.createObjectStore("progress",{keyPath:"bookId"});
      const b=d.createObjectStore("bookmarks",{keyPath:"id"});
      b.createIndex("byBook","bookId");
    };
    r.onsuccess=()=>res(r.result);
    r.onerror=()=>rej(r.error);
  });
}
const tx=(s,m="readonly")=>db.transaction(s,m).objectStore(s);
const getAll=(s,i,k)=>new Promise(r=>{
  const req=i?tx(s).index(i).getAll(k):tx(s).getAll();
  req.onsuccess=()=>r(req.result);
});
const put=(s,v)=>new Promise(r=>{
  const t=db.transaction(s,"readwrite");
  t.objectStore(s).put(v);
  t.oncomplete=r;
});

/* ---------- 起動 ---------- */
(async()=>{
  db=await openDB();
  renderLibrary();
})();

/* ---------- 本棚 ---------- */
async function renderLibrary(){
  const books=await getAll("books");
  const grid=$("#libraryGrid");
  grid.innerHTML="";
  for(const b of books){
    const c=document.createElement("div");
    c.className="card";
    c.textContent=b.title;
    c.onclick=()=>openBook(b.id);
    grid.appendChild(c);
  }
}

/* ---------- 取り込み ---------- */
$("#btnImport").onclick=()=>$("#filePicker").click();
$("#filePicker").onchange=async e=>{
  const files=[...e.target.files].sort((a,b)=>a.name.localeCompare(b.name));
  if(!files.length)return;
  const id=crypto.randomUUID();
  await put("books",{id,title:files[0].name,pageCount:files.length});
  let i=0;
  for(const f of files){
    await put("pages",{pid:`${id}:${i}`,bookId:id,index:i,blob:f});
    i++;
  }
  await put("progress",{bookId:id,lastIndex:0});
  renderLibrary();
};

/* ---------- Reader ---------- */
async function openBook(id){
  current.bookId=id;
  current.pages=(await getAll("pages","byBook",id)).sort((a,b)=>a.index-b.index);
  const prog=await new Promise(r=>tx("progress").get(id).onsuccess=e=>r(e.target.result));
  current.index=prog?.lastIndex||0;
  $("#libraryView").classList.add("hidden");
  $("#readerView").classList.remove("hidden");
  renderPage();
}

function renderPage(){
  const p=current.pages[current.index];
  $("#readerImg").src=URL.createObjectURL(p.blob);
  $("#pageInfo").textContent=`${current.index+1}/${current.pages.length}`;
  $("#rangePage").max=current.pages.length;
  $("#rangePage").value=current.index+1;
  applyFit();
  put("progress",{bookId:current.bookId,lastIndex:current.index});
}

/* ---------- 操作 ---------- */
$("#readerStage").onclick=e=>{
  const w=window.innerWidth;
  if(e.clientX<w*0.3)prev();
  else if(e.clientX>w*0.7)next();
  else toggleHud();
};
function next(){ if(current.index<current.pages.length-1){current.index++;renderPage();}}
function prev(){ if(current.index>0){current.index--;renderPage();}}

$("#rangePage").oninput=e=>{
  current.index=e.target.value-1;
  renderPage();
};

$("#selFit").onchange=e=>{
  current.fit=e.target.value;
  applyFit();
};
$("#rangeMargin").oninput=e=>{
  current.margin=e.target.value;
  applyFit();
};

function applyFit(){
  const img=$("#readerImg");
  if(current.fit==="fitWidth"){
    img.style.width="100%";img.style.height="auto";
  }else if(current.fit==="fitHeight"){
    img.style.height="100%";img.style.width="auto";
  }else{
    img.style.width="auto";img.style.height="auto";
  }
  $("#readerStage").style.padding=current.margin+"px";
}

/* ---------- しおり ---------- */
$("#btnBookmark").onclick=async()=>{
  const note=prompt("メモ","");
  await put("bookmarks",{id:crypto.randomUUID(),bookId:current.bookId,index:current.index,note});
  alert("追加しました");
};
$("#btnBookmarks").onclick=async()=>{
  document.body.classList.add("modal-open");
  const list=$("#bmList");
  list.innerHTML="";
  const bms=await getAll("bookmarks","byBook",current.bookId);
  for(const b of bms){
    const d=document.createElement("div");
    d.textContent=`${b.index+1}p ${b.note||""}`;
    d.onclick=()=>{current.index=b.index;renderPage();$("#bmModal").classList.add("hidden");};
    list.appendChild(d);
  }
  $("#bmModal").classList.remove("hidden");
};
$("#btnBmClose").onclick=()=>{
  document.body.classList.remove("modal-open");
  $("#bmModal").classList.add("hidden");
}

/* ---------- HUD ---------- */
function toggleHud(){
  $("#readerHud").classList.toggle("hidden");
}
$("#btnBack").onclick=()=>{
  $("#readerView").classList.add("hidden");
  $("#libraryView").classList.remove("hidden");
};

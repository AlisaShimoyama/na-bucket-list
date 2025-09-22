"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

/* ========= Types ========= */
type Session = { user: { id: string; email?: string | null } } | null;
type Member = { user_id: string };

type Category = {
  id: string;
  name: string;
  /** index into CATEGORY_PALETTE (persisted so colors never shuffle) */
  colorIndex?: number;
};

type Comment = { id: string; userId: string; text: string; createdAt: string };
type Item = {
  id: string;
  categoryId: string | null;
  creatorId: string;
  title: string;
  description?: string;
  isSecret?: boolean;
  secretFor?: string | null;
  done?: boolean;
  createdAt?: string; // used for sort + display
  alreadyDone?: Record<string, boolean>;
  reactions?: Record<string, string>;
  comments?: Comment[];
};

type ListDoc = { categories: Category[]; items: Item[] };

/* ========= Accessible palette (distinct + readable) ========= */
/* Each entry: background, border, readable text color */
const CATEGORY_PALETTE: Array<{ bg: string; border: string; fg: string }> = [
  { bg: "#ef4444", border: "#b91c1c", fg: "#ffffff" }, // red
  { bg: "#f97316", border: "#c2410c", fg: "#ffffff" }, // orange
  { bg: "#f59e0b", border: "#b45309", fg: "#111111" }, // amber
  { bg: "#eab308", border: "#a16207", fg: "#111111" }, // yellow
  { bg: "#84cc16", border: "#4d7c0f", fg: "#111111" }, // lime
  { bg: "#22c55e", border: "#15803d", fg: "#ffffff" }, // green
  { bg: "#10b981", border: "#047857", fg: "#ffffff" }, // emerald
  { bg: "#14b8a6", border: "#0f766e", fg: "#111111" }, // teal
  { bg: "#06b6d4", border: "#0e7490", fg: "#111111" }, // cyan
  { bg: "#0ea5e9", border: "#075985", fg: "#ffffff" }, // sky
  { bg: "#3b82f6", border: "#1d4ed8", fg: "#ffffff" }, // blue
  { bg: "#6366f1", border: "#4338ca", fg: "#ffffff" }, // indigo
  { bg: "#8b5cf6", border: "#6d28d9", fg: "#ffffff" }, // violet
  { bg: "#a855f7", border: "#7e22ce", fg: "#ffffff" }, // purple
  { bg: "#d946ef", border: "#a21caf", fg: "#ffffff" }, // fuchsia
  { bg: "#ec4899", border: "#be185d", fg: "#ffffff" }, // pink
  { bg: "#f43f5e", border: "#be123c", fg: "#ffffff" }, // rose
  { bg: "#22d3ee", border: "#0891b2", fg: "#111111" }, // light cyan
  { bg: "#84a59d", border: "#52796f", fg: "#ffffff" }, // muted green
  { bg: "#fb923c", border: "#c2410c", fg: "#111111" }, // light orange
  { bg: "#34d399", border: "#059669", fg: "#111111" }, // light emerald
  { bg: "#60a5fa", border: "#1d4ed8", fg: "#ffffff" }, // light blue
  { bg: "#e879f9", border: "#a21caf", fg: "#111111" }, // light fuchsia
  { bg: "#fda4af", border: "#be123c", fg: "#111111" }, // light rose
];

/* ======= Color helpers ======= */
function nextColorIndex(categories: Category[]) {
  const used = new Set<number>();
  categories.forEach(c => { if (typeof c.colorIndex === "number") used.add(c.colorIndex); });
  for (let i = 0; i < CATEGORY_PALETTE.length; i++) if (!used.has(i)) return i;
  return (categories.length * 7) % CATEGORY_PALETTE.length; // fallback when > palette size
}
function colorForCategory(c: Category) {
  const idx = (c.colorIndex ?? 0) % CATEGORY_PALETTE.length;
  return CATEGORY_PALETTE[idx];
}
function ensureCategoryColors(doc: ListDoc): { changed: boolean; doc: ListDoc } {
  const used = new Set<number>();
  const out: Category[] = [];
  let changed = false;
  doc.categories.forEach((c) => {
    if (typeof c.colorIndex === "number") { used.add(c.colorIndex); out.push(c); }
    else {
      let idx = 0;
      for (let i = 0; i < CATEGORY_PALETTE.length; i++) if (!used.has(i)) { idx = i; used.add(i); break; }
      out.push({ ...c, colorIndex: idx }); changed = true;
    }
  });
  if (!changed) return { changed, doc };
  return { changed, doc: { ...doc, categories: out } };
}

/* ======= Small UI helper ======= */
function fmtDate(iso?: string) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch { return iso; }
}

export default function Page() {
  /* ========= Auth / State ========= */
  const [session, setSession] = useState<Session>(null);
  const [email, setEmail] = useState("");

  const [profile, setProfile] = useState<{ id: string; display_name: string | null; couple_id: string | null } | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [listDoc, setListDoc] = useState<ListDoc | null>(null);

  const [loading, setLoading] = useState(true);
  const [joinCode, setJoinCode] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [selectedCat, setSelectedCat] = useState<string | "all">("all"); // category filter
  const [secretOnly, setSecretOnly] = useState(false);                   // separate toggle

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session as any));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s as any));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    (async () => {
      if (!session) { setLoading(false); return; }
      setLoading(true);
      const { data: p } = await supabase.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
      if (p) setProfile(p);
      if (p?.couple_id) {
        await ensureMembershipAndList(p.couple_id);
        subscribeRealtime(p.couple_id);
      }
      setLoading(false);
    })();
  }, [session]);

  const myId = session?.user.id ?? null;
  const partnerId = myId ? (members.find(m => m.user_id !== myId)?.user_id ?? null) : null;
  const coupleCode = profile?.couple_id ?? "";

  /* ========= Auth actions ========= */
  async function signInWithMagicLink() {
    if (!email) return;
    await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: typeof window !== "undefined" ? window.location.origin : undefined }
    });
    alert("Check your email for the login link.");
  }
  async function signOut() {
    await supabase.auth.signOut();
    setProfile(null); setMembers([]); setListDoc(null);
  }

  /* ========= Data loaders ========= */
  async function ensureMembershipAndList(coupleId: string) {
    const { data: mems } = await supabase.from("couple_members").select("user_id").eq("couple_id", coupleId);
    setMembers(mems || []);

    const { data: lst } = await supabase.from("lists").select("data").eq("couple_id", coupleId).maybeSingle();
    if (!lst) {
      const seed: ListDoc = {
        categories: [
          { id: "books",  name: "Books",  colorIndex: 0 },
          { id: "places", name: "Places", colorIndex: 1 },
        ],
        items: []
      };
      await supabase.from("lists").insert({ couple_id: coupleId, data: seed });
      setListDoc(seed);
    } else {
      const existing = lst.data as ListDoc;
      const { changed, doc } = ensureCategoryColors(existing);
      setListDoc(doc);
      if (changed) await supabase.from("lists").update({ data: doc }).eq("couple_id", coupleId);
    }
  }
  function subscribeRealtime(coupleId: string) {
    supabase
      .channel("lists:" + coupleId)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "lists", filter: `couple_id=eq.${coupleId}` },
        payload => setListDoc((payload.new as any).data as ListDoc)
      )
      .subscribe();
  }
  async function saveDoc(next: ListDoc) {
    if (!profile?.couple_id) return;
    setListDoc(next);
    const { error } = await supabase.from("lists").update({ data: next }).eq("couple_id", profile.couple_id);
    if (error) alert(error.message);
  }

  /* ========= Couple actions ========= */
  async function createCouple() {
    if (!myId) return;
    const { data: couple, error } = await supabase.from("couples").insert({}).select("id").single();
    if (error) return alert(error.message);
    await supabase.from("profiles").update({ couple_id: couple.id }).eq("id", myId);
    await supabase.from("couple_members").insert({ couple_id: couple.id, user_id: myId });
    setProfile(p => p ? { ...p, couple_id: couple.id } : p);
    await ensureMembershipAndList(couple.id);
    subscribeRealtime(couple.id);
  }
  async function joinCouple() {
    if (!myId || !joinCode) return;
    const { error: insErr } = await supabase.from("couple_members").insert({ couple_id: joinCode, user_id: myId });
    if (insErr) { alert("Join failed. Check code."); return; }
    await supabase.from("profiles").update({ couple_id: joinCode }).eq("id", myId);
    setProfile(p => p ? { ...p, couple_id: joinCode } : p);
    await ensureMembershipAndList(joinCode);
    subscribeRealtime(joinCode);
  }

  /* ========= Category ops ========= */
  function addCategory() {
    if (!newCategory.trim() || !listDoc) return;
    const id = crypto.randomUUID();
    const idx = nextColorIndex(listDoc.categories);
    const cat: Category = { id, name: newCategory.trim(), colorIndex: idx };
    saveDoc({ ...listDoc, categories: [...listDoc.categories, cat] });
    setNewCategory("");
  }
  function renameCategory(id: string, name: string) {
    if (!listDoc) return;
    saveDoc({ ...listDoc, categories: listDoc.categories.map(c => c.id === id ? { ...c, name } : c) });
  }
  function deleteCategory(id: string) {
    if (!listDoc) return;
    saveDoc({
      ...listDoc,
      categories: listDoc.categories.filter(c => c.id !== id),
      items: listDoc.items.map(i => i.categoryId === id ? { ...i, categoryId: null } : i)
    });
    if (selectedCat === id) setSelectedCat("all");
  }

  /* ========= Item ops ========= */
  function addItem(catId: string | null, title: string, description: string, isSecret: boolean) {
    if (!listDoc || !myId) return;
    const item: Item = {
      id: crypto.randomUUID(),
      categoryId: catId,
      creatorId: myId,
      title: title.trim(),
      description: description.trim() || undefined,
      isSecret: !!isSecret,
      secretFor: isSecret ? (partnerId ?? null) : null,
      done: false,
      createdAt: new Date().toISOString(),
      alreadyDone: {},
      reactions: {},
      comments: []
    };
    saveDoc({ ...listDoc, items: [item, ...(listDoc.items || [])] });
  }
  function toggleDone(itemId: string) {
    if (!listDoc) return;
    const next = listDoc.items.map(i => {
      if (i.id !== itemId) return i;
      const newDone = !i.done;
      return newDone
        ? { ...i, done: true, isSecret: false, secretFor: null }
        : { ...i, done: false };
    });
    saveDoc({ ...listDoc, items: next });
  }
  function toggleAlreadyDone(itemId: string) {
    if (!listDoc || !myId) return;
    const items = listDoc.items.map(i => {
      if (i.id !== itemId) return i;
      const already = { ...(i.alreadyDone || {}) };
      already[myId] = !already[myId];
      return { ...i, alreadyDone: already };
    });
    saveDoc({ ...listDoc, items });
  }
  function react(itemId: string, emoji: string) {
    if (!listDoc || !myId) return;
    const items = listDoc.items.map(i => {
      if (i.id !== itemId) return i;
      const r = { ...(i.reactions || {}) };
      // toggle: click again to remove
      if (r[myId] === emoji) delete r[myId];
      else r[myId] = emoji;
      return { ...i, reactions: r };
    });
    saveDoc({ ...listDoc, items });
  }
  function editItem(itemId: string) {
    if (!listDoc || !myId) return;
    const i = listDoc.items.find(x => x.id === itemId);
    if (!i || i.creatorId !== myId) return;
    const newTitle = prompt("Edit title", i.title);
    if (newTitle === null) return;
    const newDesc = prompt("Edit description (empty to clear)", i.description || "") ?? "";
    const updated = listDoc.items.map(x => x.id === itemId ? {
      ...x, title: newTitle.trim() || x.title, description: newDesc.trim() || undefined
    } : x);
    saveDoc({ ...listDoc, items: updated });
  }
  function deleteItem(itemId: string) {
    if (!listDoc || !myId) return;
    const i = listDoc.items.find(x => x.id === itemId);
    if (!i || i.creatorId !== myId) return;
    saveDoc({ ...listDoc, items: listDoc.items.filter(x => x.id !== itemId) });
  }
  function addComment(itemId: string, text: string) {
    if (!listDoc || !myId || !text.trim()) return;
    const updated = listDoc.items.map(i => {
      if (i.id !== itemId) return i;
      const comments = i.comments ? [...i.comments] : [];
      comments.push({ id: crypto.randomUUID(), userId: myId, text: text.trim(), createdAt: new Date().toISOString() });
      return { ...i, comments };
    });
    saveDoc({ ...listDoc, items: updated });
  }

  /* ========= Derived (sort + filter) ========= */
  const visibleItems = !listDoc
    ? []
    : [...listDoc.items]
        // unfinished first, finished last; newest first within each group
        .sort((a, b) => {
          if (!!a.done !== !!b.done) return a.done ? 1 : -1;
          const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
          const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
          return tb - ta;
        })
        .filter(i => {
          if (secretOnly) return i.isSecret && i.creatorId === myId; // independent toggle
          if (selectedCat === "all")  return true;
          if (selectedCat === "null") return i.categoryId === null;
          return i.categoryId === selectedCat;
        });

  /* ========= UI ========= */
  if (loading) return <p>Loading…</p>;

  if (!session)
    return (
      <div className="card">
        <h1>Couples Bucket List</h1>
        <p className="muted">Sign in with a magic link.</p>
        <div className="row">
          <input placeholder="your@email.com" value={email} onChange={e=>setEmail(e.target.value)}/>
          <button onClick={signInWithMagicLink}>Send magic link</button>
        </div>
      </div>
    );

  if (session && !profile?.couple_id)
    return (
      <div className="grid">
        <div className="card">
          <h2>Create a new couple</h2>
          <p>You’ll get a code to share with your partner.</p>
          <button onClick={createCouple}>Create couple</button>
        </div>
        <div className="card">
          <h2>Join an existing couple</h2>
          <input placeholder="Paste couple code (UUID)" value={joinCode} onChange={e=>setJoinCode(e.target.value)} />
          <button onClick={joinCouple}>Join couple</button>
        </div>
        <div className="card">
          <button onClick={signOut}>Sign out</button>
        </div>
      </div>
    );

  return (
    <>
      <div className="row" style={{justifyContent:"space-between"}}>
        <div>
          <h1>Couples Bucket List</h1>
          <p className="muted">Share this couple code with your partner: <span className="badge">{coupleCode}</span></p>
          <p className="muted">Signed in as: {session.user.email}</p>
        </div>
        <button onClick={signOut}>Sign out</button>
      </div>

      <div className="grid">
        {/* Categories manager */}
        <div className="card">
          <h2>Categories</h2>
          <div className="row">
            <input placeholder="New category name" value={newCategory} onChange={e=>setNewCategory(e.target.value)}/>
            <button onClick={addCategory}>Add</button>
          </div>
          <ul>
            {listDoc?.categories.map(c => {
              const col = colorForCategory(c);
              return (
                <li key={c.id} className="row" style={{marginTop:8}}>
                  <span className="badge" style={{background: col.bg, borderColor: col.border, color: col.fg}}>{c.name}</span>
                  <input value={c.name} onChange={e=>renameCategory(c.id, e.target.value)} style={{flex:1}} />
                  <button onClick={()=>deleteCategory(c.id)}>Delete</button>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Add Item */}
        <AddItemCard
          categories={listDoc?.categories || []}
          selectedCat={selectedCat}
          onAdd={(catId, title, desc, secret)=>addItem(catId === "all" ? null : (catId === "null" ? null : catId), title, desc, secret)}
          partnerExists={!!partnerId}
        />
      </div>

      {/* Filter controls */}
      <div className="card">
        <div className="tabs" style={{justifyContent:"space-between", alignItems:"center", gap:12, flexWrap:"wrap"}}>
          {/* Left: category tabs */}
          <div className="row" style={{gap:8, flexWrap:"wrap"}}>
            <button
              className={`tab ${selectedCat === "all" ? "active" : ""}`}
              onClick={()=>setSelectedCat("all")}
            >All</button>

            {listDoc?.categories.map(c => {
              const col = colorForCategory(c);
              return (
                <button
                  key={c.id}
                  className={`tab ${selectedCat === c.id ? "active" : ""}`}
                  onClick={()=>setSelectedCat(c.id)}
                  style={{background: col.bg, borderColor: col.border, color: col.fg}}
                >
                  {c.name}
                </button>
              );
            })}

            <button
              className={`tab ${selectedCat === "null" ? "active" : ""}`}
              onClick={()=>setSelectedCat("null")}
            >No category</button>
          </div>

          {/* Right: distinct Secret toggle */}
          <button
            className={`secret-toggle ${secretOnly ? "on" : ""}`}
            onClick={()=>setSecretOnly(!secretOnly)}
            title="Show only items you marked as secret"
          >
            🔒 My secrets {secretOnly ? "ON" : "OFF"}
          </button>
        </div>
      </div>

      {/* Items */}
      <div className="card">
        <h2>Items</h2>
        {!visibleItems.length && <p className="muted">Nothing yet.</p>}

        {visibleItems.map(i => {
          const IAmViewer = myId === i.secretFor;
          const isSecretHidden = i.isSecret && IAmViewer;
          const myAlready = i.alreadyDone?.[myId || ""] || false;
          const myEmoji = i.reactions?.[myId || ""] || null;
          const canReact = myId && i.creatorId !== myId;

          const cat  = i.categoryId ? listDoc?.categories.find(c=>c.id===i.categoryId) : null;
          const col  = cat ? colorForCategory(cat) : null;
          const mine = i.creatorId === myId;

          return (
            <div key={i.id} className="card" style={{marginTop:12}}>
              <div className="row" style={{justifyContent:"space-between"}}>
                <div>
                  <div className="row" style={{gap:8, alignItems:"center"}}>
                    <span className={`badge ${mine ? "me" : "partner"}`}>
                      {mine ? "Created by me" : "Created by partner"}
                    </span>
                    {i.done ? <span className="badge">Done together ✅</span> : null}
                    {i.categoryId
                      ? <span className="badge" style={{background: col!.bg, borderColor: col!.border, color: col!.fg}}>{cat?.name || "Category"}</span>
                      : <span className="badge">No category</span>}
                    {i.createdAt ? <span className="badge muted">Created {fmtDate(i.createdAt)}</span> : null}
                    {i.isSecret ? <span className="badge">Secret</span> : null}
                    {partnerId && i.alreadyDone?.[partnerId] ? <span className="badge">Partner already did this</span> : null}
                    {myEmoji ? <span className="badge">You: {myEmoji}</span> : null}
                    {partnerId && i.reactions?.[partnerId] ? <span className="badge">Partner: {i.reactions[partnerId]}</span> : null}
                  </div>

                  <div style={{marginTop:6}}>
                    {isSecretHidden ? (
                      <div className="lock">
                        <strong>🔒 Secret item</strong>
                        <div className="muted">Your partner added something here.</div>
                      </div>
                    ) : (
                      <>
                        <strong>{i.title}</strong>
                        {i.description ? <div className="muted">{i.description}</div> : null}
                      </>
                    )}
                  </div>
                </div>

                <div className="row">
                  <button onClick={()=>toggleDone(i.id)}>{i.done ? "Mark not done" : "Done together"}</button>
                  <button onClick={()=>toggleAlreadyDone(i.id)}>
                    {myAlready ? "Unmark Done solo" : "Done solo"}
                  </button>
                  {mine && <button onClick={()=>editItem(i.id)}>Edit</button>}
                  {mine && <button onClick={()=>deleteItem(i.id)}>🗑️ Bin</button>}
                </div>
              </div>

              {/* Reactions: only to partner's items; click again to remove */}
              {canReact && (
                <div className="row" style={{marginTop:8}}>
                  {"❤️ 😂 👍 😍 😮".split(" ").map(e => {
                    const selected = i.reactions?.[myId!] === e;
                    return (
                      <button key={e} className={selected ? "emoji-selected" : ""} onClick={()=>react(i.id, e)}>
                        {e}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Comments: input on partner's items */}
              <div style={{marginTop:8}}>
                {i.comments && i.comments.length > 0 && (
                  <div style={{marginBottom:6}}>
                    {i.comments.slice().sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt)).map(c => {
                      const mineC = c.userId === myId;
                      return (
                        <div key={c.id} className="comment">
                          <span className="badge" style={{marginRight:8}}>{mineC ? "You" : (c.userId === i.creatorId ? "Author" : "Partner")}</span>
                          <span>{c.text}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
                {myId && i.creatorId !== myId && (
                  <CommentInput onSubmit={(txt)=>addComment(i.id, txt)} />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ========= Sub-components ========= */
function AddItemCard({
  categories, selectedCat, onAdd, partnerExists
}: {
  categories: Category[];
  selectedCat: string | "all";
  onAdd: (catId: string | "all" | "null", title: string, desc: string, secret: boolean) => void;
  partnerExists: boolean;
}) {
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [cat, setCat] = useState<string | "all">(selectedCat);
  const [secret, setSecret] = useState(false);
  useEffect(()=>setCat(selectedCat),[selectedCat]);

  return (
    <div className="card">
      <h2>Add item</h2>
      <div className="row">
        <select value={cat} onChange={e=>setCat(e.target.value)}>
          <option value="all">Choose category…</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          <option value="null">No category</option>
        </select>
      </div>
      <div style={{marginTop:8}}>
        <input placeholder="Title (e.g. Paris sunrise at Trocadéro)" value={title} onChange={e=>setTitle(e.target.value)} />
      </div>
      <div style={{marginTop:8}}>
        <textarea rows={3} placeholder="Optional description" value={desc} onChange={e=>setDesc(e.target.value)} />
      </div>
      <div className="row" style={{marginTop:8}}>
        <label className="row" style={{gap:8}}>
          <input type="checkbox" checked={secret} onChange={e=>setSecret(e.target.checked)} />
          Make this secret (your partner will only see a 🔒 placeholder)
        </label>
      </div>
      {!partnerExists && secret && <div className="muted" style={{marginTop:8}}>Invite your partner first so I know who to hide it from.</div>}
      <div style={{marginTop:12}}>
        <button onClick={()=>{
          if (!title.trim()) return alert("Add a title");
          onAdd(cat, title, desc, secret);
          setTitle(""); setDesc(""); setSecret(false);
        }}>Add</button>
      </div>
    </div>
  );
}

function CommentInput({ onSubmit }: { onSubmit: (text: string) => void }) {
  const [t, setT] = useState("");
  return (
    <div className="row">
      <input
        placeholder="Write a comment…"
        value={t}
        onChange={e=>setT(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") { onSubmit(t); setT(""); } }}
      />
      <button onClick={()=>{ onSubmit(t); setT(""); }}>Comment</button>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import "./globals.css";

type Session = { user: { id: string; email?: string | null } } | null;

type Member = { user_id: string };
type Category = { id: string; name: string };
type Item = {
  id: string;
  categoryId: string | null;
  creatorId: string;
  title: string;
  description?: string;
  isSecret?: boolean;
  secretFor?: string | null;
  done?: boolean;
  alreadyDone?: Record<string, boolean>;
  reactions?: Record<string, string>;
};

type ListDoc = { categories: Category[]; items: Item[] };

export default function Page() {
  const [session, setSession] = useState<Session>(null);
  const [email, setEmail] = useState("");
  const [profile, setProfile] = useState<{ id: string; display_name: string | null; couple_id: string | null } | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [listDoc, setListDoc] = useState<ListDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [joinCode, setJoinCode] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [selectedCat, setSelectedCat] = useState<string | "all">("all");

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
  const partnerId = useMemo(() => {
    if (!myId) return null;
    const partner = members.find(m => m.user_id !== myId);
    return partner?.user_id ?? null;
  }, [members, myId]);

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
    setProfile(null);
    setMembers([]);
    setListDoc(null);
  }

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
    if (insErr) { alert("Join failed. Check code (must be a valid couple ID)."); return; }
    await supabase.from("profiles").update({ couple_id: joinCode }).eq("id", myId);
    setProfile(p => p ? { ...p, couple_id: joinCode } : p);
    await ensureMembershipAndList(joinCode);
    subscribeRealtime(joinCode);
  }

  async function ensureMembershipAndList(coupleId: string) {
    const { data: mems } = await supabase.from("couple_members").select("user_id").eq("couple_id", coupleId);
    setMembers(mems || []);
    const { data: lst } = await supabase.from("lists").select("data").eq("couple_id", coupleId).maybeSingle();
    if (!lst) {
      await supabase.from("lists").insert({ couple_id: coupleId });
      setListDoc({ categories: [{ id: "books", name: "Books" }, { id: "places", name: "Places" }], items: [] });
    } else {
      setListDoc(lst.data as ListDoc);
    }
  }

  function subscribeRealtime(coupleId: string) {
    const chan = supabase
      .channel("lists:" + coupleId)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "lists", filter: `couple_id=eq.${coupleId}` },
        payload => {
          const newData = (payload.new as any).data as ListDoc;
          setListDoc(newData);
        }
      )
      .subscribe();
  }

  async function saveDoc(next: ListDoc) {
    if (!profile?.couple_id) return;
    setListDoc(next);
    const { error } = await supabase.from("lists").update({ data: next }).eq("couple_id", profile.couple_id);
    if (error) alert(error.message);
  }

  function addCategory() {
    if (!newCategory.trim() || !listDoc) return;
    const id = crypto.randomUUID();
    saveDoc({ ...listDoc, categories: [...listDoc.categories, { id, name: newCategory.trim() }] });
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
      alreadyDone: {},
      reactions: {}
    };
    saveDoc({ ...listDoc, items: [item, ...listDoc.items] });
  }
  function toggleDone(itemId: string) {
    if (!listDoc) return;
    saveDoc({ ...listDoc, items: listDoc.items.map(i => i.id === itemId ? { ...i, done: !i.done } : i) });
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
      r[myId] = emoji;
      return { ...i, reactions: r };
    });
    saveDoc({ ...listDoc, items });
  }

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

  const partnerReactionHint = "❤️ 😂 👍 😍 😮".split(" ");

  const visibleItems = useMemo(() => {
    if (!listDoc) return [];
    let arr = listDoc.items;
    if (selectedCat !== "all") arr = arr.filter(i => i.categoryId === selectedCat);
    return arr;
  }, [listDoc, selectedCat]);

  const coupleCode = profile?.couple_id ?? "";

  return (
    <>
      <div className="row" style={{justifyContent:"space-between"}}>
        <div>
          <h1>Couples Bucket List</h1>
          <p className="muted">Share this couple code with your partner to join: <span className="badge">{coupleCode}</span></p>
          <p className="muted">Signed in as: {session.user.email}</p>
        </div>
        <button onClick={signOut}>Sign out</button>
      </div>

      <div className="grid">
        <div className="card">
          <h2>Categories</h2>
          <div className="row">
            <select value={selectedCat} onChange={e=>setSelectedCat(e.target.value)}>
              <option value="all">All</option>
              {listDoc?.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              <option value="null">No category</option>
            </select>
            <input placeholder="New category name" value={newCategory} onChange={e=>setNewCategory(e.target.value)}/>
            <button onClick={addCategory}>Add</button>
          </div>
          <ul>
            {listDoc?.categories.map(c => (
              <li key={c.id} className="row" style={{marginTop:8}}>
                <input value={c.name} onChange={e=>renameCategory(c.id, e.target.value)} style={{flex:1}} />
                <button onClick={()=>deleteCategory(c.id)}>Delete</button>
              </li>
            ))}
          </ul>
        </div>

        <AddItemCard
          categories={listDoc?.categories || []}
          selectedCat={selectedCat}
          onAdd={(catId, title, desc, secret)=>addItem(catId === "all" ? null : (catId === "null" ? null : catId), title, desc, secret)}
          partnerExists={!!partnerId}
        />
      </div>

      <div className="card">
        <h2>Items</h2>
        {!visibleItems.length && <p className="muted">Nothing yet. Add your first item!</p>}
        <div>
          {visibleItems.map(i => {
            const IAmViewer = myId === i.secretFor;
            const isSecretHidden = i.isSecret && IAmViewer;
            const myAlready = i.alreadyDone?.[myId || ""] || false;
            const partnerEmoji = Object.entries(i.reactions || {})
              .find(([uid]) => uid !== myId || "")?.[1];

            return (
              <div key={i.id} className="card" style={{marginTop:12}}>
                <div className="row" style={{justifyContent:"space-between"}}>
                  <div>
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
                    <div className="row" style={{marginTop:8}}>
                      <span className="badge">{i.done ? "Done together ✅" : "Not done"}</span>
                      {i.categoryId
                        ? <span className="badge">{(listDoc?.categories.find(c=>c.id===i.categoryId)?.name) || "Category"}</span>
                        : <span className="badge">No category</span>}
                      {i.isSecret ? <span className="badge">Secret</span> : null}
                      {partnerEmoji ? <span className="badge">Partner reacted: {partnerEmoji}</span> : null}
                    </div>
                  </div>

                  <div className="row">
                    <button onClick={()=>toggleDone(i.id)}>{i.done ? "Mark not done" : "Mark done"}</button>
                    <button onClick={()=>toggleAlreadyDone(i.id)}>
                      {myAlready ? "Unmark 'I already did this'" : "I already did this"}
                    </button>
                  </div>
                </div>

                {myId && i.creatorId !== myId && (
                  <div className="row" style={{marginTop:8}}>
                    {"❤️ 😂 👍 😍 😮".split(" ").map(e => (
                      <button key={e} onClick={()=>react(i.id, e)}>{e}</button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function AddItemCard({
  categories,
  selectedCat,
  onAdd,
  partnerExists
}: {
  categories: { id: string; name: string }[];
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

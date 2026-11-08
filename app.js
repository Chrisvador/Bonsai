/* Mes bonsaïs — collection, travaux, photos. Données dans Supabase (tables bonsais, travaux, bonsai_photos, stockage « bonsai »). */
(() => {
'use strict';
const SB_URL = 'https://istppmzkpkwgxpyafcfw.supabase.co';
const SB_KEY = 'sb_publishable_ZPXa_NiEzsUTt-D1iMQC9g_lRQoBRtk';
const sb = window.supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'bonsai-auth' } });
const BUCKET = 'bonsai';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lsg = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } };
const lss = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
const today = () => new Date().toLocaleDateString('sv-SE');

const ORIGINES = { yamadori: 'Yamadori', echange_club: 'Échange club', jardinerie: 'Jardinerie', autre: 'Autre' };
const TYPES = { rempotage: 'Rempotage', taille: 'Taille', autre: 'Autre' };
const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const fmtDate = d => { if (!d) return '—'; const [y, m, j] = d.split('-').map(Number); return `${j} ${MOIS[m - 1]} ${y}`; };
const yearsSince = d => { if (!d) return 0; const a = new Date(d), n = new Date(); let y = n.getFullYear() - a.getFullYear(); if (n.getMonth() < a.getMonth() || (n.getMonth() === a.getMonth() && n.getDate() < a.getDate())) y--; return Math.max(0, y); };
const norm = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const ans = n => n + (n > 1 ? ' ans' : ' an');

const ICON_TREE = '<svg viewBox="0 0 64 64" width="56" height="56" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M32 46c0-8 2-14 8-18M32 40c-2-6-7-9-12-10"/><ellipse cx="22" cy="24" rx="12" ry="7"/><ellipse cx="42" cy="20" rx="13" ry="8"/><path d="M14 46h36l-4 8H18z"/></svg>';

/* ---------- état ---------- */
let me = null;
let B = [], T = [], P = [];          // bonsaïs, travaux, photos
let filter = lsg('bz-filter', 'tous'), sortBy = lsg('bz-sort', 'nom'), query = '';
let openId = null;
const CACHE = 'bz-cache';

/* ---------- toast ---------- */
let toastT;
function toast(msg, ms = 2600) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms); }

/* ---------- URLs signées des photos (gardées 6 jours pour profiter du cache du navigateur) ---------- */
let urls = lsg('bz-urls', {});
const URL_TTL = 7 * 24 * 3600;
async function signAll(paths) {
  const now = Date.now(), need = [...new Set(paths)].filter(p => p && !(urls[p] && urls[p].e > now + 24 * 3600e3));
  for (let i = 0; i < need.length; i += 100) {
    const chunk = need.slice(i, i + 100);
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(chunk, URL_TTL);
    if (error) { console.warn(error); continue; }
    data.forEach(d => { if (d.signedUrl) urls[d.path] = { u: d.signedUrl, e: now + (URL_TTL - 3600) * 1e3 }; });
  }
  for (const k in urls) if (urls[k].e < now) delete urls[k];
  lss('bz-urls', urls);
}
const url = p => (p && urls[p] ? urls[p].u : '');
const thumbPath = p => p ? p.replace(/\.jpg$/, '_t.jpg') : '';

/* ---------- données ---------- */
function saveCache() { lss(CACHE, { uid: me && me.id, B, T, P }); }
async function load() {
  const [b, t, p] = await Promise.all([
    sb.from('bonsais').select('*').order('nom'),
    sb.from('travaux').select('*').order('date', { ascending: false }),
    sb.from('bonsai_photos').select('*').order('date', { ascending: false, nullsFirst: false })
  ]);
  const err = b.error || t.error || p.error;
  if (err) { console.warn(err); if (!B.length) toast('Chargement impossible : ' + err.message); return; }
  B = b.data; T = t.data; P = p.data; saveCache();
  await signAll(B.map(x => thumbPath(mainPhoto(x)?.chemin)));
  render();
  if (openId) renderDetail();
}
const photosOf = id => P.filter(p => p.bonsai_id === id);
const travauxOf = id => T.filter(t => t.bonsai_id === id).sort((a, b) => b.date.localeCompare(a.date) || (b.created_at || '').localeCompare(a.created_at || ''));
function mainPhoto(b) {
  const ps = photosOf(b.id); if (!ps.length) return null;
  return ps.find(p => p.id === b.photo_principale) || ps.slice().sort((x, y) => (y.date || '').localeCompare(x.date || ''))[0];
}
const lastRepot = id => { const r = T.filter(t => t.bonsai_id === id && t.type === 'rempotage').map(t => t.date).sort(); return r[r.length - 1] || null; };

/* ---------- liste ---------- */
function render() {
  $('nAll').textContent = B.length;
  $('nRepot').textContent = B.filter(b => b.rempotage_a_prevoir).length;
  $('nHiver').textContent = B.filter(b => b.abri_hiver).length;
  $('sub').textContent = `${B.length} arbre${B.length > 1 ? 's' : ''} · ${T.length} travaux`;
  document.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', c.dataset.f === filter));
  $('sort').value = sortBy;
  const q = query.trim().toLowerCase();
  let list = B.filter(b => (filter === 'repot' ? b.rempotage_a_prevoir : filter === 'hiver' ? b.abri_hiver : true)
    && (!q || [b.nom, b.espece, b.origine_detail, ORIGINES[b.origine]].some(v => v && v.toLowerCase().includes(q))));
  const coll = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });
  list.sort(sortBy === 'acq' ? (a, b) => (a.date_acquisition || '9').localeCompare(b.date_acquisition || '9')
    : sortBy === 'repot' ? (a, b) => (lastRepot(a.id) || '0').localeCompare(lastRepot(b.id) || '0')
    : (a, b) => coll.compare(a.nom, b.nom));
  const g = $('grid');
  if (!list.length) {
    g.innerHTML = `<div class="empty" style="grid-column:1/-1">${filter === 'repot' ? 'Aucun bonsaï marqué « rempotage à prévoir ». Ouvrez une fiche pour le cocher.' : B.length ? 'Aucun résultat.' : 'Aucun bonsaï pour l\'instant. Touchez « Ajouter ».'}</div>`;
    return;
  }
  g.innerHTML = list.map(b => {
    const ph = mainPhoto(b), u = ph && url(thumbPath(ph.chemin)), lr = lastRepot(b.id);
    const age = b.age_acquisition != null ? ` · ≈ ${ans(b.age_acquisition + yearsSince(b.date_acquisition))}` : '';
    return `<button class="card" data-id="${b.id}" type="button">
      <div class="ph">${u ? `<img class="bg" src="${esc(u)}" alt="" aria-hidden="true" loading="lazy"><img src="${esc(u)}" alt="" loading="lazy">` : `<span class="ph-empty">${ICON_TREE}</span>`}
        <div class="badges">${b.rempotage_a_prevoir ? '<span class="badge repot">Rempotage à prévoir</span>' : ''}${b.abri_hiver ? '<span class="badge hiver">❄ Abri l\'hiver</span>' : ''}</div></div>
      <div class="body"><h3>${esc(b.nom)}</h3>
        <div class="meta">${esc(ORIGINES[b.origine] || 'Origine ?')}${b.date_acquisition ? ' · depuis ' + b.date_acquisition.slice(0, 4) : ''}${age}</div>
        <div class="meta">${lr ? 'Dernier rempotage : ' + fmtDate(lr) : 'Jamais rempoté ici'}</div></div>
    </button>`;
  }).join('');
}

/* ---------- fiche ---------- */
function openSheet(html) { const s = $('sheet'); s.innerHTML = `<div class="panel" role="dialog" aria-modal="true">${html}</div>`; s.hidden = false; document.body.style.overflow = 'hidden'; }
function closeSheet() { $('sheet').hidden = true; $('sheet').innerHTML = ''; document.body.style.overflow = ''; openId = null; if (location.hash) history.replaceState(null, '', location.pathname + location.search); }
let tFilter = 'tous';
async function openDetail(id) { openId = id; tFilter = 'tous'; if (location.hash !== '#' + id) history.replaceState(null, '', '#' + id); renderDetail(); }
async function renderDetail() {
  const b = B.find(x => x.id === openId); if (!b) { closeSheet(); return; }
  const ps = photosOf(b.id).sort((x, y) => (y.date || '').localeCompare(x.date || ''));
  const main = mainPhoto(b);
  const tr = travauxOf(b.id).filter(t => tFilter === 'tous' || t.type === tFilter);
  const hist = tr.slice();
  if (tFilter === 'tous') {           // photos sans travail associé : regroupées par date dans l'historique
    const g = {};
    ps.filter(p => !p.travail_id && p.date).forEach(p => { (g[p.date] = g[p.date] || []).push(p); });
    Object.entries(g).forEach(([date, arr]) => hist.push({ photosOnly: true, date, ps: arr, caps: [...new Set(arr.map(p => p.legende).filter(Boolean))].join(' · ') }));
    hist.sort((a, c) => c.date.localeCompare(a.date));
  }
  const scrolled = $('sheet').querySelector('.panel')?.scrollTop || 0;
  const age = b.age_acquisition != null ? `${ans(b.age_acquisition)} à l'acquisition · ≈ ${ans(b.age_acquisition + yearsSince(b.date_acquisition))} aujourd'hui` : 'Non renseigné';
  const cnt = k => travauxOf(b.id).filter(t => k === 'tous' || t.type === k).length;
  openSheet(`
    <div class="panel-head"><button class="iconbtn" data-act="close" aria-label="Fermer"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M15 5l-7 7 7 7"/></svg></button>
      <h2>${esc(b.nom)}</h2><button class="btn" data-act="edit">Modifier</button></div>
    <div class="panel-body">
      <div class="hero">${main ? `<img class="bg" src="${esc(url(thumbPath(main.chemin)))}" alt="" aria-hidden="true"><img src="${esc(url(main.chemin) || url(thumbPath(main.chemin)))}" alt="${esc(b.nom)}" data-photo="${main.id}">` : `<span class="ph-empty">${ICON_TREE}</span>`}</div>
      <div class="toggle-row">
        <label class="switch ${b.rempotage_a_prevoir ? 'on' : ''}"><input type="checkbox" data-act="repot" ${b.rempotage_a_prevoir ? 'checked' : ''}><span><strong>Rempotage à prévoir</strong><br><span class="meta">${lastRepot(b.id) ? 'Dernier : ' + fmtDate(lastRepot(b.id)) : 'Aucun rempotage noté'}</span></span></label>
        <label class="switch hiver ${b.abri_hiver ? 'on' : ''}"><input type="checkbox" data-act="hiver" ${b.abri_hiver ? 'checked' : ''}><span><strong>À mettre à l'abri l'hiver</strong><br><span class="meta">${b.abri_hiver ? 'Oui' : 'Non, reste dehors'}</span></span></label>
      </div>
      <div class="facts">
        <div class="fact"><span>Acquisition</span><strong>${fmtDate(b.date_acquisition)}</strong></div>
        <div class="fact"><span>Âge estimé</span><strong>${esc(age)}</strong></div>
        <div class="fact"><span>Origine</span><strong>${esc(ORIGINES[b.origine] || '—')}</strong>${b.origine_detail && norm(b.origine_detail) !== norm(ORIGINES[b.origine] || '') ? `<div class="meta">${esc(b.origine_detail)}</div>` : ''}</div>
        ${b.espece ? `<div class="fact"><span>Espèce</span><strong>${esc(b.espece)}</strong></div>` : ''}
      </div>

      <div class="section-title"><h3>Historique</h3><button class="btn pri" data-act="addwork">+ Travail</button></div>
      <div class="seg" role="group" aria-label="Filtrer les travaux">
        ${['tous', 'rempotage', 'taille', 'autre'].map(k => `<button type="button" data-tf="${k}" aria-pressed="${tFilter === k}">${k === 'tous' ? 'Tous' : TYPES[k]} ${cnt(k)}</button>`).join('')}
      </div>
      <ul class="timeline">${hist.length ? hist.map(t => {
        if (t.photosOnly) return `<li><span class="tag photo">Photos</span>
          <div><div class="when">${fmtDate(t.date)}</div>${t.caps ? `<div class="note">${esc(t.caps)}</div>` : ''}
          <div class="thumbs">${t.ps.map(p => `<img src="${esc(url(thumbPath(p.chemin)))}" alt="" data-photo="${p.id}" loading="lazy">`).join('')}</div></div><span></span></li>`;
        const tp = P.filter(p => p.travail_id === t.id);
        return `<li><span class="tag ${t.type}">${TYPES[t.type]}</span>
          <div><div class="when">${fmtDate(t.date)}</div>${t.note ? `<div class="note">${esc(t.note)}</div>` : ''}
          ${tp.length ? `<div class="thumbs">${tp.map(p => `<img src="${esc(url(thumbPath(p.chemin)))}" alt="" data-photo="${p.id}" loading="lazy">`).join('')}</div>` : ''}</div>
          <button class="iconbtn" data-work="${t.id}" aria-label="Modifier ce travail">✎</button></li>`;
      }).join('') : '<li><span></span><div class="meta">Rien pour l\'instant.</div><span></span></li>'}</ul>

      <div class="section-title"><h3>Photos · ${ps.length}</h3>
        <label class="btn">+ Photos<input type="file" accept="image/*" multiple hidden data-act="addphotos"></label></div>
      ${ps.length ? `<div class="gallery">${ps.map(p => `<button type="button" data-photo="${p.id}" aria-label="${esc(p.legende || 'Photo')} ${p.date ? fmtDate(p.date) : ''}"><img src="${esc(url(thumbPath(p.chemin)))}" alt="" loading="lazy">${main && p.id === main.id ? '<span class="star">Principale</span>' : ''}</button>`).join('')}</div>` : '<p class="meta">Aucune photo. Ajoutez-en depuis la photothèque.</p>'}
      <p class="status" id="upStatus"></p>

      ${b.notes ? `<div class="section-title"><h3>Notes</h3></div><div class="notes">${esc(b.notes)}</div>` : ''}
    </div>`);
  const panel = $('sheet').querySelector('.panel'); panel.scrollTop = scrolled;
  const need = ps.map(p => thumbPath(p.chemin)); if (main) need.push(main.chemin);
  if (need.some(p => !url(p))) { await signAll(need); if (openId === b.id) { const keep = panel.scrollTop; renderDetail(); $('sheet').querySelector('.panel').scrollTop = keep; } }
}

async function patchBonsai(id, fields) {
  const b = B.find(x => x.id === id); const old = { ...b };
  Object.assign(b, fields); render(); if (openId === id) renderDetail();
  const { error } = await sb.from('bonsais').update(fields).eq('id', id);
  if (error) { Object.assign(b, old); render(); if (openId === id) renderDetail(); toast('Échec : ' + error.message); return false; }
  saveCache(); return true;
}

/* ---------- formulaire bonsaï ---------- */
function bonsaiForm(b) {
  const isNew = !b; b = b || { abri_hiver: false, rempotage_a_prevoir: false, date_acquisition: today() };
  openSheet(`
    <div class="panel-head"><button class="iconbtn" data-act="${isNew ? 'close' : 'back'}" aria-label="Retour"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M15 5l-7 7 7 7"/></svg></button><h2>${isNew ? 'Nouveau bonsaï' : 'Modifier'}</h2></div>
    <div class="panel-body"><form class="f" id="bForm">
      <label class="field"><span>Nom</span><input name="nom" required value="${esc(b.nom || '')}" placeholder="Ex. Érable du Japon 2"></label>
      <label class="field"><span>Espèce (facultatif)</span><input name="espece" value="${esc(b.espece || '')}"></label>
      <div class="row2">
        <label class="field"><span>Date d'acquisition</span><input name="date_acquisition" type="date" value="${esc(b.date_acquisition || '')}"></label>
        <label class="field"><span>Âge estimé à l'acquisition (ans)</span><input name="age_acquisition" type="number" min="0" max="1000" inputmode="numeric" value="${b.age_acquisition ?? ''}"></label>
      </div>
      <div class="row2">
        <label class="field"><span>Origine</span><select name="origine"><option value="">—</option>${Object.entries(ORIGINES).map(([k, v]) => `<option value="${k}" ${b.origine === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="field"><span>Précision (lieu, personne…)</span><input name="origine_detail" value="${esc(b.origine_detail || '')}"></label>
      </div>
      <label class="switch hiver ${b.abri_hiver ? 'on' : ''}"><input type="checkbox" name="abri_hiver" ${b.abri_hiver ? 'checked' : ''}><strong>À mettre à l'abri l'hiver</strong></label>
      <label class="switch ${b.rempotage_a_prevoir ? 'on' : ''}"><input type="checkbox" name="rempotage_a_prevoir" ${b.rempotage_a_prevoir ? 'checked' : ''}><strong>Rempotage à prévoir</strong></label>
      <label class="field"><span>Notes</span><textarea name="notes">${esc(b.notes || '')}</textarea></label>
      ${isNew ? '<label class="field"><span>Photos (facultatif)</span><input type="file" name="photos" accept="image/*" multiple></label>' : ''}
      <p class="err" id="bErr" role="alert"></p>
      <div class="foot">${isNew ? '' : '<button type="button" class="btn danger" data-act="delbonsai">Supprimer</button><span class="spacer"></span>'}
        <button type="button" class="btn" data-act="${isNew ? 'close' : 'back'}">Annuler</button><button class="btn pri" type="submit">Enregistrer</button></div>
    </form></div>`);
  const f = $('bForm');
  f.querySelectorAll('.switch input').forEach(i => i.onchange = () => i.closest('.switch').classList.toggle('on', i.checked));
  f.onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(f), btn = f.querySelector('[type=submit]');
    const age = fd.get('age_acquisition');
    const row = {
      nom: fd.get('nom').trim(), espece: fd.get('espece').trim() || null,
      date_acquisition: fd.get('date_acquisition') || null,
      age_acquisition: age === '' ? null : Math.round(Number(age)),
      origine: fd.get('origine') || null, origine_detail: fd.get('origine_detail').trim() || null,
      abri_hiver: !!fd.get('abri_hiver'), rempotage_a_prevoir: !!fd.get('rempotage_a_prevoir'),
      notes: fd.get('notes').trim() || null
    };
    if (!row.nom) { $('bErr').textContent = 'Le nom est obligatoire.'; return; }
    btn.disabled = true;
    if (isNew) {
      const { data, error } = await sb.from('bonsais').insert(row).select().single();
      if (error) { $('bErr').textContent = 'Échec : ' + error.message; btn.disabled = false; return; }
      B.push(data); saveCache(); render();
      const files = f.querySelector('[name=photos]').files;
      openDetail(data.id);
      if (files.length) uploadPhotos(data.id, files, null, today());
    } else {
      const ok = await patchBonsai(b.id, row);
      if (!ok) { btn.disabled = false; return; }
      openDetail(b.id);
    }
  };
}

/* ---------- formulaire travail ---------- */
function workForm(bonsaiId, t) {
  const isNew = !t; t = t || { type: 'taille', date: today(), note: '' };
  const b = B.find(x => x.id === bonsaiId);
  openSheet(`
    <div class="panel-head"><button class="iconbtn" data-act="back" aria-label="Retour"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M15 5l-7 7 7 7"/></svg></button><h2>${isNew ? 'Nouveau travail' : 'Modifier le travail'} · ${esc(b.nom)}</h2></div>
    <div class="panel-body"><form class="f" id="wForm">
      <div class="seg" role="group" aria-label="Type de travail" id="wType">${Object.entries(TYPES).map(([k, v]) => `<button type="button" data-v="${k}" aria-pressed="${t.type === k}">${v}</button>`).join('')}</div>
      <label class="field"><span>Date</span><input name="date" type="date" required value="${esc(t.date)}"></label>
      <label class="field"><span>Note</span><textarea name="note" placeholder="Substrat, pot, observations…">${esc(t.note || '')}</textarea></label>
      <label class="field"><span>Photos (facultatif)</span><input type="file" name="photos" accept="image/*" multiple></label>
      <p class="meta" id="wHint">${b.rempotage_a_prevoir ? 'Enregistrer un rempotage décochera « Rempotage à prévoir ».' : ''}</p>
      <p class="err" id="wErr" role="alert"></p>
      <div class="foot">${isNew ? '' : '<button type="button" class="btn danger" data-act="delwork">Supprimer</button><span class="spacer"></span>'}
        <button type="button" class="btn" data-act="back">Annuler</button><button class="btn pri" type="submit">Enregistrer</button></div>
    </form></div>`);
  let type = t.type;
  const f = $('wForm');
  $('wType').onclick = e => { const x = e.target.closest('button'); if (!x) return; type = x.dataset.v; $('wType').querySelectorAll('button').forEach(y => y.setAttribute('aria-pressed', y === x)); };
  f.querySelector('[data-act=delwork]')?.addEventListener('click', async () => {
    if (!confirm('Supprimer ce travail ? Ses photos restent dans la galerie.')) return;
    const { error } = await sb.from('travaux').delete().eq('id', t.id);
    if (error) { $('wErr').textContent = error.message; return; }
    T = T.filter(x => x.id !== t.id); P.forEach(p => { if (p.travail_id === t.id) p.travail_id = null; }); saveCache(); render(); openDetail(bonsaiId);
  });
  f.onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(f), btn = f.querySelector('[type=submit]'); btn.disabled = true;
    const row = { type, date: fd.get('date'), note: fd.get('note').trim() || null };
    let saved;
    if (isNew) {
      const r = await sb.from('travaux').insert({ ...row, bonsai_id: bonsaiId }).select().single();
      if (r.error) { $('wErr').textContent = 'Échec : ' + r.error.message; btn.disabled = false; return; }
      saved = r.data; T.push(saved);
    } else {
      const r = await sb.from('travaux').update(row).eq('id', t.id).select().single();
      if (r.error) { $('wErr').textContent = 'Échec : ' + r.error.message; btn.disabled = false; return; }
      saved = r.data; T = T.map(x => x.id === t.id ? saved : x);
    }
    saveCache();
    const files = f.querySelector('[name=photos]').files;
    if (type === 'rempotage' && b.rempotage_a_prevoir && isNew) { await patchBonsai(bonsaiId, { rempotage_a_prevoir: false }); toast('Rempotage noté · retiré de « à prévoir »'); }
    openDetail(bonsaiId); render();
    if (files.length) uploadPhotos(bonsaiId, files, saved.id, saved.date);
  };
}

/* ---------- photos ---------- */
async function toJpeg(src, max, q) {
  const bmp = await createImageBitmap(src);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(bmp, 0, 0, w, h); bmp.close && bmp.close();
  return await new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('Conversion impossible')), 'image/jpeg', q));
}
async function putPhoto(bonsaiId, src, meta) {
  const id = uuid(), path = `${me.id}/${bonsaiId}/${id}.jpg`;
  const [big, small] = [await toJpeg(src, 1600, .82), await toJpeg(src, 420, .78)];
  const st = sb.storage.from(BUCKET);
  let r = await st.upload(path, big, { contentType: 'image/jpeg', upsert: true }); if (r.error) throw r.error;
  r = await st.upload(thumbPath(path), small, { contentType: 'image/jpeg', upsert: true }); if (r.error) throw r.error;
  const ins = await sb.from('bonsai_photos').insert({ id, bonsai_id: bonsaiId, chemin: path, ...meta }).select().single();
  if (ins.error) { await st.remove([path, thumbPath(path)]); throw ins.error; }
  return ins.data;
}
async function uploadPhotos(bonsaiId, files, travailId, date) {
  const list = [...files]; let ok = 0;
  const say = m => { const s = $('upStatus'); if (s) s.textContent = m; };
  for (const f of list) {
    say(`Envoi des photos… ${ok + 1}/${list.length}`);
    try {
      const d = f.lastModified ? new Date(f.lastModified).toLocaleDateString('sv-SE') : null;
      const p = await putPhoto(bonsaiId, f, { travail_id: travailId, date: date || d || today() });
      P.unshift(p); ok++;
    } catch (e) { console.warn(e); toast('Photo non envoyée : ' + (e.message || e)); }
  }
  saveCache(); say(''); render(); if (openId === bonsaiId) renderDetail();
  if (ok) toast(`${ok} photo${ok > 1 ? 's' : ''} ajoutée${ok > 1 ? 's' : ''}`);
}

/* ---------- visionneuse ---------- */
let vList = [], vIdx = 0;
function openViewer(photoId) {
  const p = P.find(x => x.id === photoId); if (!p) return;
  vList = photosOf(p.bonsai_id).sort((x, y) => (y.date || '').localeCompare(x.date || '')); vIdx = vList.findIndex(x => x.id === photoId);
  paintViewer();
}
async function paintViewer() {
  const p = vList[vIdx], b = B.find(x => x.id === p.bonsai_id), v = $('viewer');
  if (!url(p.chemin)) await signAll([p.chemin]);
  const isMain = mainPhoto(b)?.id === p.id;
  v.innerHTML = `<img src="${esc(url(p.chemin))}" alt="${esc(p.legende || b.nom)}">
    <div class="vbar"><button class="btn" data-v="prev" aria-label="Précédente" ${vIdx <= 0 ? 'disabled' : ''}>‹</button>
    <button class="btn" data-v="next" aria-label="Suivante" ${vIdx >= vList.length - 1 ? 'disabled' : ''}>›</button>
    <div class="cap">${p.date ? fmtDate(p.date) : ''}${p.legende ? ' · ' + esc(p.legende) : ''} <span style="opacity:.6">(${vIdx + 1}/${vList.length})</span></div>
    ${isMain ? '' : '<button class="btn" data-v="main">Photo principale</button>'}
    <button class="btn" data-v="del">Supprimer</button><button class="btn" data-v="close">Fermer</button></div>`;
  v.hidden = false;
}
$('viewer').addEventListener('click', async e => {
  const a = e.target.closest('[data-v]')?.dataset.v; if (!a) return;
  const p = vList[vIdx];
  if (a === 'close') { $('viewer').hidden = true; $('viewer').innerHTML = ''; }
  if (a === 'prev' && vIdx > 0) { vIdx--; paintViewer(); }
  if (a === 'next' && vIdx < vList.length - 1) { vIdx++; paintViewer(); }
  if (a === 'main') { await patchBonsai(p.bonsai_id, { photo_principale: p.id }); paintViewer(); toast('Photo principale changée'); }
  if (a === 'del') {
    if (!confirm('Supprimer définitivement cette photo ?')) return;
    const { error } = await sb.from('bonsai_photos').delete().eq('id', p.id);
    if (error) { toast(error.message); return; }
    await sb.storage.from(BUCKET).remove([p.chemin, thumbPath(p.chemin)]);
    P = P.filter(x => x.id !== p.id); saveCache();
    vList.splice(vIdx, 1); render(); if (openId) renderDetail();
    if (!vList.length) { $('viewer').hidden = true; return; }
    vIdx = Math.min(vIdx, vList.length - 1); paintViewer();
  }
});
document.addEventListener('keydown', e => {
  if (!$('viewer').hidden) { if (e.key === 'ArrowLeft') $('viewer').querySelector('[data-v=prev]')?.click(); if (e.key === 'ArrowRight') $('viewer').querySelector('[data-v=next]')?.click(); if (e.key === 'Escape') $('viewer').querySelector('[data-v=close]').click(); return; }
  if (e.key === 'Escape' && !$('sheet').hidden) closeSheet();
});

/* ---------- interactions de la fiche ---------- */
$('sheet').addEventListener('click', async e => {
  if (e.target === $('sheet')) { closeSheet(); return; }
  const el = e.target.closest('[data-act],[data-photo],[data-work],[data-tf]'); if (!el) return;
  if (el.dataset.photo) { openViewer(el.dataset.photo); return; }
  if (el.dataset.work) { const t = T.find(x => x.id === el.dataset.work); workForm(t.bonsai_id, t); return; }
  if (el.dataset.tf) { tFilter = el.dataset.tf; renderDetail(); return; }
  const act = el.dataset.act;
  if (act === 'close') closeSheet();
  if (act === 'back') { if (openId) openDetail(openId); else closeSheet(); }
  if (act === 'edit') bonsaiForm(B.find(x => x.id === openId));
  if (act === 'addwork') workForm(openId);
  if (act === 'delbonsai') {
    const b = B.find(x => x.id === openId);
    if (!confirm(`Supprimer « ${b.nom} », ses travaux et ses photos ?`)) return;
    const paths = photosOf(b.id).flatMap(p => [p.chemin, thumbPath(p.chemin)]);
    const { error } = await sb.from('bonsais').delete().eq('id', b.id);
    if (error) { toast(error.message); return; }
    if (paths.length) await sb.storage.from(BUCKET).remove(paths);
    B = B.filter(x => x.id !== b.id); T = T.filter(x => x.bonsai_id !== b.id); P = P.filter(x => x.bonsai_id !== b.id);
    saveCache(); closeSheet(); render(); toast('Bonsaï supprimé');
  }
});
$('sheet').addEventListener('change', e => {
  const act = e.target.dataset.act;
  if (act === 'repot') patchBonsai(openId, { rempotage_a_prevoir: e.target.checked });
  if (act === 'hiver') patchBonsai(openId, { abri_hiver: e.target.checked });
  if (act === 'addphotos' && e.target.files.length) uploadPhotos(openId, e.target.files, null, null);
});

/* ---------- liste : événements ---------- */
$('grid').addEventListener('click', e => { const c = e.target.closest('.card'); if (c) openDetail(c.dataset.id); });
document.querySelectorAll('.chip').forEach(c => c.onclick = () => { filter = c.dataset.f; lss('bz-filter', filter); render(); });
$('q').oninput = e => { query = e.target.value; render(); };
$('sort').onchange = e => { sortBy = e.target.value; lss('bz-sort', sortBy); render(); };
$('addBtn').onclick = () => bonsaiForm(null);
window.addEventListener('hashchange', () => { const id = location.hash.slice(1); if (id && B.some(b => b.id === id)) openDetail(id); else if (!id && !$('sheet').hidden) closeSheet(); });

/* ---------- compte et import ---------- */
$('acctBtn').onclick = () => {
  const withPhotos = P.filter(p => p.ancien_id != null).length;
  openSheet(`
    <div class="panel-head"><button class="iconbtn" data-act="close" aria-label="Fermer"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M15 5l-7 7 7 7"/></svg></button><h2>Compte</h2></div>
    <div class="panel-body">
      <p>Connecté : <strong>${esc(me.email)}</strong></p>
      <div class="section-title"><h3>Photos de Bonsai Album</h3></div>
      <p class="meta">Choisissez le fichier <strong>.bdbi</strong> exporté de Bonsai Album. Les photos sont associées aux bonsaïs et aux travaux déjà repris. Le fichier reste sur cet appareil ; l'import peut être relancé sans créer de doublons. À faire de préférence depuis un ordinateur (fichier volumineux).</p>
      <p class="meta">${withPhotos} photo${withPhotos > 1 ? 's' : ''} déjà importée${withPhotos > 1 ? 's' : ''}.</p>
      <label class="btn pri">Choisir le fichier .bdbi<input type="file" id="bdbi" hidden></label>
      <div class="progress" id="impBar" hidden><i></i></div><p class="status" id="impMsg"></p>
      <div class="section-title"><h3>Session</h3></div>
      <button class="btn danger" id="logout">Se déconnecter</button>
    </div>`);
  $('logout').onclick = async () => { await sb.auth.signOut(); localStorage.removeItem(CACHE); location.reload(); };
  $('bdbi').onchange = e => e.target.files[0] && importAlbum(e.target.files[0]);
};

function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Chargement de ' + src + ' impossible')); document.head.append(s); }); }
const parisDate = ts => new Date(ts * 1000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
async function importAlbum(file) {
  const msg = $('impMsg'), bar = $('impBar'), fill = bar.querySelector('i');
  const say = m => { msg.textContent = m; };
  bar.hidden = false; fill.style.width = '0';
  let db;
  try {
    say('Lecture du fichier…');
    if (!window.initSqlJs) await loadScript('sql-wasm.js');
    const SQL = await window.initSqlJs({ locateFile: f => f });
    db = new SQL.Database(new Uint8Array(await file.arrayBuffer()));
    const rows = (sql, p) => { const st = db.prepare(sql); if (p) st.bind(p); const out = []; while (st.step()) out.push(st.getAsObject()); st.free(); return out; };
    const byOld = Object.fromEntries(B.filter(b => b.ancien_id != null).map(b => [b.ancien_id, b]));
    const workOld = Object.fromEntries(T.filter(t => t.ancien_id != null).map(t => [t.ancien_id, t]));
    const done = new Set(P.filter(p => p.ancien_id != null).map(p => p.ancien_id));
    const logs = Object.fromEntries(rows('select pk,bonsai_key,date from log').map(l => [l.pk, l]));
    const map = {}; rows('select image_key,bonsai_key from image_map where bonsai_key>0').forEach(m => { map[m.image_key] = m.bonsai_key; });
    const main = {}; rows('select pk,photo1_key from bonsai').forEach(b => { if (b.photo1_key > 0) main[b.photo1_key] = b.pk; });
    const imgs = rows('select pk,type,key,caption from image order by pk');
    const todo = [];
    for (const im of imgs) {
      if (done.has(im.pk)) continue;
      const lg = im.type === 2 ? logs[im.key] : null;
      const bk = map[im.pk] || (im.type === 0 ? im.key : lg && lg.bonsai_key);
      const b = byOld[bk]; if (!b) continue;
      let cap = (im.caption || '').trim(), date = null;
      const m = cap.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s*:?\s*/);
      if (m) { date = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; cap = cap.slice(m[0].length).trim(); }
      if (lg && lg.date) date = parisDate(lg.date);
      const w = lg && workOld[lg.pk];
      todo.push({ pk: im.pk, b, date, legende: cap || null, travail_id: w ? w.id : null, main: main[im.pk] === bk });
    }
    if (!todo.length) { say('Rien de nouveau à importer : toutes les photos sont déjà là.'); fill.style.width = '100%'; return; }
    let ok = 0, fail = 0;
    for (const [i, t] of todo.entries()) {
      say(`Photo ${i + 1} sur ${todo.length} · ${t.b.nom}`);
      try {
        const blob = new Blob([rows('select photo from image where pk=?', [t.pk])[0].photo], { type: 'image/jpeg' });
        const p = await putPhoto(t.b.id, blob, { date: t.date, legende: t.legende, travail_id: t.travail_id, ancien_id: t.pk });
        P.push(p); ok++;
        if (t.main && !t.b.photo_principale) { t.b.photo_principale = p.id; await sb.from('bonsais').update({ photo_principale: p.id }).eq('id', t.b.id); }
      } catch (e) { console.warn(e); fail++; }
      fill.style.width = ((i + 1) / todo.length * 100).toFixed(1) + '%';
      if (i % 10 === 9) { saveCache(); }
    }
    saveCache(); load();
    say(`Terminé : ${ok} photo${ok > 1 ? 's' : ''} importée${ok > 1 ? 's' : ''}${fail ? `, ${fail} en échec (relancez l'import pour les reprendre)` : ''}.`);
  } catch (e) {
    console.error(e); say('Import interrompu : ' + (e.message || e) + '. Vous pouvez le relancer, les photos déjà envoyées ne seront pas dupliquées.');
  } finally { db && db.close(); }
}

/* ---------- connexion ---------- */
let mode = 'login';
function paintMode() {
  const L = { login: ['Mes bonsaïs', 'Se connecter', 'Créer un compte', true], signup: ['Créer un compte', 'Créer le compte', 'J\'ai déjà un compte', false],
    reset: ['Mot de passe oublié', 'Envoyer le lien', 'Retour', false], newpw: ['Nouveau mot de passe', 'Enregistrer', '', false] }[mode];
  $('authTitle').textContent = L[0]; $('authGo').textContent = L[1]; $('authAlt').textContent = L[2]; $('authAlt').hidden = !L[2];
  $('authForgot').hidden = !L[3]; $('authEmailF').hidden = mode === 'newpw'; $('authPwF').hidden = mode === 'reset';
  $('authPw').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
}
function showLogin(m) { $('app').hidden = true; $('auth').hidden = false; $('authErr').textContent = m || ''; paintMode(); }
$('authAlt').onclick = () => { mode = mode === 'login' ? 'signup' : 'login'; $('authErr').textContent = ''; paintMode(); };
$('authForgot').onclick = () => { mode = 'reset'; $('authErr').textContent = ''; paintMode(); };
$('authForm').onsubmit = async e => {
  e.preventDefault();
  const email = $('authEmail').value.trim().toLowerCase(), pw = $('authPw').value, err = $('authErr'), go = $('authGo');
  err.textContent = ''; go.disabled = true;
  try {
    const back = location.origin + location.pathname;
    if (mode === 'login') { const { error } = await sb.auth.signInWithPassword({ email, password: pw }); if (error) throw error; }
    else if (mode === 'signup') {
      if (pw.length < 8) throw new Error('Choisissez un mot de passe d\'au moins 8 caractères.');
      const { data, error } = await sb.auth.signUp({ email, password: pw, options: { emailRedirectTo: back } }); if (error) throw error;
      if (!data.session) { mode = 'login'; paintMode(); err.textContent = 'Compte créé. Confirmez via le lien reçu par e-mail, puis connectez-vous.'; }
    } else if (mode === 'reset') {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: back }); if (error) throw error;
      mode = 'login'; paintMode(); err.textContent = 'E-mail envoyé. Suivez le lien pour choisir un nouveau mot de passe.';
    } else if (mode === 'newpw') {
      if (pw.length < 8) throw new Error('Au moins 8 caractères.');
      const { error } = await sb.auth.updateUser({ password: pw }); if (error) throw error;
      mode = 'login'; const { data } = await sb.auth.getSession(); if (data.session) start(data.session);
    }
  } catch (e2) {
    const m = e2 && e2.message || '';
    err.textContent = /invalid login/i.test(m) ? 'E-mail ou mot de passe incorrect.' : /not confirmed/i.test(m) ? 'Adresse pas encore confirmée : ouvrez le lien reçu par e-mail.'
      : /already registered/i.test(m) ? 'Ce compte existe déjà : connectez-vous.' : /rate limit/i.test(m) ? 'Trop de tentatives, réessayez dans quelques minutes.'
      : /fetch|network/i.test(m) ? 'Pas de réseau.' : (m || 'Erreur inattendue.');
  } finally { go.disabled = false; }
};

function start(session) {
  if (me && me.id === session.user.id) return;
  me = session.user;
  $('auth').hidden = true; $('app').hidden = false;
  const c = lsg(CACHE, null);
  if (c && c.uid === me.id) { B = c.B || []; T = c.T || []; P = c.P || []; render(); }
  else render();
  load().then(() => { const id = location.hash.slice(1); if (id && B.some(b => b.id === id) && !openId) openDetail(id); });
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && me) load(); });
sb.auth.onAuthStateChange((ev, session) => {
  if (ev === 'PASSWORD_RECOVERY') { mode = 'newpw'; showLogin('Choisissez votre nouveau mot de passe.'); return; }
  if (ev === 'SIGNED_IN' && session) start(session);
});
sb.auth.getSession().then(({ data }) => { if (data.session) start(data.session); else if (mode !== 'newpw') showLogin(); });

if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
})();

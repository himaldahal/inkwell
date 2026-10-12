// openShareDialog(noteId): People | Public link | Export (PDF)
import { h } from '../core/utils.js';
import { toast } from '../core/store.js';
import { getRecord, rawPut } from '../core/db.js';
import * as sync from '../core/sync.js';
import { openModal } from './dom.js';
import { ensureCss, field, errText, avatarEl } from './sxkit.js';

const roleLabel = (r) => (r === 'editor' || r === 'write' ? 'Can edit' : 'Can view');

async function patchLocal(noteId, patch) { // CORE reads these fields to show share badges; they are never uploaded
  const n = await getRecord('notes', noteId);
  if (n) { await rawPut('notes', { ...n, ...patch }, { silent: true }); }
}

export async function openShareDialog(noteId, { kind = 'notes' } = {}) {
  ensureCss();
  const note = await getRecord(kind, noteId);
  if (!note) return toast('Note not found');
  const auth = await sync.getAuth();
  const e2e = await sync.isE2EEnabled();
  const body = h('div', { class: 'sx' });
  let tab = 'people', busy = false, msg = '', ok = '', people = [], link = null, cfg = {}, progress = '';

  const m = openModal({ title: `Share "${note.title || note.name || 'Untitled'}"`, body, size: 'md' });

  const run = async (fn) => { busy = true; msg = ''; ok = ''; paint(); try { await fn(); } catch (e) { msg = errText(e); } busy = false; paint(); };
  async function load() {
    if (!auth?.token) return paint();
    cfg = await sync.getConfig();
    try {
      people = (await sync.apiCall(`/api/share/people?kind=${kind}&id=${encodeURIComponent(noteId)}`)).people;
      link = (await sync.apiCall(`/api/share/public?kind=${kind}&noteId=${encodeURIComponent(noteId)}`)).link;
    } catch (e) { msg = errText(e); }
    paint();
  }

  function peopleTab() {
    const [l1, email] = field('Invite by e-mail', { type: 'email', placeholder: 'name@example.com', autocomplete: 'off' });
    const role = h('select', { 'aria-label': 'Permission' }, h('option', { value: 'viewer' }, 'Can view'), h('option', { value: 'editor' }, 'Can edit'));
    return [
      e2e ? h('div', { class: 'sx-warn' }, 'End-to-end encryption is on, so this note is unreadable for others. Turn it off in Settings to share.') : null,
      h('div', { class: 'sx-row' }, h('div', { class: 'sx-grow' }, l1), role,
        h('button', { class: 'sx-btn primary', disabled: busy || e2e, onclick: () => run(async () => {
          await sync.syncNow();
          const r = await sync.apiCall('/api/share/people', { method: 'POST', json: { kind, id: noteId, email: email.value.trim(), role: role.value } });
          ok = r.message || 'Shared.'; email.value = ''; await load();
          await patchLocal(noteId, { shares: people.map((p) => ({ email: p.recipient.email, role: p.role })) });
        }) }, 'Invite')),
      h('p', {}, 'If that person has an account they will be notified; otherwise the invitation waits until they sign up.'),
      h('div', { class: 'sx-list' }, people.length ? people.map((p) => h('div', {},
        h('div', { class: 'sx-row' }, avatarEl(p.recipient, 32), h('div', {}, h('b', {}, p.recipient.name), h('small', {}, p.recipient.email + (p.expiresAt ? ' - until ' + new Date(p.expiresAt).toLocaleDateString() : '')))),
        h('div', { class: 'sx-row' },
          h('select', { 'aria-label': 'Permission', onchange: (e) => run(async () => { await sync.apiCall('/api/share/people/' + p.id, { method: 'PATCH', json: { role: e.target.value } }); await load(); }) },
            ['viewer', 'editor'].map((r) => h('option', { value: r, selected: p.role === r }, roleLabel(r)))),
          h('button', { class: 'sx-btn sm danger', onclick: () => run(async () => { await sync.apiCall('/api/share/people/' + p.id, { method: 'DELETE' }); await load(); await patchLocal(noteId, { shares: people.map((x) => ({ email: x.recipient.email, role: x.role })) }); }) }, 'Remove'))))
        : [h('p', {}, 'Not shared with anyone yet.')]),
    ];
  }

  async function publish(opts) {
    progress = 'Preparing...'; paint();
    await sync.syncNow();
    const ex = await import('../features/export.js');
    const pages = [], blobs = [];
    if (kind === 'notes') {
      for (let i = 0; i < (note.pages || []).length; i++) {
        progress = `Rendering page ${i + 1} of ${note.pages.length}`; paint();
        const c = await ex.renderPageToCanvas(note.pages[i], note, { scale: 1.5 });
        const b = await new Promise((r) => c.toBlob(r, 'image/png'));
        pages.push({ key: 'p' + (i + 1), w: Math.round(note.pages[i].width || 820), h: Math.round(note.pages[i].height || 1160) }); blobs.push(['p' + (i + 1), b]);
      }
    }
    let pdf = null;
    if (opts.allowDownload && kind === 'notes') { progress = 'Building PDF'; paint(); try { pdf = (await ex.buildNoteFile(note, 'pdf')).blob; } catch { pdf = null; } }
    const r = await sync.apiCall('/api/share/public', { method: 'POST', json: { kind, noteId, visibility: opts.visibility, permission: opts.permission, allowDownload: !!pdf, password: opts.password,
      expiresAt: opts.expiresAt, regenerate: opts.regenerate, snapshot: { title: note.title || note.name || '', text: note.text || '', pages, hasPdf: !!pdf } } });
    link = r.link;
    const up = [...blobs.map(([k, b]) => [k, b, 'image/png']), ...(pdf ? [['pdf', pdf, 'application/pdf']] : [])];
    let i = 0;
    for (const [k, b, t] of up) {
      progress = `Uploading ${++i} of ${up.length}`; paint();
      await sync.apiCall(`/api/share/public/${encodeURIComponent(link.token)}/asset/${k}`, { method: 'PUT', body: b, headers: { 'Content-Type': t }, timeout: 120000 });
    }
    progress = '';
    link = (await sync.apiCall(`/api/share/public?kind=${kind}&noteId=${encodeURIComponent(noteId)}`)).link;
    await patchLocal(noteId, { publicLink: link.url, publicToken: link.token, passwordProtected: link.hasPassword });
  }

  function linkTab() {
    if (e2e) return [h('div', { class: 'sx-warn' }, 'End-to-end encryption is on. Publishing a link exposes this note in plain text on the server. Turn encryption off to publish.')];
    const on = link && !link.revoked;
    const anon = cfg.features?.anonymousLinks;
    const vis = h('select', { 'aria-label': 'Who can open' }, anon ? h('option', { value: 'public', selected: link?.visibility === 'public' }, 'Anyone with the link') : null,
      h('option', { value: 'internal', selected: link?.visibility === 'internal' || !anon }, 'Signed-in members only'));
    const perm = h('select', { 'aria-label': 'Permission' }, h('option', { value: 'read', selected: link?.permission !== 'write' }, 'View only'), h('option', { value: 'write', selected: link?.permission === 'write' }, 'Can edit (signed-in)'));
    const [lp, pw] = field('Password (optional)', { type: 'password', autocomplete: 'new-password', placeholder: link?.hasPassword ? 'Set - leave blank to keep' : 'None' });
    const [le, exp] = field('Expires (optional)', { type: 'datetime-local', value: link?.expiresAt ? new Date(link.expiresAt - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 16) : '' });
    const dl = h('input', { type: 'checkbox', checked: !!link?.allowDownload });
    const collect = (regenerate) => ({ visibility: vis.value, permission: perm.value, password: pw.value || undefined, expiresAt: exp.value ? new Date(exp.value).getTime() : null, allowDownload: dl.checked, regenerate });
    const clearPw = link?.hasPassword ? h('button', { class: 'sx-btn sm', onclick: () => run(async () => { await publish({ ...collect(), password: '' }); ok = 'Password removed'; }) }, 'Remove password') : null;
    return [
      h('div', { class: 'sx-warn' }, 'Publishing creates a copy of this note on the server that others can open. Only publish what you are happy to share.'),
      h('label', {}, 'Who can open', vis), kind === 'notes' ? h('label', {}, 'Permission', perm) : null, lp, clearPw, le,
      kind === 'notes' ? h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexDirection: 'row' } }, dl, 'Allow PDF download') : null,
      progress ? h('p', {}, progress) : null,
      on ? h('div', { class: 'sx-card' },
        h('input', { type: 'text', readonly: true, value: link.url, 'aria-label': 'Public link', onfocus: (e) => e.target.select() }),
        h('div', { class: 'sx-row' },
          h('button', { class: 'sx-btn sm', onclick: async () => { try { await navigator.clipboard.writeText(link.url); toast('Link copied'); } catch { toast(link.url); } } }, 'Copy link'),
          navigator.share ? h('button', { class: 'sx-btn sm', onclick: () => navigator.share({ title: note.title || 'Note', url: link.url }).catch(() => {}) }, 'Share...') : null,
          h('button', { class: 'sx-btn sm', disabled: busy, onclick: () => run(async () => { await publish(collect()); ok = 'Published copy updated'; }) }, 'Update published copy'),
          h('button', { class: 'sx-btn sm', disabled: busy, onclick: () => run(async () => { await publish(collect(true)); ok = 'New link created; the old one stopped working'; }) }, 'New link')),
        h('p', {}, `${link.views} view(s)${link.permission === 'write' ? `, ${link.edits} edit(s)` : ''}${link.expired ? ' - expired' : ''}`),
        h('button', { class: 'sx-btn danger sm', disabled: busy, onclick: () => run(async () => { await sync.apiCall(`/api/share/public?kind=${kind}&noteId=${encodeURIComponent(noteId)}`, { method: 'DELETE' }); await load(); await patchLocal(noteId, { publicLink: null, publicToken: null, passwordProtected: false }); }) }, 'Stop sharing'))
        : h('button', { class: 'sx-btn primary', disabled: busy, onclick: () => run(async () => { await publish(collect()); }) }, 'Create link'),
    ];
  }

  function exportTab() {
    return [h('p', {}, 'Export this note as a PDF.'),
      h('div', { class: 'sx-row' },
        h('button', { class: 'sx-btn primary', disabled: busy, onclick: () => run(async () => { const ex = await import('../features/export.js'); await ex.exportNote(note, 'pdf'); }) }, 'Download PDF'),
        navigator.canShare ? h('button', { class: 'sx-btn', disabled: busy, onclick: () => run(async () => {
          const ex = await import('../features/export.js'); const { blob, filename } = await ex.buildNoteFile(note, 'pdf');
          const f = new File([blob], filename, { type: 'application/pdf' });
          if (navigator.canShare({ files: [f] })) await navigator.share({ files: [f], title: note.title || 'Note' }).catch(() => {}); else await ex.exportNote(note, 'pdf');
        }) }, 'Share PDF...') : null)];
  }

  function paint() {
    const tabs = [['people', 'People'], ['link', 'Public link'], ['export', 'Export']];
    const signedOut = !auth?.token && tab !== 'export';
    body.replaceChildren(
      h('div', { class: 'sx-tabs', role: 'tablist' }, tabs.map(([k, l]) => h('button', { type: 'button', role: 'tab', 'aria-selected': tab === k, onclick: () => { tab = k; msg = ok = ''; paint(); } }, l))),
      signedOut ? h('div', { class: 'sx-card' }, h('p', {}, 'Sign in to share notes.'), h('button', { class: 'sx-btn primary', onclick: () => { m.close(); location.hash = '#/auth/login'; } }, 'Sign in'))
        : h('div', { class: 'sx' }, ...[].concat(tab === 'people' ? peopleTab() : tab === 'link' ? linkTab() : exportTab())),
      msg ? h('div', { class: 'sx-err', role: 'alert' }, msg) : null, ok ? h('div', { class: 'sx-ok', role: 'status' }, ok) : null);
  }
  paint();
  load();
  return m;
}
export default openShareDialog;

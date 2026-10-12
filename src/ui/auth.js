// Auth screens (#/auth/login|register|forgot|reset|verify|change). mountAuth(el, {sub, rest, query, navigate})
import { h } from '../core/utils.js';
import { toast } from '../core/store.js';
import * as sync from '../core/sync.js';
import { ensureCss, field, errText, safeNext, passwordSetup, solvePow, countdown } from './sxkit.js';

export function mountAuth(el, { sub = 'login', query = {}, navigate = (p) => { location.hash = '#' + p; } } = {}) {
  ensureCss();
  const root = h('div', { class: 'sx sx-center' });
  el.replaceChildren(root);
  const shown = Date.now();
  let busy = false, msg = '', ok = '', cfg = { mode: 'internal', registrationOpen: false };
  const go = (p) => navigate(p);
  const next = safeNext(query.next);

  async function paint() {
    const f = { login, register, forgot, reset, verify, change }[sub] || login;
    root.replaceChildren(h('div', { class: 'sx-narrow sx' },
      h('div', { class: 'sx-brand' }, 'Inkwell'),
      f()));
  }
  const run = async (fn) => { busy = true; msg = ''; ok = ''; paint(); try { await fn(); } catch (e) { msg = errText(e); } busy = false; paint(); };
  const status = () => [msg ? h('div', { class: 'sx-err', role: 'alert' }, msg) : null, ok ? h('div', { class: 'sx-ok', role: 'status' }, ok) : null];
  const link = (label, to) => h('a', { href: '#' + to, onclick: (e) => { e.preventDefault(); go(to); } }, label);

  let needCode = false, remember = true;
  function login() {
    const [l1, email] = field('E-mail', { type: 'email', autocomplete: 'email', required: true, autocapitalize: 'none', value: login.email || '' });
    const [l2, pass] = field('Password', { type: 'password', autocomplete: 'current-password', required: true });
    const [l3, code] = field('Two-factor code or recovery code', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code' });
    const [l4, server] = field('Server address (blank = this site)', { type: 'url', placeholder: 'https://notes.example.com' });
    sync.getAuth().then((a) => { if (a?.serverUrl && !server.value) server.value = a.serverUrl; });
    return h('form', { class: 'sx-card', onsubmit: (e) => {
      e.preventDefault(); if (busy) return;
      login.email = email.value;
      run(async () => {
        try {
          const r = await sync.signIn({ serverUrl: server.value.trim(), email: email.value.trim(), password: pass.value, code: code?.value?.trim(), remember });
          if (r.mustChangePassword) { sub = 'change'; return; }
          toast('Signed in'); go(next);
        } catch (err) {
          if (err.code === '2fa-required') { needCode = true; msg = code?.value ? 'That code is not valid.' : 'Enter your two-factor code.'; return; }
          if (err.code === 'unverified') { msg = 'Please confirm your e-mail address first. '; sub = 'verify'; verifyEmail = email.value; return; }
          throw err;
        }
      });
    } },
      h('h2', {}, 'Sign in'),
      h('p', {}, cfg.mode === 'internal' ? 'Use the account your administrator created for you.' : 'Sign in to sync your notes across devices.'),
      l1, l2, needCode ? l3 : null,
      needCode ? h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, h('input', { type: 'checkbox', checked: remember, onchange: (e) => { remember = e.target.checked; } }), 'Remember this device for 30 days') : null,
      h('details', {}, h('summary', {}, 'Advanced'), l4),
      ...status(),
      h('button', { class: 'sx-btn primary', type: 'submit', disabled: busy }, busy ? 'Please wait...' : 'Sign in'),
      h('div', { class: 'sx-row', style: { justifyContent: 'space-between' } },
        cfg.passwordReset ? link('Forgot password?', '/auth/forgot') : h('span'),
        cfg.registrationOpen ? link('Create account', '/auth/register') : null),
    );
  }

  function register() {
    if (!cfg.registrationOpen) return h('div', { class: 'sx-card' }, h('h2', {}, 'Registration is closed'), h('p', {}, 'Ask your administrator for an account.'), link('Back to sign in', '/auth/login'));
    const [l0, name] = field('Your name', { type: 'text', autocomplete: 'name', maxlength: 60 });
    const [l1, email] = field('E-mail', { type: 'email', autocomplete: 'email', inputmode: 'email', required: true, autocapitalize: 'none', spellcheck: 'false' });
    const pws = passwordSetup({ label: 'Password', email: () => email.value });
    const hp = h('input', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true' });
    return h('form', { class: 'sx-card', novalidate: true, onsubmit: (e) => {
      e.preventDefault(); if (busy) return;
      if (!pws.valid()) { msg = 'Please choose a password that meets the rules.'; paint(); return; }
      run(async () => {
        const pow = await solvePow('register');
        const r = await sync.signIn({ email: email.value.trim(), password: pws.pw.value, displayName: name.value.trim(), register: true, website: hp.value, elapsedMs: Date.now() - shown, pow });
        if (r.verificationRequired) { ok = `We sent a confirmation link to ${r.email}. Open it to finish.`; sub = 'verify'; verifyEmail = r.email; return; }
        toast('Welcome to Inkwell'); go('/');
      });
    } },
      h('h2', {}, 'Create account'), l0, l1, ...pws.nodes, h('div', { class: 'sx-hp' }, h('label', {}, 'Website', hp)),
      ...status(),
      h('button', { class: 'sx-btn primary', type: 'submit', disabled: busy }, busy ? 'Please wait...' : 'Create account'),
      h('p', {}, 'Already registered? ', link('Sign in', '/auth/login')));
  }

  function forgot() {
    const [l1, email] = field('E-mail', { type: 'email', autocomplete: 'email', inputmode: 'email', required: true, autocapitalize: 'none' });
    const hp = h('input', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true' });
    const submit = h('button', { class: 'sx-btn primary', type: 'submit', disabled: busy }, 'Send reset link');
    return h('form', { class: 'sx-card', onsubmit: (e) => {
      e.preventDefault(); if (busy || submit.disabled) return;
      run(async () => {
        const r = await sync.apiCall('/api/auth/forgot', { method: 'POST', json: { email: email.value.trim(), website: hp.value, elapsedMs: Date.now() - shown, pow: await solvePow('forgot') }, noAuth: true });
        ok = 'If an account exists for that address, a reset link is on its way.';
        cool = r.retryAfter || 0; coolAt = Date.now();
      });
    } },
      h('h2', {}, 'Reset password'), h('p', {}, 'We will e-mail you a link that works once.'), l1, h('div', { class: 'sx-hp' }, h('label', {}, 'Website', hp)), ...status(), submit,
      (() => { if (cool - (Date.now() - coolAt) / 1000 > 0) countdown(submit, cool - (Date.now() - coolAt) / 1000, 'Send again'); return link('Back to sign in', '/auth/login'); })());
  }
  let cool = 0, coolAt = 0;

  function reset() {
    const pws = passwordSetup({ label: 'New password', email: () => query.email || '' });
    return h('form', { class: 'sx-card', novalidate: true, onsubmit: (e) => { e.preventDefault(); if (!pws.valid()) { msg = 'Please choose a password that meets the rules.'; paint(); return; } run(async () => { await sync.apiCall('/api/auth/reset', { method: 'POST', json: { token: query.token, newPassword: pws.pw.value }, noAuth: true }); toast('Password changed. Please sign in.'); go('/auth/login'); }); } },
      h('h2', {}, 'Choose a new password'), ...pws.nodes, ...status(), h('button', { class: 'sx-btn primary', type: 'submit', disabled: busy || !query.token }, 'Change password'));
  }

  let verifyEmail = '', verified = false;
  function verify() {
    if (query.token && !verified && !verify.started) {
      verify.started = true;
      sync.apiCall('/api/auth/verify', { method: 'POST', json: { token: query.token }, noAuth: true }).then(() => { verified = true; ok = 'E-mail confirmed.'; paint(); }, (e) => { msg = errText(e); paint(); });
    }
    return h('div', { class: 'sx-card' }, h('h2', {}, verified ? 'You are all set' : 'Confirm your e-mail'),
      ...status(), !query.token ? h('p', {}, 'Open the confirmation link we sent you.') : null,
      !query.token && verifyEmail ? (() => { const b = h('button', { class: 'sx-btn', onclick: () => run(async () => { const r = await sync.apiCall('/api/auth/resend', { method: 'POST', json: { email: verifyEmail, pow: await solvePow('resend') }, noAuth: true }); ok = 'Sent again if the address is registered.'; cool = r.retryAfter || 0; coolAt = Date.now(); }) }, 'Resend e-mail'); if (cool - (Date.now() - coolAt) / 1000 > 0) countdown(b, cool - (Date.now() - coolAt) / 1000, 'Resend e-mail'); return b; })() : null,
      link(verified ? 'Sign in' : 'Back to sign in', '/auth/login'));
  }

  function change() { // forced change after an admin issued a temporary password
    const [l1, oldp] = field('Temporary password', { type: 'password', autocomplete: 'current-password', required: true });
    const pws = passwordSetup({ label: 'New password' });
    return h('form', { class: 'sx-card', novalidate: true, onsubmit: (e) => { e.preventDefault(); if (!pws.valid()) { msg = 'Please choose a password that meets the rules.'; paint(); return; } run(async () => { await sync.changePassword(oldp.value, pws.pw.value); toast('Password updated'); sync.syncNow(); go(next); }); } },
      h('h2', {}, 'Set your password'), h('p', {}, 'Your administrator gave you a temporary password. Choose your own to continue.'), l1, ...pws.nodes, ...status(),
      h('button', { class: 'sx-btn primary', type: 'submit', disabled: busy }, 'Save password'));
  }

  sync.getConfig().then((c) => { cfg = c; paint(); });
  paint();
  return { destroy() { root.remove(); } };
}
export default mountAuth;
export const mount = mountAuth;

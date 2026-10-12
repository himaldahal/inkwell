// WebCrypto helpers: PBKDF2 -> AES-GCM.
//  * End-to-end sync encryption (used by core/sync.js)
//  * Per-note locks: encryptString / decryptString (also exported as lockNoteCrypto)
const enc = new TextEncoder();
const dec = new TextDecoder();
const ITER = 310000;

export const b64 = (buf) => {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
};
export const unb64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));

export const cryptoAvailable = () => !!(globalThis.crypto && crypto.subtle);

async function baseKey(passphrase) {
  return crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
}

/** Derive an AES-GCM key. `salt` is a string or Uint8Array. */
export async function deriveKey(passphrase, salt, { extractable = false, iterations = ITER } = {}) {
  const s = typeof salt === 'string' ? enc.encode(salt) : salt;
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: s, iterations, hash: 'SHA-256' },
    await baseKey(passphrase),
    { name: 'AES-GCM', length: 256 },
    extractable,
    ['encrypt', 'decrypt'],
  );
}
export const exportKey = async (key) => crypto.subtle.exportKey('jwk', key);
export const importKey = (jwk) => crypto.subtle.importKey('jwk', jwk, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);

export async function encryptBytes(bytes, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv); out.set(ct, 12);
  return out;
}
export async function decryptBytes(bytes, key) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u.subarray(0, 12) }, key, u.subarray(12)));
}
export const encryptJSON = async (obj, key) => b64(await encryptBytes(enc.encode(JSON.stringify(obj)), key));
export const decryptJSON = async (str, key) => JSON.parse(dec.decode(await decryptBytes(unb64(str), key)));

// ---- passphrase-only helpers for per-note locks (self-contained string format) ----
// format: "iw1.<salt b64>.<payload b64 (iv + ciphertext)>"
export async function encryptString(plain, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(passphrase, salt);
  return `iw1.${b64(salt)}.${b64(await encryptBytes(enc.encode(plain), key))}`;
}
/** Throws if the passphrase is wrong or data is corrupt. */
export async function decryptString(packed, passphrase) {
  const [tag, s, p] = String(packed).split('.');
  if (tag !== 'iw1' || !s || !p) throw new Error('Not an encrypted payload');
  const key = await deriveKey(passphrase, unb64(s));
  try {
    return dec.decode(await decryptBytes(unb64(p), key));
  } catch {
    throw new Error('Wrong passphrase');
  }
}
export const isEncryptedString = (v) => typeof v === 'string' && v.startsWith('iw1.');
export const lockNoteCrypto = { encryptString, decryptString, isEncryptedString };

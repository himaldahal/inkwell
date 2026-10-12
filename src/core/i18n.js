import { getSetting } from './settings.js';
/* i18n scaffold: add a language by registering a dictionary. English strings are the keys' fallbacks. */
const dicts = { en: {} };
export const registerLanguage = (code, dict) => { dicts[code] = { ...(dicts[code] || {}), ...dict }; };
export const languages = () => Object.keys(dicts);
export const t = (key, fallback) => dicts[getSetting('region.language')]?.[key] ?? fallback ?? key;

// Optional-subsystem switches (core/modules.js, owned by CORE). Everything defaults to enabled when the registry is absent.
const load = Object.values(import.meta.glob('../core/modules.js'))[0];
let reg = null;
if (load) load().then((m) => { reg = m; }).catch(() => {});
export const enabled = (name) => { try { return reg?.isEnabled ? reg.isEnabled(name) !== false : true; } catch { return true; } };
export const optional = {
  ocr: Object.values(import.meta.glob('../features/ocr/index.js'))[0],
  share: Object.values(import.meta.glob('../ui/share.js'))[0],
  activity: Object.values(import.meta.glob('../core/activity.js'))[0],
};

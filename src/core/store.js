const handlers = new Map();
export function on(evt, fn) {
  if (!handlers.has(evt)) handlers.set(evt, new Set());
  handlers.get(evt).add(fn);
  return () => handlers.get(evt)?.delete(fn);
}
export function emit(evt, data) {
  handlers.get(evt)?.forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } });
}
export const toast = (message, opts = {}) => emit('toast', { message, ...opts });

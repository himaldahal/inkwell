// Text tool: tap empty space to create a text box, tap a box to edit it, drag a box to move it.
export function createTextTool(engine) {
  let st = null;
  return {
    cursor: 'text',
    down(pt) {
      const it = engine.itemAt(pt.pv, pt.x, pt.y);
      const text = it && it.type === 'text' ? it : null;
      st = { pt, it: text, moved: false, before: text ? engine.snap(pt.pv) : null };
    },
    move(pt) {
      if (!st) return;
      const dx = pt.x - st.pt.x, dy = pt.y - st.pt.y;
      if (!st.moved && Math.hypot(dx, dy) * engine.zoom < 6) return;
      st.moved = true;
      if (!st.it) return;
      const pv = pt.pv, o = st.it;
      pv.page.items = st.before.items.map((x) => (x === o ? { ...o, x: o.x + dx, y: o.y + dy } : x));
      pv.renderItems();
    },
    up(pt) {
      if (!st) return; const s = st; st = null; const pv = pt.pv;
      if (s.it) {
        if (s.moved) engine.commit(pv, s.before); else engine.startEdit(pv, s.it.id);
      } else if (!s.moved) {
        const fs = engine.settings.text.fontSize;
        engine.insertTextBox(pv, pv.free ? pt.x : Math.max(0, Math.min(pv.w - 80, pt.x)), pv.free ? pt.y - fs * 0.8 : Math.max(0, pt.y - fs * 0.8));
      }
    },
    cancel() { if (st?.before) { const pv = engine.currentPv(); void pv; } st = null; },
  };
}

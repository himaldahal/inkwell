// Linear undo/redo stack of {undo, redo} commands (unlimited per session).
export class History {
  constructor(onChange) { this.stack = []; this.idx = 0; this.onChange = onChange; }
  push(cmd) { this.stack.length = this.idx; this.stack.push(cmd); this.idx++; this.onChange?.('push'); }
  get canUndo() { return this.idx > 0; }
  get canRedo() { return this.idx < this.stack.length; }
  undo() { if (!this.canUndo) return false; this.stack[--this.idx].undo(); this.onChange?.('undo'); return true; }
  redo() { if (!this.canRedo) return false; this.stack[this.idx++].redo(); this.onChange?.('redo'); return true; }
  clear() { this.stack = []; this.idx = 0; this.onChange?.('clear'); }
}

// Cancel browser defaults without consuming the physical keys used by the game.
// In particular, never prevent before-input-event for Ctrl+W: that would also
// suppress the game's W keydown. Left/Right Ctrl remain distinct KeyboardCodes.
window.addEventListener('keydown', event => {
  if (!(event.ctrlKey || event.metaKey)) return;
  const editing = event.target?.closest?.('input,textarea,select,[contenteditable="true"]');
  if (!editing || ['KeyW', 'KeyR', 'KeyT', 'KeyN', 'KeyL'].includes(event.code)) event.preventDefault();
}, true);
window.addEventListener('wheel', event => {
  if (event.ctrlKey) event.preventDefault();
}, { passive: false, capture: true });

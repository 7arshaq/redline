// Layer stack bound to browser history, so Android's back button / gesture
// closes the top sheet, player or view instead of leaving the app.
const stack = [];
let skipPops = 0;

export function initNav() {
  history.replaceState({ em: 0 }, '');
  addEventListener('popstate', (e) => {
    // a back we asked for ourselves after already closing the layer
    if (skipPops > 0) {
      skipPops -= 1;
      return;
    }
    const depth = e.state?.em ?? 0;
    while (stack.length > depth) {
      const layer = stack.pop();
      layer.close();
    }
  });
}

/**
 * Register an open layer. Returns a function that closes it (via history).
 * The function carries its `layer`, so whoever owns it can hand the slot to something else
 * (a tab swap) by replacing `layer.close`.
 */
export function pushLayer(close, name = '') {
  const layer = { close, name };
  stack.push(layer);
  history.pushState({ em: stack.length }, '');
  const closer = () => {
    const i = stack.indexOf(layer);
    if (i === -1) return;
    if (i === stack.length - 1) {
      // close right away (waiting for the browser's back can take a beat on iPhone),
      // then tidy the history entry behind it
      stack.pop();
      layer.close();
      skipPops += 1;
      history.back();
    } else {
      stack.splice(i, 1);
      layer.close();
    }
  };
  closer.layer = layer;
  return closer;
}

export const topLayer = () => stack[stack.length - 1]?.name || null;
export const hasLayer = (name) => stack.some((l) => l.name === name);
export const closeTop = () => {
  if (stack.length) history.back();
};

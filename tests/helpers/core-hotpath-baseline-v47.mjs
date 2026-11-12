/** Frozen v46 web window traversal, copied from the archived implementation. */
export const baselineStateWindows = (raw, prefix) => Object.entries(raw ?? {}).filter(([k]) => k === prefix || new RegExp(`^${prefix}\\d+$`).test(k)).map(([,v]) => v);

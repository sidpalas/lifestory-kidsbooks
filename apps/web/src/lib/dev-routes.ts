// Shared gate for the development-only routes under /__dev. `import.meta.env.DEV` is
// false in `vite build` output, so production images can never enable them (D17).
export const devRoutesEnabled = () =>
  import.meta.env.DEV && process.env.DEV_LOGIN_ENABLED === "true" && process.env.NODE_ENV !== "production";

export const devRouteNotFound = () => new Response("Not found", { status: 404 });

export const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

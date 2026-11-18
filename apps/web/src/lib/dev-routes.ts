// Shared gate for the development-only routes under /__dev.
export const devRoutesEnabled = () => process.env.DEV_LOGIN_ENABLED === "true" && process.env.NODE_ENV !== "production";

export const devRouteNotFound = () => new Response("Not found", { status: 404 });

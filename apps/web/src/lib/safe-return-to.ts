/** Only relative paths on this origin; anything else (absolute, protocol-relative) becomes "/". */
export const safeReturnTo = (value: string | null): string =>
  value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") ? value : "/";

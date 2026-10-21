// Pure rules deciding whether a host command may run. Kept separate so it is unit-tested.
const DANGEROUS = [
  /\brm\s+-rf?\s+\/(\s|$)/i, /\bformat\s+[a-z]:/i, /\bmkfs\b/i, /\bdd\s+if=/i, /\bshutdown\b/i,
  /\breboot\b/i, /:\(\)\s*\{\s*:\|:&\s*\};:/, /\bdel\s+\/[sq]/i, /\brd\s+\/s/i, /\bdiskpart\b/i,
];

export const parseAllowlist = (s = "") => s.split(",").map((x) => x.trim()).filter(Boolean);

export function isDangerous(cmd) {
  return DANGEROUS.some((r) => r.test(cmd));
}

/** Metacaracteres de shell que nunca aparecem num comando permitido.
 *  Inclui controles (quebra de linha/CR: `ls \n rm -rf` era aceito) e redirecionamento
 *  (`ls > arquivo` era aceito), além de encadeamento, substituição e subshell. */
const SHELL_METACHARS = /[\x00-\x1f\x7f;&|`<>$()\\]/;

/** Command is allowed when it starts with an allowlisted prefix and has no shell metacharacters. */
export function isAllowlisted(cmd, allowlist) {
  const c = String(cmd ?? "").trim();
  if (!c || SHELL_METACHARS.test(c)) return false;
  return parseAllowlist(allowlist).some((p) => c === p || c.startsWith(p + " "));
}

/**
 * Decide what to do with a command.
 * autonomy: "confirm" (always ask), "safe" (allowlist only, else refuse), "full" (run unless dangerous)
 * @returns "run" | "ask" | "deny"
 */
export function decide(cmd, { enabled, allowlist, autonomy }) {
  if (!enabled) return "deny";
  if (isDangerous(cmd)) return autonomy === "confirm" ? "ask" : "deny";
  if (autonomy === "confirm") return "ask";
  if (autonomy === "safe") return isAllowlisted(cmd, allowlist) ? "run" : "deny";
  return "run";
}

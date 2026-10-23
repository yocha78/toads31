// Organiser login (REQUIREMENTS 4.3, 4.9). One shared password, kept in AWS Parameter Store as a
// SecureString at /toads31/<stage>/organiser-password. Logging in returns a token that lasts 12 hours.
// Tokens are signed with a key derived from the password, so changing the password signs everyone out.
import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";

export const TOKEN_HOURS = 12;
const CACHE_MS = 5 * 60 * 1000;

// Reads the password from Parameter Store, at most every 5 minutes. null when it isn't set up.
export function parameterStorePassword(stage = process.env.STAGE, ssm = new SSMClient({})) {
  let cached, at = 0;
  return async () => {
    if (Date.now() - at < CACHE_MS) return cached;
    try {
      const r = await ssm.send(new GetParameterCommand({ Name: `/toads31/${stage}/organiser-password`, WithDecryption: true }));
      cached = r.Parameter && r.Parameter.Value ? r.Parameter.Value : null;
    } catch (e) {
      if (e.name !== "ParameterNotFound") throw e;
      cached = null;
    }
    at = Date.now();
    return cached;
  };
}

const b64 = s => Buffer.from(s).toString("base64url");
const keyFor = password => createHash("sha256").update("toads31 organiser token:" + password).digest();
const sign = (password, body) => createHmac("sha256", keyFor(password)).update(body).digest("base64url");
const same = (a, b) => {
  const x = createHash("sha256").update(String(a)).digest(), y = createHash("sha256").update(String(b)).digest();
  return timingSafeEqual(x, y);
};

// → {token, expires} | {error, status}
export async function login(getPassword, input, now = Date.now()) {
  const password = await getPassword();
  if (!password) return { status: 503, error: "the organiser password has not been set up yet" };
  if (!input || typeof input.password !== "string" || !same(input.password, password)) {
    await new Promise(r => setTimeout(r, 400)); // slows down guessing
    return { status: 401, error: "wrong password" };
  }
  const exp = now + TOKEN_HOURS * 3600 * 1000, body = b64(JSON.stringify({ role: "organiser", exp }));
  return { token: `${body}.${sign(password, body)}`, expires: new Date(exp).toISOString() };
}

// True when the request carries a valid, unexpired organiser token
export async function isOrganiser(getPassword, event, now = Date.now()) {
  const h = (event.headers || {}).authorization || (event.headers || {}).Authorization || "";
  const m = /^Bearer ([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(h);
  if (!m) return false;
  const password = await getPassword();
  if (!password || !same(sign(password, m[1]), m[2])) return false;
  try {
    const claims = JSON.parse(Buffer.from(m[1], "base64url").toString("utf8"));
    return claims.role === "organiser" && typeof claims.exp === "number" && claims.exp > now;
  } catch {
    return false;
  }
}

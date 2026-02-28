import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(scrypt);

/**
 * Hash a plain-text password.
 *
 * How it works:
 * 1. Generate a random "salt" -- 16 random bytes turned into a hex string.
 *    The salt makes sure that two users with the same password get different
 *    hashes, so an attacker can't use a precomputed table.
 * 2. Run scrypt (a slow, memory-hard hash function) on the password + salt.
 *    "Slow" is good here: it makes brute-force guessing expensive.
 * 3. Store "salt:hash" together so we can verify later.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

/**
 * Verify a plain-text password against a stored "salt:hash" string.
 *
 * We split the stored value back into salt and hash, re-derive from the
 * candidate password, and compare using timingSafeEqual (constant-time
 * comparison that prevents timing attacks).
 */
export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const storedBuf = Buffer.from(hash, "hex");
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return timingSafeEqual(storedBuf, derived);
}

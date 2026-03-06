import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export function createSalt(): string {
  return randomBytes(16).toString("hex");
}

export function hashPasscode(passcode: string, salt: string): string {
  return scryptSync(passcode, salt, 32).toString("hex");
}

export function verifyPasscode(passcode: string, salt: string, hash: string): boolean {
  const derived = Buffer.from(hashPasscode(passcode, salt), "hex");
  const expected = Buffer.from(hash, "hex");
  if (derived.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(derived, expected);
}

export function hashRuntimePasscode(passcode: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${passcode}`).digest("hex");
}

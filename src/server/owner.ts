/**
 * The owner (game master) account: one username and password, stored in
 * `data/owner.json` as a salted scrypt hash, never in clear text.
 *
 * After a successful login the server gives the client a session token,
 * signed with a secret kept in owner.json, so the browser can reconnect
 * without sending the password again. Resetting the owner (new secret)
 * invalidates every session.
 */
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sameName } from "../shared/permissions.ts";

export const OWNER_FILE = "owner.json";
export const MIN_PASSWORD_LENGTH = 8;
/** How long a session token stays valid. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface OwnerRecord {
  username: string;
  /** hex */
  salt: string;
  /** scrypt(password, salt), hex */
  hash: string;
  /** Signs session tokens. hex */
  secret: string;
  createdAt: string;
}

function hashPassword(password: string, salt: string): Buffer {
  return scryptSync(password, Buffer.from(salt, "hex"), 64);
}

/** Problems with proposed credentials, or null if they are acceptable. */
export function credentialsProblem(username: string, password: string): string | null {
  if (username.trim().length === 0) return "The username must not be empty.";
  if (username.trim().length > 80) return "The username must be at most 80 characters.";
  if (password.length < MIN_PASSWORD_LENGTH) return `The password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length > 200) return "The password must be at most 200 characters.";
  return null;
}

export class OwnerStore {
  private readonly file: string;
  private record: OwnerRecord | null;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.file = join(dataDir, OWNER_FILE);
    this.record = existsSync(this.file) ? (JSON.parse(readFileSync(this.file, "utf8")) as OwnerRecord) : null;
  }

  /** Has the owner account been set up? */
  get exists(): boolean {
    return this.record !== null;
  }

  get username(): string | null {
    return this.record?.username ?? null;
  }

  /** Creates or replaces the owner account. Existing sessions become invalid. */
  set(username: string, password: string): void {
    const problem = credentialsProblem(username, password);
    if (problem) throw new Error(problem);
    const salt = randomBytes(16).toString("hex");
    this.record = {
      username: username.trim(),
      salt,
      hash: hashPassword(password, salt).toString("hex"),
      secret: randomBytes(32).toString("hex"),
      createdAt: new Date().toISOString(),
    };
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.record, null, 2), { mode: 0o600 });
    renameSync(tmp, this.file);
  }

  /** Is this the owner's username (so that players cannot use it)? */
  isOwnerName(name: string): boolean {
    return this.record !== null && sameName(name, this.record.username);
  }

  checkPassword(password: string): boolean {
    if (!this.record) return false;
    const expected = Buffer.from(this.record.hash, "hex");
    const actual = hashPassword(password, this.record.salt);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  private sign(expiresAt: number): string {
    return createHmac("sha256", this.record!.secret).update(`${this.record!.username}.${expiresAt}`).digest("base64url");
  }

  issueSession(now = Date.now()): string {
    const expiresAt = now + SESSION_TTL_MS;
    return `${expiresAt}.${this.sign(expiresAt)}`;
  }

  checkSession(token: string, now = Date.now()): boolean {
    if (!this.record) return false;
    const [expires, signature] = token.split(".");
    const expiresAt = Number(expires);
    if (!signature || !Number.isFinite(expiresAt) || expiresAt < now) return false;
    const expected = Buffer.from(this.sign(expiresAt));
    const actual = Buffer.from(signature);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
}

/** Counts failed logins per address; blocks an address after too many in a window. */
export class LoginLimiter {
  private readonly failures = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly maxFailures = 5,
    private readonly windowMs = 60_000,
  ) {}

  isBlocked(address: string, now = Date.now()): boolean {
    const entry = this.failures.get(address);
    return !!entry && entry.resetAt > now && entry.count >= this.maxFailures;
  }

  fail(address: string, now = Date.now()): void {
    const entry = this.failures.get(address);
    if (!entry || entry.resetAt <= now) this.failures.set(address, { count: 1, resetAt: now + this.windowMs });
    else entry.count++;
  }

  succeed(address: string): void {
    this.failures.delete(address);
  }
}

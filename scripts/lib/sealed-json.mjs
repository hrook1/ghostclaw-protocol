import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

const MAX_SEALED_BYTES = 2 * 1024 * 1024;
const ALGORITHM = "aes-256-gcm";
const SALT = Buffer.from("GHOSTCLAW_HOSTED_STATE_V1", "utf8");

function sealedBytes(value, label, { exactBytes = null, maxBytes = null } = {}) {
  const maxEncoded = maxBytes === null ? 128 : Math.ceil(maxBytes * 4 / 3) + 2;
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > maxEncoded
    || !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    throw new Error(`The hosted-state ${label} is invalid.`);
  }
  const bytes = Buffer.from(value, "base64url");
  if (
    bytes.toString("base64url") !== value
    || (exactBytes !== null && bytes.length !== exactBytes)
    || (maxBytes !== null && bytes.length > maxBytes)
  ) {
    bytes.fill(0);
    throw new Error(`The hosted-state ${label} is invalid.`);
  }
  return bytes;
}

function secretBytes(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new Error("GHOSTCLAW_DEMO_MERCHANT_SECRET must contain 32 base64url bytes.");
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length !== 32) {
    bytes.fill(0);
    throw new Error("GHOSTCLAW_DEMO_MERCHANT_SECRET must contain 32 base64url bytes.");
  }
  return bytes;
}

function derivedKey(secret, purpose) {
  if (!/^[a-z0-9:-]{1,128}$/i.test(purpose)) {
    throw new Error("The sealed-state purpose is invalid.");
  }
  const input = secretBytes(secret);
  try {
    return Buffer.from(hkdfSync(
      "sha256",
      input,
      SALT,
      Buffer.from(purpose, "utf8"),
      32,
    ));
  } finally {
    input.fill(0);
  }
}

function aadBytes(aad) {
  const value = Buffer.from(String(aad ?? ""), "utf8");
  if (value.length < 8 || value.length > 512) {
    value.fill(0);
    throw new Error("The sealed-state context is invalid.");
  }
  return value;
}

export function newHostedSecret() {
  return randomBytes(32).toString("base64url");
}

export function sealJson(value, secret, { purpose, aad }) {
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  if (plaintext.length === 0 || plaintext.length > MAX_SEALED_BYTES) {
    plaintext.fill(0);
    throw new Error("The hosted state is too large.");
  }
  const key = derivedKey(secret, purpose);
  const iv = randomBytes(12);
  const associatedData = aadBytes(aad);
  try {
    const cipher = createCipheriv(ALGORITHM, key, iv);
    cipher.setAAD(associatedData);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return {
      version: 1,
      algorithm: ALGORITHM,
      iv: iv.toString("base64url"),
      tag: cipher.getAuthTag().toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
    };
  } finally {
    key.fill(0);
    plaintext.fill(0);
    associatedData.fill(0);
  }
}

export function openSealedJson(envelope, secret, { purpose, aad }) {
  if (
    envelope?.version !== 1
    || envelope.algorithm !== ALGORITHM
    || typeof envelope.iv !== "string"
    || typeof envelope.tag !== "string"
    || typeof envelope.ciphertext !== "string"
  ) {
    throw new Error("The hosted-state envelope is invalid.");
  }
  let iv;
  let tag;
  let ciphertext;
  try {
    iv = sealedBytes(envelope.iv, "IV", { exactBytes: 12 });
    tag = sealedBytes(envelope.tag, "authentication tag", { exactBytes: 16 });
    ciphertext = sealedBytes(envelope.ciphertext, "ciphertext", { maxBytes: MAX_SEALED_BYTES });
  } catch {
    iv?.fill(0);
    tag?.fill(0);
    ciphertext?.fill(0);
    throw new Error("The hosted-state envelope failed authentication.");
  }
  const key = derivedKey(secret, purpose);
  const associatedData = aadBytes(aad);
  let plaintext;
  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAAD(associatedData);
    decipher.setAuthTag(tag);
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(plaintext.toString("utf8"));
  } catch {
    throw new Error("The hosted-state envelope failed authentication.");
  } finally {
    key.fill(0);
    iv.fill(0);
    tag.fill(0);
    ciphertext.fill(0);
    plaintext?.fill(0);
    associatedData.fill(0);
  }
}

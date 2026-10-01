import { createHash, randomBytes } from "node:crypto";
import { getAddress, parseAbi } from "viem";

export const BN254_SCALAR_FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export const NETWORK = "base-sepolia";
export const CHAIN_ID = 84532;
export const PUBLIC_RPC_URL = "https://sepolia.base.org";
export const PUBLIC_NOTE_TREE_URL =
  "https://ghostclaw-confidential-payments.vercel.app/note-tree";

export const CONTRACTS = Object.freeze({
  pool: getAddress("0x415330497f132e8D811b80c3EB96eb15B985f3C6"),
  token: getAddress("0x67A288E50AD08FCa1d8dC4f65d80640a39e48760"),
  identityVerifier: getAddress("0x886c99F83E741337c947586C423117E7F26a728a"),
  depositVerifier: getAddress("0x70C8e535b3A0f25E0e7127F25097AaF83F8832b2"),
  spendVerifier: getAddress("0xBb12FB3bBdcf0e77f63b0c5a52A1C62Cd51DcbdC"),
  withdrawalVerifier: getAddress("0xd0ba5592E6b9443b7cdD2a71c2287eB283f59b8c"),
  poseidon2: getAddress("0xB2bFD7988D6b7695a54aC4864C4106242a4da21b"),
  deploymentBlock: 44_999_064n,
});

export const poolAbi = parseAbi([
  "event NotesInserted(uint256 indexed pairIndex,uint256 left,uint256 right,uint256 root)",
  "event X402Settlement(uint256 indexed paymentIntent,address indexed payer,address indexed merchant,uint256 senderOwner,uint256 recipientOwner,uint256 nullifier,uint256 outputLeft,uint256 outputRight,uint256 pairIndex,uint256 root)",
  "function context() view returns (uint256)",
  "function ownerOf(address) view returns (uint256)",
  "function accountForOwner(uint256) view returns (address)",
  "function identityNonce(uint256) view returns (uint256)",
  "function pendingRecovery(uint256) view returns (address currentAccount,address newAccount,uint256 executeAfter,uint256 nonce)",
  "function accountConsentDigest(uint256,address,address,uint256,uint256,uint256) view returns (bytes32)",
  "function roots(uint256) view returns (bool)",
  "function currentRoot() view returns (uint256)",
  "function nextLeafIndex() view returns (uint256)",
  "function commitments(uint256) view returns (bool)",
  "function nullifiers(uint256) view returns (bool)",
  "function settledPaymentIntents(uint256) view returns (bool)",
  "function totalEscrowed() view returns (uint256)",
  "function registerSelf(bytes,uint256)",
  "function rotateAccount(bytes,address,uint256,bytes)",
  "function requestRecovery(bytes,uint256,address,uint256,bytes)",
  "function cancelRecovery(uint256)",
  "function finalizeRecovery(uint256)",
  "function deposit(bytes,uint256,uint64)",
  "function confidentialTransfer(bytes,uint256,uint256,uint256,uint256,uint256,uint256,address)",
  "function withdraw(bytes,uint256,uint256,uint256,address,uint64)",
]);

export const tokenAbi = parseAbi([
  "function FAUCET_AMOUNT() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function faucetUsed(address) view returns (bool)",
  "function faucet()",
  "function approve(address,uint256) returns (bool)",
  "function transfer(address,uint256) returns (bool)",
]);

export function randomField() {
  let value = 0n;
  while (value === 0n) {
    value = BigInt(`0x${randomBytes(31).toString("hex")}`);
  }
  return value.toString();
}

export function canonicalRequestDigest(input) {
  const digest = BigInt(`0x${createHash("sha256").update(input).digest("hex")}`);
  return (digest % BN254_SCALAR_FIELD).toString();
}

export function bindRequestDigest(canonicalDigest, salt = randomBytes(32).toString("hex")) {
  const digest = parseField(canonicalDigest, "The canonical request digest");
  if (!/^[0-9a-f]{64}$/i.test(salt)) {
    throw new Error("The request salt must contain 64 hexadecimal characters.");
  }
  const encodedDigest = Buffer.from(digest.toString(16).padStart(64, "0"), "hex");
  const hash = createHash("sha256")
    .update("GHOSTCLAW_X402_REQUEST_BINDING_V2", "utf8")
    .update(Buffer.from(salt, "hex"))
    .update(encodedDigest)
    .digest("hex");
  return {
    digest: (BigInt(`0x${hash}`) % BN254_SCALAR_FIELD).toString(),
    salt,
  };
}

export function parseField(value, label) {
  let parsed;
  try {
    parsed = BigInt(value);
  } catch {
    throw new Error(`${label} must be an integer.`);
  }
  if (parsed < 0n || parsed >= BN254_SCALAR_FIELD) {
    throw new Error(`${label} must fit the BN254 scalar field.`);
  }
  return parsed;
}

export function parseTokenAmount(value) {
  const text = String(value ?? "").trim();
  if (!/^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/.test(text)) {
    throw new Error("The amount must use at most six decimal places.");
  }
  const [whole, fraction = ""] = text.split(".");
  const amount = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0") || "0");
  if (amount <= 0n || amount > 18_446_744_073_709_551_615n) {
    throw new Error("The amount must be a positive 64-bit token value.");
  }
  return amount;
}

export function formatTokenAmount(amount) {
  const value = BigInt(amount);
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

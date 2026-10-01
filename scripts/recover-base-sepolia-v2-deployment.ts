import assert from "node:assert/strict";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  createPublicClient,
  getAddress,
  http,
  parseAbiItem,
  type Address,
  type Hex,
} from "viem";
import { entryPoint07Address } from "viem/account-abstraction";
import { baseSepolia } from "viem/chains";
import { installSecretRedactingFatalHandlers } from "./lib/redact-fatal-error";

installSecretRedactingFatalHandlers();
process.umask(0o077);

const userOperationEvent = parseAbiItem(
  "event UserOperationEvent(bytes32 indexed userOpHash,address indexed sender,address indexed paymaster,uint256 nonce,bool success,uint256 actualGasCost,uint256 actualGasUsed)",
);

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function atomicJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");
const evidencePath = resolve(projectRoot, "deployments/base-sepolia-v2.json");
const evidence = JSON.parse(await readFile(evidencePath, "utf8")) as {
  version: number;
  chainId: number;
  operatorSmartAccount: Address;
  entries: Array<{
    name: string;
    address: Address;
    userOperationHash: Hex | null;
    transactionHash: Hex | null;
    blockNumber: number | null;
    reused: boolean;
  }>;
  [key: string]: unknown;
};
assert.equal(evidence.version, 2);
assert.equal(evidence.chainId, 84532);

const client = createPublicClient({
  chain: baseSepolia,
  transport: http(required("BASE_SEPOLIA_SECONDARY_RPC_URL"), {
    retryCount: 2,
    timeout: 60_000,
  }),
});
assert.equal(await client.getChainId(), 84532);
const latestBlock = await client.getBlockNumber();

async function firstCodeBlock(address: Address) {
  let absent = 0n;
  let present = latestBlock;
  const latestCode = await client.getBytecode({ address, blockNumber: present });
  assert.ok(latestCode && latestCode !== "0x");
  while (absent + 1n < present) {
    const candidate = (absent + present) / 2n;
    const code = await client.getBytecode({ address, blockNumber: candidate });
    if (code && code !== "0x") present = candidate;
    else absent = candidate;
  }
  assert.equal(await client.getBytecode({ address, blockNumber: absent }), undefined);
  return present;
}

for (const entry of evidence.entries) {
  const blockNumber = await firstCodeBlock(entry.address);
  const logs = await client.getLogs({
    address: entryPoint07Address,
    event: userOperationEvent,
    args: { sender: getAddress(evidence.operatorSmartAccount) },
    fromBlock: blockNumber,
    toBlock: blockNumber,
  });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].args.success, true);
  assert.ok(logs[0].transactionHash);
  assert.ok(logs[0].args.userOpHash);
  const receipt = await client.getTransactionReceipt({ hash: logs[0].transactionHash });
  assert.equal(receipt.status, "success");
  assert.equal(receipt.blockNumber, blockNumber);
  entry.userOperationHash = logs[0].args.userOpHash;
  entry.transactionHash = logs[0].transactionHash;
  entry.blockNumber = Number(blockNumber);
  entry.reused = false;
  process.stdout.write(`${entry.name}: ${logs[0].transactionHash}\n`);
}

evidence.deploymentEvidenceRecoveredAt = new Date().toISOString();
evidence.deploymentEvidenceSource = "Base Sepolia EntryPoint v0.7 UserOperationEvent and first-code block";
await atomicJson(evidencePath, evidence);

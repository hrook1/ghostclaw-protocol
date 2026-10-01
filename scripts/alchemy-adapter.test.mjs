import assert from "node:assert/strict";
import test from "node:test";
import { encodeCallsMAv2 } from "@alchemy/smart-accounts";
import { createSmartWalletClient } from "@alchemy/wallet-apis";
import {
  DEFAULT_RELAY_URL,
  SponsoredTransactionAdapter,
  TRUSTED_DELEGATION_ADDRESS,
  verifyTrustedDelegation,
  normalizeRelayUrl,
  trustedDelegationDesignation,
  validatePreparedCallBundle,
} from "./lib/alchemy-adapter.mjs";
import { CHAIN_ID, CONTRACTS, tokenAbi } from "./lib/protocol.mjs";
import { custom, encodeFunctionData } from "viem";
import { entryPoint07Address, getUserOperationHash } from "viem/account-abstraction";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const PRIVATE_KEY = `0x${"11".repeat(32)}`;
const ACCOUNT = privateKeyToAccount(PRIVATE_KEY).address;
const MERCHANT = "0x2222222222222222222222222222222222222222";
const TRANSACTION_HASH = `0x${"12".repeat(32)}`;
const PROOF = `0x${"21".repeat(768)}`;

function preparedUserOperation(calls) {
  const data = {
    sender: ACCOUNT,
    nonce: "0x0",
    callData: encodeCallsMAv2(calls),
    callGasLimit: "0x100000",
    verificationGasLimit: "0x100000",
    preVerificationGas: "0x10000",
    maxFeePerGas: "0x1000000",
    maxPriorityFeePerGas: "0x100000",
    paymaster: "0x3333333333333333333333333333333333333333",
    paymasterData: "0x1234",
    paymasterVerificationGasLimit: "0x10000",
    paymasterPostOpGasLimit: "0x0",
  };
  const hash = getUserOperationHash({
    chainId: CHAIN_ID,
    entryPointAddress: entryPoint07Address,
    entryPointVersion: "0.7",
    userOperation: data,
  });
  return {
    type: "user-operation-v070",
    data,
    chainId: CHAIN_ID,
    signatureRequest: { type: "personal_sign", data: { raw: hash }, rawPayload: hash },
    feePayment: {
      sponsored: true,
      tokenAddress: "0x0000000000000000000000000000000000000000",
      maxAmount: 0n,
    },
    details: { type: "user-operation", data: { hash, calls } },
  };
}

function signedUserOperation(prepared) {
  const { signatureRequest: _request, feePayment: _fee, ...rest } = prepared;
  return {
    ...rest,
    signature: { type: "secp256k1", data: `0x${"44".repeat(65)}` },
  };
}

function mockAdapter() {
  const preparedCalls = [];
  const client = {
    async prepareCalls({ calls }) {
      preparedCalls.push(calls);
      return preparedUserOperation(calls);
    },
    async signPreparedCalls(prepared) {
      return signedUserOperation(prepared);
    },
    async sendPreparedCalls() {
      return { id: `0x${"55".repeat(32)}` };
    },
    async waitForCallsStatus() {
      return {
        status: "success",
        receipts: [{ transactionHash: TRANSACTION_HASH }],
      };
    },
  };
  const adapter = new SponsoredTransactionAdapter(
    "https://relay.ghostclaw.test/rpc",
    PRIVATE_KEY,
    {
      client,
      publicClient: { getTransactionCount: async () => 0 },
      verifyDelegation: async () => true,
    },
  );
  return { adapter, preparedCalls };
}

test("the emergency exit removes only the pinned EIP-7702 delegation", async () => {
  const reads = [trustedDelegationDesignation(), undefined];
  const client = {
    async undelegateAccount() {
      return { id: `0x${"77".repeat(32)}` };
    },
    async waitForCallsStatus() {
      return { status: "success", receipts: [{ transactionHash: TRANSACTION_HASH }] };
    },
  };
  const adapter = new SponsoredTransactionAdapter(
    "https://relay.ghostclaw.test/rpc",
    PRIVATE_KEY,
    {
      client,
      publicClient: { getBytecode: async () => reads.shift() },
      verifyDelegation: async () => true,
    },
  );
  const result = await adapter.emergencyUndelegate();
  assert.equal(result.status, "undelegated");
  assert.equal(result.transactionHash, TRANSACTION_HASH);
  assert.equal(result.sponsored, true);

  const changed = new SponsoredTransactionAdapter(
    "https://relay.ghostclaw.test/rpc",
    PRIVATE_KEY,
    {
      client,
      publicClient: { getBytecode: async () => "0x6000" },
      verifyDelegation: async () => true,
    },
  );
  await assert.rejects(changed.emergencyUndelegate(), /unknown implementation/);
});

test("every GhostClaw write uses the local wallet and sponsored relay", async () => {
  const { adapter, preparedCalls } = mockAdapter();
  await adapter.registerSelf({ proof: { proof: PROOF }, owner: "1" });
  await adapter.rotateAccount(
    { proof: { proof: PROOF } },
    ACCOUNT,
    "3",
    `0x${"34".repeat(65)}`,
  );
  await adapter.requestRecovery(
    { proof: { proof: PROOF } },
    "1",
    ACCOUNT,
    "3",
    `0x${"34".repeat(65)}`,
  );
  await adapter.cancelRecovery("1");
  await adapter.finalizeRecovery("1");
  await adapter.faucet();
  await adapter.approve("100");
  await adapter.deposit({ proof: { proof: PROOF }, commitment: "4", amount: "5" });
  await adapter.pay({
    proof: { proof: PROOF },
    spendRoot: "1",
    nullifier: "2",
    outputLeft: "3",
    outputRight: "4",
    recipientOwner: "6",
    paymentIntent: "7",
  }, MERCHANT);
  await adapter.withdraw({
    proof: { proof: PROOF },
    spendRoot: "1",
    nullifier: "2",
    changeCommitment: "3",
    amount: "4",
  }, ACCOUNT);

  assert.equal(adapter.account, ACCOUNT);
  assert.equal(preparedCalls.length, 10);
  assert.ok(preparedCalls.every((calls) => calls.length === 1 && calls[0].value === 0n));
});

test("the playtest claim uses one sponsored 100 gUSD faucet call", async () => {
  const { adapter, preparedCalls } = mockAdapter();
  await adapter.claimPlaytestCredit();
  assert.equal(preparedCalls.length, 1);
  assert.equal(preparedCalls[0].length, 1);
  assert.equal(preparedCalls[0][0].to, CONTRACTS.token);
});

test("the adapter rejects unrelated contract calls", async () => {
  const { adapter } = mockAdapter();
  await assert.rejects(
    adapter.send(CONTRACTS.pool, "transfer(address,uint256)", [ACCOUNT, 1n]),
    /outside the GhostClaw .*policy/,
  );
  await assert.rejects(
    adapter.send(MERCHANT, "faucet()", []),
    /outside the GhostClaw .*policy/,
  );
});

test("the local wallet signs only the pinned EIP-7702 delegation", () => {
  const call = {
    to: CONTRACTS.token,
    value: 0n,
    data: encodeFunctionData({ abi: tokenAbi, functionName: "faucet" }),
  };
  const userOperation = preparedUserOperation([call]);
  const bundle = {
    type: "array",
    data: [{
      type: "authorization",
      data: { address: TRUSTED_DELEGATION_ADDRESS, nonce: 0n },
      chainId: CHAIN_ID,
      signatureRequest: { type: "eip7702Auth", rawPayload: `0x${"66".repeat(32)}` },
    }, userOperation],
  };

  assert.equal(
    validatePreparedCallBundle(bundle, [call], ACCOUNT, { currentNonce: 0 }).authorizationRequired,
    true,
  );
  bundle.data[0].data.address = MERCHANT;
  assert.throws(
    () => validatePreparedCallBundle(bundle, [call], ACCOUNT, { currentNonce: 0 }),
    /untrusted EIP-7702 delegation/,
  );
});

test("the pinned Wallet API SDK decodes and signs the validated bundle locally", async () => {
  let observedRequest;
  const client = createSmartWalletClient({
    chain: baseSepolia,
    signer: privateKeyToAccount(PRIVATE_KEY),
    transport: custom({
      async request({ method, params }) {
        assert.equal(method, "wallet_prepareCalls");
        observedRequest = params[0];
        const calls = observedRequest.calls.map((call) => ({
          to: call.to,
          value: BigInt(call.value ?? 0),
          data: call.data ?? "0x",
        }));
        const operation = preparedUserOperation(calls);
        operation.chainId = `0x${CHAIN_ID.toString(16)}`;
        operation.feePayment.maxAmount = "0x0";
        operation.details.data.calls = observedRequest.calls;
        return {
          type: "array",
          data: [{
            type: "authorization",
            data: { address: TRUSTED_DELEGATION_ADDRESS, nonce: "0x0" },
            chainId: `0x${CHAIN_ID.toString(16)}`,
            signatureRequest: {
              type: "eip7702Auth",
              rawPayload: `0x${"66".repeat(32)}`,
            },
          }, operation],
        };
      },
    }),
  });
  const calls = [{
    to: CONTRACTS.token,
    value: 0n,
    data: encodeFunctionData({ abi: tokenAbi, functionName: "faucet" }),
  }];
  const prepared = await client.prepareCalls({ calls });
  validatePreparedCallBundle(prepared, calls, ACCOUNT, { currentNonce: 0 });
  const signed = await client.signPreparedCalls(prepared);
  validatePreparedCallBundle(signed, calls, ACCOUNT, { currentNonce: 0, signed: true });

  assert.equal(observedRequest.from, ACCOUNT);
  assert.equal(Number(observedRequest.chainId), CHAIN_ID);
  assert.equal(signed.data[0].signature.data.length, 132);
  assert.equal(signed.data[1].signature.data.length, 132);
});

test("the local signer rejects an unsigned or changed sponsorship result", () => {
  const call = {
    to: CONTRACTS.token,
    value: 0n,
    data: encodeFunctionData({ abi: tokenAbi, functionName: "faucet" }),
  };
  const missingFee = preparedUserOperation([call]);
  delete missingFee.feePayment;
  assert.throws(
    () => validatePreparedCallBundle(missingFee, [call], ACCOUNT),
    /would charge the local wallet/,
  );

  const changedHash = preparedUserOperation([call]);
  changedHash.details.data.hash = `0x${"77".repeat(32)}`;
  assert.throws(
    () => validatePreparedCallBundle(changedHash, [call], ACCOUNT),
    /reports a different hash/,
  );
});

test("the adapter rejects changed code at the pinned delegation address", async () => {
  await assert.rejects(
    verifyTrustedDelegation({ getBytecode: async () => "0x6000" }),
    /does not match the audited runtime/,
  );
});

test("relay URLs use TLS outside the local machine", () => {
  assert.equal(
    normalizeRelayUrl(DEFAULT_RELAY_URL),
    "https://ghostclaw-confidential-payments.vercel.app/rpc",
  );
  assert.equal(normalizeRelayUrl("https://relay.ghostclaw.test/rpc"), "https://relay.ghostclaw.test/rpc");
  assert.equal(normalizeRelayUrl("http://127.0.0.1:8787/rpc"), "http://127.0.0.1:8787/rpc");
  assert.throws(() => normalizeRelayUrl("http://relay.ghostclaw.test/rpc"), /must use HTTPS/);
});

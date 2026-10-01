import assert from "node:assert/strict";
import test from "node:test";
import { encodeCallsMAv2 } from "@alchemy/smart-accounts";
import { encodeFunctionData, getAddress, serializeSignature, zeroAddress } from "viem";
import { entryPoint07Address, getUserOperationHash } from "viem/account-abstraction";
import { privateKeyToAccount } from "viem/accounts";
import { authorizeRelayPayload } from "./lib/relay-policy.mjs";
import { CHAIN_ID, CONTRACTS, poolAbi, tokenAbi } from "./lib/protocol.mjs";

const POLICY_ID = "ghostclaw-test-policy";
const UNDELEGATION_POLICY_ID = "ghostclaw-test-undelegation-policy";
const PRIVATE_KEY = `0x${"11".repeat(32)}`;
const ACCOUNT = privateKeyToAccount(PRIVATE_KEY);
const SENDER = ACCOUNT.address;
const OTHER = getAddress("0x2222222222222222222222222222222222222222");
const PAYMASTER = getAddress("0x3333333333333333333333333333333333333333");
const DELEGATION = getAddress("0x69007702764179f14F51cdce752f4f775d74E139");
const PROOF = `0x${"11".repeat(768)}`;

function tokenCall(functionName, args = []) {
  return {
    to: CONTRACTS.token,
    value: "0x0",
    data: encodeFunctionData({ abi: tokenAbi, functionName, args }),
  };
}

function poolCall(functionName, args = []) {
  return {
    to: CONTRACTS.pool,
    value: "0x0",
    data: encodeFunctionData({ abi: poolAbi, functionName, args }),
  };
}

function rpc(method, params, id = 1) {
  return { jsonrpc: "2.0", id, method, params };
}

async function signedBundle(call = tokenCall("faucet")) {
  const calls = Array.isArray(call) ? call : [call];
  const data = {
    sender: SENDER,
    nonce: "0x0",
    callData: encodeCallsMAv2(calls),
    callGasLimit: "0x100000",
    verificationGasLimit: "0x100000",
    preVerificationGas: "0x10000",
    maxFeePerGas: "0x1000000",
    maxPriorityFeePerGas: "0x100000",
    paymaster: PAYMASTER,
    paymasterData: "0x12",
    paymasterVerificationGasLimit: "0x10000",
    paymasterPostOpGasLimit: "0x0",
  };
  const hash = getUserOperationHash({
    chainId: CHAIN_ID,
    entryPointAddress: entryPoint07Address,
    entryPointVersion: "0.7",
    userOperation: data,
  });
  const authorization = await ACCOUNT.signAuthorization({
    address: DELEGATION,
    chainId: CHAIN_ID,
    nonce: 0,
  });
  return {
    type: "array",
    data: [{
      type: "authorization",
      data: { address: DELEGATION, nonce: "0x0" },
      chainId: `0x${CHAIN_ID.toString(16)}`,
      signature: {
        type: "secp256k1",
        data: serializeSignature(authorization),
      },
    }, {
      type: "user-operation-v070",
      data,
      chainId: `0x${CHAIN_ID.toString(16)}`,
      signature: {
        type: "secp256k1",
        data: await ACCOUNT.signMessage({ message: { raw: hash } }),
      },
    }],
  };
}

test("the relay adds its policy to an approved prepared call", async () => {
  const checked = await authorizeRelayPayload(rpc("wallet_prepareCalls", [{
    from: SENDER,
    chainId: `0x${CHAIN_ID.toString(16)}`,
    calls: [poolCall("registerSelf", [PROOF, 1n])],
  }]), POLICY_ID);
  assert.equal(checked.sender, SENDER);
  assert.deepEqual(checked.payload.params[0].capabilities, {
    paymasterService: { policyId: POLICY_ID },
  });
});

test("the relay accepts a signed sponsored GhostClaw bundle", async () => {
  const checked = await authorizeRelayPayload(
    rpc("wallet_sendPreparedCalls", [await signedBundle()]),
    POLICY_ID,
  );
  assert.equal(checked.sender, SENDER);
  assert.equal(checked.payload.params[0].data.length, 2);
});

test("the relay accepts the 100 gUSD faucet call", async () => {
  const calls = [tokenCall("faucet")];
  const prepared = await authorizeRelayPayload(rpc("wallet_prepareCalls", [{
    from: SENDER,
    chainId: `0x${CHAIN_ID.toString(16)}`,
    calls,
  }]), POLICY_ID, undefined, UNDELEGATION_POLICY_ID);
  assert.equal(prepared.payload.params[0].calls.length, 1);

  const sent = await authorizeRelayPayload(
    rpc("wallet_sendPreparedCalls", [await signedBundle(calls)]),
    POLICY_ID,
  );
  assert.equal(sent.sender, SENDER);
});

test("the relay rejects changed calls, capabilities, and delegations", async () => {
  await assert.rejects(() => authorizeRelayPayload(rpc("wallet_prepareCalls", [{
    from: SENDER,
    chainId: `0x${CHAIN_ID.toString(16)}`,
    calls: [{ to: OTHER, value: "0x0", data: "0x12345678" }],
  }]), POLICY_ID), /outside the GhostClaw/);

  await assert.rejects(() => authorizeRelayPayload(rpc("wallet_prepareCalls", [{
    from: SENDER,
    chainId: `0x${CHAIN_ID.toString(16)}`,
    calls: [tokenCall("faucet")],
    capabilities: { sessionKey: {}, paymasterService: {} },
  }]), POLICY_ID), /unsupported capability/);

  const changed = await signedBundle();
  changed.data[0].data.address = OTHER;
  await assert.rejects(
    () => authorizeRelayPayload(rpc("wallet_sendPreparedCalls", [changed]), POLICY_ID),
    /untrusted delegation/,
  );

  const shortSignature = await signedBundle();
  shortSignature.data[1].signature.data = "0x12";
  await assert.rejects(
    () => authorizeRelayPayload(rpc("wallet_sendPreparedCalls", [shortSignature]), POLICY_ID),
    /malformed or unsponsored/,
  );
});

test("the relay accepts only one hexadecimal status identifier", async () => {
  const checked = await authorizeRelayPayload(
    rpc("wallet_getCallsStatus", [`0x${"55".repeat(32)}`]),
    POLICY_ID,
  );
  assert.equal(checked.sender, null);
  await assert.rejects(
    () => authorizeRelayPayload(rpc("wallet_getCallsStatus", ["pending"]), POLICY_ID),
    /malformed/,
  );
});

test("the relay accepts only a zero-address EIP-7702 exit request", async () => {
  const checked = await authorizeRelayPayload(rpc("wallet_prepareCalls", [{
    from: SENDER,
    chainId: `0x${CHAIN_ID.toString(16)}`,
    calls: [],
    capabilities: { eip7702Auth: { delegation: zeroAddress } },
  }]), POLICY_ID, undefined, UNDELEGATION_POLICY_ID);
  assert.equal(checked.sender, SENDER);
  assert.deepEqual(checked.acceptedCalls, [{
    target: zeroAddress,
    functionName: "undelegateAccount",
  }]);
  assert.deepEqual(checked.payload.params[0].capabilities, {
    paymasterService: { policyId: UNDELEGATION_POLICY_ID },
    eip7702Auth: { delegation: zeroAddress },
  });

  await assert.rejects(() => authorizeRelayPayload(rpc("wallet_prepareCalls", [{
    from: SENDER,
    chainId: `0x${CHAIN_ID.toString(16)}`,
    calls: [],
    capabilities: { eip7702Auth: { delegation: OTHER } },
  }]), POLICY_ID, undefined, UNDELEGATION_POLICY_ID), /exit capability is malformed/);
});

test("the relay recovers the signer of a zero-address exit authorization", async () => {
  const authorization = await ACCOUNT.signAuthorization({
    address: zeroAddress,
    chainId: CHAIN_ID,
    nonce: 9,
  });
  const bundle = {
    type: "authorization",
    data: { address: zeroAddress, nonce: "0x9" },
    chainId: `0x${CHAIN_ID.toString(16)}`,
    signature: {
      type: "secp256k1",
      data: serializeSignature(authorization),
    },
    capabilities: { paymasterService: { policyId: UNDELEGATION_POLICY_ID } },
  };
  const checked = await authorizeRelayPayload(
    rpc("wallet_sendPreparedCalls", [bundle]),
    POLICY_ID,
    undefined,
    UNDELEGATION_POLICY_ID,
  );
  assert.equal(checked.sender, SENDER);
  assert.equal(checked.acceptedCalls[0].functionName, "undelegateAccount");
  assert.deepEqual(checked.payload.params[0].capabilities, {
    paymasterService: { policyId: UNDELEGATION_POLICY_ID },
  });

  bundle.data.address = OTHER;
  await assert.rejects(
    () => authorizeRelayPayload(
      rpc("wallet_sendPreparedCalls", [bundle]),
      POLICY_ID,
      undefined,
      UNDELEGATION_POLICY_ID,
    ),
    /nonzero delegation/,
  );
});

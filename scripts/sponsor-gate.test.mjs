import assert from "node:assert/strict";
import test from "node:test";
import { encodeCallsMAv2 } from "@alchemy/smart-accounts";
import { encodeFunctionData, getAddress } from "viem";
import {
  CHAIN_ID,
  CONTRACTS,
  poolAbi,
  tokenAbi,
} from "./lib/protocol.mjs";
import { evaluateSponsorship } from "./lib/sponsorship-policy.mjs";

const POLICY_ID = "ghostclaw-test-policy";
const SENDER = getAddress("0x1111111111111111111111111111111111111111");
const MERCHANT = getAddress("0x2222222222222222222222222222222222222222");
const PROOF = `0x${"11".repeat(768)}`;

function request(calls, overrides = {}) {
  return {
    policyId: POLICY_ID,
    chainId: `0x${CHAIN_ID.toString(16)}`,
    userOperation: {
      sender: SENDER,
      callData: encodeCallsMAv2(calls),
    },
    ...overrides,
  };
}

function poolCall(functionName, args) {
  return {
    to: CONTRACTS.pool,
    value: 0n,
    data: encodeFunctionData({ abi: poolAbi, functionName, args }),
  };
}

function tokenCall(functionName, args = []) {
  return {
    to: CONTRACTS.token,
    value: 0n,
    data: encodeFunctionData({ abi: tokenAbi, functionName, args }),
  };
}

test("the sponsor gate accepts every GhostClaw write path", () => {
  const calls = [
    poolCall("registerSelf", [PROOF, 1n]),
    poolCall("rotateAccount", [PROOF, SENDER, 2n, `0x${"22".repeat(65)}`]),
    poolCall("requestRecovery", [PROOF, 1n, SENDER, 2n, `0x${"22".repeat(65)}`]),
    poolCall("cancelRecovery", [1n]),
    poolCall("finalizeRecovery", [1n]),
    tokenCall("faucet"),
    tokenCall("approve", [CONTRACTS.pool, 100_000_000n]),
    poolCall("deposit", [PROOF, 3n, 100_000_000n]),
    poolCall("confidentialTransfer", [PROOF, 1n, 2n, 3n, 4n, 6n, 7n, MERCHANT]),
    poolCall("withdraw", [PROOF, 1n, 2n, 3n, SENDER, 1n]),
  ];

  for (const call of calls) {
    const result = evaluateSponsorship(request([call]), POLICY_ID);
    assert.equal(result.approved, true, result.reason);
  }
});

test("the sponsor gate accepts the 100 gUSD faucet claim", () => {
  const result = evaluateSponsorship(request([tokenCall("faucet")]), POLICY_ID);
  assert.equal(result.approved, true, result.reason);
});

test("the sponsor gate rejects calls that can spend the relay budget elsewhere", () => {
  const unknownTarget = evaluateSponsorship(request([{
    to: MERCHANT,
    value: 0n,
    data: "0x12345678",
  }]), POLICY_ID);
  assert.equal(unknownTarget.approved, false);

  const wrongSpender = evaluateSponsorship(request([
    tokenCall("approve", [MERCHANT, 1n]),
  ]), POLICY_ID);
  assert.equal(wrongSpender.approved, false);

  const nativeValue = evaluateSponsorship(request([{
    ...poolCall("registerSelf", [PROOF, 1n]),
    value: 1n,
  }]), POLICY_ID);
  assert.equal(nativeValue.approved, false);

  const publicTransfer = evaluateSponsorship(request([
    tokenCall("transfer", [MERCHANT, 1n]),
  ]), POLICY_ID);
  assert.equal(publicTransfer.approved, false);
});

test("the sponsor gate fails closed for altered policy metadata and call wrappers", () => {
  const call = poolCall("registerSelf", [PROOF, 1n]);
  assert.equal(evaluateSponsorship(request([call], { policyId: "other-policy" }), POLICY_ID).approved, false);
  assert.equal(evaluateSponsorship(request([call], { chainId: "0x1" }), POLICY_ID).approved, false);
  assert.equal(evaluateSponsorship(request([call, call, call, call]), POLICY_ID).approved, false);

  const wrapped = request([call]);
  wrapped.userOperation.callData = `0x8dd7712f${wrapped.userOperation.callData.slice(2)}`;
  assert.equal(evaluateSponsorship(wrapped, POLICY_ID).approved, true);
});

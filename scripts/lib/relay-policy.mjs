import {
  getAddress,
  isAddress,
  isHex,
  recoverMessageAddress,
  size,
  zeroAddress,
} from "viem";
import { entryPoint07Address, getUserOperationHash } from "viem/account-abstraction";
import { recoverAuthorizationAddress } from "viem/utils";
import { CHAIN_ID } from "./protocol.mjs";
import {
  validateGhostClawCalls,
  validateGhostClawUserOperation,
} from "./sponsorship-policy.mjs";

const TRUSTED_DELEGATION_ADDRESS = getAddress(
  "0x69007702764179f14F51cdce752f4f775d74E139",
);
const ALLOWED_METHODS = new Set([
  "wallet_prepareCalls",
  "wallet_sendPreparedCalls",
  "wallet_getCallsStatus",
]);

function reject(message) {
  const error = new Error(message);
  error.code = "RELAY_REJECTED";
  throw error;
}

function requireChain(value) {
  if (Number(value) !== CHAIN_ID) reject("The relay request targets another chain.");
}

function undelegationCapability(capabilities) {
  const capability = capabilities.eip7702Auth;
  if (
    !capability
    || typeof capability !== "object"
    || Array.isArray(capability)
    || Object.keys(capability).length !== 1
    || !isAddress(capability.delegation)
    || getAddress(capability.delegation) !== zeroAddress
  ) {
    reject("The EIP-7702 exit capability is malformed.");
  }
  return { delegation: zeroAddress };
}

function requireCapabilities(value, policyId, inject, webhookSecret, allowUndelegation = false) {
  const capabilities = value ?? {};
  if (!capabilities || typeof capabilities !== "object" || Array.isArray(capabilities)) {
    reject("The relay request capabilities are malformed.");
  }
  const names = Object.keys(capabilities);
  if (names.some((name) => (
    name !== "paymasterService"
    && !(allowUndelegation && name === "eip7702Auth")
  ))) {
    reject("The relay request contains an unsupported capability.");
  }
  const eip7702Auth = capabilities.eip7702Auth === undefined
    ? undefined
    : undelegationCapability(capabilities);
  if (
    capabilities.paymasterService?.policyId
    && capabilities.paymasterService.policyId !== policyId
  ) {
    reject("The relay request contains another sponsorship policy.");
  }
  if (capabilities.paymasterService !== undefined) {
    if (
      !capabilities.paymasterService
      || typeof capabilities.paymasterService !== "object"
      || Array.isArray(capabilities.paymasterService)
      || Object.keys(capabilities.paymasterService).some((name) => name !== "policyId")
    ) {
      reject("The paymaster capability is malformed.");
    }
  }
  if (!inject) return capabilities;
  return {
    paymasterService: {
      policyId,
      ...(webhookSecret ? { webhookData: webhookSecret } : {}),
    },
    ...(eip7702Auth ? { eip7702Auth } : {}),
  };
}

function prepareRequest(params, policyId, webhookSecret, undelegationPolicyId) {
  if (!Array.isArray(params) || params.length !== 1) {
    reject("The prepared call parameters are malformed.");
  }
  const request = params?.[0];
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    reject("The prepared call request is malformed.");
  }
  requireChain(request.chainId);
  const sender = getAddress(request.from);
  const undelegation = request.capabilities?.eip7702Auth !== undefined;
  const selectedPolicyId = undelegation ? undelegationPolicyId : policyId;
  if (
    !Array.isArray(request.calls)
    || (undelegation ? request.calls.length !== 0 : request.calls.length < 1)
    || request.calls.length > 3
  ) {
    reject("The prepared call count is outside the relay policy.");
  }
  const accepted = undelegation
    ? [{ target: zeroAddress, functionName: "undelegateAccount" }]
    : validateGhostClawCalls(request.calls);
  const calls = request.calls.map((call, index) => {
    const checked = accepted[index];
    return {
      to: checked.target,
      value: "0x0",
      data: call.data,
    };
  });
  const capabilities = requireCapabilities(
    request.capabilities,
    selectedPolicyId,
    true,
    undelegation ? undefined : webhookSecret,
    undelegation,
  );
  return {
    sender,
    acceptedCalls: accepted,
    params: [{
      calls,
      from: sender,
      chainId: `0x${CHAIN_ID.toString(16)}`,
      capabilities,
    }],
  };
}

function signedEntries(value) {
  if (value?.type === "array") {
    if (!Array.isArray(value.data)) reject("The signed call array is malformed.");
    return value.data;
  }
  return [value];
}

async function requireValidSignatures(authorization, userOperation, sender) {
  const hash = getUserOperationHash({
    chainId: CHAIN_ID,
    entryPointAddress: entryPoint07Address,
    entryPointVersion: "0.7",
    userOperation: userOperation.data,
  });
  let userOperationSigner;
  try {
    userOperationSigner = await recoverMessageAddress({
      message: { raw: hash },
      signature: userOperation.signature.data,
    });
  } catch {
    reject("The UserOperation signature does not authorize its sender.");
  }
  if (getAddress(userOperationSigner) !== sender) {
    reject("The UserOperation signature does not authorize its sender.");
  }
  if (authorization) {
    let authorizationSigner;
    try {
      authorizationSigner = await recoverAuthorizationAddress({
        authorization: {
          address: authorization.data.address,
          chainId: Number(authorization.chainId),
          nonce: BigInt(authorization.data.nonce),
        },
        signature: authorization.signature.data,
      });
    } catch {
      reject("The EIP-7702 signature does not authorize its sender.");
    }
    if (getAddress(authorizationSigner) !== sender) {
      reject("The EIP-7702 signature does not authorize its sender.");
    }
  }
}

async function sendRequest(params, policyId, undelegationPolicyId) {
  if (!Array.isArray(params) || params.length !== 1) {
    reject("The signed call parameters are malformed.");
  }
  const request = params?.[0];
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    reject("The signed call request is malformed.");
  }
  const entries = signedEntries(request);
  const authorizations = entries.filter((entry) => entry?.type === "authorization");
  const userOperations = entries.filter((entry) => entry?.type === "user-operation-v070");
  if (authorizations.length === 1 && userOperations.length === 0 && entries.length === 1) {
    const capabilities = requireCapabilities(
      request.capabilities,
      undelegationPolicyId,
      true,
    );
    const authorization = authorizations[0];
    requireChain(authorization.chainId);
    if (getAddress(authorization.data?.address) !== zeroAddress) {
      reject("The signed exit bundle contains a nonzero delegation.");
    }
    if (
      authorization.signature?.type !== "secp256k1"
      || !isHex(authorization.signature?.data)
      || size(authorization.signature.data) !== 65
    ) {
      reject("The EIP-7702 exit signature is malformed.");
    }
    let sender;
    try {
      sender = getAddress(await recoverAuthorizationAddress({
        authorization: {
          address: zeroAddress,
          chainId: Number(authorization.chainId),
          nonce: BigInt(authorization.data?.nonce),
        },
        signature: authorization.signature.data,
      }));
    } catch {
      reject("The EIP-7702 exit signature does not authorize its sender.");
    }
    return {
      sender,
      acceptedCalls: [{ target: zeroAddress, functionName: "undelegateAccount" }],
      params: [{ ...request, capabilities }],
    };
  }
  requireCapabilities(request.capabilities, policyId, false);
  if (
    authorizations.length > 1
    || userOperations.length !== 1
    || entries.length !== authorizations.length + userOperations.length
  ) {
    reject("The signed call bundle contains an unsupported call type.");
  }
  if (authorizations.length === 1) {
    const authorization = authorizations[0];
    requireChain(authorization.chainId);
    if (getAddress(authorization.data?.address) !== TRUSTED_DELEGATION_ADDRESS) {
      reject("The signed call bundle contains an untrusted delegation.");
    }
    if (
      authorization.signature?.type !== "secp256k1"
      || !isHex(authorization.signature?.data)
      || size(authorization.signature.data) !== 65
    ) {
      reject("The EIP-7702 authorization signature is malformed.");
    }
  }
  const userOperation = userOperations[0];
  requireChain(userOperation.chainId);
  if (
    userOperation.signature?.type !== "secp256k1"
    || !isHex(userOperation.signature?.data)
    || size(userOperation.signature.data) !== 65
    || !isAddress(userOperation.data?.paymaster)
    || !isHex(userOperation.data?.paymasterData)
    || size(userOperation.data.paymasterData) === 0
  ) {
    reject("The signed UserOperation is malformed or unsponsored.");
  }
  const result = validateGhostClawUserOperation(userOperation.data);
  await requireValidSignatures(authorizations[0], userOperation, result.sender);
  return { sender: result.sender, acceptedCalls: result.acceptedCalls, params: [request] };
}

function statusRequest(params) {
  if (
    !Array.isArray(params)
    || params.length !== 1
    || typeof params[0] !== "string"
    || !/^0x[0-9a-f]+$/i.test(params[0])
  ) {
    reject("The call status request is malformed.");
  }
  return { sender: null, acceptedCalls: [], params: [params[0]] };
}

export async function authorizeRelayPayload(
  payload,
  policyId,
  webhookSecret,
  undelegationPolicyId = policyId,
) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    reject("The JSON-RPC request must contain one object.");
  }
  if (payload.jsonrpc !== "2.0" || !ALLOWED_METHODS.has(payload.method)) {
    reject("The JSON-RPC method is outside the GhostClaw relay policy.");
  }
  if (typeof payload.id !== "string" && typeof payload.id !== "number") {
    reject("The JSON-RPC request ID is malformed.");
  }

  let checked;
  if (payload.method === "wallet_prepareCalls") {
    checked = prepareRequest(payload.params, policyId, webhookSecret, undelegationPolicyId);
  } else if (payload.method === "wallet_sendPreparedCalls") {
    checked = await sendRequest(payload.params, policyId, undelegationPolicyId);
  } else {
    checked = statusRequest(payload.params);
  }
  return {
    sender: checked.sender,
    acceptedCalls: checked.acceptedCalls,
    payload: {
      jsonrpc: "2.0",
      id: payload.id,
      method: payload.method,
      params: checked.params,
    },
  };
}

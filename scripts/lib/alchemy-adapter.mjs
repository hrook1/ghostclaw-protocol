import {
  alchemyWalletTransport,
  createSmartWalletClient,
} from "@alchemy/wallet-apis";
import { decodeCallsMAv2 } from "@alchemy/smart-accounts";
import {
  createPublicClient,
  encodeFunctionData,
  getAddress,
  http,
  isAddress,
  isHex,
  keccak256,
  size,
  zeroAddress,
} from "viem";
import {
  entryPoint07Address,
  getUserOperationHash,
} from "viem/account-abstraction";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import {
  CHAIN_ID,
  CONTRACTS,
  PUBLIC_RPC_URL,
  poolAbi,
  tokenAbi,
} from "./protocol.mjs";
import {
  assertGhostClawSignature,
  validateGhostClawCalls,
} from "./sponsorship-policy.mjs";

const EXECUTE_USER_OP_SELECTOR = "0x8dd7712f";
export const DEFAULT_RELAY_URL = "https://ghostclaw-confidential-payments.vercel.app/rpc";
export const TRUSTED_DELEGATION_ADDRESS = getAddress(
  "0x69007702764179f14F51cdce752f4f775d74E139",
);
export const TRUSTED_DELEGATION_RUNTIME_HASH =
  "0xecfc0328ce4d953a4d452e11f54b578fa2d7f2f8126246d1120ca24d11845081";
export const TRUSTED_DELEGATION_RUNTIME_BYTES = 23_741;

export const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(PUBLIC_RPC_URL, { retryCount: 2, timeout: 30_000 }),
});

export async function verifyTrustedDelegation(client = publicClient) {
  const code = await client.getBytecode({ address: TRUSTED_DELEGATION_ADDRESS });
  if (
    !code
    || size(code) !== TRUSTED_DELEGATION_RUNTIME_BYTES
    || keccak256(code) !== TRUSTED_DELEGATION_RUNTIME_HASH
  ) {
    throw new Error("The pinned EIP-7702 delegation code does not match the audited runtime.");
  }
  return true;
}

export function trustedDelegationDesignation() {
  return `0xef0100${TRUSTED_DELEGATION_ADDRESS.slice(2).toLowerCase()}`;
}

export function normalizeRelayUrl(value) {
  let url;
  try {
    url = new URL(String(value ?? ""));
  } catch {
    throw new Error("A valid GhostClaw relay URL is required.");
  }
  const loopback = url.hostname === "localhost"
    || url.hostname === "127.0.0.1"
    || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) {
    throw new Error("The GhostClaw relay URL must use HTTPS.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("The GhostClaw relay URL contains unsupported credentials or parameters.");
  }
  return url.toString();
}

function bundleEntries(bundle) {
  if (bundle?.type === "array") {
    if (!Array.isArray(bundle.data)) throw new Error("The prepared call array is malformed.");
    return bundle.data;
  }
  return [bundle];
}

function userOperationHash(data) {
  return getUserOperationHash({
    chainId: CHAIN_ID,
    entryPointAddress: entryPoint07Address,
    entryPointVersion: "0.7",
    userOperation: data,
  });
}

function sameCall(actual, expected) {
  return getAddress(actual.to) === getAddress(expected.to)
    && BigInt(actual.value ?? 0) === BigInt(expected.value ?? 0)
    && String(actual.data ?? "0x").toLowerCase() === String(expected.data ?? "0x").toLowerCase();
}

function decodedUserOperationCalls(data, account) {
  if (getAddress(data.sender) !== account) {
    throw new Error("The prepared UserOperation has a different sender.");
  }
  let callData = data.callData;
  if (typeof callData !== "string" || !callData.startsWith("0x")) {
    throw new Error("The prepared UserOperation call data is malformed.");
  }
  if (callData.toLowerCase().startsWith(EXECUTE_USER_OP_SELECTOR)) {
    callData = `0x${callData.slice(10)}`;
  }
  return decodeCallsMAv2(callData, account);
}

export function validatePreparedCallBundle(
  bundle,
  expectedCalls,
  accountValue,
  options = {},
) {
  const account = getAddress(accountValue);
  const entries = bundleEntries(bundle);
  const authorizations = entries.filter((entry) => entry?.type === "authorization");
  const userOperations = entries.filter((entry) => entry?.type === "user-operation-v070");
  if (authorizations.length > 1 || userOperations.length !== 1) {
    throw new Error("The relay returned an unsupported prepared call bundle.");
  }
  if (entries.length !== authorizations.length + userOperations.length) {
    throw new Error("The relay returned an unsupported call type.");
  }

  if (authorizations.length === 1) {
    const authorization = authorizations[0];
    if (
      getAddress(authorization.data?.address) !== TRUSTED_DELEGATION_ADDRESS
      || Number(authorization.chainId) !== CHAIN_ID
    ) {
      throw new Error("The relay requested an untrusted EIP-7702 delegation.");
    }
    if (
      options.currentNonce !== undefined
      && BigInt(authorization.data?.nonce) !== BigInt(options.currentNonce)
    ) {
      throw new Error("The relay requested an unexpected EIP-7702 nonce.");
    }
    if (
      options.signed !== true
      && authorization.signatureRequest?.type !== "eip7702Auth"
    ) {
      throw new Error("The EIP-7702 signature request is malformed.");
    }
    if (
      options.signed === true
      && (
        authorization.signature?.type !== "secp256k1"
        || !isHex(authorization.signature?.data)
        || size(authorization.signature.data) !== 65
      )
    ) {
      throw new Error("The EIP-7702 signature is malformed.");
    }
  }

  const prepared = userOperations[0];
  if (Number(prepared.chainId) !== CHAIN_ID) {
    throw new Error("The prepared UserOperation targets another chain.");
  }
  if (
    !isAddress(prepared.data?.paymaster)
    || !isHex(prepared.data?.paymasterData)
    || size(prepared.data.paymasterData) === 0
  ) {
    throw new Error("The prepared UserOperation has no gas sponsorship.");
  }
  if (options.signed !== true && prepared.feePayment?.sponsored !== true) {
    throw new Error("The prepared UserOperation would charge the local wallet.");
  }

  const calls = decodedUserOperationCalls(prepared.data, account);
  if (calls.length !== expectedCalls.length) {
    throw new Error("The prepared UserOperation changed the call count.");
  }
  for (let index = 0; index < calls.length; index += 1) {
    if (!sameCall(calls[index], expectedCalls[index])) {
      throw new Error("The prepared UserOperation changed a GhostClaw call.");
    }
  }
  validateGhostClawCalls(calls);

  const hash = userOperationHash(prepared.data);
  if (prepared.details?.data?.hash && prepared.details.data.hash.toLowerCase() !== hash.toLowerCase()) {
    throw new Error("The prepared UserOperation reports a different hash.");
  }
  if (options.signed !== true) {
    const signatureRequest = prepared.signatureRequest;
    if (
      signatureRequest?.type !== "personal_sign"
      || signatureRequest.data?.raw?.toLowerCase() !== hash.toLowerCase()
    ) {
      throw new Error("The UserOperation signature request does not match the call.");
    }
  } else if (
    prepared.signature?.type !== "secp256k1"
    || !isHex(prepared.signature?.data)
    || size(prepared.signature.data) !== 65
  ) {
    throw new Error("The UserOperation signature is malformed.");
  }
  return { hash, calls, authorizationRequired: authorizations.length === 1 };
}

function callAbi(target) {
  const address = getAddress(target);
  if (address === CONTRACTS.pool) return poolAbi;
  if (address === CONTRACTS.token) return tokenAbi;
  throw new Error("The contract target is outside the GhostClaw sponsorship policy.");
}

export class SponsoredTransactionAdapter {
  constructor(relayUrl, transactionSigner, dependencies = {}) {
    this.relayUrl = normalizeRelayUrl(relayUrl);
    this.signer = typeof transactionSigner === "string"
      ? privateKeyToAccount(transactionSigner)
      : transactionSigner;
    if (
      !this.signer
      || typeof this.signer.address !== "string"
      || typeof this.signer.signMessage !== "function"
      || typeof this.signer.signAuthorization !== "function"
    ) {
      throw new Error("The transaction signer does not implement the required local-account interface.");
    }
    this.account = this.signer.address;
    this.publicClient = dependencies.publicClient ?? publicClient;
    this.verifyDelegation = dependencies.verifyDelegation
      ?? (() => verifyTrustedDelegation(this.publicClient));
    this.client = dependencies.client ?? createSmartWalletClient({
      transport: alchemyWalletTransport({ url: this.relayUrl }),
      chain: baseSepolia,
      signer: this.signer,
    });
  }

  async sendCalls(requests) {
    const calls = requests.map(({ target, signature, args = [] }) => {
      const address = getAddress(target);
      assertGhostClawSignature(address, signature, args);
      const functionName = signature.slice(0, signature.indexOf("("));
      return {
        to: address,
        value: 0n,
        data: encodeFunctionData({ abi: callAbi(address), functionName, args }),
      };
    });
    validateGhostClawCalls(calls);
    await this.verifyDelegation();
    const currentNonce = await this.publicClient.getTransactionCount({ address: this.account });
    const prepared = await this.client.prepareCalls({ calls });
    validatePreparedCallBundle(prepared, calls, this.account, { currentNonce });
    const signed = await this.client.signPreparedCalls(prepared);
    validatePreparedCallBundle(signed, calls, this.account, { currentNonce, signed: true });
    const result = await this.client.sendPreparedCalls(signed);
    const status = await this.client.waitForCallsStatus({
      id: result.id,
      timeout: 120_000,
      throwOnFailure: true,
    });
    const transactionHash = status.receipts?.[0]?.transactionHash;
    if (status.status !== "success" || !transactionHash) {
      throw new Error("The GhostClaw sponsored transaction did not confirm.");
    }
    return {
      transactionHash,
      callId: result.id,
      account: this.account,
      sponsored: true,
      status: "confirmed",
    };
  }

  async emergencyUndelegate() {
    await this.verifyDelegation();
    const currentCode = await this.publicClient.getBytecode({ address: this.account });
    if (!currentCode || currentCode === "0x") {
      return {
        transactionHash: null,
        callId: null,
        account: this.account,
        sponsored: false,
        status: "already-undelegated",
      };
    }
    if (currentCode.toLowerCase() !== trustedDelegationDesignation()) {
      throw new Error("The Base account delegates to an unknown implementation.");
    }
    const result = await this.client.undelegateAccount();
    const status = await this.client.waitForCallsStatus({
      id: result.id,
      timeout: 120_000,
      throwOnFailure: true,
    });
    const transactionHash = status.receipts?.[0]?.transactionHash;
    if (status.status !== "success" || !transactionHash) {
      throw new Error("The sponsored account exit did not confirm.");
    }
    const finalCode = await this.publicClient.getBytecode({ address: this.account });
    if (finalCode && finalCode !== "0x") {
      throw new Error("The Base account remains delegated after the confirmed exit.");
    }
    return {
      transactionHash,
      callId: result.id,
      account: this.account,
      sponsored: true,
      status: "undelegated",
      delegation: zeroAddress,
    };
  }

  send(target, signature, args = []) {
    return this.sendCalls([{ target, signature, args }]);
  }

  registerSelf(bundle) {
    return this.send(CONTRACTS.pool, "registerSelf(bytes,uint256)", [
      bundle.proof.proof,
      BigInt(bundle.owner),
    ]);
  }

  rotateAccount(bundle, newAccount, deadline, signature) {
    return this.send(
      CONTRACTS.pool,
      "rotateAccount(bytes,address,uint256,bytes)",
      [bundle.proof.proof, getAddress(newAccount), BigInt(deadline), signature],
    );
  }

  requestRecovery(bundle, owner, newAccount, deadline, signature) {
    return this.send(
      CONTRACTS.pool,
      "requestRecovery(bytes,uint256,address,uint256,bytes)",
      [bundle.proof.proof, BigInt(owner), getAddress(newAccount), BigInt(deadline), signature],
    );
  }

  cancelRecovery(owner) {
    return this.send(CONTRACTS.pool, "cancelRecovery(uint256)", [BigInt(owner)]);
  }

  finalizeRecovery(owner) {
    return this.send(CONTRACTS.pool, "finalizeRecovery(uint256)", [BigInt(owner)]);
  }

  faucet() {
    return this.send(CONTRACTS.token, "faucet()", []);
  }

  claimPlaytestCredit() {
    return this.faucet();
  }

  approve(amount) {
    return this.send(CONTRACTS.token, "approve(address,uint256)", [CONTRACTS.pool, BigInt(amount)]);
  }

  deposit(bundle) {
    return this.send(CONTRACTS.pool, "deposit(bytes,uint256,uint64)", [
      bundle.proof.proof,
      BigInt(bundle.commitment),
      BigInt(bundle.amount),
    ]);
  }

  pay(bundle, merchant) {
    return this.send(
      CONTRACTS.pool,
      "confidentialTransfer(bytes,uint256,uint256,uint256,uint256,uint256,uint256,address)",
      [
        bundle.proof.proof,
        BigInt(bundle.spendRoot),
        BigInt(bundle.nullifier),
        BigInt(bundle.outputLeft),
        BigInt(bundle.outputRight),
        BigInt(bundle.recipientOwner),
        BigInt(bundle.paymentIntent),
        getAddress(merchant),
      ],
    );
  }

  withdraw(bundle, recipient) {
    return this.send(CONTRACTS.pool, "withdraw(bytes,uint256,uint256,uint256,address,uint64)", [
      bundle.proof.proof,
      BigInt(bundle.spendRoot),
      BigInt(bundle.nullifier),
      BigInt(bundle.changeCommitment),
      getAddress(recipient),
      BigInt(bundle.amount),
    ]);
  }
}

export async function readPool(functionName, args = [], options = {}) {
  return publicClient.readContract({
    ...(options.blockNumber === undefined ? {} : { blockNumber: options.blockNumber }),
    address: CONTRACTS.pool,
    abi: poolAbi,
    functionName,
    args,
  });
}

export async function readToken(functionName, args = []) {
  return publicClient.readContract({
    address: CONTRACTS.token,
    abi: tokenAbi,
    functionName,
    args,
  });
}

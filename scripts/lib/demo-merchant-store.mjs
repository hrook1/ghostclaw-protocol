import { randomBytes } from "node:crypto";
import { getAddress } from "viem";
import { NETWORK } from "./protocol.mjs";
import { openSealedJson, sealJson } from "./sealed-json.mjs";
import { transactionAccount } from "./state.mjs";

const LOCK_TTL_MS = 45_000;
const RELEASE_LOCK_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

function checkedDeployment(value) {
  if (
    value?.version !== 1
    || value.network !== NETWORK
    || typeof value.owner !== "string"
    || typeof value.noteEncryptionPublicKey !== "string"
    || !value.sealedState
  ) {
    throw new Error("The hosted demo merchant deployment is invalid.");
  }
  return {
    ...value,
    merchant: getAddress(value.merchant),
  };
}

function stateContext(merchant) {
  return `ghostclaw-demo-merchant-state-v1:${merchant.toLowerCase()}`;
}

export class DemoMerchantStateStore {
  constructor({ redis, secret, deployment }) {
    this.redis = redis;
    this.secret = secret;
    this.deployment = checkedDeployment(deployment);
    const suffix = this.deployment.merchant.toLowerCase().slice(2);
    this.stateKey = `ghostclaw:demo:merchant:${suffix}:state:v1`;
    this.lockKey = `ghostclaw:demo:merchant:${suffix}:lock:v1`;
  }

  open(envelope) {
    const state = openSealedJson(envelope, this.secret, {
      purpose: "demo-merchant-state",
      aad: stateContext(this.deployment.merchant),
    });
    if (
      transactionAccount(state) !== this.deployment.merchant
      || String(state.owner) !== String(this.deployment.owner)
      || state.noteEncryptionPublicKey !== this.deployment.noteEncryptionPublicKey
    ) {
      throw new Error("The hosted demo merchant state has another identity.");
    }
    return state;
  }

  seal(state) {
    return sealJson(state, this.secret, {
      purpose: "demo-merchant-state",
      aad: stateContext(this.deployment.merchant),
    });
  }

  async ensureState() {
    let encoded = await this.redis.get(this.stateKey);
    if (encoded === null) {
      await this.redis.set(
        this.stateKey,
        JSON.stringify(this.deployment.sealedState),
        { nx: true },
      );
      encoded = await this.redis.get(this.stateKey);
    }
    if (typeof encoded !== "string" || encoded.length > 3 * 1024 * 1024) {
      throw new Error("The hosted demo merchant state is unavailable.");
    }
    let envelope;
    try {
      envelope = JSON.parse(encoded);
    } catch {
      throw new Error("The hosted demo merchant state is invalid.");
    }
    return this.open(envelope);
  }

  loadState() {
    return this.ensureState();
  }

  async saveState(state) {
    const envelope = this.seal(state);
    this.open(envelope);
    await this.redis.set(this.stateKey, JSON.stringify(envelope));
  }

  async withWalletLock(callback) {
    const token = randomBytes(32).toString("hex");
    const acquired = await this.redis.set(this.lockKey, token, { nx: true, px: LOCK_TTL_MS });
    if (acquired !== "OK") {
      const error = new Error("The hosted demo merchant wallet is busy. Retry the paid request.");
      error.code = "GHOSTCLAW_MERCHANT_BUSY";
      throw error;
    }
    try {
      return await callback();
    } finally {
      await this.redis.eval(RELEASE_LOCK_SCRIPT, [this.lockKey], [token]).catch(() => {});
    }
  }

  dependencies(extra = {}) {
    return {
      ...extra,
      loadState: () => this.loadState(),
      saveState: (state) => this.saveState(state),
      withWalletLock: (callback) => this.withWalletLock(callback),
    };
  }
}

export function validateDemoMerchantDeployment(deployment, secret) {
  const checked = checkedDeployment(deployment);
  const store = new DemoMerchantStateStore({
    deployment: checked,
    secret,
    redis: {
      get: async () => null,
      set: async () => "OK",
      eval: async () => 1,
    },
  });
  const state = store.open(checked.sealedState);
  return {
    merchant: checked.merchant,
    owner: String(state.owner),
    noteEncryptionPublicKey: state.noteEncryptionPublicKey,
  };
}

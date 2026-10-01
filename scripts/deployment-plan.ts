import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  concatHex,
  encodeDeployData,
  getAddress,
  getCreate2Address,
  keccak256,
  padHex,
  stringToHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";

export const UNIVERSAL_CREATE2_DEPLOYER =
  "0x4e59b44847b379578588920cA78FbF26c0B4956C" as const;
export const UNIVERSAL_CREATE2_RUNTIME =
  "0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3" as const;

type Artifact = {
  abi: Abi;
  bytecode: { object: Hex };
  deployedBytecode: {
    object: Hex;
    immutableReferences?: Record<string, Array<{ start: number; length: number }>>;
  };
};

type ComponentName =
  | "gUSD"
  | "identityVerifier"
  | "depositVerifier"
  | "spendVerifier"
  | "withdrawVerifier"
  | "poseidon2"
  | "pool";

export type DeploymentComponent = {
  name: ComponentName;
  contractName: string;
  artifactPath: string;
  artifactSha256: string;
  expectedRuntimeBytes: number;
  expectedRuntimeHash: Hex;
  address: Address;
  salt: Hex;
  initCode: Hex;
  initCodeHash: Hex;
  deployerCalldata: Hex;
};

const scriptRoot = dirname(new URL(import.meta.url).pathname);
const projectRoot = resolve(scriptRoot, "..");
const definitions = {
  gUSD: [
    "GhostClawTestUSDV2",
    "out/GhostClawTestUSDV2.sol/GhostClawTestUSDV2.json",
  ],
  identityVerifier: [
    "GhostClawGnarkIdentityVerifierV2",
    "out/GhostClawGnarkIdentityVerifierV2.sol/GhostClawGnarkIdentityVerifierV2.json",
  ],
  depositVerifier: [
    "GhostClawGnarkDepositVerifierV2",
    "out/GhostClawGnarkDepositVerifierV2.sol/GhostClawGnarkDepositVerifierV2.json",
  ],
  spendVerifier: [
    "GhostClawGnarkSpendVerifierV2",
    "out/GhostClawGnarkSpendVerifierV2.sol/GhostClawGnarkSpendVerifierV2.json",
  ],
  withdrawVerifier: [
    "GhostClawGnarkWithdrawVerifierV2",
    "out/GhostClawGnarkWithdrawVerifierV2.sol/GhostClawGnarkWithdrawVerifierV2.json",
  ],
  poseidon2: [
    "GhostClawPoseidon2BN254",
    "out/GhostClawPoseidon2BN254.sol/GhostClawPoseidon2BN254.json",
  ],
  pool: [
    "GhostClawGnarkPlonkPoolV2",
    "out/GhostClawGnarkPlonkPoolV2.sol/GhostClawGnarkPlonkPoolV2.json",
  ],
} as const;

async function loadArtifact(path: string) {
  const bytes = await readFile(resolve(projectRoot, path));
  const artifact = JSON.parse(bytes.toString("utf8")) as Artifact;
  if (
    !artifact.bytecode?.object?.startsWith("0x")
    || !artifact.deployedBytecode?.object?.startsWith("0x")
  ) {
    throw new Error(`${path} has no deployable bytecode.`);
  }
  return {
    artifact,
    artifactSha256: createHash("sha256").update(bytes).digest("hex"),
    runtimeBytes: (artifact.deployedBytecode.object.length - 2) / 2,
  };
}

function saltFor(name: ComponentName) {
  return keccak256(
    stringToHex(`ghostclaw:confidential-payments:base-sepolia:v2:${name}`),
  );
}

function materializeRuntime(artifact: Artifact, args: readonly unknown[] = []) {
  const references = artifact.deployedBytecode.immutableReferences ?? {};
  const immutableIds = Object.keys(references).sort((left, right) => Number(left) - Number(right));
  if (immutableIds.length === 0) return artifact.deployedBytecode.object;
  if (immutableIds.length !== args.length) {
    throw new Error("The constructor arguments do not match the immutable runtime references.");
  }

  let runtime = artifact.deployedBytecode.object.slice(2);
  immutableIds.forEach((id, index) => {
    if (typeof args[index] !== "string") {
      throw new Error("Only address immutables are supported by this deployment plan.");
    }
    const value = padHex(getAddress(args[index] as string), { size: 32 }).slice(2);
    for (const reference of references[id]) {
      if (reference.length !== 32) {
        throw new Error("An immutable runtime reference has an unexpected length.");
      }
      const start = reference.start * 2;
      runtime = `${runtime.slice(0, start)}${value}${runtime.slice(start + reference.length * 2)}`;
    }
  });
  return `0x${runtime}` as Hex;
}

function makeComponent(input: {
  name: ComponentName;
  contractName: string;
  artifactPath: string;
  artifactSha256: string;
  runtimeBytes: number;
  artifact: Artifact;
  args?: readonly unknown[];
}): DeploymentComponent {
  const runtime = materializeRuntime(input.artifact, input.args);
  const runtimeBytes = (runtime.length - 2) / 2;
  if (runtimeBytes >= 24_576) {
    throw new Error(`${input.name} exceeds the EIP-170 runtime limit.`);
  }
  const initCode = encodeDeployData({
    abi: input.artifact.abi,
    bytecode: input.artifact.bytecode.object,
    args: input.args,
  });
  const salt = saltFor(input.name);
  return {
    name: input.name,
    contractName: input.contractName,
    artifactPath: input.artifactPath,
    artifactSha256: input.artifactSha256,
    expectedRuntimeBytes: runtimeBytes,
    expectedRuntimeHash: keccak256(runtime),
    address: getCreate2Address({
      from: UNIVERSAL_CREATE2_DEPLOYER,
      salt,
      bytecode: initCode,
    }),
    salt,
    initCode,
    initCodeHash: keccak256(initCode),
    deployerCalldata: concatHex([salt, initCode]),
  };
}

export async function buildDeploymentPlan(operator: Address) {
  const loaded = Object.fromEntries(
    await Promise.all(
      Object.entries(definitions).map(async ([name, [contractName, path]]) => [
        name,
        {
          contractName,
          path,
          ...(await loadArtifact(path)),
        },
      ]),
    ),
  ) as Record<
    ComponentName,
    {
      contractName: string;
      path: string;
      artifact: Artifact;
      artifactSha256: string;
      runtimeBytes: number;
    }
  >;

  const components: DeploymentComponent[] = [];
  const add = (name: ComponentName, args?: readonly unknown[]) => {
    const selected = loaded[name];
    const component = makeComponent({
      name,
      contractName: selected.contractName,
      artifactPath: selected.path,
      artifactSha256: selected.artifactSha256,
      runtimeBytes: selected.runtimeBytes,
      artifact: selected.artifact,
      args,
    });
    components.push(component);
    return component.address;
  };

  const gUSD = add("gUSD");
  const identityVerifier = add("identityVerifier");
  const depositVerifier = add("depositVerifier");
  const spendVerifier = add("spendVerifier");
  const withdrawVerifier = add("withdrawVerifier");
  const poseidon2 = add("poseidon2");
  const pool = add("pool", [
    gUSD,
    identityVerifier,
    depositVerifier,
    spendVerifier,
    withdrawVerifier,
    poseidon2,
  ]);

  return {
    version: 2,
    chainId: 84532,
    operator: getAddress(operator),
    create2Deployer: UNIVERSAL_CREATE2_DEPLOYER,
    reusedContracts: {},
    contracts: {
      gUSD,
      identityVerifier,
      depositVerifier,
      spendVerifier,
      withdrawVerifier,
      poseidon2,
      pool,
    },
    components,
  };
}

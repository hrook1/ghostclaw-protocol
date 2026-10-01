# Hosted merchant configuration migration

The public manifest contains only the demo merchant's public identity and registration record. The encrypted wallet seed is operator configuration.

The hosted report route requires two secret environment values:

| Variable | Contents |
|---|---|
| `GHOSTCLAW_DEMO_MERCHANT_DEPLOYMENT_JSON` | Complete existing encrypted deployment JSON, including `sealedState`. |
| `GHOSTCLAW_DEMO_MERCHANT_SECRET` | Existing encryption key that authenticates and decrypts that state. |

Keep both values in the hosting provider's secret configuration. Never copy either value into source code, build logs, issues, or screenshots.

## Migrate the existing service

Complete this configuration change before deploying code that requires the new variable. Creating or merging a pull request does not perform this migration.

1. Locate the preserved full encrypted deployment in the operator's private storage.
2. Set `GHOSTCLAW_DEMO_MERCHANT_DEPLOYMENT_JSON` to that complete JSON through the hosting provider's secret interface.
3. Keep the existing `GHOSTCLAW_DEMO_MERCHANT_SECRET` unchanged.
4. Keep the existing Redis connection, merchant identity, and encrypted Redis wallet state unchanged.
5. Configure the same values for each approved environment that runs this merchant.
6. Deploy only after the operator approves the configuration and deployment.
7. Run the read-only hosted verification against that approved deployment.

The original private checkout preserves the encrypted JSON in its ignored `.operator/publication-quarantine/` directory with owner-only permissions.
This public repository contains neither that directory nor the encrypted JSON.

Do not reprovision the merchant for this migration. Do not register another identity, rotate keys, clear Redis, or replace the existing deployment.

The seed initializes Redis only when no merchant state exists. Existing Redis state contains received notes and remains the operational wallet state.

The route authenticates the secret deployment and compares its public fields with `deployments/base-sepolia-demo-merchant.json`. Missing, malformed, mismatched, or unauthenticated configuration returns a generic `503` response.

No local validation can confirm that the hosting environment has received the new secret. Record that operator step separately from source validation.

## Provision a new test merchant

Provisioning creates wallet state and can register a Base Sepolia identity. Run it only with explicit operator approval.

The default provisioning destination is `.operator/base-sepolia-demo-merchant.sealed.json`. The script creates that encrypted file with owner-only permissions and refuses to replace an existing file.

The optional `--public-deployment-file <path>` writes a separate public manifest. It refuses to overwrite an existing reviewed manifest.

Only the public manifest belongs in Git. Store the full encrypted JSON and its encryption key through the approved secret-management process.

## Earlier Git history

The encrypted state remains in the private predecessor's history, not this repository's new history. Its encryption key still requires protection.

If the key may have been exposed, follow the [incident response guide](INCIDENT_RESPONSE.md). Do not treat file removal as credential revocation.

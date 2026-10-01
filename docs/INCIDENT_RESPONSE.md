# Incident response

## Scope

Use this procedure for the Base Sepolia test service. Keep test gUSD valueless.
Preserve evidence before a configuration change when this action is safe.

## Sponsor abuse

1. Set the Alchemy Agent Gas Manager policy to `inactive`.
2. Block `/rpc` and `/alchemy/sponsor` in Vercel.
3. Preserve redacted Alchemy sponsorship records.
4. Preserve Redis counters and Vercel security events.
5. Record affected senders, methods, costs, and time windows.
6. Rotate the Alchemy API key, Redis token, and callback secret.
7. Correct the policy or code.
8. Run all relay and live verification tests.
9. Create a new policy when the old policy data is untrusted.
10. Restore the hosted routes after review.

## Relay credential disclosure

1. Disable the Gas Manager policy.
2. Revoke the disclosed provider credential.
3. Disable the affected Vercel deployment.
4. Search deployment logs and Git history for the value.
5. Create a new value in the provider secret store.
6. Redeploy from the signed release.
7. Run the hosted fresh-wallet acceptance test.

## Redis failure

1. Confirm that `/health` or protected calls fail closed.
2. Keep sponsorship disabled during an uncertain limit state.
3. Check Redis provider status and request logs.
4. Replace the Redis token after suspected disclosure.
5. Run the concurrent limit test before restoration.

## Simulation RPC failure

1. Confirm that the sponsorship callback returns rejection.
2. Keep callback error sponsorship disabled in Alchemy.
3. Check the independent RPC health and chain ID.
4. Replace the RPC endpoint after repeated failures.
5. Run a valid call and a reverting call before restoration.

## Merchant settlement mismatch

1. Stop service delivery for the affected request.
2. Preserve the payment response and original x402 requirement.
3. Record the Base transaction hash and receipt.
4. Run the release receive validation again.
5. Check the smart-account call, pool call, event, commitment, root, and intent.
6. Check the original request digest and request salt.
7. Keep the request pending when a value differs.
8. Record any replay evidence before local state changes.

## Base transaction key compromise

1. Stop the local wallet process.
2. Disable relay sponsorship for the public sender.
3. Use `rotate-account` from a clean wallet backup when the spend key is safe.
4. Use delayed recovery when the old Base key is unavailable.
5. Cancel an unknown recovery from the current account.
6. Use emergency undelegation after an Alchemy runtime concern.

## Spend key compromise

1. Stop all wallet activity.
2. Disable sponsorship for the public account.
3. Preserve encrypted state for investigation.
4. Treat every unspent note as exposed.
5. Move available value to a new protocol identity when safe.

Account rotation keeps the same spend key. It cannot remove this compromise.

## Note encryption key compromise

1. Stop merchant note delivery to the affected card.
2. Publish a new merchant card from a new wallet identity.
3. Treat received note plaintext as exposed.
4. Move affected notes when the spend key remains safe.

## EIP-7702 concern

1. Disable sponsorship for the affected sender.
2. Compare the account designation with the pinned delegation address.
3. Compare the delegation runtime size and hash.
4. Review the vendored Alchemy source and security notices.
5. Run `emergency-undelegate` from a clean host.
6. Confirm empty account code through an independent Base RPC.

## Contract concern

1. Disable sponsorship for the complete policy.
2. Stop new deposits and service delivery.
3. Preserve the affected transaction, proof, and state values.
4. Compare deployed runtime hashes with the signed release.
5. Ask the auditor to assess withdrawal safety.
6. Publish tested exit instructions before service restoration.

The deployed pool has no operator pause or upgrade function. The relay can stop
sponsored calls. It cannot stop a user who supplies separate Base gas.

## Release key compromise

1. Revoke the affected signing key.
2. Remove releases signed after the first suspected event.
3. Publish the affected tag, commit, archive hash, and time window.
4. Create a new offline release key.
5. Rebuild from a reviewed signed tag.
6. Ask users to verify the replacement archive.

## Evidence handling

Remove all provider tokens, wallet keys, request bodies, and private note data
from a shared incident record. Keep the original evidence in encrypted storage
with access logging.

/**
 * ShieldPass SDK — end-to-end self test.
 *
 * Proves the WHOLE flow actually works with a single shared Poseidon:
 *   issuer leaf → real Merkle root → nullifier → ZK proof → verify == true
 *
 * Run:  npx ts-node test.ts
 * Exits non-zero if the proof fails to verify, so it can gate CI.
 */
import { TrustedIssuer } from './src/issuer';
import { ShieldPassProver } from './src/prover';
import { computeNullifier } from './src/poseidon';
import { KYCProofParams, CompiledCircuit } from './src/types';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const circuit = require('./circuits/reusable_kyc/target/reusable_kyc.json') as CompiledCircuit;

async function main() {
    console.log('=== ShieldPass SDK end-to-end self test ===\n');

    const issuer = new TrustedIssuer();

    // 1. User passes KYC; issuer mints a secret salt + leaf + inclusion proof.
    //    hardwareAttested + bvnVerified + goodStanding (a Tier 2, BVN-verified, user).
    const secretSalt = issuer.generateSecretSalt();
    const leaf = issuer.generateLeaf(BigInt(secretSalt), true, true, true);
    const { merkle_path, merkle_indices, merkle_root } = issuer.generateMerkleProof(leaf);
    console.log('[issuer] leaf       :', leaf);
    console.log('[issuer] merkle_root:', merkle_root);

    // 2. Time-bound nullifier, computed with the same Poseidon the circuit asserts.
    const current_timestamp = Math.floor(Date.now() / 3_600_000).toString();
    const nullifier = computeNullifier(secretSalt, current_timestamp);
    console.log('[user]   nullifier  :', nullifier);

    const params: KYCProofParams = {
        secret_salt: secretSalt,
        hardware_attested: '1',
        bvn_verified: '1',
        good_standing: '1',
        merkle_path,
        merkle_indices,
        merkle_root,
        current_timestamp,
        nullifier,
        require_bvn: '1', // enforce the Tier 2 (BVN) branch in the circuit
    };

    // 3. Generate + verify the proof.
    const prover = new ShieldPassProver(circuit);
    await prover.init();
    const result = await prover.proveKYC(params);
    const ok = await prover.verifyProof(result.proof, result.publicInputs);

    console.log(`\nproof bytes: ${result.proof.length}, verifyProof => ${ok}`);
    if (!ok) {
        console.error('\n❌ FAIL: proof did not verify.');
        process.exit(1);
    }
    console.log('\n✅ PASS: full issuer → prover → verify flow works.');
}

main().catch((e) => {
    console.error('\n❌ FAIL:', e);
    process.exit(1);
});

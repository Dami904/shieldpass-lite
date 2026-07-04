// V2 validation: drive the new owner-based SDK (note model + swap + transfer) and confirm
// the proofs verify. Run: npx ts-node --transpile-only test-shielded.ts
import * as snarkjs from 'snarkjs';
import { readFileSync } from 'fs';
import { IncrementalMerkleTree } from './src/tree';
import { ownerOf, noteCommitment, noteNullifier, Compliance } from './src/notes';
import { buildSwapInputFromPath, buildTransferInput, buildInsertInput } from './src/circuitInputs';
import { prove } from './src/groth16Prover';

const B = `${__dirname}/circom/build`;
const vk = (n: string) => JSON.parse(readFileSync(`${B}/${n}_vk.json`, 'utf8'));
const wasm = (n: string) => `${B}/${n}_js/${n}.wasm`;
const zkey = (n: string) => `${B}/${n}_final.zkey`;

async function main() {
    const c: Compliance = { hardware_attested: 1n, bvn_verified: 1n, good_standing: 1n };
    const sk = 7777777n, owner = ownerOf(sk);
    const in_amount = 1000n, in_randomness = 111111n;
    const leaf = noteCommitment(in_amount, owner, in_randomness, c);

    // seed the note into a fresh tree
    const tree = new IncrementalMerkleTree(20);
    const insNoteInput = buildInsertInput(tree, leaf); // index 0
    const noteIndex = 0;
    const ins = await prove(insNoteInput, wasm('merkle_insert'), zkey('merkle_insert'));
    if (!(await snarkjs.groth16.verify(vk('merkle_insert'), ins.raw.publicSignals, ins.raw.proof))) throw new Error('insert failed');

    const siblings = tree.path(noteIndex);
    const indices: number[] = [];
    let idx = noteIndex; for (let i = 0; i < 20; i++) { indices.push(idx & 1); idx = Math.floor(idx / 2); }

    // 1) confidential_swap (owner-based)
    console.log('proving confidential_swap (owner-based)...');
    const swap = await prove(buildSwapInputFromPath({
        sk, in_amount, in_randomness, compliance: c, siblings, indices,
        merkle_root: tree.root(), swap_amount: 250n, change_randomness: 222222n,
        bank_account_number: 1234567890n, secret_salt: 999999n, require_bvn: 0n,
    }), wasm('confidential_swap'), zkey('confidential_swap'));
    if (!(await snarkjs.groth16.verify(vk('confidential_swap'), swap.raw.publicSignals, swap.raw.proof))) throw new Error('swap failed');
    if (BigInt(swap.raw.publicSignals[0]) !== noteNullifier(sk, leaf)) throw new Error('nullifier mismatch');

    // 2) shielded_transfer (private P2P) — send 300 to a recipient
    const recipientSk = 5555555n, recipient_owner = ownerOf(recipientSk);
    console.log('proving shielded_transfer...');
    const transfer = await prove(buildTransferInput({
        sk, in_amount, in_randomness, compliance: c, siblings, indices,
        merkle_root: tree.root(), send_amount: 300n, recipient_owner,
        recipient_randomness: 333333n, change_randomness: 444444n,
    }), wasm('shielded_transfer'), zkey('shielded_transfer'));
    if (!(await snarkjs.groth16.verify(vk('shielded_transfer'), transfer.raw.publicSignals, transfer.raw.proof))) throw new Error('transfer failed');

    // recipient's note (publicSignals[1]) must equal a note built for the recipient's owner
    const expectRecip = noteCommitment(300n, recipient_owner, 333333n, c);
    if (BigInt(transfer.raw.publicSignals[1]) !== expectRecip) throw new Error('recipient commitment mismatch');

    console.log('\n✅ PASS: owner-based notes — swap + private transfer both verify, recipient note correct.');
    console.log('   transfer publicSignals = [nullifier, recipientNote, changeNote, root, recipientOwner]');
}
main().then(() => process.exit(0)).catch((e) => { console.error('❌', e.message); process.exit(1); });

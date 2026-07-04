pragma circom 2.1.6;

// Shared V2 note model (owner-based). A note is owned by `owner = Poseidon(DOM_OWNER, sk)`,
// so only the holder of the shielded spending key `sk` can spend it. This lets a sender
// create a note FOR a recipient (binding their owner tag) without being able to spend it back.
include "poseidon.circom";

function DOM_NOTE()  { return 1; }
function DOM_NULL()  { return 2; }
function DOM_BANK()  { return 3; }
function DOM_OWNER() { return 4; }

// owner = Poseidon(DOM_OWNER, sk)
template Owner() {
    signal input sk;
    signal output out;
    component h = Poseidon(2);
    h.inputs[0] <== DOM_OWNER();
    h.inputs[1] <== sk;
    out <== h.out;
}

// note commitment = Poseidon(DOM_NOTE, amount, owner, randomness, hw, bvn, standing)
// `randomness` gives per-note uniqueness; compliance travels with the value.
template NoteCommitment() {
    signal input amount;
    signal input owner;
    signal input randomness;
    signal input hw;
    signal input bvn;
    signal input standing;
    signal output out;
    component h = Poseidon(7);
    h.inputs[0] <== DOM_NOTE();
    h.inputs[1] <== amount;
    h.inputs[2] <== owner;
    h.inputs[3] <== randomness;
    h.inputs[4] <== hw;
    h.inputs[5] <== bvn;
    h.inputs[6] <== standing;
    out <== h.out;
}

// nullifier = Poseidon(DOM_NULL, sk, leaf) — unique per (key, note); prevents double-spend.
template Nullifier() {
    signal input sk;
    signal input leaf;
    signal output out;
    component h = Poseidon(3);
    h.inputs[0] <== DOM_NULL();
    h.inputs[1] <== sk;
    h.inputs[2] <== leaf;
    out <== h.out;
}

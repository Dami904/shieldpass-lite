pragma circom 2.1.6;

// ShieldPass V2 — Private shielded transfer (Groth16 / BN254).
// Spend ONE owned note -> create TWO output notes (recipient + change), entirely inside
// the pool. Amounts are PRIVATE (hidden on-chain); the recipient's owner is bound as a
// public input so a tampered delivery blob can't redirect funds. No token movement.

include "poseidon.circom";
include "comparators.circom";
include "switcher.circom";
include "bitify.circom";
include "./note.circom";

template ShieldedTransfer(DEPTH) {
    // ---- private witnesses ----
    signal input sk;                    // sender's shielded spending key
    signal input in_amount;             // value of the spent note (hidden)
    signal input in_randomness;
    signal input hw;
    signal input bvn;
    signal input standing;
    signal input merkle_path[DEPTH];
    signal input merkle_indices[DEPTH];
    signal input send_amount;           // amount to the recipient (hidden)
    signal input recipient_randomness;
    signal input change_randomness;

    // ---- public ----
    signal input merkle_root;
    signal input recipient_owner;       // bound: where the value goes
    signal output nullifier;
    signal output out_recipient_commitment;
    signal output out_change_commitment;

    // compliance booleans (travel with the value)
    hw * (hw - 1) === 0;
    bvn * (bvn - 1) === 0;
    standing * (standing - 1) === 0;
    hw === 1;
    standing === 1;

    // owner = Poseidon(sk)
    component own = Owner();
    own.sk <== sk;

    // input note (leaf)
    component leaf = NoteCommitment();
    leaf.amount <== in_amount;
    leaf.owner <== own.out;
    leaf.randomness <== in_randomness;
    leaf.hw <== hw; leaf.bvn <== bvn; leaf.standing <== standing;

    // membership in the tree
    signal cur[DEPTH + 1];
    cur[0] <== leaf.out;
    component sw[DEPTH];
    component node[DEPTH];
    for (var i = 0; i < DEPTH; i++) {
        merkle_indices[i] * (merkle_indices[i] - 1) === 0;
        sw[i] = Switcher();
        sw[i].sel <== merkle_indices[i];
        sw[i].L <== cur[i];
        sw[i].R <== merkle_path[i];
        node[i] = Poseidon(2);
        node[i].inputs[0] <== sw[i].outL;
        node[i].inputs[1] <== sw[i].outR;
        cur[i + 1] <== node[i].out;
    }
    cur[DEPTH] === merkle_root;

    // nullifier
    component nf = Nullifier();
    nf.sk <== sk;
    nf.leaf <== leaf.out;
    nullifier <== nf.out;

    // value conservation: change = in - send; all in [0, 2^64)
    component r1 = Num2Bits(64); r1.in <== in_amount;
    component r2 = Num2Bits(64); r2.in <== send_amount;
    signal change_amount;
    change_amount <== in_amount - send_amount;
    component r3 = Num2Bits(64); r3.in <== change_amount;

    // output note for the recipient (bound to recipient_owner)
    component outR = NoteCommitment();
    outR.amount <== send_amount;
    outR.owner <== recipient_owner;
    outR.randomness <== recipient_randomness;
    outR.hw <== hw; outR.bvn <== bvn; outR.standing <== standing;
    out_recipient_commitment <== outR.out;

    // change note back to the sender
    component outC = NoteCommitment();
    outC.amount <== change_amount;
    outC.owner <== own.out;
    outC.randomness <== change_randomness;
    outC.hw <== hw; outC.bvn <== bvn; outC.standing <== standing;
    out_change_commitment <== outC.out;
}

component main { public [merkle_root, recipient_owner] } = ShieldedTransfer(20);

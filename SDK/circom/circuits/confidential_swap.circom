pragma circom 2.1.6;

// ShieldPass — Confidential Swap (Groth16 / BN254), V2 OWNER-BASED note model.
// Used by withdraw (off-ramp) and unshield. Notes are owned by `owner = Poseidon(sk)`
// (the persistent shielded key), so the same notes work across swap / unshield / transfer.
// `swap_amount` is PUBLIC here (a boundary action — real value leaves the pool).
//
// Public-signal layout is unchanged from V1 so the contract needs no changes (only the VK):
//   outputs:  [nullifier, change_commitment, user_blinded_commitment]
//   inputs:   [merkle_root, require_bvn, swap_amount]

include "poseidon.circom";
include "comparators.circom";
include "switcher.circom";
include "bitify.circom";
include "./note.circom";

template ConfidentialSwap(DEPTH) {
    // ---- private ----
    signal input sk;
    signal input in_amount;
    signal input in_randomness;
    signal input merkle_path[DEPTH];
    signal input merkle_indices[DEPTH];
    signal input change_randomness;
    signal input bank_account_number;
    signal input secret_salt;
    signal input hardware_attested;
    signal input bvn_verified;
    signal input good_standing;

    // ---- public inputs ----
    signal input merkle_root;
    signal input require_bvn;
    signal input swap_amount;
    // Destination binding (anti front-running): for unshield this is the field encoding
    // of the on-chain recipient (int_be(sha256(xdr(address))) mod r); the contract
    // recomputes it and rejects any tx whose recipient doesn't match. For withdraw-to-fiat
    // it is unused (pass 0) — that flow is bound by the blinded bank hash instead.
    signal input recipient;

    // ---- public outputs ----
    signal output nullifier;
    signal output change_commitment;
    signal output user_blinded_commitment;

    // compliance gate
    hardware_attested * (hardware_attested - 1) === 0;
    bvn_verified * (bvn_verified - 1) === 0;
    good_standing * (good_standing - 1) === 0;
    require_bvn * (require_bvn - 1) === 0;
    hardware_attested === 1;
    good_standing === 1;
    require_bvn * (1 - bvn_verified) === 0;

    // owner + input note (leaf)
    component own = Owner();
    own.sk <== sk;
    component leaf = NoteCommitment();
    leaf.amount <== in_amount;
    leaf.owner <== own.out;
    leaf.randomness <== in_randomness;
    leaf.hw <== hardware_attested; leaf.bvn <== bvn_verified; leaf.standing <== good_standing;

    // membership
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

    // amounts (public swap_amount): change = in - swap; ranges
    component r1 = Num2Bits(64); r1.in <== in_amount;
    component r2 = Num2Bits(64); r2.in <== swap_amount;
    signal change_amount;
    change_amount <== in_amount - swap_amount;
    component r3 = Num2Bits(64); r3.in <== change_amount;

    // nullifier
    component nf = Nullifier();
    nf.sk <== sk;
    nf.leaf <== leaf.out;
    nullifier <== nf.out;

    // change note (back to self)
    component cc = NoteCommitment();
    cc.amount <== change_amount;
    cc.owner <== own.out;
    cc.randomness <== change_randomness;
    cc.hw <== hardware_attested; cc.bvn <== bvn_verified; cc.standing <== good_standing;
    change_commitment <== cc.out;

    // blinded bank commitment (for fiat settlement)
    component bk = Poseidon(3);
    bk.inputs[0] <== DOM_BANK();
    bk.inputs[1] <== bank_account_number;
    bk.inputs[2] <== secret_salt;
    user_blinded_commitment <== bk.out;

    // Bind `recipient` into the constraint system so the compiler can't optimize the
    // public signal away. Its value is otherwise unconstrained (the *contract* checks it),
    // which is exactly Tornado's pattern for committing a destination to the proof.
    signal recipient_sq;
    recipient_sq <== recipient * recipient;
}

component main { public [merkle_root, require_bvn, swap_amount, recipient] } = ConfidentialSwap(20);

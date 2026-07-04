pragma circom 2.1.6;

// ShieldPass — Merkle Insert (Groth16 / BN254)
//
// Proves a single trustless append to the append-only commitment tree:
//   replacing the EMPTY (0) leaf at `index` with `leaf` transforms
//   `old_root` into `new_root`, using one shared sibling path.
//
// The Soroban contract verifies this proof in `insert(...)` instead of hashing
// on-chain (the SDK cannot call native Poseidon). old_root is bound to the
// contract's current_root and index to next_index, so no party can forge a root.
//
// Uses the SAME circomlib Poseidon(2) and left/right (Switcher) convention as
// confidential_swap.circom, so a leaf inserted here is provable there.

include "poseidon.circom";
include "bitify.circom";
include "switcher.circom";

template MerkleInsert(DEPTH) {
    // ---- public ----
    signal input old_root;   // == contract current_root
    signal input new_root;   // becomes contract current_root
    signal input leaf;       // commitment being appended
    signal input index;      // == contract next_index

    // ---- private ----
    signal input siblings[DEPTH];

    // index -> path bits (bit i == 1 means the running node is the RIGHT child)
    component idxBits = Num2Bits(DEPTH);
    idxBits.in <== index;

    signal curOld[DEPTH + 1];
    signal curNew[DEPTH + 1];
    curOld[0] <== 0;     // the slot is currently empty
    curNew[0] <== leaf;  // ...and becomes `leaf`

    component swOld[DEPTH];
    component swNew[DEPTH];
    component hOld[DEPTH];
    component hNew[DEPTH];

    for (var i = 0; i < DEPTH; i++) {
        // old path
        swOld[i] = Switcher();
        swOld[i].sel <== idxBits.out[i];
        swOld[i].L <== curOld[i];
        swOld[i].R <== siblings[i];
        hOld[i] = Poseidon(2);
        hOld[i].inputs[0] <== swOld[i].outL;
        hOld[i].inputs[1] <== swOld[i].outR;
        curOld[i + 1] <== hOld[i].out;

        // new path (identical siblings + bits)
        swNew[i] = Switcher();
        swNew[i].sel <== idxBits.out[i];
        swNew[i].L <== curNew[i];
        swNew[i].R <== siblings[i];
        hNew[i] = Poseidon(2);
        hNew[i].inputs[0] <== swNew[i].outL;
        hNew[i].inputs[1] <== swNew[i].outR;
        curNew[i + 1] <== hNew[i].out;
    }

    curOld[DEPTH] === old_root;
    curNew[DEPTH] === new_root;
}

component main { public [old_root, new_root, leaf, index] } = MerkleInsert(20);

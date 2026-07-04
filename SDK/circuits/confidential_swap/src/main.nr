use poseidon::poseidon::bn254;

global DEPTH: u32 = 20;

fn merkle_membership(
    leaf: Field,
    path: [Field; DEPTH],
    indices: [Field; DEPTH]
) -> Field {
    let mut node = leaf;
    for i in 0..DEPTH {
        let is_right = indices[i];
        let (l, r) = if is_right == 1 {
            (path[i], node)
        } else {
            (node, path[i])
        };
        node = bn254::hash_2([l, r]);
    }
    node
}

fn main(
    // --- Private Inputs ---
    note_amount: u64,
    note_secret: Field,
    merkle_path: [Field; DEPTH],
    merkle_indices: [Field; DEPTH],
    swap_amount: u64,
    bank_account_number: Field,
    secret_salt: Field,
    new_change_secret: Field,

    // --- Public Inputs ---
    merkle_root: pub Field,
    nullifier: pub Field,
    change_commitment: pub Field,
    user_blinded_commitment: pub Field,
) {
    // 1. Prove ownership of the original note
    let note_commitment = bn254::hash_2([note_amount as Field, note_secret]);

    // 2. Prove the note exists in the Merkle tree
    let computed_root = merkle_membership(note_commitment, merkle_path, merkle_indices);
    assert(computed_root == merkle_root);

    // 3. Ensure sufficient funds and compute change
    assert(note_amount >= swap_amount);
    let change_amount = note_amount - swap_amount;

    // 4. Verify the nullifier (prevents double spending)
    let computed_nullifier = bn254::hash_2([note_commitment, note_secret]);
    assert(computed_nullifier == nullifier);

    // 5. Verify the change note commitment
    let computed_change_commitment = bn254::hash_2([change_amount as Field, new_change_secret]);
    assert(computed_change_commitment == change_commitment);

    // 6. Verify the blinded bank account commitment
    let computed_bank_commitment = bn254::hash_2([bank_account_number, secret_salt]);
    assert(computed_bank_commitment == user_blinded_commitment);
}

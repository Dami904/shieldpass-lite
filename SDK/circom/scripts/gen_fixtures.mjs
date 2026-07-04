// V2 fixtures: real Groth16 proofs for confidential_swap (owner-based), merkle_insert,
// and the new shielded_transfer — all on the owner-based note model. Verifies with snarkjs
// and emits Rust fixtures for the contract test.
import { poseidon2, poseidon3, poseidon7 } from "poseidon-lite";
import * as snarkjs from "snarkjs";
import { writeFileSync, readFileSync } from "fs";

const DEPTH = 20;
const DOM_NOTE = 1n, DOM_NULL = 2n, DOM_BANK = 3n, DOM_OWNER = 4n;

const ownerOf = (sk) => poseidon2([DOM_OWNER, sk]);
const noteLeaf = (amount, owner, rand, c) => poseidon7([DOM_NOTE, amount, owner, rand, c.hw, c.bvn, c.standing]);
const nullifierOf = (sk, leaf) => poseidon3([DOM_NULL, sk, leaf]);
const bankOf = (acct, salt) => poseidon3([DOM_BANK, acct, salt]);
const toStr = (x) => x.toString();

// ---------- Incremental Merkle tree (Poseidon arity-2) ----------
class IMT {
  constructor(depth) {
    this.depth = depth;
    this.zeros = [0n];
    for (let i = 0; i < depth; i++) this.zeros.push(poseidon2([this.zeros[i], this.zeros[i]]));
    this.nodes = new Map();
  }
  node(l, i) { const k = `${l}:${i}`; return this.nodes.has(k) ? this.nodes.get(k) : this.zeros[l]; }
  root() { return this.node(this.depth, 0); }
  path(index) {
    const s = []; let idx = index;
    for (let l = 0; l < this.depth; l++) { s.push(idx % 2 === 0 ? this.node(l, idx + 1) : this.node(l, idx - 1)); idx = Math.floor(idx / 2); }
    return s;
  }
  setLeaf(index, value) {
    this.nodes.set(`0:${index}`, value); let idx = index;
    for (let l = 0; l < this.depth; l++) { const p = Math.floor(idx / 2); this.nodes.set(`${l + 1}:${p}`, poseidon2([this.node(l, p * 2), this.node(l, p * 2 + 1)])); idx = p; }
  }
}

// ---------- byte serialization ----------
const be32 = (x) => Uint8Array.from((((x % (2n ** 256n)) + 2n ** 256n) % (2n ** 256n)).toString(16).padStart(64, "0").match(/.{2}/g).map((b) => parseInt(b, 16)));
const lit = (u8) => `[${Array.from(u8).map((b) => "0x" + b.toString(16).padStart(2, "0")).join(", ")}]`;
const g1 = (p) => lit(new Uint8Array([...be32(BigInt(p[0])), ...be32(BigInt(p[1]))]));
const g2 = (p) => lit(new Uint8Array([...be32(BigInt(p[0][1])), ...be32(BigInt(p[0][0])), ...be32(BigInt(p[1][1])), ...be32(BigInt(p[1][0]))]));
const fr = (s) => lit(be32(BigInt(s)));
const rustVk = (name, vk) => `pub fn ${name}() -> Vk {\n  Vk {\n    alpha1: ${g1(vk.vk_alpha_1)},\n    beta2: ${g2(vk.vk_beta_2)},\n    gamma2: ${g2(vk.vk_gamma_2)},\n    delta2: ${g2(vk.vk_delta_2)},\n    ic: &[\n${vk.IC.map((p) => "      " + g1(p)).join(",\n")}\n    ],\n  }\n}\n`;
const rustFix = (name, proof, pub) => `pub fn ${name}() -> Fixture {\n  Fixture {\n    a: ${g1(proof.pi_a)},\n    b: ${g2(proof.pi_b)},\n    c: ${g1(proof.pi_c)},\n    public_signals: &[\n${pub.map((x) => "      " + fr(x)).join(",\n")}\n    ],\n  }\n}\n`;

const prove = async (input, name) => {
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, `build/${name}_js/${name}.wasm`, `build/${name}_final.zkey`);
  const vk = JSON.parse(readFileSync(`build/${name}_vk.json`, "utf8"));
  if (!(await snarkjs.groth16.verify(vk, publicSignals, proof))) throw new Error(`${name} proof failed to verify`);
  return { proof, publicSignals, vk };
};

async function main() {
  const c = { hw: 1n, bvn: 1n, standing: 1n };
  const sk = 7777777n, owner = ownerOf(sk);
  const in_amount = 1000n, in_randomness = 111111n;
  const leaf = noteLeaf(in_amount, owner, in_randomness, c);

  // (0) insert the note at index 0
  const tree = new IMT(DEPTH);
  const noteOldRoot = tree.root();
  const noteSiblings = tree.path(0);
  tree.setLeaf(0, leaf);
  const merkle_root = tree.root();
  const siblings = tree.path(0);
  const indices = Array.from({ length: DEPTH }, (_, i) => (0 >> i) & 1);

  console.log("proving merkle_insert (note @0)...");
  const insNote = await prove({ old_root: toStr(noteOldRoot), new_root: toStr(merkle_root), leaf: toStr(leaf), index: "0", siblings: noteSiblings.map(toStr) }, "merkle_insert");

  // (1) confidential_swap: spend note, swap 250, change 750.
  // `recipient` binds the unshield destination into the proof: it is
  //   int_be(sha256(xdr(address))) mod r
  // for the contract address CABITVLRUBEUPLACCPI7VFZVUBCNDFJRRUWBWTIJXZ5D2NHVB3LMVM6K.
  // The unshield contract test MUST pass that same address (the off-ramp swap ignores it).
  const RECIPIENT_FIELD = "11239796314445253800532920576593019933732159008483329631653343833670468030781";
  console.log("proving confidential_swap...");
  const swap = await prove({
    sk: toStr(sk), in_amount: toStr(in_amount), in_randomness: toStr(in_randomness),
    merkle_path: siblings.map(toStr), merkle_indices: indices.map(String),
    change_randomness: "222222", bank_account_number: "1234567890", secret_salt: "999999",
    hardware_attested: "1", bvn_verified: "1", good_standing: "1",
    merkle_root: toStr(merkle_root), require_bvn: "0", swap_amount: "250",
    recipient: RECIPIENT_FIELD,
  }, "confidential_swap");
  console.log("  swap publicSignals:", swap.publicSignals);

  // (2) insert the swap change note @1
  const change_commitment = BigInt(swap.publicSignals[1]);
  const insChangeOld = tree.root();
  const insChangeSib = tree.path(1);
  tree.setLeaf(1, change_commitment);
  const insChange = await prove({ old_root: toStr(insChangeOld), new_root: toStr(tree.root()), leaf: toStr(change_commitment), index: "1", siblings: insChangeSib.map(toStr) }, "merkle_insert");

  // (3) shielded_transfer: spend the SAME note (index 0), send 300 to a recipient
  const recipient_sk = 5555555n, recipient_owner = ownerOf(recipient_sk);
  console.log("proving shielded_transfer...");
  const transfer = await prove({
    sk: toStr(sk), in_amount: toStr(in_amount), in_randomness: toStr(in_randomness),
    hw: "1", bvn: "1", standing: "1",
    merkle_path: siblings.map(toStr), merkle_indices: indices.map(String),
    send_amount: "300", recipient_randomness: "333333", change_randomness: "444444",
    merkle_root: toStr(merkle_root), recipient_owner: toStr(recipient_owner),
  }, "shielded_transfer");
  console.log("  transfer publicSignals:", transfer.publicSignals);

  // ---------- emit Rust fixtures ----------
  let rs = `// AUTO-GENERATED by scripts/gen_fixtures.mjs (V2 owner-based notes).\n`;
  rs += `// Encoding: G1 [u8;64]=be(x)||be(y); G2 [u8;128]=be(x.c1)||be(x.c0)||be(y.c1)||be(y.c0); Fr [u8;32] be.\n\n`;
  rs += `pub struct Vk { pub alpha1: [u8;64], pub beta2: [u8;128], pub gamma2: [u8;128], pub delta2: [u8;128], pub ic: &'static [[u8;64]] }\n`;
  rs += `pub struct Fixture { pub a: [u8;64], pub b: [u8;128], pub c: [u8;64], pub public_signals: &'static [[u8;32]] }\n\n`;
  rs += rustVk("swap_vk", swap.vk) + "\n" + rustFix("swap_fixture", swap.proof, swap.publicSignals) + "\n";
  rs += rustVk("insert_vk", insNote.vk) + "\n";
  rs += rustFix("insert_note_fixture", insNote.proof, insNote.publicSignals) + "\n";
  rs += rustFix("insert_change_fixture", insChange.proof, insChange.publicSignals) + "\n";
  rs += rustVk("transfer_vk", transfer.vk) + "\n" + rustFix("transfer_fixture", transfer.proof, transfer.publicSignals) + "\n";
  writeFileSync("build/groth16_fixtures.rs", rs);
  console.log("\n✅ wrote build/groth16_fixtures.rs (swap + insert + transfer)");
}
main().then(() => process.exit(0)).catch((e) => { console.error("❌", e.message); process.exit(1); });

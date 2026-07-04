//! On-chain Groth16 verifier over BN254, using Soroban's native `bn254` host fns.
//!
//! Verifies the snarkjs/circom Groth16 equation
//!   e(A,B) == e(alpha,beta) · e(L,gamma) · e(C,delta)
//! rearranged into a single multi-pairing == 1:
//!   e(-A,B) · e(alpha,beta) · e(L,gamma) · e(C,delta) == 1
//! where L = IC[0] + Σ pub[i]·IC[i+1].
//!
//! Point encodings match snarkjs export (Ethereum/Soroban): G1 = be(x)||be(y) (64B);
//! G2 = be(x.c1)||be(x.c0)||be(y.c1)||be(y.c0) (128B); Fr = 32B big-endian.

use soroban_sdk::crypto::bn254::{Bn254, Bn254G1Affine, Bn254G2Affine, Fr};
use soroban_sdk::{Bytes, BytesN, Env, U256, Vec};

/// A Groth16 verifying key, reconstructed from byte constants per call.
pub struct Vk {
    pub alpha1: Bn254G1Affine,
    pub beta2: Bn254G2Affine,
    pub gamma2: Bn254G2Affine,
    pub delta2: Bn254G2Affine,
    pub ic: Vec<Bn254G1Affine>,
}

// BN254 scalar field order minus one. [r-1]·P == -P, so we negate via g1_mul.
const NEG_ONE_BE: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91, 0x43, 0xe1, 0xf5, 0x93, 0xf0, 0x00, 0x00, 0x00,
];

pub fn g1_from(env: &Env, bytes: &[u8; 64]) -> Bn254G1Affine {
    Bn254G1Affine::from_bytes(BytesN::from_array(env, bytes))
}
pub fn g2_from(env: &Env, bytes: &[u8; 128]) -> Bn254G2Affine {
    Bn254G2Affine::from_bytes(BytesN::from_array(env, bytes))
}
pub fn fr_from(env: &Env, bytes: &[u8; 32]) -> Fr {
    Fr::from_u256(U256::from_be_bytes(env, &Bytes::from_array(env, bytes)))
}

fn neg_g1(env: &Env, bn: &Bn254, p: &Bn254G1Affine) -> Bn254G1Affine {
    let s = fr_from(env, &NEG_ONE_BE);
    bn.g1_mul(p, &s)
}

/// Verify a Groth16 proof. `public` length must equal `vk.ic.len() - 1`.
pub fn verify(
    env: &Env,
    vk: &Vk,
    a: &Bn254G1Affine,
    b: &Bn254G2Affine,
    c: &Bn254G1Affine,
    public: &Vec<Fr>,
) -> bool {
    let bn = env.crypto().bn254();

    if vk.ic.len() != public.len() + 1 {
        return false;
    }

    // L = IC[0] + Σ pub[i]·IC[i+1]
    let mut acc = vk.ic.get(0).unwrap();
    for i in 0..public.len() {
        let term = bn.g1_mul(&vk.ic.get(i + 1).unwrap(), &public.get(i).unwrap());
        acc = bn.g1_add(&acc, &term);
    }

    let neg_a = neg_g1(env, &bn, a);

    let mut g1s: Vec<Bn254G1Affine> = Vec::new(env);
    let mut g2s: Vec<Bn254G2Affine> = Vec::new(env);
    g1s.push_back(neg_a);
    g2s.push_back(b.clone());
    g1s.push_back(vk.alpha1.clone());
    g2s.push_back(vk.beta2.clone());
    g1s.push_back(acc);
    g2s.push_back(vk.gamma2.clone());
    g1s.push_back(c.clone());
    g2s.push_back(vk.delta2.clone());

    bn.pairing_check(g1s, g2s)
}

#[cfg(test)]
mod tests {
    extern crate std;
    use super::*;
    use crate::test_fixtures as fx;

    fn to_vk(env: &Env, v: &fx::Vk) -> Vk {
        let mut ic: Vec<Bn254G1Affine> = Vec::new(env);
        for arr in v.ic.iter() {
            ic.push_back(g1_from(env, arr));
        }
        Vk {
            alpha1: g1_from(env, &v.alpha1),
            beta2: g2_from(env, &v.beta2),
            gamma2: g2_from(env, &v.gamma2),
            delta2: g2_from(env, &v.delta2),
            ic,
        }
    }

    fn pubs(env: &Env, sigs: &[[u8; 32]]) -> Vec<Fr> {
        let mut p: Vec<Fr> = Vec::new(env);
        for s in sigs.iter() {
            p.push_back(fr_from(env, s));
        }
        p
    }

    #[test]
    fn real_swap_proof_verifies_and_tamper_fails() {
        let env = Env::default();
        env.cost_estimate().budget().reset_unlimited();
        let f = fx::swap_fixture();
        let vk = to_vk(&env, &fx::swap_vk());
        let a = g1_from(&env, &f.a);
        let b = g2_from(&env, &f.b);
        let c = g1_from(&env, &f.c);

        assert!(verify(&env, &vk, &a, &b, &c, &pubs(&env, f.public_signals)),
            "a real confidential_swap proof must verify on-chain");

        // Tamper one public signal (swap_amount) -> must fail.
        let mut bad = pubs(&env, f.public_signals);
        bad.set(5, fr_from(&env, &[0xffu8; 32]));
        assert!(!verify(&env, &vk, &a, &b, &c, &bad),
            "a tampered public input must be rejected");
    }

    #[test]
    fn real_insert_proof_verifies() {
        let env = Env::default();
        env.cost_estimate().budget().reset_unlimited();
        let f = fx::insert_change_fixture();
        let vk = to_vk(&env, &fx::insert_vk());
        assert!(verify(&env, &vk,
            &g1_from(&env, &f.a), &g2_from(&env, &f.b), &g1_from(&env, &f.c),
            &pubs(&env, f.public_signals)),
            "a real merkle_insert proof must verify on-chain");
    }

    #[test]
    fn swap_verify_cost() {
        let env = Env::default();
        env.cost_estimate().budget().reset_default();
        let f = fx::swap_fixture();
        let vk = to_vk(&env, &fx::swap_vk());
        let _ = verify(&env, &vk, &g1_from(&env, &f.a), &g2_from(&env, &f.b),
            &g1_from(&env, &f.c), &pubs(&env, f.public_signals));
        std::println!("[cost] confidential_swap on-chain verify = {} CPU instructions",
            env.cost_estimate().budget().cpu_instruction_cost());
    }
}

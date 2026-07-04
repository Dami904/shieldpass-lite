#!/usr/bin/env bash
# ShieldPass — compile circuit, run a (demo-grade) Groth16 trusted setup, export VK.
# Produces build/{confidential_swap.r1cs,.wasm}, build/confidential_swap_final.zkey,
# build/verification_key.json.
set -euo pipefail
cd "$(dirname "$0")/.."

CIRCUIT="${1:-confidential_swap}"   # circuit name (without .circom), default confidential_swap
BUILD=build
PTAU=$BUILD/pot_final.ptau
POWER=15                      # 2^15 = 32768 constraints headroom (circuit is ~8k)
SNARKJS="node_modules/.bin/snarkjs"
mkdir -p "$BUILD"

echo "== 1/4 compile circuit =="
circom "circuits/$CIRCUIT.circom" --r1cs --wasm --sym -o "$BUILD" -l node_modules/circomlib/circuits
"$SNARKJS" r1cs info "$BUILD/$CIRCUIT.r1cs"

echo "== 2/4 powers of tau (local, DEMO-GRADE — re-run a real ceremony for prod) =="
if [ ! -f "$PTAU" ]; then
  "$SNARKJS" powersoftau new bn128 "$POWER" "$BUILD/pot_0.ptau" -v
  "$SNARKJS" powersoftau contribute "$BUILD/pot_0.ptau" "$BUILD/pot_1.ptau" \
    --name="shieldpass-1" -v -e="$(head -c 64 /dev/urandom | base64)"
  "$SNARKJS" powersoftau prepare phase2 "$BUILD/pot_1.ptau" "$PTAU" -v
  rm -f "$BUILD/pot_0.ptau" "$BUILD/pot_1.ptau"
fi

echo "== 3/4 groth16 setup =="
"$SNARKJS" groth16 setup "$BUILD/$CIRCUIT.r1cs" "$PTAU" "$BUILD/${CIRCUIT}_0.zkey"
"$SNARKJS" zkey contribute "$BUILD/${CIRCUIT}_0.zkey" "$BUILD/${CIRCUIT}_final.zkey" \
  --name="shieldpass-2" -v -e="$(head -c 64 /dev/urandom | base64)"
rm -f "$BUILD/${CIRCUIT}_0.zkey"

echo "== 4/4 export verification key =="
"$SNARKJS" zkey export verificationkey "$BUILD/${CIRCUIT}_final.zkey" "$BUILD/${CIRCUIT}_vk.json"

echo "Build complete -> $BUILD/"

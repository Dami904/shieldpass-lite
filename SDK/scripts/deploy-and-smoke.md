# Escrow testnet deploy + smoke

Prereqs: `stellar` CLI 27+, a funded testnet identity (`stellar keys generate arbiter --fund`).

1. Build: `cd SDK/contracts/shielded_pool && stellar contract build`
   → artifact: `SDK/target/wasm32v1-none/release/shielded_pool.wasm`
2. Deploy:
   `stellar contract deploy --wasm ../../target/wasm32v1-none/release/shielded_pool.wasm --source arbiter --network testnet`
   → note the returned CONTRACT_ID.
3. Init with the arbiter address:
   `stellar contract invoke --id <CONTRACT_ID> --source arbiter --network testnet -- init --arbiter $(stellar keys address arbiter)`
4. Put `STELLAR_CONTRACT_ID=<CONTRACT_ID>` and `STELLAR_RELAYER_SECRET=$(stellar keys show arbiter)` in `backend/.env`
   (the relayer key doubles as the arbiter for this iteration).
5. Smoke: a seller locks via `createOffer`, then the arbiter releases via `releaseCrypto` (exercised
   end-to-end in Plan 3's integration test once the backend settlement flow is in place).

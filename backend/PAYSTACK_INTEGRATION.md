# Paystack test-mode + Stellar testnet integration

1. Create a Paystack account, enable test mode, copy the `sk_test_`/`pk_test_` keys into `backend/.env`.
2. Expose the webhook locally: `npx localtunnel --port 3001` (or ngrok). Set the public URL +
   `/payments/webhook` as the webhook URL in the Paystack dashboard.
3. Deploy + init the escrow contract per `SDK/scripts/deploy-and-smoke.md`; put `STELLAR_CONTRACT_ID`
   and `STELLAR_RELAYER_SECRET` (the arbiter key) in `backend/.env`.
4. End-to-end smoke:
   - Seller lists (Plan 4) -> crypto locked on-chain, trade OPEN.
   - Buyer accepts (Plan 4) -> a dedicated virtual account number is returned, trade AWAITING_PAYMENT.
   - Use Paystack's test dashboard to simulate a transfer into that virtual account.
   - Paystack fires `charge.success` -> `/payments/webhook` -> trade PAID -> settlement releases crypto
     to the buyer's testnet wallet and pays out the seller.
   - Assert: buyer testnet balance increased; trade status SETTLED with `releaseTxHash` + `payoutRef`.

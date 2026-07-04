import { rpc, Contract, Keypair, Networks, TransactionBuilder, Account, BASE_FEE, nativeToScVal, scValToNative, xdr, Address, hash } from '@stellar/stellar-sdk';
import { LockSwapParams, Signer } from './types';
import { isValidSorobanAddress } from './utils';
import { withAccountLock, waitForLanding } from './accountLock';

// BN254 scalar field order r — recipient field elements must be canonical (< r).
const BN254_R = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * Field encoding of a Stellar address for the confidential_swap circuit's `recipient`
 * public signal: int_be(sha256(xdr(address))) mod r. The shielded_pool contract recomputes
 * this from the on-chain recipient Address (see `recipient_field` in lib.rs) and rejects any
 * unshield whose passed recipient doesn't match — binding the destination into the proof so a
 * relayer cannot redirect funds. MUST stay bit-for-bit identical to the contract.
 */
export function addressToField(address: string): bigint {
    const xdrBytes = Address.fromString(address).toScVal().toXDR(); // ScVal(Address) raw XDR
    const h = hash(xdrBytes); // sha256, 32 bytes
    let v = 0n;
    for (const b of h) v = (v << 8n) | BigInt(b);
    return v % BN254_R;
}

// Validates a Stellar public key (G... address, 56 chars)
function isValidStellarAddress(address: string): boolean {
    return typeof address === 'string' && /^G[A-Z2-7]{55}$/.test(address);
}

export class StellarContractClient {
    private server: rpc.Server;
    private networkPassphrase: string;
    private contractId: string;

    constructor(rpcUrl: string, networkPassphrase: string, contractId: string) {
        if (!rpcUrl) throw new Error('[StellarContractClient] rpcUrl is required');
        if (!networkPassphrase) throw new Error('[StellarContractClient] networkPassphrase is required');
        if (!contractId) throw new Error('[StellarContractClient] contractId is required');

        this.server = new rpc.Server(rpcUrl);
        this.networkPassphrase = networkPassphrase;
        this.contractId = contractId;
    }

    /**
     * Read-only: a Stellar Asset Contract (SAC) token balance for an address. Simulated, no signer.
     * Returns the raw i128 balance as a bigint (0n if the account holds none / sim has no result).
     */
    async getTokenBalance(tokenId: string, address: string): Promise<bigint> {
        const contract = new Contract(tokenId);
        const account = new Account(Keypair.random().publicKey(), '0');
        const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: this.networkPassphrase })
            .addOperation(contract.call('balance', nativeToScVal(address, { type: 'address' })))
            .setTimeout(30)
            .build();
        const sim = await this.server.simulateTransaction(tx);
        if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) return 0n;
        return BigInt(scValToNative(sim.result.retval) as number | bigint);
    }

    /**
     * Funds a wallet by transferring a Stellar Asset Contract (SAC) token from a source account
     * to `to`. Used to seed brand-new passkey smart wallets (C-addresses) with test tokens from the
     * relayer — friendbot can't fund contract addresses, so tokens must be moved in via the SAC.
     * Signed by `sourceKeypair` (a funded classic G-account that holds the token, e.g. the relayer).
     * Returns the submitted tx hash.
     */
    async fundWallet(tokenId: string, to: string, amount: bigint, sourceKeypair: Keypair): Promise<string> {
        if (!isValidSorobanAddress(tokenId)) {
            throw new Error('[StellarContractClient] Invalid token contract address.');
        }
        if (!isValidSorobanAddress(to)) {
            throw new Error('[StellarContractClient] Invalid destination wallet address.');
        }
        if (amount <= 0n) {
            throw new Error('[StellarContractClient] Funding amount must be greater than zero.');
        }

        // Serialize on the source account + hold through landing so this transfer never races
        // another relayer tx for the same sequence number. See accountLock.ts.
        return withAccountLock(sourceKeypair.publicKey(), async () => {
            const contract = new Contract(tokenId);
            const accountInfo = await this.server.getAccount(sourceKeypair.publicKey());
            const account = new Account(sourceKeypair.publicKey(), accountInfo.sequenceNumber());

            let tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: this.networkPassphrase })
                .addOperation(contract.call(
                    'transfer',
                    nativeToScVal(sourceKeypair.publicKey(), { type: 'address' }),
                    nativeToScVal(to, { type: 'address' }),
                    nativeToScVal(amount, { type: 'i128' }),
                ))
                .setTimeout(30)
                .build();

            const sim = await this.server.simulateTransaction(tx);
            if (!rpc.Api.isSimulationSuccess(sim)) {
                throw new Error(`[StellarContractClient] fundWallet simulation failed: ${JSON.stringify(sim)}`);
            }
            tx = rpc.assembleTransaction(tx, sim).build();
            tx.sign(sourceKeypair);
            const sent = await this.server.sendTransaction(tx);
            console.log(`[StellarContractClient] fundWallet submitted! Hash: ${sent.hash}`);
            await waitForLanding(this.server, sent.hash);
            return sent.hash;
        });
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Trustless Instant Swap (HTLC-style time-locked off-ramp)
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * One-time setup of the Trustless Swap contract: `admin` (backend, the only party allowed
     * to claim after a fiat payout) and `treasury` (where claimed crypto is swept).
     */
    async initSwap(adminAddress: string, signerKeypair: Keypair): Promise<string> {
        if (!isValidStellarAddress(adminAddress)) throw new Error('[StellarContractClient] Invalid admin address.');

        return withAccountLock(signerKeypair.publicKey(), async () => {
            const contract = new Contract(this.contractId);
            const accountInfo = await this.server.getAccount(signerKeypair.publicKey());
            const account = new Account(signerKeypair.publicKey(), accountInfo.sequenceNumber());

            let tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: this.networkPassphrase })
                .addOperation(contract.call('init',
                    nativeToScVal(adminAddress, { type: 'address' }),
                ))
                .setTimeout(30)
                .build();

            const sim = await this.server.simulateTransaction(tx);
            if (!rpc.Api.isSimulationSuccess(sim)) throw new Error(`[StellarContractClient] initSwap simulation failed: ${JSON.stringify(sim)}`);
            tx = rpc.assembleTransaction(tx, sim).build();
            tx.sign(signerKeypair);
            const sent = await this.server.sendTransaction(tx);
            console.log(`[StellarContractClient] initSwap submitted! Hash: ${sent.hash}`);
            await waitForLanding(this.server, sent.hash);
            return sent.hash;
        });
    }

    /**
     * lock_swap: the user transfers ANY Stellar asset into the contract to start an off-ramp.
     * Supports keypair (backend) and passkey (browser smart wallet) signing. Returns the on-chain
     * swap id and tx hash.
     */
    async lockSwap(params: LockSwapParams, signer: Signer): Promise<{ hash: string; swapId: bigint }> {
        if (!isValidSorobanAddress(params.userWallet)) throw new Error('[StellarContractClient] Invalid user wallet address.');
        if (!isValidSorobanAddress(params.tokenAddress)) throw new Error('[StellarContractClient] Invalid token contract address.');
        if (!params.nullifier || params.nullifier.length === 0) throw new Error('[StellarContractClient] ZK nullifier is required to lock a swap.');
        if (params.amount <= 0n) throw new Error('[StellarContractClient] Amount must be greater than zero.');

        const contract = new Contract(this.contractId);

        const nullifierBytes = Buffer.alloc(32);
        const nullifierHex = params.nullifier.replace('0x', '').padStart(64, '0').slice(0, 64);
        Buffer.from(nullifierHex, 'hex').copy(nullifierBytes);

        const op = contract.call(
            'lock_swap',
            nativeToScVal(params.userWallet, { type: 'address' }),
            nativeToScVal(params.tokenAddress, { type: 'address' }),
            nativeToScVal(params.amount, { type: 'i128' }),
            xdr.ScVal.scvBytes(nullifierBytes),
        );

        if (signer.kind === 'keypair') {
            const kp = signer.keypair;
            return withAccountLock(kp.publicKey(), async () => {
                const accountInfo = await this.server.getAccount(kp.publicKey());
                const account = new Account(kp.publicKey(), accountInfo.sequenceNumber());
                let tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: this.networkPassphrase })
                    .addOperation(op).setTimeout(30).build();
                const sim = await this.server.simulateTransaction(tx);
                if (!rpc.Api.isSimulationSuccess(sim)) throw new Error(`[StellarContractClient] Simulation failed: ${JSON.stringify(sim)}`);
                tx = rpc.assembleTransaction(tx, sim).build();
                tx.sign(kp);
                const sent = await this.server.sendTransaction(tx);
                console.log(`[StellarContractClient] lock_swap submitted! Hash: ${sent.hash}`);
                // decodeU64Return polls until SUCCESS, so it doubles as the landing wait that
                // keeps the account lock held until the sequence number is consumed.
                return { hash: sent.hash, swapId: await this.decodeU64Return(sent.hash) };
            });
        }

        // passkey path — same pattern as createOffer: build+simulate+assemble, then the caller's
        // WebAuthn signer authorizes the C-address and the Channels relayer submits gaslessly.
        const account = new Account(Keypair.random().publicKey(), '0');
        let tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: this.networkPassphrase })
            .addOperation(op).setTimeout(30).build();
        const sim = await this.server.simulateTransaction(tx);
        if (!rpc.Api.isSimulationSuccess(sim)) throw new Error(`[StellarContractClient] Simulation failed: ${JSON.stringify(sim)}`);
        tx = rpc.assembleTransaction(tx, sim).build();
        const signedXdr = await signer.sign(tx.toXDR());
        const hash = await signer.submit(signedXdr);
        console.log(`[StellarContractClient] lock_swap (passkey) submitted! Hash: ${hash}`);
        return { hash, swapId: await this.decodeU64Return(hash) };
    }

    /**
     * claim_swap: backend sweeps the locked crypto to the treasury AFTER the Lenco fiat payout
     * succeeded. MUST be signed by the admin keypair configured in the contract.
     */
    async claimSwap(swapId: bigint, adminKeypair: Keypair): Promise<string> {
        if (swapId <= 0n) throw new Error('[StellarContractClient] swapId must be a positive number.');

        return withAccountLock(adminKeypair.publicKey(), async () => {
            const contract = new Contract(this.contractId);
            const accountInfo = await this.server.getAccount(adminKeypair.publicKey());
            const account = new Account(adminKeypair.publicKey(), accountInfo.sequenceNumber());

            let tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: this.networkPassphrase })
                .addOperation(contract.call(
                    'claim_swap',
                    nativeToScVal(swapId, { type: 'u64' }),
                ))
                .setTimeout(30)
                .build();

            const sim = await this.server.simulateTransaction(tx);
            if (!rpc.Api.isSimulationSuccess(sim)) throw new Error(`[StellarContractClient] claim_swap simulation failed: ${JSON.stringify(sim)}`);
            tx = rpc.assembleTransaction(tx, sim).build();
            tx.sign(adminKeypair);
            const sent = await this.server.sendTransaction(tx);
            console.log(`[StellarContractClient] claim_swap submitted! Hash: ${sent.hash}`);
            await waitForLanding(this.server, sent.hash);
            return sent.hash;
        });
    }

    /** Poll getTransaction until SUCCESS, then decode a u64 return value (a swap/offer id). */
    private async decodeU64Return(hash: string): Promise<bigint> {
        for (let i = 0; i < 20; i++) {
            const r = await this.server.getTransaction(hash);
            if (r.status === rpc.Api.GetTransactionStatus.SUCCESS && r.returnValue) {
                return BigInt(scValToNative(r.returnValue) as number | bigint);
            }
            if (r.status === rpc.Api.GetTransactionStatus.FAILED) {
                throw new Error('[StellarContractClient] lock_swap transaction failed.');
            }
            await new Promise((res) => setTimeout(res, 1000));
        }
        throw new Error('[StellarContractClient] lock_swap result not available (timed out).');
    }
}

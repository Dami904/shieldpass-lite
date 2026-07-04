import { StellarContractClient } from './src/stellar';
import { Networks } from '@stellar/stellar-sdk';

// Compile-time + construction smoke: ensures the public surface stays intact.
const client = new StellarContractClient(
    'https://soroban-testnet.stellar.org',
    Networks.TESTNET,
    'CONTRACT_ID_PLACEHOLDER',
);
if (typeof client.initialize !== 'function') throw new Error('initialize missing');
if (typeof client.releaseCrypto !== 'function') throw new Error('releaseCrypto missing');
if (typeof client.createOffer !== 'function') throw new Error('createOffer missing');
console.log('✅ StellarContractClient surface ok (initialize/createOffer/releaseCrypto present)');

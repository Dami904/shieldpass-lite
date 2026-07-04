// snarkjs ships no TypeScript types; declare the surface we use.
declare module 'snarkjs' {
    export const groth16: {
        fullProve(input: any, wasm: any, zkey: any): Promise<{ proof: any; publicSignals: string[] }>;
        prove(zkey: any, witness: any): Promise<{ proof: any; publicSignals: string[] }>;
        verify(vk: any, publicSignals: string[], proof: any): Promise<boolean>;
    };
}

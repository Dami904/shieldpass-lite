import { buildPoseidon, buildPoseidonReference } from "circomlibjs";
const p = await buildPoseidon();
const pr = await buildPoseidonReference();
const F = p.F;
console.log("poseidon([1,2])   =", F.toString(p([1n, 2n])));
console.log("reference([1,2])  =", pr.F.toString(pr([1n, 2n])));
console.log("opt keys:", Object.keys(p));
console.log("ref keys:", Object.keys(pr));

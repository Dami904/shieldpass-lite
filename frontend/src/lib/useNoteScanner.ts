import { useEffect, useRef } from "react";
import { decryptNote } from "@shieldpass/sdk/dist/identity";
import { api } from "./api";
import { useSession } from "./session";
import { assetByCode } from "./assets";

const fromHex = (s: string) => Uint8Array.from(s.match(/.{2}/g)!.map((b) => parseInt(b, 16)));

/**
 * Background scanner for incoming private payments. Polls the backend for new encrypted
 * note blobs, trial-decrypts each with the user's shielded key, and adds the ones that
 * open to the shielded balance. `onReceived` fires per new note (for notifications/badge).
 */
export function useNoteScanner(apiBaseUrl: string, onReceived?: (amount: string, asset: string) => void, intervalMs = 15000) {
    const session = useSession();
    const onRef = useRef(onReceived);
    onRef.current = onReceived;

    useEffect(() => {
        if (!session.identity) return;
        const cursorKey = `shp_scan_cursor_${session.email}`;
        let stopped = false;

        async function scan() {
            if (!session.identity) return;
            try {
                const cursor = Number(localStorage.getItem(cursorKey) || 0);
                const { blobs, nextCursor } = await api.scanNotes(cursor);
                for (const blob of blobs) {
                    let note: any;
                    try {
                        const pt = decryptNote(session.identity.encSecret, fromHex(blob.ephemeralPub), fromHex(blob.ciphertext));
                        note = JSON.parse(new TextDecoder().decode(pt));
                    } catch {
                        continue; // not addressed to us
                    }
                    try {
                        // Resolve the commitment in THIS note's asset pool/tree.
                        const noteAsset = String(note.asset ?? "XLM");
                        const pool = assetByCode(noteAsset)?.poolContractId;
                        const { index } = await api.treeIndexOf(blob.commitment, pool);
                        const added = session.addNote({
                            amount: String(note.amount), asset: noteAsset,
                            randomness: String(note.randomness), leafIndex: index, compliance: note.compliance,
                            // The scanner only finds notes already inserted in the tree (treeIndexOf
                            // resolved), so they're confirmed/spendable — not "settling".
                            confirmed: true,
                        });
                        if (added) onRef.current?.(String(note.amount), String(note.asset ?? "XLM"));
                    } catch {
                        // commitment not yet inserted into the tree — leave cursor so we retry next pass
                        return;
                    }
                }
                localStorage.setItem(cursorKey, String(nextCursor));
            } catch {
                /* network hiccup — retry next interval */
            }
        }

        scan();
        const t = setInterval(() => { if (!stopped) scan(); }, intervalMs);
        return () => { stopped = true; clearInterval(t); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [session.identity, session.email, apiBaseUrl, intervalMs]);
}

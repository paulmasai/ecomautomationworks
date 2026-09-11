import { useCallback, useEffect, useState, type FormEvent } from "react";
import { apiRequest } from "./lib/api";

interface DeletionRequest {
  id: string;
  source: "meta" | "website";
  contact: string | null;
  reference: string | null;
  meta_user_id: string | null;
  meta_app_id: string | null;
  created_at: string;
}

export function PrivacyRequests({ demo, hasMfa }: { demo: boolean; hasMfa: boolean }) {
  const [requests, setRequests] = useState<DeletionRequest[]>([]);
  const [selected, setSelected] = useState<DeletionRequest | null>(null);
  const [subjectIds, setSubjectIds] = useState("");
  const [verification, setVerification] = useState("existing_channel");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (demo || !hasMfa) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try { setRequests((await apiRequest<{ items: DeletionRequest[] }>("/privacy/requests")).items); }
    catch { setError("Requests could not be loaded. Check your connection and retry."); }
    finally { setLoading(false); }
  }, [demo, hasMfa]);
  useEffect(() => { void refresh(); }, [refresh]);

  async function complete(event: FormEvent) {
    event.preventDefault();
    if (selected === null || demo || busy) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      await apiRequest(`/privacy/requests/${selected.id}/complete`, {
        method: "POST",
        body: JSON.stringify({ subjectIds: subjectIds.split(/[\s,]+/).filter(Boolean), verification, confirmation }),
      });
      setSelected(null); setSubjectIds(""); setConfirmation("");
      setMessage("Verified application records deleted. The private status page now shows completion.");
      await refresh();
    } catch { setError("Deletion was not confirmed. Check the identifiers and MFA session, then retry. Repeating a completed request is safe."); }
    finally { setBusy(false); }
  }

  return <section className="workspace-panel page-panel privacy-workspace">
    <div className="panel-heading"><div><h2>Data deletion requests</h2><p>Review oldest requests first and respond within one calendar month.</p></div><button className="secondary-button" onClick={() => void refresh()} disabled={loading || busy || !hasMfa}>Refresh</button></div>
    <p><a href="/privacy-policy">Privacy policy</a> · <a href="/data-deletion">Public deletion form</a> · <a href="/terms">Terms of service</a></p>
    {!hasMfa && <p role="status">Complete MFA in Settings to access privacy requests.</p>}
    {demo && <p>This preview does not contain real requests or perform deletion.</p>}
    {error && <p className="form-message" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {hasMfa && loading && <p role="status">Loading requests…</p>}
    {hasMfa && !loading && !error && requests.length === 0 && <p>No pending deletion requests.</p>}
    {hasMfa && requests.length > 0 && <ul className="privacy-request-list">{requests.map((item) => <li key={item.id}><div><strong>{item.source === "meta" ? "Meta deletion request" : item.contact}</strong><p>Received {new Date(item.created_at).toLocaleDateString("en-GB")}</p></div><button className="secondary-button" disabled={busy} onClick={() => { setSelected(item); setSubjectIds(""); setConfirmation(""); setMessage(null); }}>Review request</button></li>)}</ul>}
    {selected !== null && <form className="privacy-review" onSubmit={(event) => void complete(event)}>
      <h3>Verify before deleting</h3>
      <p>{selected.reference ?? `Meta app ${selected.meta_app_id}: app-scoped user ${selected.meta_user_id}`}</p>
      <p>Confirm the requester through an existing conversation or a verified Meta mapping. An app-scoped ID is not necessarily the Page-scoped Messenger ID. Never copy the callback ID here without establishing that mapping.</p>
      <p>Check all associated identifiers and records outside this database before closing the request. Do not use this action for staff accounts; follow the staff offboarding procedure.</p>
      <label>Verified customer identifiers<textarea value={subjectIds} onChange={(e) => setSubjectIds(e.target.value)} maxLength={2100} required placeholder="One verified numeric identifier per line" /></label>
      <label>Verification method<select value={verification} onChange={(e) => setVerification(e.target.value)}><option value="existing_channel">Confirmed through existing customer channel</option><option value="verified_meta_mapping">Confirmed Meta identifier mapping</option></select></label>
      <p>This permanently removes matching application records and associated conversations, replies, and leads. It cannot be undone.</p>
      <label>Type DELETE VERIFIED DATA to confirm<input value={confirmation} onChange={(e) => setConfirmation(e.target.value)} autoComplete="off" required /></label>
      <div className="privacy-actions"><button className="primary-button" type="submit" disabled={busy || confirmation !== "DELETE VERIFIED DATA" || subjectIds.trim() === ""}>{busy ? "Deleting…" : "Delete verified data"}</button><button className="secondary-button" type="button" disabled={busy} onClick={() => setSelected(null)}>Cancel</button></div>
    </form>}
  </section>;
}

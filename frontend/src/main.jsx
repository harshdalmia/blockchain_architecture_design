import React, { useEffect, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { ethers } from "ethers";

const STATUS = ["Submitted", "Flagged", "Verified", "Approved", "Paid", "Rejected"];
const short = (a) => a.slice(0, 6) + "…" + a.slice(-4);
const eth = (v) => Number(ethers.formatEther(v)).toLocaleString(undefined, { maximumFractionDigits: 4 });

function App() {
  const [cfg, setCfg] = useState(null);
  const [role, setRole] = useState("holder");
  const [data, setData] = useState({ policies: [], claims: [], events: [], bal: {}, pool: 0n, block: 0 });
  const [toast, setToast] = useState(null);
  const [form, setForm] = useState({ policyId: "1", amount: "", file: null });
  const [pform, setPform] = useState({ holder: "", coverage: "10", days: "365" });

  useEffect(() => { fetch("/config.json").then((r) => r.json()).then((c) => { setCfg(c); setPform((p) => ({ ...p, holder: c.accounts.holder })); }); }, []);

  const ctx = useCallback(async (who) => {
    const provider = new ethers.JsonRpcProvider(cfg.rpc);
    const idx = { insurer: 0, auditor: 1, holder: 2 }[who];
    const signer = await provider.getSigner(idx);
    return { provider, contract: new ethers.Contract(cfg.address, cfg.abi, signer) };
  }, [cfg]);

  const refresh = useCallback(async () => {
    if (!cfg) return;
    const { provider, contract } = await ctx("holder");
    const [pc, cc] = [Number(await contract.policyCount()), Number(await contract.claimCount())];
    const policies = [], claims = [];
    for (let i = 1; i <= pc; i++) policies.push({ id: i, ...(await contract.policies(i)).toObject() });
    for (let i = 1; i <= cc; i++) claims.push({ id: i, ...(await contract.claims(i)).toObject() });
    const evs = await contract.queryFilter("*", 0, "latest");
    const events = await Promise.all(evs.filter((e) => e.fragment).map(async (e) => ({ name: e.fragment.name, block: e.blockNumber, tx: e.transactionHash, args: e.args })));
    const bal = {};
    for (const k of ["insurer", "auditor", "holder"]) bal[k] = await provider.getBalance(cfg.accounts[k]);
    setData({ policies, claims, events, bal, pool: await provider.getBalance(cfg.address), block: await provider.getBlockNumber() });
  }, [cfg, ctx]);
  useEffect(() => { refresh(); }, [refresh]);

  const send = async (label, fn) => {
    try {
      const { contract } = await ctx(role);
      setToast({ title: `Confirm in wallet: ${label}…` });
      const tx = await fn(contract);
      const rc = await tx.wait();
      setToast({ title: `✓ ${label} confirmed in block ${rc.blockNumber}`, tx: tx.hash });
      await refresh();
    } catch (e) { setToast({ title: "✗ " + (e.reason || e.shortMessage || e.message) }); }
  };

  const pin = async () => {
    const buf = await form.file.arrayBuffer();
    const r = await fetch("/api/pin", { method: "POST", body: buf });
    return (await r.json()).cid;
  };

  if (!cfg) return <div style={{ padding: 40 }}>Connecting to local Ethereum node…</div>;
  const who = cfg.accounts[role];

  return (<>
    <header>
      <h1>Decentralized Insurance Claims<small>Blockchain-based claim processing &amp; fraud prevention</small></h1>
      <div className="net"><b>● Local Ethereum testnet</b> (chain 31337) · block #{data.block}<br />Contract {short(cfg.address)} · Pool {eth(data.pool)} ETH</div>
    </header>
    <main>
      <div className="col">
        <div className="card">
          <h2>Connected wallet</h2>
          <div className="roles">{[["holder", "Policyholder"], ["insurer", "Insurer"], ["auditor", "Auditor"]].map(([k, l]) =>
            <button key={k} className={role === k ? "on" : ""} onClick={() => setRole(k)}>{l}</button>)}</div>
          <div className="addr">{who}</div>
          <div className="stat" style={{ marginTop: 8 }}><span>Balance</span><b>{eth(data.bal[role] ?? 0n)} ETH</b></div>
        </div>

        {role === "insurer" && <div className="card">
          <h2>Create policy</h2>
          <label>Policyholder address</label><input value={pform.holder} onChange={(e) => setPform({ ...pform, holder: e.target.value })} />
          <label>Coverage (ETH)</label><input value={pform.coverage} onChange={(e) => setPform({ ...pform, coverage: e.target.value })} />
          <label>Duration (days)</label><input value={pform.days} onChange={(e) => setPform({ ...pform, days: e.target.value })} />
          <button className="btn" id="create-policy" onClick={() => send("Create policy", (c) => c.createPolicy(pform.holder, ethers.parseEther(pform.coverage), BigInt(pform.days)))}>Issue policy on-chain</button>
        </div>}

        {role === "holder" && <div className="card">
          <h2>Submit a claim</h2>
          <label>Policy</label>
          <select value={form.policyId} onChange={(e) => setForm({ ...form, policyId: e.target.value })}>
            {data.policies.filter((p) => p.holder === who).map((p) => <option key={p.id} value={p.id}>Policy #{p.id} · cover {eth(p.coverage)} ETH</option>)}
          </select>
          <label>Claim amount (ETH)</label><input id="amount" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          <label>Supporting document</label><input id="file" type="file" onChange={(e) => setForm({ ...form, file: e.target.files[0] })} />
          <button className="btn" id="submit-claim" onClick={() => send("Submit claim", async (c) => c.submitClaim(form.policyId, ethers.parseEther(form.amount), await pin()))}>Upload to IPFS &amp; submit</button>
          <div className="note">The file is hashed to an IPFS CID; only the CID is stored on-chain.</div>
        </div>}

        <div className="card">
          <h2>Policies</h2>
          {data.policies.length === 0 && <div className="note">No policies issued yet.</div>}
          {data.policies.map((p) => <div key={p.id} className="stat"><span>#{p.id} · <span className="addr">{short(p.holder)}</span></span><b>{eth(p.coverage)} ETH <span style={{ color: "var(--ok)" }}>active</span></b></div>)}
        </div>
      </div>

      <div className="col">
        <div className="card">
          <h2>Claims</h2>
          <table><thead><tr><th>#</th><th>Policy</th><th>Amount</th><th>Document (IPFS CID)</th><th>Status</th><th>Approvals</th><th>Action</th></tr></thead><tbody>
            {data.claims.length === 0 && <tr><td colSpan="7" className="note">No claims yet.</td></tr>}
            {data.claims.map((c) => { const s = STATUS[Number(c.status)]; return (
              <tr key={c.id} id={`claim-${c.id}`}>
                <td>{c.id}</td><td>#{Number(c.policyId)}</td><td>{eth(c.amount)} ETH</td>
                <td><span className="cid">{c.ipfsHash}</span></td>
                <td><span className={`badge s-${s}`}>{s}</span>{c.note && <div className={s === "Flagged" ? "flag" : "note"}>{s === "Flagged" ? "⚑ " : ""}{c.note}</div>}</td>
                <td>{c.insurerApproved ? "✔" : "○"} Insurer<br />{c.auditorApproved ? "✔" : "○"} Auditor</td>
                <td>
                  {s === "Flagged" && role === "insurer" && <><button className="btn sm warn" onClick={() => send("Clear flag", (k) => k.reviewFlagged(c.id, true))}>Clear</button><button className="btn sm bad" onClick={() => send("Reject claim", (k) => k.reviewFlagged(c.id, false))}>Reject</button></>}
                  {s === "Verified" && (role === "insurer" || role === "auditor") && !(role === "insurer" ? c.insurerApproved : c.auditorApproved) && <button className="btn sm ok" onClick={() => send("Approve claim", (k) => k.approveClaim(c.id))}>Approve</button>}
                  {s === "Paid" && <span style={{ color: "var(--ok)" }}>Paid out</span>}
                </td>
              </tr>); })}
          </tbody></table>
        </div>
        <div className="card">
          <h2>Audit trail (on-chain events)</h2>
          <div className="log">{data.events.length === 0 && <div>No events yet.</div>}
            {data.events.map((e, i) => <div key={i}><span className="blk">block {e.block}</span><span className="ev">{e.name}</span>
              <span>{e.name === "PolicyCreated" ? `policy #${e.args[0]} → ${short(e.args[1])}` :
                e.name === "ClaimSubmitted" ? `claim #${e.args[0]} · ${eth(e.args[3])} ETH` :
                e.name === "ClaimFlagged" ? `claim #${e.args[0]} · ${e.args[1]}` :
                e.name === "ClaimApproved" ? `claim #${e.args[0]} · by ${e.args[2]}` :
                e.name === "ClaimRejected" ? `claim #${e.args[0]} · ${e.args[2]}` :
                e.name === "PayoutExecuted" ? `claim #${e.args[0]} · ${eth(e.args[2])} ETH → ${short(e.args[1])}` :
                e.name === "PoolFunded" ? `${eth(e.args[1])} ETH` : e.args[0] !== undefined ? `claim #${e.args[0]}` : ""}</span>
              <span style={{ marginLeft: "auto", color: "var(--mut)" }}>{e.tx.slice(0, 10)}…</span></div>)}</div>
        </div>
      </div>
    </main>
    {toast && <div className="toast">{toast.title}{toast.tx && <div className="addr">tx {toast.tx.slice(0, 22)}…</div>}</div>}
  </>);
}
createRoot(document.getElementById("root")).render(<App />);

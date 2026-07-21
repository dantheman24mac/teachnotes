"use client";

import { Check, Copy, KeyRound, Search, ShieldX } from "lucide-react";
import { useActionState, useMemo, useState } from "react";
import { manageAccount, type ManageAccountState } from "./actions";

export type AdminAccount = {
  userId: string;
  email: string;
  role: "admin" | "user";
  status: "pending" | "approved" | "rejected";
  mustChangePassword: boolean;
  protectedAdmin: boolean;
  createdAt: string;
  reviewedAt: string | null;
};

const initialState: ManageAccountState = { message: "" };

function AccountRow({ account }: { account: AdminAccount }) {
  const [state, action, pending] = useActionState(manageAccount, initialState);
  const [copied, setCopied] = useState(false);
  const copyPassword = async () => {
    if (!state.temporaryPassword) return;
    await navigator.clipboard.writeText(state.temporaryPassword);
    setCopied(true);
  };
  return <article className="account-row">
    <div className="account-main"><strong>{account.email}</strong><span>Requested {new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium" }).format(new Date(account.createdAt))}</span></div>
    <span className={`account-status account-${account.status}`}>{account.status}</span>
    <div className="account-meta"><span>{account.role}</span>{account.reviewedAt && <span>Reviewed {new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium" }).format(new Date(account.reviewedAt))}</span>}{account.mustChangePassword && <span className="temporary-flag">Password change required</span>}</div>
    {account.protectedAdmin ? <span className="protected-label">Protected administrator</span> : <form className="account-actions" action={action}>
      <input name="userId" type="hidden" value={account.userId} />
      {account.status !== "approved" && <button className="button-primary" name="operation" value="approve" disabled={pending} type="submit"><Check size={15} /> Approve</button>}
      {account.status !== "rejected" && <button className="button-secondary" name="operation" value="reject" disabled={pending} type="submit"><ShieldX size={15} /> {account.status === "approved" ? "Revoke" : "Reject"}</button>}
      {account.status === "approved" && <button className="button-secondary" name="operation" value="reset-password" disabled={pending} type="submit"><KeyRound size={15} /> Reset password</button>}
    </form>}
    {state.message && <p className={state.temporaryPassword ? "form-success" : "form-note"} aria-live="polite">{state.message}</p>}
    {state.temporaryPassword && <div className="temporary-password"><code>{state.temporaryPassword}</code><button type="button" onClick={() => void copyPassword()}><Copy size={15} /> {copied ? "Copied" : "Copy"}</button></div>}
  </article>;
}

export function UserApprovalPanel({ accounts }: { accounts: AdminAccount[] }) {
  const [filter, setFilter] = useState<"all" | AdminAccount["status"]>("pending");
  const [search, setSearch] = useState("");
  const visible = useMemo(() => accounts.filter((account) => filter === "all" || account.status === filter).filter((account) => account.email.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())), [accounts, filter, search]);
  return <>
    <div className="admin-controls"><div className="search-row"><Search size={17} /><input aria-label="Search accounts" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by email" /></div><div className="filter-tabs">{(["pending", "approved", "rejected", "all"] as const).map((value) => <button className={filter === value ? "active" : ""} key={value} type="button" onClick={() => setFilter(value)}>{value}<span>{value === "all" ? accounts.length : accounts.filter((account) => account.status === value).length}</span></button>)}</div></div>
    <section className="account-list">{visible.map((account) => <AccountRow account={account} key={account.userId} />)}{visible.length === 0 && <div className="empty-state"><Check /><h3>No matching accounts</h3><p>New signup requests will appear here.</p></div>}</section>
  </>;
}

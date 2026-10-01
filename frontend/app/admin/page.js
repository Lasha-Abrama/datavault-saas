"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  Building2,
  Files,
  LogOut,
  ShieldCheck,
  Users,
} from "lucide-react";
import { Button, Field, Loading, Logo } from "@/components/ui";
import "./platform.css";

const key = "datavault.platform.session";
const tabs = ["Overview", "Companies", "Users", "Files", "Audit logs"];
const paths = ["dashboard", "companies", "users", "files", "audit-logs"];
const date = (value) => (value ? new Date(value).toLocaleDateString() : "—");

async function api(path, { token, method = "GET", body } = {}) {
  const response = await fetch(`/backend/admin/${path}`, {
    method,
    cache: "no-store",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const error = new Error(
      response.status === 401
        ? "Your admin session has expired. Sign in again."
        : "This request could not be completed. Try again.",
    );
    error.status = response.status;
    throw error;
  }
  return response.json();
}

export default function PlatformAdmin() {
  const [token, setToken] = useState(null);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [data, setData] = useState(null);
  const [detail, setDetail] = useState(null);
  const [reason, setReason] = useState("security_review");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setToken(sessionStorage.getItem(key));
    setReady(true);
  }, []);
  useEffect(() => {
    if (!token) return;
    let active = true;
    setData(null);
    setError("");
    const params = new URLSearchParams({ page: String(page), limit: "25" });
    if (search && [1, 2, 3].includes(tab)) params.set("search", search);
    api(`${paths[tab]}${tab ? `?${params}` : ""}`, { token })
      .then((result) => {
        if (active) setData(result);
      })
      .catch((failure) => {
        if (!active) return;
        if (failure.status === 401) logout();
        setError(failure.message);
      });
    return () => {
      active = false;
    };
  }, [token, tab, page, search]);
  function logout() {
    sessionStorage.removeItem(key);
    setToken(null);
    setDetail(null);
    setData(null);
  }
  async function login(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api("auth/login", {
        method: "POST",
        body: Object.fromEntries(new FormData(event.currentTarget)),
      });
      sessionStorage.setItem(key, result.accessToken);
      setToken(result.accessToken);
    } catch (failure) {
      setError(
        failure.status === 401
          ? "Check your admin email and password."
          : failure.message,
      );
    } finally {
      setBusy(false);
    }
  }
  async function openCompany(id) {
    setError("");
    try {
      setDetail(await api(`companies/${id}`, { token }));
    } catch (failure) {
      setError(failure.message);
    }
  }
  async function changeStatus(next) {
    const name = detail.company.name;
    if (
      !window.confirm(
        `${next === "suspend" ? "Suspend" : "Reactivate"} ${name}?`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await api(`companies/${detail.company.id}/${next}`, {
        token,
        method: "POST",
        body: next === "suspend" ? { reason } : {},
      });
      setDetail(await api(`companies/${detail.company.id}`, { token }));
      setData(await api("companies?page=1&limit=25", { token }));
      setPage(1);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }
  if (!ready)
    return (
      <main className="center-screen">
        <Loading />
      </main>
    );
  if (!token)
    return (
      <main className="platform-login">
        <div className="platform-login-card">
          <Logo />
          <ShieldCheck size={32} aria-hidden="true" />
          <h1>Platform administration</h1>
          <p>Use your separate DataVault platform admin credentials.</p>
          {error && (
            <p className="platform-error" role="alert">
              {error}
            </p>
          )}
          <form onSubmit={login} className="form-stack">
            <Field
              label="Admin email"
              name="email"
              type="email"
              autoComplete="username"
              required
            />
            <Field
              label="Password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
            <Button busy={busy} className="full">
              Sign in to platform <ArrowRight size={16} />
            </Button>
          </form>
          <Link href="/login" className="text-link">
            Company workspace sign in
          </Link>
        </div>
      </main>
    );
  const items = data?.items ?? [];
  return (
    <main className="platform-shell">
      <aside className="platform-sidebar">
        <Logo />
        <span className="platform-sidebar-title">Platform administration</span>
        <nav aria-label="Platform navigation">
          {tabs.map((name, index) => (
            <button
              key={name}
              type="button"
              className={tab === index ? "active" : ""}
              onClick={() => {
                setTab(index);
                setPage(1);
                setSearch("");
                setDraft("");
                setDetail(null);
              }}
            >
              {name}
            </button>
          ))}
        </nav>
        <button className="platform-signout" type="button" onClick={logout}>
          <LogOut size={16} /> Sign out
        </button>
      </aside>
      <section className="platform-main">
        <header className="platform-heading">
          <div>
            <h1>{tabs[tab]}</h1>
            <p>DataVault platform operations</p>
          </div>
          <span className="platform-badge">
            <ShieldCheck size={15} /> Platform admin
          </span>
        </header>
        {error && (
          <p className="platform-error" role="alert">
            {error}
          </p>
        )}
        {tab > 0 && tab < 4 && (
          <form
            className="platform-search"
            onSubmit={(event) => {
              event.preventDefault();
              setPage(1);
              setSearch(draft.trim());
            }}
          >
            <input
              aria-label={`Search ${tabs[tab].toLowerCase()}`}
              placeholder={`Search ${tabs[tab].toLowerCase()}`}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={80}
            />
            <Button variant="secondary">Search</Button>
          </form>
        )}
        {!data ? (
          <Loading label={`Loading ${tabs[tab].toLowerCase()}`} />
        ) : tab === 0 ? (
          <div className="platform-overview">
            <article>
              <Building2 size={21} />
              <span>Companies</span>
              <strong>{data.companies?.total ?? 0}</strong>
              <small>
                {data.companies?.pendingActivation ?? 0} pending activation
              </small>
            </article>
            <article>
              <Users size={21} />
              <span>Tenant users</span>
              <strong>{data.tenantUsers?.total ?? 0}</strong>
              <small>{data.tenantUsers?.owners ?? 0} owners</small>
            </article>
            <article>
              <Files size={21} />
              <span>Stored files</span>
              <strong>{data.currentlyStoredFiles?.total ?? 0}</strong>
              <small>
                {data.currentlyStoredFiles?.restricted ?? 0} restricted
              </small>
            </article>
            <article>
              <ShieldCheck size={21} />
              <span>Suspended companies</span>
              <strong>{data.companies?.suspended ?? 0}</strong>
              <small>{data.pendingInvitations ?? 0} pending invitations</small>
            </article>
          </div>
        ) : (
          <>
            <div className="platform-list">
              {items.length === 0 ? (
                <p>No records found.</p>
              ) : (
                items.map((item) => (
                  <div className="platform-row" key={item.id}>
                    <div>
                      <strong>
                        {tab === 1
                          ? item.name
                          : tab === 2
                            ? item.fullName || item.email
                            : tab === 3
                              ? item.originalFilename
                              : item.action}
                      </strong>
                      <small>
                        {tab === 1
                          ? `${item.country} · ${item.industry}`
                          : tab === 2
                            ? `${item.email} · ${item.role}`
                            : tab === 3
                              ? `${item.fileType} · ${item.visibility}`
                              : `${item.targetType || "Platform"} · ${item.reason || "—"}`}
                      </small>
                    </div>
                    <span>
                      {tab === 1 ? item.platformStatus : date(item.createdAt)}
                    </span>
                    {tab === 1 && (
                      <button
                        className="text-link"
                        type="button"
                        onClick={() => openCompany(item.id)}
                      >
                        View <ArrowRight size={14} />
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
            <div className="platform-pager">
              <span>
                {data.pagination?.total ?? 0} records · Page {page}
              </span>
              <div>
                <Button
                  variant="secondary"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  disabled={page * 25 >= (data.pagination?.total ?? 0)}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
        {detail && (
          <section className="platform-detail" aria-label="Company details">
            <button
              type="button"
              className="text-link"
              onClick={() => setDetail(null)}
            >
              Close details
            </button>
            <h2>{detail.company.name}</h2>
            <p>
              {detail.company.country} · {detail.company.industry} ·{" "}
              {detail.company.platformStatus}
            </p>
            <dl>
              <div>
                <dt>Owner</dt>
                <dd>{detail.owner?.email ?? "—"}</dd>
              </div>
              <div>
                <dt>Plan</dt>
                <dd>{detail.subscription?.planCode ?? "—"}</dd>
              </div>
              <div>
                <dt>Employees</dt>
                <dd>{detail.employees.accepted}</dd>
              </div>
              <div>
                <dt>Files</dt>
                <dd>{detail.currentlyStoredFiles.total}</dd>
              </div>
              <div>
                <dt>Activated</dt>
                <dd>{date(detail.company.activatedAt)}</dd>
              </div>
            </dl>
            {detail.company.platformStatus === "suspended" ? (
              <Button busy={busy} onClick={() => changeStatus("reactivate")}>
                Reactivate company
              </Button>
            ) : (
              <div className="platform-actions">
                <label>
                  Suspension reason
                  <select
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  >
                    <option value="security_review">Security review</option>
                    <option value="policy_review">Policy review</option>
                    <option value="operational_hold">Operational hold</option>
                  </select>
                </label>
                <Button
                  busy={busy}
                  variant="danger"
                  onClick={() => changeStatus("suspend")}
                >
                  Suspend company
                </Button>
              </div>
            )}
          </section>
        )}
      </section>
    </main>
  );
}

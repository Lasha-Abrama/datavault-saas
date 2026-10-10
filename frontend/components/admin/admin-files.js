"use client";

import { useEffect, useState } from "react";
import { Button, Loading } from "@/components/ui";
import { bytes } from "@/lib/utils";

function DirectoryFilter({
  kind,
  token,
  load,
  selected,
  onChange,
  companyId,
  onUnauthorized,
}) {
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const timer = setTimeout(() => {
      const query = new URLSearchParams({ limit: "25", page: "1" });
      if (search.trim()) query.set("search", search.trim());
      if (companyId) query.set("companyId", companyId);
      load(`${kind === "Company" ? "companies" : "users"}?${query}`, {
        token,
        signal: controller.signal,
      })
        .then((data) => {
          if (!controller.signal.aborted) setRows(data.items);
        })
        .catch((failure) => {
          if (controller.signal.aborted) return;
          if (failure.status === 401) onUnauthorized();
          setError(failure.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [kind, token, load, search, companyId, retry]);
  return (
    <div className="platform-file-filter">
      <label>
        Find {kind.toLowerCase()}
        <input
          value={search}
          maxLength={80}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={kind === "Company" ? "Company name" : "Name or email"}
        />
      </label>
      <label>
        {kind} filter
        <select
          value={selected?.id || ""}
          disabled={loading}
          onChange={(event) =>
            onChange(rows.find((row) => row.id === event.target.value) || null)
          }
        >
          <option value="">
            All {kind === "Company" ? "companies" : "users"}
          </option>
          {selected && !rows.some((row) => row.id === selected.id) && (
            <option value={selected.id}>
              {selected.name ||
                selected.fullName ||
                selected.email ||
                selected.id}
            </option>
          )}
          {rows.map((row) => (
            <option key={row.id} value={row.id}>
              {kind === "Company"
                ? row.name
                : `${row.fullName || "Unnamed user"} · ${row.email}`}
            </option>
          ))}
        </select>
      </label>
      <small>
        {loading
          ? "Loading options…"
          : "Showing up to 25 matches. Search to narrow the list."}
      </small>
      {error && (
        <div role="alert">
          {error}{" "}
          <Button
            variant="secondary"
            onClick={() => setRetry((value) => value + 1)}
          >
            Retry {kind.toLowerCase()} options
          </Button>
        </div>
      )}
    </div>
  );
}

export default function AdminFiles({
  token,
  load,
  initialUser,
  onUnauthorized,
}) {
  const [company, setCompany] = useState(
    initialUser?.companyId
      ? { id: initialUser.companyId, name: initialUser.companyId }
      : null,
  );
  const [user, setUser] = useState(initialUser || null);
  const [draft, setDraft] = useState({ search: "", uploaderSearch: "" });
  const [search, setSearch] = useState(draft);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [sortBy, setSortBy] = useState("createdAt");
  const [order, setOrder] = useState("desc");
  const [fileType, setFileType] = useState("");
  const [visibility, setVisibility] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const query = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    sortBy,
    order,
  });
  for (const [name, value] of Object.entries({
    ...search,
    companyId: company?.id,
    userId: user?.id,
    fileType,
    visibility,
  }))
    if (value) query.set(name, value);
  const queryString = query.toString();
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError("");
    load(`files?${queryString}`, { token, signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((failure) => {
        if (controller.signal.aborted) return;
        if (failure.status === 401) onUnauthorized();
        setError(failure.message);
      });
    return () => controller.abort();
  }, [token, load, queryString, retry]);
  function scopeToUser(uploader, associatedCompany) {
    setUser(uploader);
    setCompany(associatedCompany);
    setDraft({ search: "", uploaderSearch: "" });
    setSearch({ search: "", uploaderSearch: "" });
    setFileType("");
    setVisibility("");
    setPage(1);
  }
  function clear() {
    scopeToUser(null, null);
  }
  return (
    <section aria-label="Admin file management">
      <form
        className="platform-file-search"
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          setSearch({
            search: draft.search.trim(),
            uploaderSearch: draft.uploaderSearch.trim(),
          });
        }}
      >
        <label>
          Filename
          <input
            value={draft.search}
            maxLength={80}
            onChange={(event) =>
              setDraft({ ...draft, search: event.target.value })
            }
            placeholder="Search filenames"
          />
        </label>
        <label>
          Uploader name or email
          <input
            value={draft.uploaderSearch}
            maxLength={80}
            onChange={(event) =>
              setDraft({ ...draft, uploaderSearch: event.target.value })
            }
            placeholder="Search uploaders"
          />
        </label>
        <Button variant="secondary">Search files</Button>
      </form>
      <div className="platform-file-filters">
        <DirectoryFilter
          kind="Company"
          token={token}
          load={load}
          selected={company}
          onUnauthorized={onUnauthorized}
          onChange={(value) => {
            setCompany(value);
            setUser(null);
            setPage(1);
          }}
        />
        <DirectoryFilter
          kind="User"
          token={token}
          load={load}
          selected={user}
          companyId={company?.id}
          onUnauthorized={onUnauthorized}
          onChange={(value) => {
            setUser(value);
            setPage(1);
          }}
        />
        <label>
          File type
          <select
            value={fileType}
            onChange={(event) => {
              setFileType(event.target.value);
              setPage(1);
            }}
          >
            <option value="">All formats</option>
            {["csv", "xls", "xlsx"].map((value) => (
              <option key={value} value={value}>
                {value.toUpperCase()}
              </option>
            ))}
          </select>
        </label>
        <label>
          File access
          <select
            value={visibility}
            onChange={(event) => {
              setVisibility(event.target.value);
              setPage(1);
            }}
          >
            <option value="">All access</option>
            <option value="company_wide">Company-wide</option>
            <option value="restricted">Restricted</option>
          </select>
        </label>
        <label>
          Sort files
          <select
            value={sortBy}
            onChange={(event) => {
              setSortBy(event.target.value);
              setPage(1);
            }}
          >
            <option value="createdAt">Upload date</option>
            <option value="originalFilename">Filename</option>
            <option value="size">Size</option>
          </select>
        </label>
        <label>
          Sort direction
          <select
            value={order}
            onChange={(event) => {
              setOrder(event.target.value);
              setPage(1);
            }}
          >
            <option value="desc">Descending</option>
            <option value="asc">Ascending</option>
          </select>
        </label>
        <label>
          Files per page
          <select
            value={limit}
            onChange={(event) => {
              setLimit(Number(event.target.value));
              setPage(1);
            }}
          >
            {[10, 25, 50, 100].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="platform-file-scope">
        <p>
          {user
            ? `Files uploaded by ${user.fullName || user.email || user.id}`
            : "Files from all uploaders"}
          {company ? ` · ${company.name || company.id}` : " · All companies"}
        </p>
        <Button variant="secondary" onClick={clear}>
          Clear filters
        </Button>
      </div>
      <p className="muted small">
        This directory shows file metadata. Download, deletion, and access
        changes remain in the company workspace.
      </p>
      {error ? (
        <div role="alert" className="platform-error">
          {error}{" "}
          <Button
            variant="secondary"
            onClick={() => setRetry((value) => value + 1)}
          >
            Retry files
          </Button>
        </div>
      ) : !data ? (
        <Loading label="Loading files" />
      ) : (
        <>
          {data.items.length === 0 ? (
            <p role="status" className="platform-files-empty">
              No files match these filters.
            </p>
          ) : (
            <div
              className="table-scroll platform-files-scroll"
              role="region"
              aria-label="Scrollable file metadata"
              tabIndex={0}
            >
              <table className="platform-files-table">
                <caption className="sr-only">Platform file metadata</caption>
                <thead>
                  <tr>
                    {[
                      "File",
                      "Size",
                      "Uploaded",
                      "Uploaded by",
                      "Company",
                      "Access",
                      "Actions",
                    ].map((title) => (
                      <th scope="col" key={title}>
                        {title}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((file) => (
                    <tr key={file.id}>
                      <td>
                        <strong>{file.originalFilename}</strong>
                        <small>{file.fileType.toUpperCase()}</small>
                      </td>
                      <td>{bytes(file.size)}</td>
                      <td>
                        <time dateTime={file.createdAt}>
                          {file.createdAt
                            ? new Date(file.createdAt).toLocaleString()
                            : "Date unavailable"}
                        </time>
                      </td>
                      <td>
                        <strong>
                          {file.uploader?.fullName ||
                            file.uploader?.email ||
                            "Uploader unavailable"}
                        </strong>
                        <small>{file.uploader?.email || file.uploaderId}</small>
                      </td>
                      <td>
                        {file.company?.name || "Company unavailable"}
                        <small>{file.companyId}</small>
                      </td>
                      <td>
                        {file.visibility === "restricted"
                          ? "Restricted"
                          : "Company-wide"}
                      </td>
                      <td>
                        {file.uploader && (
                          <button
                            type="button"
                            className="platform-text-button"
                            onClick={() =>
                              scopeToUser(
                                file.uploader,
                                file.company || { id: file.companyId },
                              )
                            }
                          >
                            View uploader files
                            <span className="sr-only">
                              {" "}
                              for{" "}
                              {file.uploader.fullName || file.uploader.email}
                            </span>
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="platform-pager">
            <span role="status">
              {data.pagination.total} files · Page {page}
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
                disabled={page * limit >= data.pagination.total || page >= 1000}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

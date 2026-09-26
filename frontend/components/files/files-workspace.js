"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  FileUp,
  LockKeyhole,
  Search,
  SlidersHorizontal,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { collection, request, upload } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useResource } from "@/lib/hooks";
import { bytes, date, filterFiles, storageEnabled } from "@/lib/utils";
import {
  Alert,
  Badge,
  Button,
  Confirm,
  Empty,
  ErrorState,
  Field,
  FileIcon,
  Loading,
  Modal,
  PageHeading,
  Progress,
  useToast,
  Visibility,
} from "@/components/ui";
import { useWorkspace } from "@/components/layout/shell";
export function FileTable({ files, users = [], onSelect, compact = false }) {
  const { user } = useAuth();
  const uploader = (id) =>
    id === user._id
      ? "You"
      : users.find((u) => u._id === id)?.fullName ||
        users.find((u) => u._id === id)?.email ||
        "Company member";
  return (
    <div className="table-scroll">
      <table className="file-table">
        <thead>
          <tr>
            <th>File name</th>
            <th>Uploaded by</th>
            <th>Date added</th>
            <th>Visibility</th>
            <th>
              <span className="sr-only">Details</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {files.map((file) => (
            <tr key={file.id}>
              <td>
                <button className="file-name" onClick={() => onSelect(file)}>
                  <FileIcon type={file.fileType} />
                  <span>
                    <strong>{file.originalFilename}</strong>
                    <small>
                      {bytes(file.size)} · {file.fileType.toUpperCase()}
                    </small>
                  </span>
                </button>
              </td>
              <td>{uploader(file.uploaderId)}</td>
              <td>{date(file.createdAt)}</td>
              <td>
                <Visibility value={file.visibility} />
              </td>
              <td>
                <button
                  className="icon-button"
                  aria-label={`View ${file.originalFilename}`}
                  onClick={() => onSelect(file)}
                >
                  <ArrowRight size={17} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function Permissions({ value, onChange, users, isAdmin, user }) {
  const [search, setSearch] = useState("");
  const employees = users.filter((u) => u.role === "company_member");
  return (
    <fieldset className="permissions">
      <legend>Who can access this file?</legend>
      {[
        [
          "company_wide",
          "Everyone in the company",
          "A shared resource for your whole workspace.",
        ],
        [
          "restricted",
          "Selected employees only",
          "Only selected employees, the uploader, and administrators.",
        ],
      ].map(([id, title, help]) => (
        <label
          className={`radio-card ${value.visibility === id ? "selected" : ""}`}
          key={id}
        >
          <input
            type="radio"
            name="visibility"
            value={id}
            checked={value.visibility === id}
            onChange={() =>
              onChange({
                visibility: id,
                restrictedUserIds:
                  id === "company_wide" ? [] : value.restrictedUserIds,
              })
            }
          />
          <span>
            <strong>{title}</strong>
            <small>{help}</small>
          </span>
        </label>
      ))}
      {value.visibility === "restricted" && (
        <div className="employee-picker">
          {isAdmin ? (
            <>
              <div className="search-field">
                <Search size={15} />
                <input
                  aria-label="Search employees"
                  placeholder="Find an employee…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="checkbox-list">
                {employees
                  .filter((u) =>
                    `${u.fullName} ${u.email}`
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  )
                  .map((u) => (
                    <label key={u._id}>
                      <input
                        type="checkbox"
                        checked={value.restrictedUserIds.includes(u._id)}
                        onChange={(e) =>
                          onChange({
                            ...value,
                            restrictedUserIds: e.target.checked
                              ? [...value.restrictedUserIds, u._id]
                              : value.restrictedUserIds.filter(
                                  (id) => id !== u._id,
                                ),
                          })
                        }
                      />
                      <span>
                        {u.fullName || u.email}
                        <small>{u.email}</small>
                      </span>
                    </label>
                  ))}
              </div>
              {!employees.length && (
                <p className="muted small">
                  Invite an employee before creating restricted access.
                </p>
              )}
            </>
          ) : (
            <>
              <p className="muted small">
                The employee directory is available to administrators. You can
                retain existing recipients or restrict a file to yourself. Ask
                an administrator to add other employees.
              </p>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={value.restrictedUserIds.includes(user._id)}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      restrictedUserIds: e.target.checked
                        ? [...value.restrictedUserIds, user._id]
                        : value.restrictedUserIds.filter(
                            (id) => id !== user._id,
                          ),
                    })
                  }
                />
                Include me
              </label>
              {value.restrictedUserIds
                .filter((id) => id !== user._id)
                .map((id) => (
                  <div className="chip" key={id}>
                    Employee {id.slice(-6)}
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Remove recipient"
                      onClick={() =>
                        onChange({
                          ...value,
                          restrictedUserIds: value.restrictedUserIds.filter(
                            (v) => v !== id,
                          ),
                        })
                      }
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
            </>
          )}
          <small className="muted">
            {value.restrictedUserIds.length} selected · At least one employee
            required
          </small>
        </div>
      )}
    </fieldset>
  );
}
export function FileDetail({ file, users = [], onClose, onChanged }) {
  const { user, isAdmin } = useAuth(),
    toast = useToast();
  const detail = useResource(
    (signal) => request(`/files/${file.id}`, { signal }),
    [file.id],
  );
  const [permissions, setPermissions] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(null),
    [deleting, setDeleting] = useState(false);
  useEffect(() => {
    if (detail.data)
      setPermissions({
        visibility: detail.data.visibility,
        restrictedUserIds: detail.data.restrictedUserIds,
      });
  }, [detail.data]);
  const canEdit = isAdmin || file.uploaderId === user._id;
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await request(`/files/${file.id}/permissions`, {
        method: "PATCH",
        body: permissions,
      });
      toast("File access updated");
      onChanged();
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function download() {
    setBusy(true);
    setError(null);
    try {
      const blob = await request(`/files/${file.id}/download`, {
        binary: true,
      });
      const url = URL.createObjectURL(blob),
        anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.originalFilename;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Modal title="File details" onClose={onClose} busy={busy}>
        <div className="detail-file">
          <FileIcon type={file.fileType} />
          <div>
            <h3>{file.originalFilename}</h3>
            <p>
              {bytes(file.size)} · Added {date(file.createdAt)}
            </p>
          </div>
        </div>
        <Alert>{error?.message}</Alert>
        {detail.loading ? (
          <Loading label="Loading file access" />
        ) : detail.error ? (
          <ErrorState error={detail.error} retry={detail.reload} />
        ) : (
          <>
            <div className="detail-meta">
              <span>Last updated</span>
              <strong>{date(detail.data.updatedAt)}</strong>
              <span>Visibility</span>
              <Visibility value={detail.data.visibility} />
            </div>
            {canEdit && permissions && (
              <Permissions
                value={permissions}
                onChange={setPermissions}
                users={users}
                isAdmin={isAdmin}
                user={user}
              />
            )}
            <div className="modal-actions">
              {storageEnabled && (
                <Button busy={busy} variant="secondary" onClick={download}>
                  <ArrowDownToLine size={16} />
                  Download
                </Button>
              )}
              {canEdit && (
                <Button
                  busy={busy}
                  disabled={
                    !permissions ||
                    (permissions.visibility === "restricted" &&
                      !permissions.restrictedUserIds.length)
                  }
                  onClick={save}
                >
                  Save access
                </Button>
              )}
            </div>
            {!storageEnabled && (
              <Alert type="info">
                File storage is temporarily unavailable. Downloads and deletion
                will return when storage is connected.
              </Alert>
            )}
            {canEdit && storageEnabled && (
              <button className="danger-link" onClick={() => setDeleting(true)}>
                <Trash2 size={15} />
                Delete file
              </button>
            )}
          </>
        )}
      </Modal>
      {deleting && (
        <Confirm
          title="Delete this file?"
          description={`“${file.originalFilename}” will be permanently removed from your company’s vault. This cannot be undone.`}
          onClose={() => setDeleting(false)}
          onConfirm={async () => {
            await request(`/files/${file.id}`, { method: "DELETE" });
            toast("File deleted");
            onChanged();
            onClose();
          }}
        />
      )}
    </>
  );
}
function UploadDialog({ users, onClose, onUploaded }) {
  const { user, isAdmin } = useAuth(),
    { subscription } = useWorkspace(),
    toast = useToast();
  const [file, setFile] = useState(null),
    [permissions, setPermissions] = useState({
      visibility: "company_wide",
      restrictedUserIds: [],
    }),
    [progress, setProgress] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(null),
    [dragging, setDragging] = useState(false);
  const controller = useRef(null),
    input = useRef(null);
  useEffect(() => () => controller.current?.abort(), []);
  function choose(selected) {
    setError(null);
    if (!selected) return;
    if (!/\.(csv|xlsx?)$/i.test(selected.name) || !selected.size) {
      setError(new Error("Choose a non-empty CSV, XLS, or XLSX file."));
      return;
    }
    setFile(selected);
  }
  async function send() {
    setBusy(true);
    setError(null);
    setProgress(0);
    controller.current = new AbortController();
    try {
      await upload(file, permissions, setProgress, controller.current.signal);
      toast("File added to your vault");
      onUploaded();
      onClose();
    } catch (e) {
      setError(e);
      onUploaded();
    } finally {
      setBusy(false);
    }
  }
  const atLimit =
    subscription &&
    subscription.plan.extraFilePriceCents === null &&
    subscription.billingPeriod.uploadedFiles >=
      subscription.plan.includedFilesPerMonth;
  return (
    <Modal title="Add a file to your vault" onClose={onClose} busy={busy}>
      <Alert>{error?.message}</Alert>
      <div
        className={`dropzone ${dragging ? "dragging" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!busy) choose(e.dataTransfer.files[0]);
        }}
      >
        <FileUp size={30} />
        <h3>{file ? file.name : "Drop your file here"}</h3>
        <p>
          {file ? bytes(file.size) : "CSV, XLS, or XLSX · One file at a time"}
        </p>
        <input
          ref={input}
          type="file"
          accept=".csv,.xls,.xlsx"
          className="sr-only"
          aria-label="Choose a file"
          disabled={busy}
          onChange={(e) => choose(e.target.files[0])}
        />
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => input.current.click()}
        >
          {file ? "Choose another file" : "Browse files"}
        </Button>
        {file && !busy && (
          <button className="text-link" onClick={() => setFile(null)}>
            Remove
          </button>
        )}
      </div>
      <p className="small muted">
        {subscription?.billingPeriod.uploadedFiles ?? "—"} /{" "}
        {subscription?.plan.includedFilesPerMonth ?? "—"} included monthly files
        used.
      </p>
      {atLimit && (
        <Alert>
          Your plan’s monthly upload limit has been reached. Change your plan to
          add more files.
        </Alert>
      )}
      <Permissions
        value={permissions}
        onChange={setPermissions}
        users={users}
        isAdmin={isAdmin}
        user={user}
      />
      {busy && (
        <div role="status">
          <Progress value={progress} max={100} label="Upload progress" />
          <p className="small muted">
            {progress === 100
              ? "File transferred. Waiting for the server to confirm…"
              : `Uploading · ${progress}%`}
          </p>
          <Button
            variant="secondary"
            onClick={() => controller.current?.abort()}
          >
            Stop upload
          </Button>
        </div>
      )}
      <div className="modal-actions">
        <Button
          busy={busy}
          disabled={
            !file ||
            atLimit ||
            !subscription ||
            (permissions.visibility === "restricted" &&
              !permissions.restrictedUserIds.length)
          }
          onClick={send}
        >
          <Upload size={16} />
          Upload file
        </Button>
      </div>
    </Modal>
  );
}
export default function FilesPage() {
  const { isAdmin } = useAuth(),
    { reload: reloadWorkspace } = useWorkspace();
  const files = useResource(
    (signal) => collection("/files", "files", signal),
    [],
  );
  const people = useResource(
    (signal) =>
      isAdmin ? collection("/users", "users", signal) : Promise.resolve([]),
    [isAdmin],
  );
  const [filters, setFilters] = useState({
      search: "",
      type: "",
      visibility: "",
      sort: "newest",
    }),
    [selected, setSelected] = useState(null),
    [uploading, setUploading] = useState(false);
  useEffect(() => {
    setFilters((f) => ({
      ...f,
      search: new URLSearchParams(window.location.search).get("q") || "",
    }));
  }, []);
  const change = (key, value) => setFilters((f) => ({ ...f, [key]: value }));
  const visible = filterFiles(files.data || [], filters);
  const reload = () => {
    files.reload();
    reloadWorkspace();
  };
  return (
    <>
      <PageHeading
        eyebrow="YOUR COMPANY’S KNOWLEDGE, TOGETHER"
        title="The file vault"
        description="A single home for the data that keeps your business moving."
        action={
          storageEnabled ? (
            <Button onClick={() => setUploading(true)}>
              <Upload size={17} />
              Upload file
            </Button>
          ) : (
            <Badge tone="amber">Storage temporarily unavailable</Badge>
          )
        }
      />
      {!storageEnabled && (
        <div className="storage-note">
          <LockKeyhole size={22} />
          <div>
            <strong>
              Your vault is ready. File storage is being connected.
            </strong>
            <p>
              You can browse available files and manage access. Uploads,
              downloads, and deletion will be available once storage is
              connected.
            </p>
          </div>
        </div>
      )}
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>
              All files{" "}
              <span className="count">{files.data?.length ?? "—"}</span>
            </h2>
            <p>Only files you have access to appear here.</p>
          </div>
          <SlidersHorizontal size={18} />
        </div>
        <div className="file-filters">
          <div className="search-field">
            <Search size={17} />
            <input
              placeholder="Search file names…"
              aria-label="Search file names"
              value={filters.search}
              onChange={(e) => change("search", e.target.value)}
            />
          </div>
          <select
            aria-label="File type"
            value={filters.type}
            onChange={(e) => change("type", e.target.value)}
          >
            <option value="">All formats</option>
            <option value="csv">CSV</option>
            <option value="xls">XLS</option>
            <option value="xlsx">XLSX</option>
          </select>
          <select
            aria-label="Visibility"
            value={filters.visibility}
            onChange={(e) => change("visibility", e.target.value)}
          >
            <option value="">All access</option>
            <option value="company_wide">Company-wide</option>
            <option value="restricted">Restricted</option>
          </select>
          <select
            aria-label="Sort files"
            value={filters.sort}
            onChange={(e) => change("sort", e.target.value)}
          >
            <option value="newest">Newest first</option>
            <option value="name">Name A–Z</option>
            <option value="size">Largest first</option>
          </select>
        </div>
        {files.loading ? (
          <Loading label="Loading your files" />
        ) : files.error ? (
          <ErrorState error={files.error} retry={files.reload} />
        ) : visible.length ? (
          <FileTable
            files={visible}
            users={people.data || []}
            onSelect={setSelected}
          />
        ) : files.data?.length ? (
          <Empty
            title="No matching files"
            description="Try a different name, format, or visibility filter."
          >
            <Button
              variant="secondary"
              onClick={() =>
                setFilters({
                  search: "",
                  type: "",
                  visibility: "",
                  sort: "newest",
                })
              }
            >
              Clear filters
            </Button>
          </Empty>
        ) : (
          <Empty>
            {storageEnabled && (
              <Button onClick={() => setUploading(true)}>
                Upload your first file
              </Button>
            )}
          </Empty>
        )}
        <div className="table-footer">
          <span>
            {visible.length} files{" "}
            {filters.search || filters.type || filters.visibility
              ? "matching your filters"
              : "in your view"}
          </span>
          <span>CSV / XLS / XLSX</span>
        </div>
      </section>
      {selected && (
        <FileDetail
          file={selected}
          users={people.data || []}
          onClose={() => setSelected(null)}
          onChanged={reload}
        />
      )}{" "}
      {uploading && (
        <UploadDialog
          users={people.data || []}
          onClose={() => setUploading(false)}
          onUploaded={reload}
        />
      )}
    </>
  );
}

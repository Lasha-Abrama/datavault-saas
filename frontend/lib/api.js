// Same-origin gateway forwards to NEXT_PUBLIC_API_URL without a backend /api prefix.
export const API_URL = "/backend";
const KEY = "datavault.session";
export const session = {
  get() {
    try {
      return sessionStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
  set(token) {
    sessionStorage.setItem(KEY, token);
  },
  clear() {
    try {
      sessionStorage.removeItem(KEY);
    } catch {}
  },
};
export class ApiError extends Error {
  constructor(status, body, context = "") {
    const messages = {
      400: "Please check your details and try again.",
      401:
        context === "/auth/sign-in"
          ? "We couldn’t sign you in. Check your email and password, and make sure your account is activated."
          : context === "/users/me/password"
            ? "Your current password could not be verified."
            : "Your session has ended or your account is unavailable. Please sign in again.",
      403: "You don’t have permission for this action, or your plan limit has been reached.",
      404: "This item is unavailable or you no longer have access to it.",
      409: "These details are already in use, or this action conflicts with an existing record.",
      413: "This file exceeds the server’s upload limit. Please choose a smaller file.",
      429: "Too many requests. Please wait a minute before trying again.",
      503: "This service is temporarily unavailable. Please try again later.",
    };
    super(
      messages[status] ||
        "We couldn’t connect to DataVault. Please check your connection and try again.",
    );
    this.status = status;
    this.code = typeof body?.code === "string" ? body.code : "";
    if (context.startsWith("/ai/")) {
      const aiMessages = {
        ai_disabled: "The AI assistant is not enabled on the server yet.",
        ai_message_too_long:
          "Your message exceeds the service limit. Shorten it and try again.",
        ai_conversation_limit:
          "Your conversation limit has been reached. Delete an old conversation to start another.",
        ai_conversation_message_limit:
          "This conversation is full. Start a new conversation to continue.",
        ai_timeout:
          "The assistant took too long to respond. Check your conversation history before trying again.",
        ai_invalid_response:
          "The assistant could not produce a usable response. Please try again later.",
        ai_tool_request_invalid:
          "The assistant could not complete the workspace lookup. Try a simpler question.",
        ai_internal_error:
          "The assistant could not complete your request. Your draft has been kept.",
      };
      this.message =
        aiMessages[this.code] ||
        (status === 409
          ? "This conversation is processing another request. Wait a moment, then refresh it."
          : status === 502 || status === 503 || status === 504
            ? "The assistant is temporarily unavailable. Your draft has been kept; check history before trying again."
            : this.message);
    }
    this.fields = {};
    if (status === 400 && Array.isArray(body?.message)) {
      for (const item of body.message) {
        const field = String(item).split(" ")[0];
        this.fields[field] = "Please check this field’s format and length.";
      }
    }
    if (
      status === 400 &&
      ["/auth/verify-account", "/invitations/accept"].includes(context)
    )
      this.message =
        "This link is invalid, expired, or has already been used. Try signing in, or request a new link.";
    if (
      status === 503 &&
      context === "/auth/sign-up" &&
      body?.message ===
        "Registration was saved, but the activation email could not be delivered. Please request another activation email."
    )
      this.message =
        "Your registration was saved, but the activation email could not be sent. Use “Resend activation” instead of registering again.";
    if (
      status === 503 &&
      context === "/invitations" &&
      body?.message ===
        "The invitation was created but its email could not be sent. Resend it later."
    )
      this.message =
        "The invitation may have been saved, but its email could not be sent. Refresh the list and use Resend.";
  }
}
function expire(status, path, authenticated) {
  if (status === 401 && authenticated && path !== "/users/me/password") {
    session.clear();
    window.dispatchEvent(new Event("datavault:expired"));
  }
}
export async function request(
  path,
  {
    method = "GET",
    body,
    signal,
    public: isPublic = false,
    binary = false,
  } = {},
) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(abort, 90000);
  const token = !isPublic && session.get();
  try {
    const response = await fetch(`${API_URL}${path}`, {
      method,
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      expire(response.status, path, !!token);
      throw new ApiError(response.status, data, path);
    }
    return binary
      ? response.blob()
      : response.status === 204
        ? null
        : response.json();
  } catch (error) {
    if (signal?.aborted || error instanceof ApiError) throw error;
    throw new ApiError(0);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
export async function collection(path, key, signal) {
  let page = 1,
    items = [],
    result;
  do {
    result = await request(`${path}?page=${page++}&take=30`, { signal });
    items.push(...result[key]);
  } while (items.length < result.total && result[key].length);
  return items;
}
export function upload(file, permissions, onProgress, signal) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}/files`);
    xhr.timeout = 90000;
    const token = session.get();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        onProgress(Math.round((event.loaded / event.total) * 100));
    };
    const abort = () => xhr.abort();
    signal?.addEventListener("abort", abort, { once: true });
    xhr.onloadend = () => signal?.removeEventListener("abort", abort);
    xhr.onload = () => {
      let body = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {}
      expire(xhr.status, "/files", !!token);
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new ApiError(xhr.status, body, "/files"));
    };
    xhr.onerror = xhr.ontimeout = () => reject(new ApiError(0));
    xhr.onabort = () =>
      reject(
        new Error(
          "Upload stopped. Refresh the file list before retrying; the server may already have received the file.",
        ),
      );
    const data = new FormData();
    data.append("file", file);
    data.append("visibility", permissions.visibility);
    data.append(
      "restrictedUserIds",
      JSON.stringify(permissions.restrictedUserIds),
    );
    if (signal?.aborted) reject(new Error("Upload cancelled."));
    else xhr.send(data);
  });
}

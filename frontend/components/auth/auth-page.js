"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  ShieldCheck,
  CircleHelp,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { googleSignInUrl, request } from "@/lib/api";
import { Alert, Button, Field, Logo, Loading } from "@/components/ui";
import LivingVault from "./living-vault";
import { paymentReturnPaths } from "@/lib/payments";
function loginDestination() {
  const next = new URLSearchParams(window.location.search).get("next");
  return paymentReturnPaths.includes(next) ? next : "/dashboard";
}
const titles = {
  login: ["Welcome back.", "Your company’s data. Right where you left it."],
  register: [
    "A home for your data.",
    "Create your workspace. Bring clarity to your company.",
  ],
  activate: [
    "Unlock your workspace.",
    "Verify your email to get started with DataVault.",
  ],
  "employee-activate": [
    "Your team is waiting.",
    "Accept your invitation and join your company’s workspace.",
  ],
  "forgot-password": ["Let’s get you back in.", "Account recovery"],
  "reset-password": ["Reset your password.", "Account recovery"],
};
export default function AuthPage({ mode }) {
  const { user, loading, login, exchangeGoogle, registerWithGoogle } =
      useAuth(),
    router = useRouter();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(null),
    [success, setSuccess] = useState(""),
    [resendNotice, setResendNotice] = useState(""),
    [token, setToken] = useState(""),
    [tokenReady, setTokenReady] = useState(false),
    [email, setEmail] = useState(""),
    [googleCode, setGoogleCode] = useState(""),
    [oauthStatus, setOauthStatus] = useState(
      mode === "login" ? "checking" : "idle",
    );
  const captured = useRef(false);
  const oauthCaptured = useRef(false);
  const googleUrl = ["login", "register"].includes(mode)
    ? googleSignInUrl()
    : null;
  useEffect(() => {
    if (
      !loading &&
      user &&
      oauthStatus === "idle" &&
      ["login", "register"].includes(mode)
    )
      router.replace(loginDestination());
  }, [user, loading, mode, oauthStatus, router]);
  useEffect(() => {
    if (mode !== "login" || oauthCaptured.current) return;
    oauthCaptured.current = true;
    const url = new URL(window.location.href);
    const fragment = new URLSearchParams(url.hash.slice(1));
    const code = fragment.get("code");
    const denied = url.searchParams.get("error");
    if (code !== null || denied !== null) {
      url.searchParams.delete("error");
      window.history.replaceState(
        window.history.state,
        "",
        url.pathname + url.search,
      );
    }
    if (denied !== null) {
      setError(
        new Error(
          denied === "account_unavailable"
            ? "This account is not active. Try signing in or request a new activation email."
            : denied === "google_auth_cancelled"
              ? "Google sign-in was cancelled. You can try again below."
              : "Google sign-in could not be completed. Please try again.",
        ),
      );
      setOauthStatus("idle");
      return;
    }
    if (code === null) {
      setOauthStatus("idle");
      return;
    }
    if (
      fragment.getAll("code").length !== 1 ||
      !/^[A-Za-z0-9_-]{43}$/.test(code)
    ) {
      setError(
        new Error(
          "This Google sign-in link is invalid. Please try Google sign-in again.",
        ),
      );
      setOauthStatus("idle");
      return;
    }
    setOauthStatus("exchanging");
    void exchangeGoogle(code)
      .then(() => router.replace(loginDestination()))
      .catch((failure) => setError(failure))
      .finally(() => setOauthStatus("idle"));
  }, [mode, exchangeGoogle, router]);
  useEffect(() => {
    if (mode !== "register") return;
    const url = new URL(window.location.href);
    const fragment = new URLSearchParams(url.hash.slice(1));
    const code = fragment.get("google_code");
    if (!code) return;
    window.history.replaceState(
      window.history.state,
      "",
      url.pathname + url.search,
    );
    if (
      fragment.getAll("google_code").length === 1 &&
      /^[A-Za-z0-9_-]{43}$/.test(code)
    )
      setGoogleCode(code);
    else
      setError(
        new Error(
          "This Google registration link is invalid. Try Google again.",
        ),
      );
  }, [mode]);
  useEffect(() => {
    if (captured.current) return;
    captured.current = true;
    const url = new URL(window.location.href);
    setToken(url.searchParams.get("token") || "");
    if (url.searchParams.has("token")) {
      url.searchParams.delete("token");
      window.history.replaceState(null, "", url.pathname + url.search);
    }
    setTokenReady(true);
  }, []);
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      if (mode === "login") {
        await login(values);
        router.replace(loginDestination());
      }
      if (mode === "register") {
        if (googleCode) {
          await registerWithGoogle({
            code: googleCode,
            companyName: values.companyName,
            country: values.country,
            industry: values.industry,
          });
          setGoogleCode("");
          router.replace("/dashboard");
        } else {
          await request("/auth/sign-up", {
            method: "POST",
            body: values,
            public: true,
          });
          setEmail(values.email);
          setSuccess(
            "Your workspace has been created. Check your inbox for an activation link, valid for 24 hours. Activate your account before signing in.",
          );
        }
      }
      if (mode === "activate") {
        await request("/auth/verify-account", {
          method: "POST",
          body: { token },
          public: true,
        });
        setToken("");
        setSuccess(
          "Your account is activated. Your workspace is ready for you.",
        );
      }
      if (mode === "employee-activate") {
        await request("/invitations/accept", {
          method: "POST",
          body: { ...values, token },
          public: true,
        });
        setToken("");
        setSuccess(
          "Invitation accepted. Sign in to open your company’s workspace.",
        );
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function resend(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await request("/auth/resend-verification", {
        method: "POST",
        body: { email },
        public: true,
      });
      setResendNotice(
        "If your account is eligible, a new activation email has been requested. Check your inbox and spam folder.",
      );
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  const recovery = ["forgot-password", "reset-password"].includes(mode),
    activation = ["activate", "employee-activate"].includes(mode);
  return (
    <main className="auth-layout">
      <section className="auth-story">
        <LivingVault />
        <Link href="/login" aria-label="DataVault home">
          <Logo light />
        </Link>
        <div className="story-body">
          <span className="eyebrow">THE COMPANY DATA WORKSPACE</span>
          <h1>
            Everything <br />
            in its <br />
            <em>right place.</em>
          </h1>
          <p>
            A considered space for the information that moves your business
            forward.
          </p>
        </div>
        <footer>BUILT FOR THE WAY YOUR COMPANY WORKS</footer>
      </section>
      <section className="auth-form-side">
        <div className="auth-top">
          <span>
            {mode === "register"
              ? "Already have a workspace?"
              : "New to DataVault?"}
          </span>
          <Link href={mode === "register" ? "/login" : "/register"}>
            {mode === "register" ? "Sign in" : "Create a workspace"}{" "}
            <ArrowUpRight size={14} />
          </Link>
        </div>
        <div className="auth-form-wrap">
          <span className="eyebrow auth-step">
            DATAVAULT /{" "}
            {mode === "register"
              ? "CREATE WORKSPACE"
              : mode === "login"
                ? "SIGN IN"
                : "ACCOUNT ACCESS"}
          </span>
          <h2>{titles[mode][0]}</h2>
          <p className="auth-subtitle">{titles[mode][1]}</p>
          <Alert>
            {error?.code === "account_exists" ? null : error?.message}
          </Alert>
          <Alert type="success">{resendNotice}</Alert>
          {error?.code === "account_exists" ? (
            <div className="success-panel account-state" role="alert">
              <CircleHelp size={32} />
              <h3>This account already exists</h3>
              <p>
                Use your existing account to get back to your workspace. If you
                have not activated it yet, request a new link below.
              </p>
              <Link className="button" href="/login">
                Sign in <ArrowRight size={16} />
              </Link>
              <button
                className="text-link"
                type="button"
                onClick={() => setError(null)}
              >
                Try another email
              </button>
            </div>
          ) : success ? (
            <div className="success-panel">
              <ShieldCheck size={32} />
              <h3>
                {mode === "register" ? "Check your inbox" : "You’re all set"}
              </h3>
              <p>{success}</p>
              <Link className="button" href="/login">
                Continue to sign in <ArrowRight size={16} />
              </Link>
            </div>
          ) : recovery ? (
            <>
              <Alert type="info">
                Email password recovery isn’t available yet. If you can still
                sign in, you can change your password in Settings → Security.
                Otherwise, contact your workspace administrator.
              </Alert>
              <Link className="button secondary" href="/login">
                Back to sign in
              </Link>
            </>
          ) : (loading || oauthStatus !== "idle") &&
            ["login", "register"].includes(mode) ? (
            <Loading
              label={
                oauthStatus === "exchanging"
                  ? "Completing Google sign-in"
                  : "Checking your session"
              }
            />
          ) : (
            <form onSubmit={submit} className="form-stack">
              {activation && tokenReady && !token ? (
                <Alert>
                  This link is missing its activation token. Open the complete
                  link from your email. If you already activated your account,
                  sign in below.
                </Alert>
              ) : (
                <>
                  {mode === "register" && (
                    <>
                      <div className="form-grid">
                        <Field
                          label="Company name"
                          name="companyName"
                          placeholder="Acme Studio"
                          minLength={2}
                          maxLength={100}
                          required
                          error={error?.fields?.companyName}
                        />
                        {!googleCode && (
                          <Field
                            label="Your name"
                            name="fullName"
                            placeholder="Alex Morgan"
                            maxLength={100}
                            required
                            autoComplete="name"
                            error={error?.fields?.fullName}
                          />
                        )}
                      </div>
                    </>
                  )}
                  {(mode === "login" ||
                    (mode === "register" && !googleCode)) && (
                    <Field
                      label="Work email"
                      name="email"
                      type="email"
                      placeholder="you@company.com"
                      required
                      maxLength={254}
                      autoComplete="email"
                      onChange={(e) => setEmail(e.target.value)}
                      error={error?.fields?.email}
                    />
                  )}
                  {mode === "employee-activate" && (
                    <>
                      <p className="muted small">
                        Your invitation connects you to the company that sent
                        your email. Invitations expire after 72 hours.
                      </p>
                      <Field
                        label="Full name"
                        name="fullName"
                        autoComplete="name"
                        required
                        maxLength={100}
                        error={error?.fields?.fullName}
                      />
                    </>
                  )}
                  {mode !== "activate" &&
                    !(mode === "register" && googleCode) && (
                      <Field
                        label={
                          mode === "login" ? "Password" : "Create a password"
                        }
                        name="password"
                        type="password"
                        required
                        minLength={6}
                        maxLength={20}
                        autoComplete={
                          mode === "login" ? "current-password" : "new-password"
                        }
                        hint={mode !== "login" ? "6–20 characters" : undefined}
                        error={error?.fields?.password}
                      />
                    )}
                  {mode === "register" && (
                    <div className="form-grid">
                      <Field
                        label="Country"
                        name="country"
                        placeholder="US"
                        pattern="[A-Za-z]{2}"
                        minLength={2}
                        maxLength={2}
                        required
                        hint="Two-letter country code, e.g. GE or US"
                        onInput={(e) => {
                          e.target.value = e.target.value.toUpperCase();
                        }}
                        error={error?.fields?.country}
                      />
                      <Field
                        label="Industry"
                        name="industry"
                        placeholder="Technology"
                        minLength={2}
                        maxLength={100}
                        required
                        error={error?.fields?.industry}
                      />
                    </div>
                  )}
                  {mode === "login" && (
                    <div className="form-end">
                      <Link href="/forgot-password">Forgot password?</Link>
                    </div>
                  )}
                  <Button
                    busy={busy}
                    className="full"
                    disabled={activation && !tokenReady}
                  >
                    {mode === "login"
                      ? "Sign in to your workspace"
                      : mode === "register"
                        ? googleCode
                          ? "Create workspace with Google"
                          : "Create your workspace"
                        : mode === "activate"
                          ? "Activate account"
                          : "Join your workspace"}
                    <ArrowRight size={17} />
                  </Button>
                  {busy && (
                    <p className="muted small" role="status">
                      Connecting… the first request may take a moment while
                      DataVault wakes up.
                    </p>
                  )}
                </>
              )}
            </form>
          )}
          {["login", "register"].includes(mode) &&
            googleUrl &&
            !loading &&
            !googleCode &&
            oauthStatus === "idle" && (
              <div className="oauth-choice">
                <span className="oauth-divider">or</span>
                <a className="button secondary full" href={googleUrl}>
                  Continue with Google <ArrowUpRight size={16} />
                </a>
                <p className="muted small">
                  {mode === "register"
                    ? "Verify your email with Google, then enter your company details here."
                    : "New here? Google will guide you through workspace setup."}
                </p>
              </div>
            )}
          {(mode === "activate" || mode === "register" || mode === "login") && (
            <details className="resend">
              <summary>Need a new activation email?</summary>
              <form className="form-stack" onSubmit={resend}>
                <Field
                  label="Account email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <Button busy={busy} variant="secondary">
                  Resend activation
                </Button>
              </form>
            </details>
          )}
          {activation && !success && (
            <Link className="text-link" href="/login">
              Already activated? Sign in <ArrowRight size={14} />
            </Link>
          )}
          <div className="auth-footnote">
            <ShieldCheck size={15} />
            <span>Your company’s data deserves a dedicated home.</span>
          </div>
          {mode === "login" && (
            <Link className="text-link" href="/admin">
              Platform admin sign in
            </Link>
          )}
        </div>
        <footer className="auth-bottom">
          <span>© {new Date().getFullYear()} DataVault</span>
          <span>Clarity. Control. Confidence.</span>
        </footer>
      </section>
    </main>
  );
}

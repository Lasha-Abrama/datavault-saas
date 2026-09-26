"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { ArrowRight, MessageCircle, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import AssistantWorkspace from "./assistant-workspace";
export default function FloatingAssistant() {
  const { user } = useAuth(),
    pathname = usePathname();
  const [open, setOpen] = useState(false),
    [visited, setVisited] = useState(false);
  const trigger = useRef(null),
    panel = useRef(null);
  function show() {
    setVisited(true);
    setOpen(true);
  }
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("assistant") === "open")
      show();
  }, [pathname]);
  useEffect(() => {
    if (open) panel.current?.focus();
  }, [open]);
  return (
    <div className="floating-assistant">
      <section
        ref={panel}
        tabIndex={-1}
        hidden={!open}
        id="datavault-chat"
        className="floating-chat-panel"
        role="dialog"
        aria-label="DataVault chat"
        onKeyDown={(e) => {
          if (e.key === "Escape" && !e.target.closest("dialog")) {
            e.stopPropagation();
            close();
          }
        }}
      >
        <header className="floating-chat-top">
          <span>
            <MessageCircle size={19} />
            Your DataVault assistant
          </span>
          <button
            className="icon-button"
            onClick={close}
            aria-label="Close chat"
          >
            <X size={20} />
          </button>
        </header>
        {user ? (
          visited && <AssistantWorkspace key={user._id} floating />
        ) : (
          <div className="chat-signin">
            <span className="assistant-emblem">
              <MessageCircle size={32} />
            </span>
            <h2>A little help, right here.</h2>
            <p>
              Sign in to ask questions about your workspace, explore your usage,
              or pick up a previous conversation.
            </p>
            <Link className="button" href="/login" onClick={close}>
              Sign in to chat <ArrowRight size={16} />
            </Link>
          </div>
        )}
      </section>
      <button
        ref={trigger}
        className="chat-launcher"
        aria-label={open ? "Minimize AI chat" : "Open AI chat"}
        aria-expanded={open}
        aria-controls="datavault-chat"
        onClick={open ? close : show}
      >
        {open ? <X size={23} /> : <MessageCircle size={24} />}
        <span>{open ? "Close" : "Ask DataVault"}</span>
      </button>
    </div>
  );
}

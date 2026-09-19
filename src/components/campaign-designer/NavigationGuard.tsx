"use client";

/**
 * Navigation guard for the Campaign Designer.
 *
 * While a simulation / detection chain is in progress, any attempt to leave —
 * clicking an internal link (sidebar section), reloading, or an in-page tab
 * switch routed through the imperative `attempt()` — is intercepted and a
 * confirmation dialog is shown with two choices:
 *
 *   • Stop Simulation   → onStop() then proceed
 *   • Run in Background  → proceed; the run keeps going server-side and stays
 *                          recoverable from the Simulation History tab
 *
 * The simulate step already runs detached on the server (it writes to a
 * SimulationRun row), so "Run in Background" genuinely keeps it alive; the run
 * is always recoverable from History.
 */

import {
  forwardRef, useEffect, useImperativeHandle, useRef, useState,
} from "react";
import { useRouter, usePathname } from "next/navigation";
import { AlertTriangle, Loader2 } from "lucide-react";

export interface NavGuardHandle {
  /** Run `action` immediately when idle; when active, hold it behind the dialog.
   *  Returns true if the action was intercepted (held), false if run now. */
  attempt: (action: () => void) => boolean;
}

interface Props {
  active: boolean;
  onStop: () => void | Promise<void>;
  message?: string;
}

export const NavigationGuardModal = forwardRef<NavGuardHandle, Props>(
  function NavigationGuardModal({ active, onStop, message }, ref) {
    const router = useRouter();
    const pathname = usePathname();
    const [pending, setPending] = useState<null | (() => void)>(null);
    const [stopping, setStopping] = useState(false);
    const activeRef = useRef(active);
    activeRef.current = active;
    const bypass = useRef(false);

    useImperativeHandle(ref, () => ({
      attempt(action: () => void) {
        if (!activeRef.current || bypass.current) { action(); return false; }
        setPending(() => action);
        return true;
      },
    }), []);

    // Intercept internal-link navigation + browser unload while active.
    useEffect(() => {
      if (!active) return;
      const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
      const onClick = (e: MouseEvent) => {
        if (!activeRef.current || bypass.current) return;
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        const a = (e.target as HTMLElement)?.closest?.("a") as HTMLAnchorElement | null;
        if (!a) return;
        const href = a.getAttribute("href");
        const tgt = a.getAttribute("target");
        if (!href || !href.startsWith("/") || href.startsWith("//")) return; // external / non-route
        if (tgt && tgt !== "_self") return;
        const path = href.split("?")[0].split("#")[0];
        if (path === pathname) return; // same page (e.g. in-page anchor)
        e.preventDefault();
        e.stopPropagation();
        setPending(() => () => router.push(href));
      };
      window.addEventListener("beforeunload", onBeforeUnload);
      document.addEventListener("click", onClick, true);
      return () => {
        window.removeEventListener("beforeunload", onBeforeUnload);
        document.removeEventListener("click", onClick, true);
      };
    }, [active, pathname, router]);

    if (!pending) return null;

    const proceed = () => {
      const action = pending;
      setPending(null);
      bypass.current = true;
      action?.();
      setTimeout(() => { bypass.current = false; }, 600);
    };
    const stopAndGo = async () => {
      setStopping(true);
      try { await onStop(); } finally { setStopping(false); }
      proceed();
    };

    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card shadow-xl">
          <div className="flex items-start gap-3 p-5 border-b border-border">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-warning/10">
              <AlertTriangle className="h-5 w-5 text-warning" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">Are you sure you want to change tabs?</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {message || "A simulation task is currently in progress."} You can keep it running in the
                background — it stays recoverable from Simulation History.
              </p>
            </div>
          </div>
          <div className="flex flex-col-reverse sm:flex-row items-center justify-end gap-2 p-4">
            <button onClick={() => setPending(null)}
              className="text-xs text-muted-foreground hover:text-foreground px-3 py-2">
              Cancel
            </button>
            <button onClick={stopAndGo} disabled={stopping}
              className="inline-flex items-center gap-1.5 rounded-lg border border-danger/40 px-3.5 py-2 text-xs font-medium text-danger hover:bg-danger/10 disabled:opacity-50">
              {stopping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Stop Simulation
            </button>
            <button onClick={proceed}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#60a5fa]">
              Run in Background
            </button>
          </div>
        </div>
      </div>
    );
  },
);

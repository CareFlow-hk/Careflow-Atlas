import { ChevronDown, LogOut, Settings2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { useAccount } from "../auth/accountContext";

/** The signed-in account in the header: one menu for settings and signing out. */
export function AccountMenu() {
  const account = useAccount();
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: Event) => {
      const details = menu.current;
      if (!details?.open) return;
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !details.contains(event.target as Node)) details.open = false;
    };
    document.addEventListener("pointerdown", close); document.addEventListener("keydown", close);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", close); };
  }, []);
  if (!account) return null;
  const choose = (action: () => void) => { if (menu.current) menu.current.open = false; action(); };
  return (
    <details className="account-menu" ref={menu}>
      <summary aria-label="帳號選單"><span className="account-menu__avatar" aria-hidden="true">{account.name.slice(0, 1)}</span><span className="account-menu__name">{account.name}</span><ChevronDown size={15} aria-hidden="true" /></summary>
      <div className="account-menu__list" role="menu">
        <p>{account.role === "ADMIN" ? "管理員" : "成員"}</p>
        <button type="button" role="menuitem" onClick={() => choose(account.openSettings)}><Settings2 size={16} />設定</button>
        <button type="button" role="menuitem" disabled={account.busy} onClick={() => choose(account.logout)}><LogOut size={16} />登出</button>
      </div>
    </details>
  );
}

/**
 * dsh-delete-session — client half.
 *
 * Registers one extra row in the session context menu (`sidebar.workspaces.session.menu.item`,
 * order 500: right after 归档会话) and talks to the host half over
 * `/api/dsh-delete-session/delete`.
 *
 * Hand-written in the module-loader's factory form on purpose: this plugin ships
 * no build step, so `lib/client.js` is the bundle.
 */
window.__ModuleLoader__.load({
  id: "dsh-delete-session",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    const React = require("react");
    const h = React.createElement;

    const inject = ["slots"];
    const ENDPOINT = "/api/dsh-delete-session/delete";

    /** zh unless the host locale looks English. */
    function pickLabel(props, zh, en) {
      try {
        if (props && typeof props.t === "function") {
          const archive = String(props.t("menu.archiveSession") || "");
          if (/archive/i.test(archive)) return en;
          if (archive.length > 0) return zh;
        }
      } catch {
        /* fall through to the document language */
      }
      const lang = String(document.documentElement?.lang || navigator.language || "").toLowerCase();
      return lang.startsWith("en") ? en : zh;
    }

    function TrashIcon(size) {
      return h(
        "svg",
        {
          width: size,
          height: size,
          viewBox: "0 0 16 16",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 1.2,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          "aria-hidden": "true",
          style: { flex: "none" },
        },
        h("path", { d: "M2.75 4.25h10.5" }),
        h("path", { d: "M6.25 4.25V3a.75.75 0 0 1 .75-.75h2a.75.75 0 0 1 .75.75v1.25" }),
        h("path", { d: "M4 4.25l.6 8.1a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9l.6-8.1" }),
        h("path", { d: "M6.75 6.75v4M9.25 6.75v4" }),
      );
    }

    function toast(text, tone) {
      try {
        const el = document.createElement("div");
        el.textContent = text;
        el.setAttribute("role", "status");
        const danger = tone === "error";
        Object.assign(el.style, {
          position: "fixed",
          left: "50%",
          bottom: "32px",
          transform: "translateX(-50%)",
          zIndex: "9999",
          maxWidth: "min(560px, 80vw)",
          padding: "10px 16px",
          borderRadius: "10px",
          fontSize: "13px",
          lineHeight: "20px",
          color: "#fff",
          background: danger ? "#b32d2d" : "rgba(28,30,34,.94)",
          boxShadow: "0 8px 24px rgba(0,0,0,.28)",
          pointerEvents: "none",
          transition: "opacity .2s ease",
        });
        document.body.appendChild(el);
        setTimeout(() => {
          el.style.opacity = "0";
          setTimeout(() => el.remove(), 220);
        }, danger ? 4200 : 2200);
      } catch {
        /* a toast is best effort */
      }
    }

    function closeMenu(props) {
      try {
        if (props && typeof props.useMenuOpenState === "function") return; // handled by the hook
      } catch {
        /* ignore */
      }
      try {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      } catch {
        /* ignore */
      }
    }

    /**
     * Whether the sidebar paints this session as the open one. The row's class
     * suffix is build-dependent, so this looks for the selected marker rather
     * than a literal class name; a miss just means "not current".
     */
    function isCurrentSession(sessionId) {
      try {
        const key = "session:" + sessionId;
        const marked = (element) => {
          const className = String((element && element.className) || "");
          return /_selected/.test(className) || /(^|\s)selected(\s|$)/.test(className)
            || (element.getAttribute && element.getAttribute("aria-selected") === "true");
        };
        for (const row of document.querySelectorAll('[data-row-key="' + key + '"]')) {
          if (marked(row)) return true;
        }
        for (const element of document.querySelectorAll('[class*="_selected"]')) {
          if (element.getAttribute && element.getAttribute("data-row-key") === key) return true;
        }
      } catch {
        /* the guard is best effort */
      }
      return false;
    }

    /** POST the deletion and return the host's answer. */
    async function requestDelete(sessionId, allowLive) {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          // Required by the host guard: cross-origin pages cannot add this
          // header without a preflight the webserver never answers.
          "x-dsh-delete-session": "1",
        },
        body: JSON.stringify({ sessionId, current: isCurrentSession(sessionId), allowLive: allowLive === true }),
      });
      let payload;
      try {
        payload = await response.json();
      } catch {
        payload = undefined;
      }
      if (payload === undefined || typeof payload !== "object") {
        return { ok: false, message: `删除请求失败（HTTP ${String(response.status)}）` };
      }
      return payload;
    }

    function DeleteSessionMenuItem(props) {
      const sessionId = props && props.sessionId;
      const title = (props && props.displayTitle) || sessionId || "";
      const label = pickLabel(props, "删除会话", "Delete session");
      const [hover, setHover] = React.useState(false);
      const [busy, setBusy] = React.useState(false);

      // The slot hands every row the menu's open state as a hook; call it only
      // when present so the component still renders stand-alone.
      let setMenuOpen = null;
      if (props && typeof props.useMenuOpenState === "function") {
        const [, setOpen] = props.useMenuOpenState();
        setMenuOpen = setOpen;
      }

      const onSelect = async () => {
        if (busy || typeof sessionId !== "string" || sessionId.length === 0) return;
        const confirmed = window.confirm(
          `确定删除会话「${title}」吗？\n\n该会话的全部记录会被永久删除，无法恢复。`,
        );
        if (!confirmed) return;
        if (typeof setMenuOpen === "function") setMenuOpen(false);
        else closeMenu(props);
        setBusy(true);
        try {
          let result = await requestDelete(sessionId, false);
          if (result && result.ok !== true && result.code === "session-live") {
            // Second gate for a session the host still holds in memory: the
            // DOM-based "current" check cannot be the only line of defence.
            const liveConfirmed = window.confirm(
              `会话「${title}」仍驻留在后台进程中。\n\n删除后若被自动保存，记录可能重新写回。确定仍要删除吗？`,
            );
            if (!liveConfirmed) {
              setBusy(false);
              return;
            }
            result = await requestDelete(sessionId, true);
          }
          if (result && result.ok === true) {
            toast(result.value?.wasLive ? "已删除会话（该会话此前驻留后台，若被自动保存可能写回）" : "已删除会话");
          } else {
            toast(String(result?.message || "删除失败"), "error");
          }
        } catch (error) {
          toast(`删除失败：${error instanceof Error ? error.message : String(error)}`, "error");
        } finally {
          setBusy(false);
        }
      };

      return h(
        "button",
        {
          type: "button",
          role: "menuitem",
          "data-dsh-delete-session": sessionId || "",
          disabled: busy,
          onClick: onSelect,
          onMouseEnter: () => setHover(true),
          onMouseLeave: () => setHover(false),
          style: {
            display: "flex",
            alignItems: "center",
            gap: "8px",
            width: "100%",
            minHeight: "28px",
            padding: "0 8px",
            border: 0,
            borderRadius: "6px",
            background: hover ? "var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12))" : "transparent",
            color: "#e5484d",
            font: "inherit",
            fontSize: "13px",
            lineHeight: "20px",
            textAlign: "left",
            cursor: busy ? "progress" : "pointer",
            opacity: busy ? 0.6 : 1,
          },
        },
        TrashIcon(14),
        h("span", null, label),
      );
    }

    function apply(ctx) {
      ctx.effect(
        () =>
          ctx.slots.inject("sidebar.workspaces.session.menu.item", () =>
            ctx.slots.register(
              {
                name: "sidebar.workspaces.session.menu.item",
                id: "delete-session",
                order: 500,
              },
              DeleteSessionMenuItem,
            ),
          ),
        "delete-session: session menu row",
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});

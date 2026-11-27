import React, { useEffect, useState } from "react";
type R = Record<string, any>;
type Api = (p: string, b?: any) => Promise<any>;
export function WorkspaceSwitcher({
  ws,
  api,
  onSwitch,
}: {
  ws: R;
  api: Api;
  onSwitch: () => void;
}) {
  const [items, setItems] = useState<R[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    api("/api/v1/tenants")
      .then((r) => setItems(r.workspaces))
      .catch((e) => setError(e.message));
  }, [ws]);
  return (
    <label className="workspace-switcher">
      Workspace
      <select
        aria-label="Organization workspace"
        value={ws.actor.org}
        onChange={(e) =>
          void api("/api/v1/tenants/switch", { org: e.target.value })
            .then(onSwitch)
            .catch((e) => setError(e.message))
        }
      >
        {items.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name} · {r.role}
          </option>
        ))}
      </select>
      {error && <small role="alert">{error}</small>}
    </label>
  );
}
export function TenantPanel({
  ws,
  api,
  open,
  refresh,
}: {
  ws: R;
  api: Api;
  open: (k: string, d?: R) => void;
  refresh: () => Promise<any>;
}) {
  const [info, setInfo] = useState<R | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    api("/api/v1/billing")
      .then(setInfo)
      .catch((e) => setError(e.message));
  }, [ws]);
  const go = async (path: string, body: R) => {
    setError("");
    try {
      const result = await api(path, body);
      location.assign(result.url);
    } catch (e: any) {
      setError(e.message);
    }
  };
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Workspace membership & modules</h2>
          <p>
            Membership roles, project permissions and module entitlements are
            managed separately.
          </p>
        </div>
        {ws.actor.role === "admin" && !ws.readOnly && (
          <div className="actions">
            <button onClick={() => open("tenant:create")}>
              Create separate workspace
            </button>
            <button onClick={() => open("tenant:member")}>
              Add existing account
            </button>
            {info?.entitlements.owner && (
              <button onClick={() => open("tenant:owner")}>
                Transfer workspace ownership
              </button>
            )}
          </div>
        )}
      </div>
      {info && (
        <div className="vendor-record">
          <h3>
            {info.entitlements.commercial
              ? "Hosted subscription"
              : "Community edition · MIT"}
          </h3>
          <p>
            {info.entitlements.commercial
              ? `Plan: ${info.entitlements.plan} · ${info.entitlements.status}`
              : "Both modules are included with no subscription or application-enforced usage limits."}
          </p>
          <p>
            Materials:{" "}
            {info.entitlements.materials ? "enabled" : "not included"} ·
            Manpower: {info.entitlements.manpower ? "enabled" : "not included"}
          </p>
          <p>
            {info.entitlements.usage.projects} projects ·{" "}
            {info.entitlements.usage.members} active members ·{" "}
            {(info.entitlements.usage.storageBytes / 1000000).toFixed(2)} MB
            evidence
          </p>
          {info.entitlements.commercial && info.entitlements.owner && (
            <>
              {!info.configured ? (
                <p>
                  The installation operator must configure Stripe prices, secret
                  key and webhook signing secret before checkout is available.
                </p>
              ) : (
                <>
                  <p>
                    Prices and payment terms are displayed by the payment
                    provider before you subscribe. Returning from checkout does
                    not unlock modules; a verified subscription event does.
                  </p>
                  {info.account && (
                    <button
                      onClick={() => void go("/api/v1/billing/portal", {})}
                    >
                      Manage subscription at Stripe
                    </button>
                  )}
                  {(!info.account || info.account.status === "canceled") &&
                    info.plans.map((p: R) => (
                      <button
                        key={p.id}
                        onClick={() =>
                          void go("/api/v1/billing/checkout", { plan: p.id })
                        }
                      >
                        Review {p.name} subscription
                      </button>
                    ))}
                </>
              )}
            </>
          )}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

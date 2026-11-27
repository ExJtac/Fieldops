export type Envelope = {
  version: 1;
  salt: string;
  iv: string;
  ciphertext: string;
};
const bytes = (value: string) =>
  Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
const base64 = (value: Uint8Array) => {
  let s = "";
  for (let i = 0; i < value.length; i += 32768)
    s += String.fromCharCode(...value.subarray(i, i + 32768));
  return btoa(s);
};
async function key(passphrase: string, salt: Uint8Array) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: 310000,
      salt: salt as BufferSource,
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
export async function seal(
  value: unknown,
  passphrase: string,
): Promise<Envelope> {
  if (passphrase.length < 12)
    throw new Error("Use at least 12 characters for the offline passphrase");
  const salt = crypto.getRandomValues(new Uint8Array(16)),
    iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  if (plaintext.length > 25000000)
    throw new Error(
      "Offline kit limit is 25 MB; sync or remove completed drafts",
    );
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: new TextEncoder().encode("CAS-FieldOps-offline-v1"),
    },
    await key(passphrase, salt),
    plaintext,
  );
  return {
    version: 1,
    salt: base64(salt),
    iv: base64(iv),
    ciphertext: base64(new Uint8Array(ciphertext)),
  };
}
export async function unseal(envelope: Envelope, passphrase: string) {
  if (envelope.version !== 1)
    throw new Error("Unsupported offline vault format");
  try {
    const clear = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: bytes(envelope.iv) as BufferSource,
        additionalData: new TextEncoder().encode("CAS-FieldOps-offline-v1"),
      },
      await key(passphrase, bytes(envelope.salt)),
      bytes(envelope.ciphertext) as BufferSource,
    );
    return JSON.parse(new TextDecoder().decode(clear));
  } catch {
    throw new Error(
      "Cannot unlock: incorrect passphrase or damaged encrypted data",
    );
  }
}
async function db() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("cas-fieldops-offline", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("vault");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function readVault(): Promise<Envelope | undefined> {
  const database = await db();
  try {
    return await new Promise((resolve, reject) => {
      const req = database
        .transaction("vault", "readonly")
        .objectStore("vault")
        .get("active");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    database.close();
  }
}
export async function writeVault(envelope: Envelope) {
  const database = await db();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction("vault", "readwrite");
      tx.objectStore("vault").put(envelope, "active");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Offline save aborted"));
    });
  } finally {
    database.close();
  }
}
export async function eraseVault() {
  const database = await db();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction("vault", "readwrite");
      tx.objectStore("vault").clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    database.close();
  }
}
export function fieldPackages(ws: any) {
  if (!["worker", "foreman", "pm", "admin"].includes(ws.actor.role))
    throw new Error("Field-work permission required");
  return {
    account: { id: ws.actor.id, org: ws.actor.org, name: ws.actor.name },
    cachedAt: new Date().toISOString(),
    packages: (ws.data.assignment || [])
      .filter((a: any) => a.status !== "Cancelled")
      .slice(0, 1000)
      .map((a: any) => {
        const t = ws.data.task.find((t: any) => t.id === a.taskId),
          p = ws.data.project.find((p: any) => p.id === a.projectId),
          w = ws.data.worker.find((w: any) => w.id === a.workerId);
        return {
          assignmentId: a.id,
          assignmentVersion: a.version,
          taskVersion: t.version,
          projectId: a.projectId,
          taskId: a.taskId,
          workerId: a.workerId,
          date: a.date,
          start: a.start ?? 7,
          hours: a.hours,
          plannedQuantity: a.plannedQuantity ?? null,
          project: p?.name,
          task: t.name,
          worker: w?.name,
          unit: t.unit,
          target: t.target,
          instructions: t.instructions,
          permits: t.permits || "",
          materials: (
            ws.readiness.find((r: any) => r.taskId === a.taskId)?.lines || []
          ).map((l: any) => ({
            part: l.partNumber,
            quantity: l.quantity,
            unit: l.unit,
            coverage: l.coverage,
            risk: l.risk,
          })),
        };
      }),
  };
}
